import { describe, expect, it } from 'vitest';
import { publishProjectFiles } from './publishProject';
import type { ProjectFile } from '../model/types';

const project = (): ProjectFile => ({
  version: 3,
  releaseProfiles: {
    version: 1,
    activeProfileId: 'profile_a',
    profiles: [
      { id: 'profile_a', name: 'A all', mode: 'all' },
      {
        id: 'profile_b',
        name: 'B selected',
        mode: 'selected',
        tables: [{ tableId: 'table-1', rows: 'all' }],
      },
    ],
  },
  tables: [
    {
      id: 'table-1',
      name: 'Sound',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'col-key', name: 'key', type: 'string' },
        { id: 'col-id', name: 'id', type: 'int', primary: true, required: true },
      ],
      rows: [
        { _rowId: 'row-1', values: { 'col-key': 'SOUND_CLICK', 'col-id': 1 } },
        { _rowId: 'row-2', values: { 'col-key': 'SOUND_WIN', 'col-id': 2 } },
      ],
      identity: {
        namespace: 'Sound',
        keyColumnId: 'col-key',
        valueColumnId: 'col-id',
      },
    },
    {
      id: 'table-2',
      name: 'Music',
      position: { x: 1, y: 1 },
      columns: [{ id: 'name', name: 'name', type: 'string' }],
      rows: [{ _rowId: 'music-1', values: { name: 'Theme' } }],
    },
  ],
});

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

const manifestOf = (disk: Map<string, string>, directory: string) =>
  JSON.parse(disk.get(`${directory}/.configra-publish.json`) ?? '{}') as {
    projectKey?: string;
    profileId?: string;
    files?: Record<string, string>;
  };

const singleTableProfile = (): ProjectFile => ({
  version: 3,
  releaseProfiles: {
    version: 1,
    activeProfileId: 'profile-a',
    profiles: [
      {
        id: 'profile-a',
        name: 'A',
        mode: 'selected',
        tables: [{ tableId: 'table-1', rows: ['row-1'] }],
      },
    ],
  },
  tables: [project().tables[0]],
});

