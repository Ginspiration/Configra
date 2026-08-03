import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';
import type { ConfigColumn, ConfigRow, ConfigTable, ProjectFile } from '../model/types';
import {
  applyMerge,
  computeMergeReport,
  defaultResolutions,
  findConflicts,
  type MergeResolutions,
} from './mergeProject';

const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('en', key, vars);

const column = (
  id: string,
  name = id,
  type: ConfigColumn['type'] = 'string',
  ref?: { tableId: string; columnId: string },
): ConfigColumn => ({
  id,
  name,
  type,
  ...(ref ? { ref } : {}),
});

const table = (
  id: string,
  name: string,
  options: {
    columns?: ConfigColumn[];
    rows?: ConfigRow[];
    position?: { x: number; y: number };
  } = {},
): ConfigTable => ({
  id,
  name,
  position: options.position ?? { x: 0, y: 0 },
  columns: options.columns ?? [],
  rows: options.rows ?? [],
});

const project = (tables: ConfigTable[]): ProjectFile => ({ version: 1, tables });

describe('findConflicts', () => {
  it('returns no conflicts when ids and names differ', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([table('b', 'Beta')]);
    expect(findConflicts(current, incoming)).toEqual([]);
  });

  it('detects id conflicts and name-only conflicts', () => {
    const current = project([table('a', 'Alpha'), table('x', 'Shared')]);
    const incoming = project([table('a', 'Alpha2'), table('y', 'Shared')]);
    const conflicts = findConflicts(current, incoming);
    expect(conflicts).toEqual([
      {
        kind: 'id',
        incomingTableId: 'a',
        incomingTableName: 'Alpha2',
        existingTableId: 'a',
        existingTableName: 'Alpha',
      },
      {
        kind: 'name',
        incomingTableId: 'y',
        incomingTableName: 'Shared',
        existingTableId: 'x',
        existingTableName: 'Shared',
      },
    ]);
  });

  it('prefers the id conflict when both id and name collide', () => {
    const current = project([table('a', 'Alpha'), table('x', 'Alpha2')]);
    const incoming = project([table('a', 'Alpha2')]);
    const conflicts = findConflicts(current, incoming);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe('id');
  });
});

describe('defaultResolutions', () => {
  it('defaults id conflicts to overwrite and suggests a unique rename', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([table('a', 'Alpha2')]);
    const { defaults, renameSuggestions } = defaultResolutions(
      findConflicts(current, incoming),
      current,
      incoming,
    );
    expect(defaults.a).toEqual({ kind: 'overwrite' });
    expect(renameSuggestions.a).toEqual({ newTableId: 'a_2', newTableName: 'Alpha2 (2)' });
  });

  it('defaults name conflicts to rename and keeps the incoming id', () => {
    const current = project([table('x', 'Shared')]);
    const incoming = project([table('y', 'Shared')]);
    const { defaults, renameSuggestions } = defaultResolutions(
      findConflicts(current, incoming),
      current,
      incoming,
    );
    expect(defaults.y).toEqual({ kind: 'rename', newTableId: 'y', newTableName: 'Shared (2)' });
    expect(renameSuggestions.y).toEqual({ newTableId: 'y', newTableName: 'Shared (2)' });
  });

  it('deduplicates rename suggestions against existing and incoming tables', () => {
    const current = project([table('a', 'Alpha'), table('b', 'Alpha2 (2)')]);
    const incoming = project([table('a', 'Alpha2')]);
    const { renameSuggestions } = defaultResolutions(
      findConflicts(current, incoming),
      current,
      incoming,
    );
    expect(renameSuggestions.a?.newTableName).toBe('Alpha2 (3)');
  });
});

