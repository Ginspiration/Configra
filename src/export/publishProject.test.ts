import { describe, expect, it } from 'vitest';
import { publishProjectFiles } from './publishProject';
import type { ProjectFile } from '../model/types';

const project: ProjectFile = {
  version: 1,
  tables: [
    {
      id: 'table-1',
      name: 'Sound',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'col-key', name: 'key', type: 'string' },
        { id: 'col-id', name: 'id', type: 'int', primary: true, required: true },
      ],
      rows: [{ _rowId: 'row-1', values: { 'col-key': 'SOUND_CLICK', 'col-id': 1 } }],
      identity: {
        namespace: 'Sound',
        keyColumnId: 'col-key',
        valueColumnId: 'col-id',
      },
    },
  ],
};

const memoryIo = (disk: Map<string, string>) => ({
  fileExists: async (path: string) => disk.has(path),
  writeTextFile: async (path: string, text: string) => {
    disk.set(path, text);
  },
  readTextFile: async (path: string) => disk.get(path) ?? '',
});

describe('publishProjectFiles', () => {
  it('writes config_ids and table JSON into the directory without overwrite prompts', async () => {
    const disk = new Map<string, string>([
      ['C:/game-data/config_ids.json', '{}'],
      ['C:/game-data/Sound.json', '[]'],
    ]);

    const result = await publishProjectFiles('C:/game-data', project, memoryIo(disk));

    expect(result).toEqual({ status: 'published', count: 2 });
    expect(disk.get('C:/game-data/config_ids.json')).toBe(
      `${JSON.stringify({ 'Sound.SOUND_CLICK': 1 }, null, 2)}\n`,
    );
    expect(disk.get('C:/game-data/Sound.json')).toBe(
      `${JSON.stringify([{ key: 'SOUND_CLICK', id: 1 }], null, 2)}\n`,
    );
  });

  it('reports the failing file when a write throws', async () => {
    const result = await publishProjectFiles('C:/game-data', project, {
      fileExists: async () => false,
      writeTextFile: async (path) => {
        throw new Error('EACCES: permission denied');
      },
      readTextFile: async () => '',
    });

    expect(result).toEqual({
      status: 'write-failed',
      fileName: 'config_ids.json',
      error: 'EACCES: permission denied',
    });
  });

  it('reports a verify failure when read-back content does not match', async () => {
    const result = await publishProjectFiles('C:/game-data', project, {
      fileExists: async () => false,
      writeTextFile: async () => undefined,
      readTextFile: async () => 'stale',
    });

    expect(result).toEqual({ status: 'verify-failed', fileName: 'config_ids.json' });
  });

  it('reports unexpected failures instead of throwing', async () => {
    const result = await publishProjectFiles('C:/game-data', project, {
      fileExists: async () => {
        throw new Error('backend gone');
      },
      writeTextFile: async () => undefined,
      readTextFile: async () => '',
    });

    expect(result).toEqual({ status: 'failed', error: 'backend gone' });
  });
});
