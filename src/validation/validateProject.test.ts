import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';
import type { ConfigColumn, ConfigRow, ConfigTable, ProjectFile, ValidationIssue } from '../model/types';
import { validateProject } from './validateProject';

const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('en', key, vars);

const column = (id: string, name = id): ConfigColumn => ({
  id,
  name,
  type: 'string',
});

const row = (rowId: string, values: Record<string, unknown> = {}): ConfigRow => ({
  _rowId: rowId,
  values,
});

const table = (
  id: string,
  name = id,
  columns: ConfigColumn[] = [],
  rows: ConfigRow[] = [],
): ConfigTable => ({
  id,
  name,
  position: { x: 0, y: 0 },
  columns,
  rows,
});

const project = (tables: ConfigTable[]): ProjectFile => ({ version: 1, tables });

const issueCodes = (issues: ValidationIssue[]) => issues.map((issue) => issue.id.split(':').pop());

describe('validateProject integrity rules', () => {
  it('reports an empty table id as an error', () => {
    const issues = validateProject(project([table('', 'Empty')]), t);
    expect(issueCodes(issues)).toContain('table-id-empty');
    expect(issues.find((issue) => issue.id.endsWith('table-id-empty'))?.severity).toBe('error');
  });

  it('reports duplicate table ids across the project as errors', () => {
    const issues = validateProject(
      project([table('a', 'First'), table('a', 'Second'), table('b', 'Third')]),
      t,
    );
    const duplicate = issues.filter((issue) => issue.id.endsWith('table-id-duplicate'));
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe('error');
    expect(duplicate[0]?.message).toContain('Second');
  });

  it('reports duplicate table names as warnings', () => {
    const issues = validateProject(
      project([table('a', 'Shared'), table('b', 'Shared')]),
      t,
    );
    const duplicate = issues.filter((issue) => issue.id.endsWith('table-name-duplicate'));
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe('warning');
  });

  it('reports empty and duplicate column ids within a table', () => {
    const issues = validateProject(
      project([
        table('a', 'A', [column('', 'Empty'), column('x', 'First'), column('x', 'Second')]),
      ]),
      t,
    );
    expect(issueCodes(issues)).toContain('column-id-empty');
    const duplicate = issues.filter((issue) => issue.id.endsWith('column-id-duplicate'));
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe('error');
  });

  it('allows the same column id in different tables', () => {
    const issues = validateProject(
      project([table('a', 'A', [column('x')]), table('b', 'B', [column('x')])]),
      t,
    );
    expect(issueCodes(issues)).not.toContain('column-id-duplicate');
  });

  it('reports empty and duplicate row ids within a table', () => {
    const issues = validateProject(
      project([table('a', 'A', [column('x')], [row(''), row('r1'), row('r1')])]),
      t,
    );
    expect(issueCodes(issues)).toContain('row-id-empty');
    const duplicate = issues.filter((issue) => issue.id.endsWith('row-id-duplicate'));
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe('error');
  });

  it('allows the same row id in different tables', () => {
    const issues = validateProject(
      project([
        table('a', 'A', [column('x')], [row('r1')]),
        table('b', 'B', [column('x')], [row('r1')]),
      ]),
      t,
    );
    expect(issueCodes(issues)).not.toContain('row-id-duplicate');
  });
});
