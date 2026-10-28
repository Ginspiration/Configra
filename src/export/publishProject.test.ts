import { describe, expect, it } from 'vitest';
import { publishProjectFiles } from './publishProject';
import type { ProjectFile } from '../model/types';

const project: ProjectFile = {
  version: 1,
  exportPolicy: 'explicit',
  tables: [
    {
      id: 'table-1',
      name: 'Sound',
      publish: true,
      position: { x: 0, y: 0 },
      columns: [
        { id: 'col-key', name: 'key', type: 'string' },
        { id: 'col-id', name: 'id', type: 'int', primary: true, required: true },
      ],
      rows: [
        { _rowId: 'row-1', publish: true, values: { 'col-key': 'SOUND_CLICK', 'col-id': 1 } },
      ],
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
  removeFile: async (directory: string, fileName: string) => {
    disk.delete(`${directory}/${fileName}`);
  },
});

const twoTableProject = (): ProjectFile => ({
  ...project,
  tables: [
    ...project.tables,
    {
      id: 'table-2',
      name: 'Music',
      publish: true,
      position: { x: 1, y: 1 },
      columns: [{ id: 'name', name: 'name', type: 'string' }],
      rows: [{ _rowId: 'music-1', publish: true, values: { name: 'Theme' } }],
    },
  ],
});

describe('publishProjectFiles', () => {
  it('writes config_ids and table JSON into the directory without overwrite prompts', async () => {
    const disk = new Map<string, string>([
      ['C:/game-data/config_ids.json', '{}'],
      ['C:/game-data/Sound.json', '[]'],
    ]);

    const result = await publishProjectFiles('C:/game-data', project, memoryIo(disk));

    expect(result).toEqual({
      status: 'published',
      count: 2,
      removed: 0,
      skippedTables: 0,
      skippedRows: 0,
    });
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

  it('removes a file that was published before but is now out of scope', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    const current = twoTableProject();

    const first = await publishProjectFiles('C:/game-data', current, io, {
      projectKey: 'project-a',
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(first.status).toBe('published');
    expect(disk.has('C:/game-data/Music.json')).toBe(true);

    current.tables[1].publish = false;
    const second = await publishProjectFiles('C:/game-data', current, io, {
      projectKey: 'project-a',
      now: '2026-01-02T00:00:00.000Z',
    });

    expect(second).toMatchObject({
      status: 'published',
      count: 2,
      removed: 1,
      skippedTables: 1,
      skippedRows: 1,
    });
    expect(disk.has('C:/game-data/Music.json')).toBe(false);
    expect(JSON.parse(disk.get('C:/game-data/.configra-publish.json') ?? '{}').files).not.toHaveProperty(
      'Music.json',
    );
  });

  it('blocks publishing into the project source directory', async () => {
    const disk = new Map<string, string>();
    const result = await publishProjectFiles('C:/game/config', project, memoryIo(disk), {
      projectPath: 'C:/game/config/project.configra.json',
    });

    expect(result.status).toBe('blocked');
    expect(result).toMatchObject({ reason: 'UNSAFE_EXPORT_TARGET' });
    expect(disk.size).toBe(0);
  });

  it('refuses a directory owned by another project and an invalid manifest', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    await publishProjectFiles('C:/game-data', project, io, { projectKey: 'project-a' });

    const foreign = await publishProjectFiles('C:/game-data', project, io, {
      projectKey: 'project-b',
    });
    expect(foreign.status).toBe('blocked');
    expect(foreign).toMatchObject({ reason: 'FOREIGN_PUBLISH_MANIFEST' });

    disk.set('C:/game-data/.configra-publish.json', 'not json');
    const invalid = await publishProjectFiles('C:/game-data', project, io, {
      projectKey: 'project-a',
    });
    expect(invalid.status).toBe('blocked');
    expect(invalid).toMatchObject({ reason: 'INVALID_PUBLISH_MANIFEST' });

    disk.set(
      'C:/game-data/.configra-publish.json',
      JSON.stringify({
        version: 1,
        projectKey: 'project-a',
        updatedAt: '',
        files: { '../outside.json': 'sha256:0' },
      }),
    );
    const traversal = await publishProjectFiles('C:/game-data', project, io, {
      projectKey: 'project-a',
    });
    expect(traversal.status).toBe('blocked');
    expect(traversal).toMatchObject({ reason: 'INVALID_PUBLISH_MANIFEST' });
  });
});
