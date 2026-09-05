import type { ProjectFile } from '../model/types';
import {
  DesktopExportFileError,
  exportDesktopFiles,
  type DesktopExportIo,
} from './desktopExport';
import { projectJsonFiles } from './exportTables';

export type PublishResult =
  | { status: 'published'; count: number }
  | { status: 'write-failed'; fileName: string; error: string }
  | { status: 'verify-failed'; fileName: string }
  | { status: 'failed'; error: string };

export type PublishIo = Pick<DesktopExportIo, 'fileExists' | 'writeTextFile' | 'readTextFile'>;

// 自动发布面向无人值守的保存流程，直接覆盖目录中的同名文件，不做覆盖确认。
export async function publishProjectFiles(
  directory: string,
  project: ProjectFile,
  io: PublishIo,
): Promise<PublishResult> {
  try {
    const files = projectJsonFiles(structuredClone(project));
    const result = await exportDesktopFiles(directory, files, {
      ...io,
      confirmOverwrite: async () => true,
    });

    return result.status === 'exported'
      ? { status: 'published', count: result.count }
      : { status: 'failed', error: 'cancelled' };
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
}
