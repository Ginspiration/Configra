import { describe, expect, it } from 'vitest';
import type { ProjectFile, ValidationIssue } from '../model/types';
import { buildExportPlan, ExportScopeError, type ExportProblem } from './exportScope';

const project = (): ProjectFile => ({
  version: 1,
  exportPolicy: 'explicit',
  tables: [
    {
      id: 'hero',
      name: 'Hero',
      publish: true,
      position: { x: 0, y: 0 },
      identity: { namespace: 'Hero', keyColumnId: 'key', valueColumnId: 'id' },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        { id: 'key', name: 'key', type: 'string', required: true },
        { id: 'internal', name: 'internal', type: 'string', export: false },
      ],
      rows: [
        {
          _rowId: 'hero_1',
          publish: true,
          values: { id: 1, key: 'A', internal: 'secret' },
        },
        {
          _rowId: 'hero_2',
          publish: false,
          values: { id: 2, key: 'B', internal: 'draft' },
        },
      ],
    },
    {
      id: 'quest',
      name: 'Quest',
      publish: true,
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
        { _rowId: 'quest_1', publish: true, values: { id: 1, hero: 1 } },
        { _rowId: 'quest_2', publish: false, values: { id: 2, hero: 2 } },
      ],
    },
  ],
});

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

describe('buildExportPlan publish scope', () => {
  it('exports only published tables and rows and filters the ID registry', () => {
    const plan = buildExportPlan(project());

    expect(plan.mode).toBe('published');
    expect(plan.tables.map((table) => table.tableId)).toEqual(['hero', 'quest']);
    expect(plan.tables[0].rows.map((row) => row._rowId)).toEqual(['hero_1']);
    expect(plan.tables[1].rows.map((row) => row._rowId)).toEqual(['quest_1']);
    expect(plan.idRegistry).toEqual({ 'Hero.A': 1 });
    expect(plan.totalRows).toBe(2);
    expect(plan.skippedRows).toBe(2);

    expect(plan.files.map((file) => file.fileName)).toEqual([
      'config_ids.json',
      'Hero.json',
      'Quest.json',
    ]);
    expect(JSON.parse(plan.files[1].text)).toEqual([{ id: 1, key: 'A' }]);
    expect(JSON.parse(plan.files[1].text)[0]).not.toHaveProperty('internal');
  });

  it('refuses an unconfigured project and a project with no published tables', () => {
    const unconfigured = project();
    delete unconfigured.exportPolicy;
    expectProblem(
      catchProblem(() => buildExportPlan(unconfigured)),
      'EXPORT_SCOPE_UNCONFIGURED',
    );

    const nonePublished = project();
    nonePublished.tables.forEach((table) => {
      table.publish = false;
    });
    expectProblem(
      catchProblem(() => buildExportPlan(nonePublished)),
      'NO_PUBLISHED_TABLES',
    );
  });

  it('refuses a single unpublished table unless the caller explicitly overrides scope', () => {
    const unpublished = project();
    unpublished.tables[0].publish = false;
    expectProblem(
      catchProblem(() => buildExportPlan(unpublished, { onlyTableId: 'hero' })),
      'TABLE_NOT_PUBLISHED',
    );

    const plan = buildExportPlan(unpublished, {
      onlyTableId: 'hero',
      includeUnpublished: true,
    });
    expect(plan.tables[0].rows).toHaveLength(2);
  });

  it('blocks validation errors only for published rows', () => {
    const draftIssue = issue({ rowId: 'hero_2', columnId: 'key' });
    expect(buildExportPlan(project(), { issues: [draftIssue] }).totalRows).toBe(2);

    const publishedIssue = issue({ rowId: 'hero_1', columnId: 'key' });
    expectProblem(
      catchProblem(() => buildExportPlan(project(), { issues: [publishedIssue] })),
      'VALIDATION_ERRORS',
    );
  });

  it('blocks a published ref that points at an unpublished row', () => {
    const broken = project();
    broken.tables[1].rows[0].values.hero = 2;

    expectProblem(
      catchProblem(() => buildExportPlan(broken)),
      'REF_NOT_PUBLISHED',
    );
  });

  it('blocks a published ref whose target table is not published', () => {
    const broken = project();
    broken.tables[0].publish = false;

    expectProblem(
      catchProblem(() => buildExportPlan(broken)),
      'REF_NOT_PUBLISHED',
    );
  });

  it('allows a single-table export when the referenced target table is published separately', () => {
    const plan = buildExportPlan(project(), { onlyTableId: 'quest' });

    expect(plan.tables.map((table) => table.tableId)).toEqual(['quest']);
    expect(plan.files.map((file) => file.fileName)).toEqual([
      'config_ids.json',
      'Quest.json',
    ]);
    expect(plan.totalRows).toBe(1);
  });

  it('blocks a single-table export when the referenced target table is unpublished', () => {
    const broken = project();
    broken.tables[0].publish = false;

    expectProblem(
      catchProblem(() => buildExportPlan(broken, { onlyTableId: 'quest' })),
      'REF_NOT_PUBLISHED',
    );
  });

  it('blocks a published ref whose target column is excluded from export', () => {
    const broken = project();
    broken.tables[0].columns[0].export = false;

    expectProblem(
      catchProblem(() => buildExportPlan(broken)),
      'REF_TARGET_NOT_EXPORTED',
    );
  });

  it('blocks a published ref whose target column has duplicate published values', () => {
    const broken = project();
    broken.tables[0].rows.push({
      _rowId: 'hero_3',
      publish: true,
      values: { id: 1, key: 'C', internal: 'duplicate target' },
    });

    expectProblem(
      catchProblem(() => buildExportPlan(broken)),
      'REF_TARGET_DUPLICATE',
    );
  });

  it('blocks duplicate ID registry keys in the published subset', () => {
    const duplicate = project();
    duplicate.tables[0].rows.push({
      _rowId: 'hero_3',
      publish: true,
      values: { id: 3, key: 'A', internal: 'duplicate' },
    });

    expectProblem(
      catchProblem(() => buildExportPlan(duplicate)),
      'DUPLICATE_ID',
    );
  });

  it('explicit full export includes drafts but still strips non-exported columns', () => {
    const plan = buildExportPlan(project(), { includeUnpublished: true });

    expect(plan.mode).toBe('all');
    expect(plan.totalRows).toBe(4);
    expect(plan.idRegistry).toEqual({ 'Hero.A': 1, 'Hero.B': 2 });
    expect(JSON.parse(plan.files[1].text)).toEqual([
      { id: 1, key: 'A' },
      { id: 2, key: 'B' },
    ]);
  });
});
