import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../model/types';
import {
  activeReleaseProfile,
  createReleaseProfile,
  deleteReleaseProfile,
  duplicateReleaseProfile,
  findReleaseProfile,
  normalizeProjectFile,
  profileTableScope,
  pruneReleaseProfiles,
  ReleaseProfileError,
  releaseProfileScope,
  renameReleaseProfile,
  setActiveReleaseProfile,
  setReleaseProfileMode,
  setReleaseProfileRows,
  setReleaseProfileTable,
  summarizeReleaseProfiles,
} from './releaseProfiles';

const legacyProject = (): ProjectFile => ({
  version: 2,
  exportPolicy: 'explicit',
  tables: [
    {
      id: 'hero',
      name: 'Hero',
      publish: true,
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        { id: 'name', name: 'name', type: 'string' },
      ],
      rows: [
        { _rowId: 'hero_1', publish: true, values: { id: 1, name: 'A' } },
        { _rowId: 'hero_2', publish: false, values: { id: 2, name: 'B' } },
      ],
    },
    {
      id: 'quest',
      name: 'Quest',
      publish: false,
      position: { x: 1, y: 1 },
      columns: [{ id: 'id', name: 'id', type: 'int', primary: true, required: true }],
      rows: [{ _rowId: 'quest_1', publish: true, values: { id: 1 } }],
    },
  ],
});

const project = (): ProjectFile => ({
  version: 3,
  releaseProfiles: {
    version: 1,
    activeProfileId: 'profile_all',
    profiles: [
      { id: 'profile_all', name: 'All', mode: 'all' },
      {
        id: 'profile_partial',
        name: 'Partial',
        mode: 'selected',
        tables: [{ tableId: 'hero', rows: ['hero_1'] }],
      },
    ],
  },
  tables: [
    {
      id: 'hero',
      name: 'Hero',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        { id: 'name', name: 'name', type: 'string' },
      ],
      rows: [
        { _rowId: 'hero_1', values: { id: 1, name: 'A' } },
        { _rowId: 'hero_2', values: { id: 2, name: 'B' } },
      ],
    },
    {
      id: 'quest',
      name: 'Quest',
      position: { x: 1, y: 1 },
      columns: [{ id: 'id', name: 'id', type: 'int', primary: true, required: true }],
      rows: [{ _rowId: 'quest_1', values: { id: 1 } }],
    },
  ],
});

const catchProfileError = (fn: () => unknown): ReleaseProfileError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseProfileError);
    return error as ReleaseProfileError;
  }
  throw new Error('Expected a ReleaseProfileError.');
};

describe('release profile migration', () => {
  it('migrates v2 publish flags into a default selected profile and strips legacy fields', () => {
    const normalized = normalizeProjectFile(legacyProject());

    expect(normalized.version).toBe(3);
    expect(normalized.exportPolicy).toBeUndefined();
    expect(normalized.releaseProfiles).toEqual({
      version: 1,
      activeProfileId: 'profile_default',
      profiles: [
        {
          id: 'profile_default',
          name: 'Default',
          mode: 'selected',
          tables: [{ tableId: 'hero', rows: ['hero_1'] }],
        },
      ],
    });
    expect(normalized.tables[0].publish).toBeUndefined();
    expect(normalized.tables[0].rows[0].publish).toBeUndefined();
    expect(JSON.stringify(normalized)).not.toContain('"publish"');
  });

  it('keeps explicit row ids even when every legacy row was published', () => {
    const legacy = legacyProject();
    legacy.tables[0].rows[1].publish = true;

    const normalized = normalizeProjectFile(legacy);
    expect(normalized.releaseProfiles?.profiles[0].tables).toEqual([
      { tableId: 'hero', rows: ['hero_1', 'hero_2'] },
    ]);
  });

  it('migrates a project without publish markers to an empty selected profile', () => {
    const legacy = legacyProject();
    delete (legacy.tables[0] as { publish?: boolean }).publish;
    delete (legacy.tables[1] as { publish?: boolean }).publish;
    for (const table of legacy.tables) {
      for (const row of table.rows) {
        delete (row as { publish?: boolean }).publish;
      }
    }

    const normalized = normalizeProjectFile(legacy);
    expect(normalized.releaseProfiles?.profiles).toEqual([
      { id: 'profile_default', name: 'Default', mode: 'selected', tables: [] },
    ]);
    expect(normalized.releaseProfiles?.activeProfileId).toBe('profile_default');
  });

  it('repairs an unknown active profile id instead of keeping a dangling pointer', () => {
    const broken = project();
    broken.releaseProfiles!.activeProfileId = 'missing';

    const normalized = normalizeProjectFile(broken);
    expect(normalized.releaseProfiles?.activeProfileId).toBe('profile_all');
  });
});

