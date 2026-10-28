import { describe, expect, it } from 'vitest';
import { assertSafeExportTarget } from './exportSafety';
import { ExportScopeError } from './exportScope';

const ioWith = (files: string[]) => ({
  fileExists: async (path: string) =>
    files.includes(path.replace(/\\/g, '/').toLowerCase()),
});

const expectUnsafe = async (
  directory: string,
  projectPath: string | undefined,
  files: string[] = [],
) => {
  await expect(
    assertSafeExportTarget(directory, projectPath, ioWith(files)),
  ).rejects.toBeInstanceOf(ExportScopeError);
};

describe('assertSafeExportTarget', () => {
  const projectPath = 'D:/game/config/project.configra.json';

  it('refuses the project file, its directory, and its parent directories', async () => {
    await expectUnsafe(projectPath, projectPath);
    await expectUnsafe('D:/game/config', projectPath);
    await expectUnsafe('D:/game', projectPath);
    await expectUnsafe('D:/', projectPath);
  });

  it('allows a dedicated output subdirectory under the project directory', async () => {
    await expect(
      assertSafeExportTarget('D:/game/config/out', projectPath, ioWith([])),
    ).resolves.toBeUndefined();
  });

  it('refuses a directory that still contains the project source file', async () => {
    await expectUnsafe('D:/game/config/out', projectPath, [
      'd:/game/config/out/project.configra.json',
    ]);
  });

  it('refuses a game project root even when the source is elsewhere', async () => {
    await expectUnsafe('D:/game', 'D:/config/project.configra.json', [
      'd:/game/project.godot',
    ]);
  });

  it('does nothing for browser exports without a project path', async () => {
    await expect(
      assertSafeExportTarget('D:/anywhere', undefined, ioWith([])),
    ).resolves.toBeUndefined();
  });
});
