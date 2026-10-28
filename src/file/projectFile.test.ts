import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';
import { parseProjectFileText } from './projectFile';
import type { ProjectFile } from '../model/types';

const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('en', key, vars);

const legacyV1 = () => ({
  version: 1,
  tables: [
    {
      id: 'sound',
      name: 'Sound',
      position: { x: 0, y: 0 },
      columns: [{ id: 'id', name: 'id', type: 'int', primary: true, required: true }],
      rows: [
        { _rowId: 'row_1', publish: true, values: { id: 1 } },
        { _rowId: 'row_2', values: { id: 2 } },
      ],
      publish: true,
    },
  ],
});

const v3Project = (): ProjectFile => ({
  version: 3,
  releaseProfiles: {
    version: 1,
    activeProfileId: 'profile_a',
    profiles: [{ id: 'profile_a', name: 'A', mode: 'all' }],
  },
  tables: [],
});

const parse = (value: unknown) => parseProjectFileText(JSON.stringify(value), t);

describe('project file v3 migration', () => {
  it('accepts v1 and migrates it to v3 with a default profile', () => {
    const result = parse(legacyV1());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.project.version).toBe(3);
    expect(result.project.releaseProfiles).toEqual({
      version: 1,
      activeProfileId: 'profile_default',
      profiles: [
        {
          id: 'profile_default',
          name: 'Default',
          mode: 'selected',
          tables: [{ tableId: 'sound', rows: ['row_1'] }],
        },
      ],
    });
    expect(JSON.stringify(result.project)).not.toContain('"publish"');
    expect(JSON.stringify(result.project)).not.toContain('exportPolicy');
  });

  it('accepts v2 and migrates it without publish markers to an empty selected profile', () => {
    const value = legacyV1();
    delete (value.tables[0] as { publish?: boolean }).publish;
    delete (value.tables[0].rows[0] as { publish?: boolean }).publish;
    const result = parse({ ...value, version: 2, exportPolicy: 'explicit' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.version).toBe(3);
    expect(result.project.releaseProfiles?.profiles).toEqual([
      { id: 'profile_default', name: 'Default', mode: 'selected', tables: [] },
    ]);
  });

  it('accepts a valid v3 release profile file', () => {
    const result = parse(v3Project());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.releaseProfiles?.activeProfileId).toBe('profile_a');
    }
  });

  it('rejects v3 without releaseProfiles instead of falling back to legacy publish flags', () => {
    const result = parse({ ...v3Project(), releaseProfiles: undefined });
    expect(result).toEqual({ ok: false, error: t('parseReleaseProfilesRequired') });
  });

  it('rejects malformed release profile collections', () => {
    const invalidMode = v3Project();
    invalidMode.releaseProfiles!.profiles = [
      { id: 'profile_a', name: 'A', mode: 'partial' as never },
    ];
    expect(parse(invalidMode)).toEqual({ ok: false, error: t('parseReleaseProfiles') });

    const allWithTables = v3Project();
    allWithTables.releaseProfiles!.profiles = [
      {
        id: 'profile_a',
        name: 'A',
        mode: 'all',
        tables: [{ tableId: 'sound', rows: 'all' }],
      },
    ];
    expect(parse(allWithTables)).toEqual({ ok: false, error: t('parseReleaseProfiles') });

    const duplicateIds = v3Project();
    duplicateIds.releaseProfiles!.profiles = [
      { id: 'profile_a', name: 'A', mode: 'all' },
      { id: 'profile_a', name: 'B', mode: 'all' },
    ];
    expect(parse(duplicateIds)).toEqual({ ok: false, error: t('parseReleaseProfiles') });
  });

  it('rejects an activeProfileId that does not exist', () => {
    const value = v3Project();
    value.releaseProfiles!.activeProfileId = 'missing';
    expect(parse(value)).toEqual({ ok: false, error: t('parseReleaseProfileActive') });
  });

  it('rejects versions outside 1-3', () => {
    expect(parse({ ...v3Project(), version: 4 })).toEqual({
      ok: false,
      error: t('parseUnsupportedVersion'),
    });
    expect(t('parseUnsupportedVersion')).toContain('3');
  });

  it('keeps a v3 file unreadable by the old version gate', () => {
    const result = parse(legacyV1());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 旧版 Configra 的版本检查：只有 1 或 2 可用。
    const legacyReaderAccepts = (version: number) => version === 1 || version === 2;
    expect(result.project.version).toBe(3);
    expect(legacyReaderAccepts(result.project.version)).toBe(false);
  });
});