describe('release profile scope', () => {
  it('includes every table and row in an all profile', () => {
    const scope = releaseProfileScope(project(), findReleaseProfile(project(), 'All'));
    expect([...scope.tableIds]).toEqual(['hero', 'quest']);
    expect(scope.rowsByTable.get('hero')).toBe('all');
  });

  it('limits a selected profile to its tables and rows', () => {
    const value = project();
    const scope = releaseProfileScope(value, findReleaseProfile(value, 'profile_partial'));

    expect([...scope.tableIds]).toEqual(['hero']);
    expect(profileTableScope(value, findReleaseProfile(value, 'profile_partial'), 'hero')).toEqual({
      included: true,
      rows: new Set(['hero_1']),
    });
    expect(profileTableScope(value, findReleaseProfile(value, 'profile_partial'), 'quest')).toEqual({
      included: false,
      rows: new Set(),
    });
  });

  it('fails on a profile that references a missing table or row', () => {
    const missingTable = project();
    missingTable.releaseProfiles!.profiles[1].tables = [
      { tableId: 'removed', rows: 'all' },
    ];
    const tableError = catchProfileError(() =>
      releaseProfileScope(missingTable, missingTable.releaseProfiles!.profiles[1]),
    );
    expect(tableError.code).toBe('PROFILE_TABLE_NOT_FOUND');

    const missingRow = project();
    missingRow.releaseProfiles!.profiles[1].tables = [
      { tableId: 'hero', rows: ['removed_row'] },
    ];
    const rowError = catchProfileError(() =>
      releaseProfileScope(missingRow, missingRow.releaseProfiles!.profiles[1]),
    );
    expect(rowError.code).toBe('PROFILE_ROW_NOT_FOUND');
    expect(rowError.rowId).toBe('removed_row');
  });

  it('resolves profiles by stable id first and rejects ambiguous names', () => {
    const value = project();
    expect(findReleaseProfile(value, 'profile_partial').name).toBe('Partial');
    expect(findReleaseProfile(value, 'Partial').id).toBe('profile_partial');
    expect(activeReleaseProfile(value)?.id).toBe('profile_all');

    value.releaseProfiles!.profiles[1].name = 'All';
    const error = catchProfileError(() => findReleaseProfile(value, 'All'));
    expect(error.code).toBe('PROFILE_DUPLICATE_NAME');
  });

  it('summarizes per-profile and active counts', () => {
    const summary = summarizeReleaseProfiles(project());
    expect(summary).toMatchObject({
      activeProfileId: 'profile_all',
      profiles: [
        { id: 'profile_all', mode: 'all', tableCount: 2, rowCount: 3 },
        { id: 'profile_partial', mode: 'selected', tableCount: 1, rowCount: 1 },
      ],
      active: { id: 'profile_all', tableCount: 2, rowCount: 3 },
    });
  });
});

