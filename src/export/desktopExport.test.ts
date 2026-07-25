import { describe, expect, it, vi } from 'vitest';
import { exportDesktopFiles } from './desktopExport';

const files = [
  { fileName: 'config_ids.json', text: '{"Sound.CLICK":2}' },
  { fileName: 'sound.json', text: '[{"id":2,"name":"NEW"}]' },
];

describe('desktop export orchestration', () => {
  it('overwrites existing files with the latest payload and verifies each write', async () => {
    const disk = new Map<string, string>([
      ['C:/exports/config_ids.json', '{"Sound.CLICK":1}'],
      ['C:/exports/sound.json', '[{"id":1,"name":"OLD"}]'],
    ]);
    const confirmOverwrite = vi.fn(async () => true);

    const result = await exportDesktopFiles('C:/exports', files, {
      fileExists: async (path) => disk.has(path),
      confirmOverwrite,
      writeTextFile: async (path, text) => {
        disk.set(path, text);
      },
      readTextFile: async (path) => disk.get(path) ?? '',
    });

    expect(result).toEqual({ status: 'exported', count: 2 });
    expect(confirmOverwrite).toHaveBeenCalledWith(2);
    expect(disk.get('C:/exports/config_ids.json')).toBe(files[0].text);
    expect(disk.get('C:/exports/sound.json')).toBe(files[1].text);
  });

  it('does not write when overwrite confirmation is cancelled', async () => {
    const writeTextFile = vi.fn(async () => undefined);

    const result = await exportDesktopFiles('C:/exports', files, {
      fileExists: async () => true,
      confirmOverwrite: async () => false,
      writeTextFile,
      readTextFile: async () => '',
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it('exports without prompting when the directory has no conflicts', async () => {
    const disk = new Map<string, string>();
    const confirmOverwrite = vi.fn(async () => true);

    await exportDesktopFiles('C:/exports', files, {
      fileExists: async () => false,
      confirmOverwrite,
      writeTextFile: async (path, text) => {
        disk.set(path, text);
      },
      readTextFile: async (path) => disk.get(path) ?? '',
    });

    expect(confirmOverwrite).not.toHaveBeenCalled();
    expect(disk.size).toBe(2);
  });

  it('rejects a write whose read-back content is stale', async () => {
    await expect(
      exportDesktopFiles('C:/exports', files, {
        fileExists: async () => true,
        confirmOverwrite: async () => true,
        writeTextFile: async () => undefined,
        readTextFile: async () => 'old content',
      }),
    ).rejects.toMatchObject({ fileName: 'config_ids.json', reason: 'verify' });
  });
});
