import type { ExportJsonFile } from './exportTables';

export type DesktopExportResult =
  | { status: 'cancelled' }
  | { status: 'exported'; count: number };

export type DesktopExportIo = {
  fileExists(path: string): Promise<boolean>;
  confirmOverwrite(count: number): Promise<boolean>;
  writeTextFile(path: string, text: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
};

export class DesktopExportFileError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: 'write' | 'verify',
    readonly originalError?: unknown,
  ) {
    super(
      reason === 'verify'
        ? `Export verification failed for ${fileName}.`
        : `Could not export ${fileName}: ${originalError instanceof Error ? originalError.message : String(originalError)}`,
    );
    this.name = 'DesktopExportFileError';
  }
}

export const joinExportFilePath = (directory: string, fileName: string) => {
  const trimmedDirectory = directory.replace(/[\\/]+$/, '');
  return `${trimmedDirectory || '/'}${trimmedDirectory ? '/' : ''}${fileName}`;
};

export async function exportDesktopFiles(
  directory: string,
  files: ExportJsonFile[],
  io: DesktopExportIo,
): Promise<DesktopExportResult> {
  const filesWithPaths = files.map((file) => ({
    ...file,
    path: joinExportFilePath(directory, file.fileName),
  }));
  const existing = await Promise.all(filesWithPaths.map((file) => io.fileExists(file.path)));
  const overwriteCount = existing.filter(Boolean).length;

  if (overwriteCount > 0 && !(await io.confirmOverwrite(overwriteCount))) {
    return { status: 'cancelled' };
  }

  for (const file of filesWithPaths) {
    try {
      await io.writeTextFile(file.path, file.text);
    } catch (error) {
      throw new DesktopExportFileError(file.fileName, 'write', error);
    }

    let writtenText: string;
    try {
      writtenText = await io.readTextFile(file.path);
    } catch (error) {
      throw new DesktopExportFileError(file.fileName, 'write', error);
    }

    if (writtenText !== file.text) {
      throw new DesktopExportFileError(file.fileName, 'verify');
    }
  }

  return { status: 'exported', count: files.length };
}