describe('release profile editing', () => {
  it('creates profiles with stable unique ids and unique names', () => {
    const created = createReleaseProfile(project(), 'Partial');
    const profiles = created.project.releaseProfiles!.profiles;

    expect(profiles).toHaveLength(3);
    expect(profiles[2].name).not.toBe('Partial');
    expect(profiles.filter((profile) => profile.id === created.profile.id)).toHaveLength(1);
    expect(created.project.releaseProfiles!.activeProfileId).toBe(created.profile.id);
  });

  it('duplicates the selected scope without sharing references', () => {
    const duplicated = duplicateReleaseProfile(project(), 'profile_partial');
    const original = duplicated.project.releaseProfiles!.profiles.find(
      (profile) => profile.id === 'profile_partial',
    );
    const copy = duplicated.profile;

    expect(copy.mode).toBe('selected');
    expect(copy.tables).toEqual([{ tableId: 'hero', rows: ['hero_1'] }]);
    copy.tables![0].rows = ['hero_2'];
    expect(original?.tables).toEqual([{ tableId: 'hero', rows: ['hero_1'] }]);
  });

  it('renames, switches and deletes profiles while keeping at least one', () => {
    const renamed = renameReleaseProfile(project(), 'profile_partial', 'B version');
    expect(findReleaseProfile(renamed, 'profile_partial').name).toBe('B version');

    const switched = setActiveReleaseProfile(renamed, 'profile_partial');
    expect(activeReleaseProfile(switched)?.id).toBe('profile_partial');

    const deleted = deleteReleaseProfile(switched, 'profile_partial');
    expect(deleted.releaseProfiles!.profiles.map((profile) => profile.id)).toEqual([
      'profile_all',
    ]);
    expect(deleted.releaseProfiles!.activeProfileId).toBe('profile_all');

    const last = deleteReleaseProfile(project(), 'profile_partial');
    const error = catchProfileError(() => deleteReleaseProfile(last, 'profile_all'));
    expect(error.code).toBe('PROFILE_LAST');
  });

  it('adds a table without publishing its rows and edits row scope', () => {
    const value = project();
    const added = setReleaseProfileTable(value, 'profile_partial', 'quest', true);
    const partial = findReleaseProfile(added, 'profile_partial');
    expect(partial.tables).toEqual([
      { tableId: 'hero', rows: ['hero_1'] },
      { tableId: 'quest', rows: [] },
    ]);

    const rowsAdded = setReleaseProfileRows(added, 'profile_partial', 'quest', ['quest_1'], true);
    expect(findReleaseProfile(rowsAdded, 'profile_partial').tables).toContainEqual({
      tableId: 'quest',
      rows: ['quest_1'],
    });

    const allRows = setReleaseProfileRows(
      value,
      'profile_partial',
      'hero',
      ['hero_2'],
      true,
    );
    expect(findReleaseProfile(allRows, 'profile_partial').tables).toEqual([
      { tableId: 'hero', rows: ['hero_1', 'hero_2'] },
    ]);
  });

  it('converts rows all to an explicit list when a row is excluded', () => {
    const value = project();
    value.releaseProfiles!.profiles[1].tables = [{ tableId: 'hero', rows: 'all' }];

    const updated = setReleaseProfileRows(
      value,
      'profile_partial',
      'hero',
      ['hero_2'],
      false,
    );
    expect(findReleaseProfile(updated, 'profile_partial').tables).toEqual([
      { tableId: 'hero', rows: ['hero_1'] },
    ]);
  });

  it('switches a profile between all and selected mode without losing the profile identity', () => {
    const all = setReleaseProfileMode(project(), 'profile_partial', 'all');
    expect(findReleaseProfile(all, 'profile_partial')).toEqual({
      id: 'profile_partial',
      name: 'Partial',
      mode: 'all',
    });

    const selected = setReleaseProfileMode(all, 'profile_partial', 'selected');
    expect(findReleaseProfile(selected, 'profile_partial')).toEqual({
      id: 'profile_partial',
      name: 'Partial',
      mode: 'selected',
      tables: [],
    });
    expect(activeReleaseProfile(selected)?.id).toBe('profile_all');
  });

  it('refuses to edit an all-mode profile', () => {
    const error = catchProfileError(() =>
      setReleaseProfileTable(project(), 'profile_all', 'hero', false),
    );
    expect(error.code).toBe('PROFILE_READ_ONLY');
  });

  it('prunes deleted tables and rows from every selected profile', () => {
    const value = project();
    value.releaseProfiles!.profiles[1].tables = [
      { tableId: 'hero', rows: ['hero_1', 'hero_2'] },
      { tableId: 'quest', rows: ['quest_1'] },
    ];

    const rowsPruned = pruneReleaseProfiles({
      ...value,
      tables: value.tables.map((table) =>
        table.id === 'hero'
          ? { ...table, rows: table.rows.filter((row) => row._rowId !== 'hero_2') }
          : table,
      ),
    });
    expect(findReleaseProfile(rowsPruned, 'profile_partial').tables).toEqual([
      { tableId: 'hero', rows: ['hero_1'] },
      { tableId: 'quest', rows: ['quest_1'] },
    ]);

    const tablePruned = pruneReleaseProfiles({
      ...rowsPruned,
      tables: rowsPruned.tables.filter((table) => table.id !== 'quest'),
    });
    expect(findReleaseProfile(tablePruned, 'profile_partial').tables).toEqual([
      { tableId: 'hero', rows: ['hero_1'] },
    ]);
  });
});