describe('publishProjectFiles release profiles', () => {
  it('writes the active profile and records its profileId in the manifest', async () => {
    const disk = new Map<string, string>([
      ['C:/game-data/config_ids.json', '{}'],
      ['C:/game-data/Sound.json', '[]'],
    ]);

    const result = await publishProjectFiles(
      'C:/game-data',
      singleTableProfile(),
      memoryIo(disk),
      { projectKey: 'project-a' },
    );

    expect(result).toEqual({
      status: 'published',
      profileId: 'profile-a',
      count: 2,
      removed: 0,
      skippedTables: 0,
      skippedRows: 1,
      warning: 'First publish to this directory; stale files from earlier exports were not removed.',
    });
    expect(disk.get('C:/game-data/config_ids.json')).toBe(
      `${JSON.stringify({ 'Sound.SOUND_CLICK': 1 }, null, 2)}\n`,
    );
    expect(disk.get('C:/game-data/Sound.json')).toBe(
      `${JSON.stringify([{ key: 'SOUND_CLICK', id: 1 }], null, 2)}\n`,
    );
    expect(manifestOf(disk, 'C:/game-data').profileId).toBe('profile-a');
  });

  it('publishes two profiles to separate directories without touching each other', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    const value = project();

    const a = await publishProjectFiles('C:/dir-a', value, io, {
      projectKey: 'project-a',
      profileId: 'profile_a',
    });
    const b = await publishProjectFiles('C:/dir-b', value, io, {
      projectKey: 'project-a',
      profileId: 'profile_b',
    });

    expect(a).toMatchObject({ status: 'published', profileId: 'profile_a', count: 3 });
    expect(b).toMatchObject({ status: 'published', profileId: 'profile_b', count: 2 });
    expect(disk.has('C:/dir-a/Music.json')).toBe(true);
    expect(disk.has('C:/dir-b/Music.json')).toBe(false);
    expect(disk.has('C:/dir-a/Sound.json')).toBe(true);
    expect(disk.has('C:/dir-b/Sound.json')).toBe(true);

    // 再次发布 B 不会删除 A 的文件。
    const bAgain = await publishProjectFiles('C:/dir-b', value, io, {
      projectKey: 'project-a',
      profileId: 'profile_b',
    });
    expect(bAgain).toMatchObject({ status: 'published', removed: 0 });
    expect(disk.has('C:/dir-a/Music.json')).toBe(true);
    expect(disk.has('C:/dir-a/Sound.json')).toBe(true);
    expect(disk.has('C:/dir-a/.configra-publish.json')).toBe(true);
  });

  it('refuses a directory whose manifest belongs to another profile', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    const value = project();
    await publishProjectFiles('C:/shared', value, io, {
      projectKey: 'project-a',
      profileId: 'profile_a',
    });
    const originalSound = disk.get('C:/shared/Sound.json');
    const originalMusic = disk.get('C:/shared/Music.json');

    const foreign = await publishProjectFiles('C:/shared', value, io, {
      projectKey: 'project-a',
      profileId: 'profile_b',
    });

    expect(foreign).toMatchObject({ status: 'blocked', reason: 'FOREIGN_RELEASE_PROFILE' });
    expect(disk.get('C:/shared/Sound.json')).toBe(originalSound);
    expect(disk.get('C:/shared/Music.json')).toBe(originalMusic);
    expect(manifestOf(disk, 'C:/shared').profileId).toBe('profile_a');
  });

  it('requires explicit confirmation before adopting a legacy manifest and does not delete unknown files', async () => {
    const disk = new Map<string, string>([
      ['C:/legacy/Old.json', '[]'],
      [
        'C:/legacy/.configra-publish.json',
        `${JSON.stringify({
          version: 1,
          projectKey: 'project-a',
          updatedAt: '2025-01-01T00:00:00.000Z',
          files: { 'Old.json': 'sha256:unknown' },
        })}\n`,
      ],
    ]);
    const io = memoryIo(disk);
    const value = singleTableProfile();

    const blocked = await publishProjectFiles('C:/legacy', value, io, {
      projectKey: 'project-a',
    });
    expect(blocked).toMatchObject({ status: 'blocked', reason: 'LEGACY_PUBLISH_MANIFEST' });
    expect(disk.has('C:/legacy/Old.json')).toBe(true);
    expect(disk.has('C:/legacy/Sound.json')).toBe(false);

    const cancelled = await publishProjectFiles('C:/legacy', value, io, {
      projectKey: 'project-a',
      confirmLegacyManifest: async () => false,
    });
    expect(cancelled).toEqual({ status: 'failed', error: 'cancelled' });

    const adopted = await publishProjectFiles('C:/legacy', value, io, {
      projectKey: 'project-a',
      confirmLegacyManifest: async () => true,
    });
    expect(adopted).toMatchObject({ status: 'published', profileId: 'profile-a', removed: 0 });
    expect(adopted.status === 'published' ? adopted.warning : '').toContain('legacy publish manifest');
    expect(disk.has('C:/legacy/Old.json')).toBe(true);
    expect(manifestOf(disk, 'C:/legacy').profileId).toBe('profile-a');
    expect(manifestOf(disk, 'C:/legacy').files).not.toHaveProperty('Old.json');
  });

  it('removes a stale file only when it is recorded in this profile manifest and unchanged', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    const value = project();
    const options = { projectKey: 'project-a', profileId: 'profile_a', now: '2026-01-01T00:00:00.000Z' };

    const first = await publishProjectFiles('C:/publish', value, io, options);
    expect(first.status).toBe('published');
    expect(disk.has('C:/publish/Music.json')).toBe(true);

    // 把 B 方案切为同时包含 Sound 与 Music 的表；再切回只含 Sound。
    const narrowed = project();
    narrowed.releaseProfiles!.profiles[0].mode = 'selected';
    narrowed.releaseProfiles!.profiles[0].tables = [
      { tableId: 'table-1', rows: 'all' },
    ];

    const second = await publishProjectFiles('C:/publish', narrowed, io, options);
    expect(second).toMatchObject({ status: 'published', removed: 1 });
    expect(disk.has('C:/publish/Music.json')).toBe(false);
    expect(manifestOf(disk, 'C:/publish').profileId).toBe('profile_a');
  });

  it('keeps a stale file that was modified after the last publish', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    const value = project();
    const options = { projectKey: 'project-a', profileId: 'profile_a' };

    await publishProjectFiles('C:/publish', value, io, options);
    disk.set('C:/publish/Music.json', 'user changed this');

    const narrowed = project();
    narrowed.releaseProfiles!.profiles[0].mode = 'selected';
    narrowed.releaseProfiles!.profiles[0].tables = [{ tableId: 'table-1', rows: 'all' }];

    const second = await publishProjectFiles('C:/publish', narrowed, io, options);
    expect(second).toMatchObject({ status: 'published', removed: 0 });
    expect(disk.get('C:/publish/Music.json')).toBe('user changed this');
  });

  it('reports the failing file when a write throws', async () => {
    const result = await publishProjectFiles('C:/game-data', singleTableProfile(), {
      fileExists: async () => false,
      writeTextFile: async () => {
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
    const result = await publishProjectFiles('C:/game-data', singleTableProfile(), {
      fileExists: async () => false,
      writeTextFile: async () => undefined,
      readTextFile: async () => 'stale',
    });

    expect(result).toEqual({ status: 'verify-failed', fileName: 'config_ids.json' });
  });

  it('reports unexpected failures instead of throwing', async () => {
    const result = await publishProjectFiles('C:/game-data', singleTableProfile(), {
      fileExists: async () => {
        throw new Error('backend gone');
      },
      writeTextFile: async () => undefined,
      readTextFile: async () => '',
    });

    expect(result).toEqual({ status: 'failed', error: 'backend gone' });
  });

  it('blocks publishing into the project source directory', async () => {
    const disk = new Map<string, string>();
    const result = await publishProjectFiles('C:/game/config', singleTableProfile(), memoryIo(disk), {
      projectPath: 'C:/game/config/project.configra.json',
    });

    expect(result.status).toBe('blocked');
    expect(result).toMatchObject({ reason: 'UNSAFE_EXPORT_TARGET' });
    expect(disk.size).toBe(0);
  });

  it('refuses a directory owned by another project and an invalid manifest', async () => {
    const disk = new Map<string, string>();
    const io = memoryIo(disk);
    const value = singleTableProfile();
    await publishProjectFiles('C:/game-data', value, io, { projectKey: 'project-a' });

    const foreign = await publishProjectFiles('C:/game-data', value, io, {
      projectKey: 'project-b',
    });
    expect(foreign.status).toBe('blocked');
    expect(foreign).toMatchObject({ reason: 'FOREIGN_PUBLISH_MANIFEST' });

    disk.set('C:/game-data/.configra-publish.json', 'not json');
    const invalid = await publishProjectFiles('C:/game-data', value, io, {
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
    const traversal = await publishProjectFiles('C:/game-data', value, io, {
      projectKey: 'project-a',
    });
    expect(traversal.status).toBe('blocked');
    expect(traversal).toMatchObject({ reason: 'INVALID_PUBLISH_MANIFEST' });
  });

  it('never falls back to full export when the requested profile is missing', async () => {
    const disk = new Map<string, string>();
    const result = await publishProjectFiles('C:/game-data', singleTableProfile(), memoryIo(disk), {
      projectKey: 'project-a',
      profileId: 'missing',
    });

    expect(result).toMatchObject({ status: 'blocked', reason: 'PROFILE_NOT_FOUND' });
    expect(disk.size).toBe(0);
  });
});
