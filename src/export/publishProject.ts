import type { ProjectFile, ValidationIssue } from '../model/types';
import {
  DesktopExportFileError,
  exportDesktopFiles,
  joinExportFilePath,
  type DesktopExportIo,
} from './desktopExport';
import { buildExportPlan, ExportScopeError } from './exportScope';
import { assertSafeExportTarget } from './exportSafety';
import {
  hashText,
  parsePublishManifest,
  PUBLISH_MANIFEST_FILE,
  publishManifestPath,
  type PublishManifest,
} from './publishManifest';

export type PublishResult =
  | {
      status: 'published';
      profileId: string;
      count: number;
      removed: number;
      skippedTables: number;
      skippedRows: number;
      warning?: string;
    }
  | { status: 'blocked'; reason: string; message: string; count?: number }
  | { status: 'write-failed'; fileName: string; error: string }
  | { status: 'verify-failed'; fileName: string }
  | { status: 'failed'; error: string };

export type PublishIo = Pick<DesktopExportIo, 'fileExists' | 'writeTextFile' | 'readTextFile'> & {
  /** 删除目标目录内、上一次发布清单里且内容未被改动过的旧文件。 */
  removeFile?(directory: string, fileName: string): Promise<void>;
};

export type PublishOptions = {
  projectPath?: string;
  projectKey?: string;
  /** 发布方案 id 或唯一名称；不传时用 activeProfileId。 */
  profileId?: string;
  issues?: ValidationIssue[];
  now?: string;
  /** 手动导出时用于确认覆盖；自动发布默认直接覆盖。 */
  confirmOverwrite?: (count: number) => Promise<boolean>;
  /**
   * 目标目录存在 legacy 清单（没有 profileId）时的显式确认。
   * 不提供回调时直接阻断，避免无人值守的自动发布静默接管旧目录。
   */
  confirmLegacyManifest?: (manifest: PublishManifest) => Promise<boolean>;
};

const blocked = (error: ExportScopeError): PublishResult => ({
  status: 'blocked',
  reason: error.problem.code,
  message: error.problem.message,
  ...(error.problem.count !== undefined ? { count: error.problem.count } : {}),
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// 自动发布面向无人值守的保存流程，直接覆盖目录中的同名文件，不做覆盖确认。
export async function publishProjectFiles(
  directory: string,
  project: ProjectFile,
  io: PublishIo,
  options: PublishOptions = {},
): Promise<PublishResult> {
  let plan;
  try {
    plan = buildExportPlan(project, {
      issues: options.issues,
      profileId: options.profileId,
    });
    await assertSafeExportTarget(directory, options.projectPath, io);
  } catch (error) {
    if (error instanceof ExportScopeError) return blocked(error);
    throw error;
  }

  const profileId = plan.profileId;
  if (!profileId) {
    return {
      status: 'blocked',
      reason: 'EXPORT_SCOPE_UNCONFIGURED',
      message:
        'Publishing requires a release profile; explicit full export bypasses it but is not a release.',
    };
  }

  const manifestPath = publishManifestPath(directory);
  let manifest: PublishManifest | undefined;
  let adoptLegacyManifest = false;
  try {
    if (await io.fileExists(manifestPath)) {
      const manifestText = await io.readTextFile(manifestPath);
      manifest = parsePublishManifest(manifestText);
      if (!manifest) {
        return {
          status: 'blocked',
          reason: 'INVALID_PUBLISH_MANIFEST',
          message: 'The publish manifest is invalid. Fix or remove it before publishing.',
        };
      }
      if (options.projectKey && manifest.projectKey !== options.projectKey) {
        return {
          status: 'blocked',
          reason: 'FOREIGN_PUBLISH_MANIFEST',
          message:
            'This directory belongs to another project. Choose a different publish directory.',
        };
      }
      if (manifest.profileId === undefined) {
        // 旧清单无法证明属于哪个方案：必须显式确认，且本次不清理旧文件。
        if (!options.confirmLegacyManifest) {
          return {
            status: 'blocked',
            reason: 'LEGACY_PUBLISH_MANIFEST',
            message:
              'This directory has a legacy publish manifest without a release profile. Publish manually once to confirm adopting it for the current profile.',
          };
        }
        if (!(await options.confirmLegacyManifest(manifest))) {
          return { status: 'failed', error: 'cancelled' };
        }
        adoptLegacyManifest = true;
      } else if (manifest.profileId !== profileId) {
        return {
          status: 'blocked',
          reason: 'FOREIGN_RELEASE_PROFILE',
          message:
            'This directory is owned by another release profile. Choose a different publish directory for this profile.',
        };
      }
    }
  } catch (error) {
    return { status: 'failed', error: errorMessage(error) };
  }

  try {
    const result = await exportDesktopFiles(directory, plan.files, {
      ...io,
      confirmOverwrite: options.confirmOverwrite ?? (async () => true),
    });
    if (result.status !== 'exported') {
      return { status: 'failed', error: 'cancelled' };
    }
  } catch (error) {
    if (error instanceof DesktopExportFileError) {
      return error.reason === 'verify'
        ? { status: 'verify-failed', fileName: error.fileName }
        : {
            status: 'write-failed',
            fileName: error.fileName,
            error: errorMessage(error.originalError),
          };
    }

    return { status: 'failed', error: errorMessage(error) };
  }

  const warnings: string[] = [];
  const nextFiles: Record<string, string> = {};
  for (const file of plan.files) {
    nextFiles[file.fileName] = await hashText(file.text);
  }

  let removed = 0;
  if (!manifest && options.projectKey) {
    warnings.push(
      'First publish to this directory; stale files from earlier exports were not removed.',
    );
  }
  if (adoptLegacyManifest) {
    warnings.push(
      'Adopted a legacy publish manifest; existing files were not removed during this publish.',
    );
  }
  if (manifest && !adoptLegacyManifest) {
    // 只清理本方案清单登记、且内容未被改动过的文件；绝不碰未知文件。
    const currentFileNames = new Set(plan.files.map((file) => file.fileName));
    for (const [fileName, previousHash] of Object.entries(manifest.files)) {
      if (currentFileNames.has(fileName) || fileName === PUBLISH_MANIFEST_FILE) continue;

      const filePath = joinExportFilePath(directory, fileName);
      let text: string;
      try {
        if (!(await io.fileExists(filePath))) continue;
        text = await io.readTextFile(filePath);
      } catch {
        warnings.push(`Could not inspect stale file ${fileName}.`);
        continue;
      }

      if ((await hashText(text)) !== previousHash) {
        warnings.push(`Kept modified stale file ${fileName}.`);
        continue;
      }

      if (!io.removeFile) {
        warnings.push(`Stale file ${fileName} was not removed.`);
        continue;
      }

      try {
        await io.removeFile(directory, fileName);
        removed += 1;
      } catch {
        warnings.push(`Could not remove stale file ${fileName}.`);
      }
    }
  }

  if (options.projectKey) {
    const nextManifest: PublishManifest = {
      version: 1,
      projectKey: options.projectKey,
      profileId,
      updatedAt: options.now ?? new Date().toISOString(),
      files: nextFiles,
    };
    try {
      await io.writeTextFile(
        manifestPath,
        `${JSON.stringify(nextManifest, null, 2)}\n`,
      );
    } catch (error) {
      warnings.push(
        `Published files but could not write the publish manifest: ${errorMessage(error)}`,
      );
    }
  }

  return {
    status: 'published',
    profileId,
    count: plan.files.length,
    removed,
    skippedTables: plan.skippedTables,
    skippedRows: plan.skippedRows,
    ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
  };
}