describe('applyMerge', () => {
  it('appends non-conflicting tables without mutating inputs', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([table('b', 'Beta')]);
    const currentSnapshot = JSON.stringify(current);
    const incomingSnapshot = JSON.stringify(incoming);

    const candidate = applyMerge(current, incoming);

    expect(candidate.tables.map((item) => item.id)).toEqual(['a', 'b']);
    expect(JSON.stringify(current)).toBe(currentSnapshot);
    expect(JSON.stringify(incoming)).toBe(incomingSnapshot);
  });

  it('overwrites an id-conflicting table in place and keeps its position', () => {
    const current = project([table('a', 'Alpha', { position: { x: 40, y: 50 } })]);
    const incoming = project([table('a', 'Alpha2', { position: { x: 999, y: 999 } })]);
    const resolutions: MergeResolutions = { a: { kind: 'overwrite' } };

    const candidate = applyMerge(current, incoming, resolutions);

    expect(candidate.tables).toHaveLength(1);
    expect(candidate.tables[0]?.name).toBe('Alpha2');
    expect(candidate.tables[0]?.position).toEqual({ x: 40, y: 50 });
  });

  it('skips an id-conflicting table', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([table('a', 'Alpha2'), table('b', 'Beta')]);
    const resolutions: MergeResolutions = { a: { kind: 'skip' } };

    const candidate = applyMerge(current, incoming, resolutions);

    expect(candidate.tables.map((item) => item.id)).toEqual(['a', 'b']);
    expect(candidate.tables[0]?.name).toBe('Alpha');
  });

  it('renames an id-conflicting table and rewrites internal refs', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([
      table('a', 'Alpha2', {
        columns: [column('id', 'id', 'int')],
      }),
      table('b', 'Beta', {
        columns: [column('target', 'target', 'ref', { tableId: 'a', columnId: 'id' })],
      }),
    ]);
    const resolutions: MergeResolutions = {
      a: { kind: 'rename', newTableId: 'a_2', newTableName: 'Alpha2 (2)' },
    };

    const candidate = applyMerge(current, incoming, resolutions);

    expect(candidate.tables.map((item) => item.id)).toEqual(['a', 'a_2', 'b']);
    const renamed = candidate.tables.find((item) => item.id === 'a_2');
    expect(renamed?.name).toBe('Alpha2 (2)');
    const beta = candidate.tables.find((item) => item.id === 'b');
    expect(beta?.columns[0]?.ref?.tableId).toBe('a_2');
  });

  it('nudges appended tables whose position overlaps an existing table', () => {
    const current = project([table('a', 'Alpha', { position: { x: 100, y: 100 } })]);
    const incoming = project([
      table('n1', 'N1', { position: { x: 100, y: 100 } }),
      table('n2', 'N2', { position: { x: 100, y: 100 } }),
    ]);

    const candidate = applyMerge(current, incoming);

    const n1 = candidate.tables.find((item) => item.id === 'n1');
    const n2 = candidate.tables.find((item) => item.id === 'n2');
    expect(n1?.position).toEqual({ x: 140, y: 140 });
    expect(n2?.position).toEqual({ x: 180, y: 180 });
  });
});

describe('computeMergeReport', () => {
  it('reports counts for a clean merge', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([table('b', 'Beta'), table('c', 'Gamma')]);
    const report = computeMergeReport(current, incoming, {}, t);

    expect(report.counts).toEqual({ added: 2, overwritten: 0, skipped: 0, renamed: 0 });
    expect(report.newErrorCount).toBe(0);
    expect(report.newWarningCount).toBe(0);
  });

  it('blocks a merge when overwrite breaks an existing reference', () => {
    const current = project([
      table('a', 'Alpha', {
        columns: [column('id', 'id', 'int')],
      }),
      table('src', 'Src', {
        columns: [column('target', 'target', 'ref', { tableId: 'a', columnId: 'id' })],
      }),
    ]);
    const incoming = project([
      table('a', 'Alpha2', {
        columns: [column('other', 'other')],
      }),
    ]);
    const report = computeMergeReport(current, incoming, { a: { kind: 'overwrite' } }, t);

    expect(report.newErrorCount).toBeGreaterThan(0);
    expect(report.newIssues.some((issue) => issue.id.endsWith('ref-target-missing'))).toBe(true);
  });

  it('blocks an import whose file contains duplicate table ids', () => {
    const current = project([table('a', 'Alpha')]);
    const incoming = project([table('x', 'X1'), table('x', 'X2')]);
    const report = computeMergeReport(current, incoming, {}, t);

    expect(report.newErrorCount).toBeGreaterThan(0);
    expect(report.newIssues.some((issue) => issue.id.endsWith('table-id-duplicate'))).toBe(true);
  });

  it('allows a merge that only introduces warnings', () => {
    const current = project([]);
    const incoming = project([table('b1', 'Shared'), table('b2', 'Shared')]);
    const report = computeMergeReport(current, incoming, {}, t);

    expect(report.newErrorCount).toBe(0);
    expect(report.newWarningCount).toBeGreaterThan(0);
    expect(report.newIssues.some((issue) => issue.id.endsWith('table-name-duplicate'))).toBe(true);
  });

  it('counts skipped and renamed tables from the resolutions', () => {
    const current = project([table('a', 'Alpha'), table('x', 'Shared')]);
    const incoming = project([table('a', 'Alpha2'), table('y', 'Shared'), table('b', 'Beta')]);
    const report = computeMergeReport(
      current,
      incoming,
      {
        a: { kind: 'skip' },
        y: { kind: 'rename', newTableId: 'y', newTableName: 'Shared (2)' },
      },
      t,
    );

    expect(report.counts).toEqual({ added: 1, overwritten: 0, skipped: 1, renamed: 1 });
    expect(report.candidate.tables.map((item) => item.id)).toEqual(['a', 'x', 'y', 'b']);
    expect(report.candidate.tables.find((item) => item.id === 'y')?.name).toBe('Shared (2)');
  });

  it('marks pre-existing issues as existing instead of new', () => {
    const current = project([table('a', 'A', { columns: [column('x', '')] })]);
    const incoming = project([table('b', 'B')]);
    const report = computeMergeReport(current, incoming, {}, t);

    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.newIssues).toHaveLength(0);
    expect(report.newErrorCount).toBe(0);
  });
});
