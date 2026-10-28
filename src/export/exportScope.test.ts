import { describe, expect, it } from 'vitest';
import type { ProjectFile, ValidationIssue } from '../model/types';
import { buildExportPlan, ExportScopeError, type ExportProblem } from './exportScope';

const project = (): ProjectFile => ({
  version: 3,
  releaseProfiles: {
    version: 1,
    activeProfileId: 'profile_default',
    profiles: [
      {
        id: 'profile_default',
        name: 'A partial',
        mode: 'selected',
        tables: [
          { tableId: 'hero', rows: ['hero_1'] },
          { tableId: 'quest', rows: ['quest_1'] },
        ],
      },
      { id: 'profile_all', name: 'B all', mode: 'all' },
    ],
  },
  tables: [
    {
      id: 'hero',
      name: 'Hero',
      position: { x: 0, y: 0 },
      identity: { namespace: 'Hero', keyColumnId: 'key', valueColumnId: 'id' },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        { id: 'key', name: 'key', type: 'string', required: true },
        { id: 'internal', name: 'internal', type: 'string', export: false },
      ],
      rows: [
        { _rowId: 'hero_1', values: { id: 1, key: 'A', internal: 'secret' } },
        { _rowId: 'hero_2', values: { id: 2, key: 'B', internal: 'draft' } },
      ],
    },
    {
      id: 'quest',
      name: 'Quest',
      position: { x: 1, y: 1 },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        {
          id: 'hero',
          name: 'hero',
          type: 'ref',
          ref: { tableId: 'hero', columnId: 'id' },
        },
      ],
      rows: [
        { _rowId: 'quest_1', values: { id: 1, hero: 1 } },
        { _rowId: 'quest_2', values: { id: 2, hero: 2 } },
      ],
    },
    {
      id: 'extra',
      name: 'Extra',
      position: { x: 2, y: 2 },
      columns: [{ id: 'value', name: 'value', type: 'string' }],
      rows: [{ _rowId: 'extra_1', values: { value: 'only in all' } }],
    },
  ],
});

const profile = (value: ProjectFile, profileId: string) => {
  const found = value.releaseProfiles?.profiles.find((item) => item.id === profileId);
  if (!found) throw new Error(`Missing profile ${profileId}`);
  return found;
};

const expectProblem = (problem: ExportProblem, code: ExportProblem['code']) => {
  expect(problem.code).toBe(code);
};

const catchProblem = (fn: () => unknown): ExportProblem => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ExportScopeError);
    return (error as ExportScopeError).problem;
  }
  throw new Error('Expected an ExportScopeError.');
};

const issue = (overrides: Partial<ValidationIssue>): ValidationIssue => ({
  id: 'issue',
  severity: 'error',
  tableId: 'hero',
  message: 'bad value',
  ...overrides,
});

