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
  issues?: ValidationIssue[];
  now?: string;
  /** 手动导出时用于确认覆盖；自动发布默认直接覆盖。 */
  confirmOverwrite?: (count: number) => Promise<boolean>;
};

const blocked = (error: ExportScopeError): PublishResult => ({
  status: 'blocked',
  reason: error.problem.code,
  message: error.problem.message,
  ...(error.problem.count !== undefined ? { count: error.problem.count } : {}),
});

// 自动发布面向无人值守的保存流程，直接覆盖目录中的同名文件，不做覆盖确认。
export async function publishProjectFiles(
  directory: string,
  project: ProjectFile,
  io: PublishIo,
  options: PublishOptions = {},
): Promise<PublishResult> {
  let plan;
  try {
    plan = buildExportPlan(project, { issues: options.issues });
    await assertSafeExportTarget(directory, options.projectPath, io);
  } catch (error) {
    if (error instanceof ExportScopeError) return blocked(error);
    throw error;
  }

  let manifest: PublishManifest | undefined;
  const manifestPath = publishManifestPath(directory);
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
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
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
            error:
              error.originalError instanceof Error
                ? error.originalError.message
                : String(error.originalError),
          };
    }

    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
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
  if (manifest) {
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
        `Published files but could not write the publish manifest: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    status: 'published',
    count: plan.files.length,
    removed,
    skippedTables: plan.skippedTables,
    skippedRows: plan.skippedRows,
    ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
  };
}
