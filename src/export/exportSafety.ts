import { ExportScopeError } from './exportScope';

export type ExportTargetIo = {
  fileExists(path: string): Promise<boolean>;
};

const normalizePath = (value: string) =>
  value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const joinPath = (directory: string, fileName: string) =>
  `${directory.replace(/[\\/]+$/, '')}/${fileName}`;

const fileNameOf = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const directoryOf = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index);
};

/**
 * 拒绝把运行时文件写进工程源目录、工程父目录或游戏工程根目录。
 * 发布目录可以是工程内的 out/ 子目录，但不能就是源文件所在目录。
 */
export async function assertSafeExportTarget(
  directory: string,
  projectPath: string | undefined,
  io: ExportTargetIo,
): Promise<void> {
  if (!projectPath) return;

  const target = normalizePath(directory);
  const project = normalizePath(projectPath);
  const projectDirectory = directoryOf(project);

  if (target === project) {
    throw new ExportScopeError({
      code: 'UNSAFE_EXPORT_TARGET',
      message: 'Refusing to export onto the project file itself.',
    });
  }

  if (projectDirectory && target === projectDirectory) {
    throw new ExportScopeError({
      code: 'UNSAFE_EXPORT_TARGET',
      message: 'Refusing to export into the directory that contains the project file.',
    });
  }

  if (projectDirectory && projectDirectory.startsWith(`${target}/`)) {
    throw new ExportScopeError({
      code: 'UNSAFE_EXPORT_TARGET',
      message: 'Refusing to export into a parent directory of the project file.',
    });
  }

  const sourceName = fileNameOf(project);
  if (sourceName && (await io.fileExists(joinPath(directory, sourceName)))) {
    throw new ExportScopeError({
      code: 'UNSAFE_EXPORT_TARGET',
      message: 'Refusing to export into a directory that contains the project source file.',
    });
  }

  for (const marker of ['project.godot', 'export_presets.cfg']) {
    if (await io.fileExists(joinPath(directory, marker))) {
      throw new ExportScopeError({
        code: 'UNSAFE_EXPORT_TARGET',
        message: `Refusing to export into a game project root (found ${marker}).`,
      });
    }
  }
}