describe('buildExportPlan release profiles', () => {
  it('exports only the active profile tables and rows and filters the ID registry', () => {
    const plan = buildExportPlan(project());

    expect(plan.mode).toBe('published');
    expect(plan.profileId).toBe('profile_default');
    expect(plan.profileName).toBe('A partial');
    expect(plan.profileMode).toBe('selected');
    expect(plan.tables.map((table) => table.tableId)).toEqual(['hero', 'quest']);
    expect(plan.tables[0].rows.map((row) => row._rowId)).toEqual(['hero_1']);
    expect(plan.tables[1].rows.map((row) => row._rowId)).toEqual(['quest_1']);
    expect(plan.idRegistry).toEqual({ 'Hero.A': 1 });
    expect(plan.totalRows).toBe(2);
    expect(plan.skippedRows).toBe(3);
    expect(plan.skippedTables).toBe(1);

    expect(plan.files.map((file) => file.fileName)).toEqual([
      'config_ids.json',
      'Hero.json',
      'Quest.json',
    ]);
    expect(JSON.parse(plan.files[1].text)).toEqual([{ id: 1, key: 'A' }]);
    expect(JSON.parse(plan.files[1].text)[0]).not.toHaveProperty('internal');
  });

  it('makes an all profile include every table and row', () => {
    const plan = buildExportPlan(project(), { profileId: 'profile_all' });

    expect(plan.profileMode).toBe('all');
    expect(plan.tables.map((table) => table.tableId)).toEqual(['hero', 'quest', 'extra']);
    expect(plan.totalRows).toBe(5);
    expect(plan.idRegistry).toEqual({ 'Hero.A': 1, 'Hero.B': 2 });
    expect(plan.files.map((file) => file.fileName)).toEqual([
      'config_ids.json',
      'Hero.json',
      'Quest.json',
      'Extra.json',
    ]);
  });

  it('produces different files, rows and config_ids for two profiles', () => {
    const partial = buildExportPlan(project(), { profileId: 'profile_default' });
    const all = buildExportPlan(project(), { profileId: 'profile_all' });

    expect(all.files.map((file) => file.fileName)).not.toEqual(
      partial.files.map((file) => file.fileName),
    );
    expect(all.totalRows).not.toBe(partial.totalRows);
    expect(all.idRegistry).not.toEqual(partial.idRegistry);
    expect(all.tables[0].rows).toHaveLength(2);
    expect(partial.tables[0].rows).toHaveLength(1);
  });

  it('uses the active profile when profileId is omitted and follows switches', () => {
    const value = project();
    value.releaseProfiles!.activeProfileId = 'profile_all';

    expect(buildExportPlan(value).profileId).toBe('profile_all');
    expect(buildExportPlan(value).totalRows).toBe(5);
  });

  it('resolves a profile by unique name and rejects unknown names', () => {
    expect(buildExportPlan(project(), { profileId: 'B all' }).profileId).toBe('profile_all');

    expectProblem(
      catchProblem(() => buildExportPlan(project(), { profileId: 'missing' })),
      'PROFILE_NOT_FOUND',
    );
  });

  it('refuses an unconfigured project and a profile with no tables', () => {
    const unconfigured = project();
    delete unconfigured.releaseProfiles;
    expectProblem(
      catchProblem(() => buildExportPlan(unconfigured)),
      'EXPORT_SCOPE_UNCONFIGURED',
    );

    const empty = project();
    profile(empty, 'profile_default').tables = [];
    expectProblem(catchProblem(() => buildExportPlan(empty)), 'NO_PUBLISHED_TABLES');
  });

  it('fails on profile entries that reference missing tables or rows', () => {
    const missingTable = project();
    profile(missingTable, 'profile_default').tables!.push({
      tableId: 'removed',
      rows: 'all',
    });
    const tableProblem = catchProblem(() => buildExportPlan(missingTable));
    expectProblem(tableProblem, 'PROFILE_TABLE_NOT_FOUND');
    expect(tableProblem.tableId).toBe('removed');

    const missingRow = project();
    profile(missingRow, 'profile_default').tables![0].rows = ['removed_row'];
    const rowProblem = catchProblem(() => buildExportPlan(missingRow));
    expectProblem(rowProblem, 'PROFILE_ROW_NOT_FOUND');
    expect(rowProblem.rowId).toBe('removed_row');
  });

  it('refuses a single table outside the profile unless the caller explicitly overrides scope', () => {
    expectProblem(
      catchProblem(() => buildExportPlan(project(), { onlyTableId: 'extra' })),
      'TABLE_NOT_PUBLISHED',
    );

    const plan = buildExportPlan(project(), {
      onlyTableId: 'extra',
      includeUnpublished: true,
    });
    expect(plan.mode).toBe('all');
    expect(plan.profileId).toBeUndefined();
    expect(plan.tables[0].rows).toHaveLength(1);
  });

  it('blocks validation errors only for rows inside the profile', () => {
    const draftIssue = issue({ rowId: 'hero_2', columnId: 'key' });
    expect(buildExportPlan(project(), { issues: [draftIssue] }).totalRows).toBe(2);

    const profileIssue = issue({ rowId: 'hero_1', columnId: 'key' });
    expectProblem(
      catchProblem(() => buildExportPlan(project(), { issues: [profileIssue] })),
      'VALIDATION_ERRORS',
    );
  });

  it('blocks a ref that points at a row outside the profile', () => {
    const broken = project();
    broken.tables[1].rows[0].values.hero = 2;

    expectProblem(catchProblem(() => buildExportPlan(broken)), 'REF_NOT_PUBLISHED');

    // 全量方案里该引用是合法的。
    expect(buildExportPlan(broken, { profileId: 'profile_all' }).totalRows).toBe(5);
  });

  it('blocks a ref whose target table is outside the profile', () => {
    const broken = project();
    profile(broken, 'profile_default').tables = [
      { tableId: 'quest', rows: ['quest_1'] },
    ];

    expectProblem(catchProblem(() => buildExportPlan(broken)), 'REF_NOT_PUBLISHED');
  });

  it('allows a single-table export when the ref target table is in the profile but not exported', () => {
    const plan = buildExportPlan(project(), { onlyTableId: 'quest' });

    expect(plan.tables.map((table) => table.tableId)).toEqual(['quest']);
    expect(plan.files.map((file) => file.fileName)).toEqual([
      'config_ids.json',
      'Quest.json',
    ]);
    expect(plan.totalRows).toBe(1);
  });

  it('blocks a single-table export when the ref target table is outside the profile', () => {
    const broken = project();
    profile(broken, 'profile_default').tables = [{ tableId: 'quest', rows: ['quest_1'] }];

    expectProblem(
      catchProblem(() => buildExportPlan(broken, { onlyTableId: 'quest' })),
      'REF_NOT_PUBLISHED',
    );
  });

  it('blocks a ref whose target column is excluded from export', () => {
    const broken = project();
    broken.tables[0].columns[0].export = false;

    expectProblem(
      catchProblem(() => buildExportPlan(broken)),
      'REF_TARGET_NOT_EXPORTED',
    );
  });

  it('blocks a ref whose target column has duplicate profile values', () => {
    const broken = project();
    profile(broken, 'profile_default').tables![0].rows = ['hero_1', 'hero_3'];
    broken.tables[0].rows.push({
      _rowId: 'hero_3',
      values: { id: 1, key: 'C', internal: 'duplicate target' },
    });

    expectProblem(
      catchProblem(() => buildExportPlan(broken)),
      'REF_TARGET_DUPLICATE',
    );
  });

  it('blocks duplicate ID registry keys in the profile subset', () => {
    const duplicate = project();
    profile(duplicate, 'profile_default').tables![0].rows = ['hero_1', 'hero_3'];
    duplicate.tables[0].rows.push({
      _rowId: 'hero_3',
      values: { id: 3, key: 'A', internal: 'duplicate' },
    });

    expectProblem(
      catchProblem(() => buildExportPlan(duplicate)),
      'DUPLICATE_ID',
    );
  });

  it('explicit full export includes every profile but still strips non-exported columns', () => {
    const plan = buildExportPlan(project(), { includeUnpublished: true });

    expect(plan.mode).toBe('all');
    expect(plan.profileId).toBeUndefined();
    expect(plan.totalRows).toBe(5);
    expect(plan.idRegistry).toEqual({ 'Hero.A': 1, 'Hero.B': 2 });
    expect(JSON.parse(plan.files[1].text)).toEqual([
      { id: 1, key: 'A' },
      { id: 2, key: 'B' },
    ]);
  });
});
