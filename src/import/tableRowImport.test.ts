import { describe, expect, it } from 'vitest';
import { exportTableRows } from '../export/exportTables';
import { translate } from '../i18n';
import type { ConfigColumn, ConfigRow, ConfigTable, ProjectFile } from '../model/types';
import { buildTableImportReport, parseTableJsonImport } from './tableRowImport';

const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('en', key, vars);

const column = (
  id: string,
  name = id,
  type: ConfigColumn['type'] = 'string',
  extra: Partial<ConfigColumn> = {},
): ConfigColumn => ({ id, name, type, ...extra });

const row = (id: string, values: Record<string, unknown>): ConfigRow => ({
  _rowId: id,
  values,
});

const project = (tables: ConfigTable[]): ProjectFile => ({ version: 1, tables });

const soundTable = (): ConfigTable => ({
  id: 'sound',
  name: 'Sounds',
  position: { x: 0, y: 0 },
  columns: [
    column('id', 'id', 'int', { primary: true, required: true, autoIncrement: true, export: true }),
    column('name', 'name', 'string', { required: true, export: true }),
    column('enabled', 'enabled', 'bool', { export: true }),
    column('volume', 'volume', 'float', { export: true }),
    column('kind', 'kind', 'enum', { enumValues: ['music', 'sfx'], export: true }),
    column('meta', 'meta', 'json', { export: true }),
  ],
  rows: [
    row('row_1', { id: 1, name: 'Click', enabled: true, volume: 0.8, kind: 'sfx', meta: '{"tag":"ui"}' }),
    row('row_2', { id: 2, name: 'Win', enabled: false, volume: 1, kind: 'music', meta: '{}' }),
  ],
});

const identityTable = (): ConfigTable => ({
  ...soundTable(),
  identity: { namespace: 'Sound', keyColumnId: 'code', valueColumnId: 'id' },
  columns: [
    column('code', 'code', 'string', { required: true }),
    ...soundTable().columns,
  ],
  rows: [
    row('ident_1', { code: 'SOUND_CLICK', id: 1, name: 'Click' }),
    row('ident_2', { code: 'SOUND_WIN', id: 2, name: 'Win' }),
  ],
});

const itemTable = (): ConfigTable => ({
  id: 'item',
  name: 'Items',
  position: { x: 0, y: 0 },
  columns: [
    column('itemId', 'itemId', 'int', { primary: true, required: true }),
    column('label', 'label', 'string'),
  ],
  rows: [row('item_1', { itemId: 10, label: 'Sword' })],
});

const inventoryTable = (): ConfigTable => ({
  id: 'inventory',
  name: 'Inventory',
  position: { x: 0, y: 0 },
  columns: [
    column('id', 'id', 'int', { primary: true, required: true, autoIncrement: true }),
    column('item', 'item', 'ref', { ref: { tableId: 'item', columnId: 'itemId' } }),
  ],
  rows: [row('inv_1', { id: 1, item: 10 })],
});

describe('parseTableJsonImport', () => {
  it('round-trips the exported table JSON', () => {
    const table = soundTable();
    const exported = JSON.stringify(exportTableRows(project([table]), table.id));
    const parsed = parseTableJsonImport(exported, table, t);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].id).toBe(1);
    expect(parsed.rows[0].name).toBe('Click');
    expect(parsed.rows[0].enabled).toBe(true);
    expect(parsed.rows[0].meta).toBe('{"tag":"ui"}');
  });

  it('rejects invalid JSON text', () => {
    const parsed = parseTableJsonImport('not json', soundTable(), t);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0].message).toContain('valid JSON');
  });

  it('rejects a non-array root', () => {
    const parsed = parseTableJsonImport('{"tables":[]}', soundTable(), t);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0].message).toContain('array of row objects');
  });

  it('rejects non-object elements', () => {
    const parsed = parseTableJsonImport('[1, "x"]', soundTable(), t);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0].message).toContain('Row 1 must be an object');
  });

  it('rejects unknown fields with row and field names', () => {
    const parsed = parseTableJsonImport('[{"id":1,"nope":2}]', soundTable(), t);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0].message).toContain('unknown field nope');
    expect(parsed.issues[0].rowIndex).toBe(0);
  });

  it('coerces int, float, bool and json values leniently', () => {
    const parsed = parseTableJsonImport(
      '[{"id":"5","name":"A","enabled":"true","volume":"1.5","kind":"sfx","meta":{"a":1}}]',
      soundTable(),
      t,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].id).toBe(5);
    expect(parsed.rows[0].enabled).toBe(true);
    expect(parsed.rows[0].volume).toBe(1.5);
    expect(parsed.rows[0].meta).toBe('{"a":1}');
  });

  it('rejects invalid int values', () => {
    expect(parseTableJsonImport('[{"id":"abc"}]', soundTable(), t).ok).toBe(false);
    expect(parseTableJsonImport('[{"id":1.5}]', soundTable(), t).ok).toBe(false);
  });

  it('rejects invalid bool values', () => {
    expect(parseTableJsonImport('[{"enabled":"maybe"}]', soundTable(), t).ok).toBe(false);
  });
});

describe('buildTableImportReport', () => {
  it('appends valid rows unchanged in strict mode', () => {
    const table = soundTable();
    const incoming = [{ id: 5, name: 'New', enabled: false, volume: 0.5, kind: 'sfx', meta: '{}' }];
    const report = buildTableImportReport(project([table]), table.id, incoming, 'strict', t);

    expect(report.blocked).toBe(false);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].values.id).toBe(5);
    expect(report.rows[0].values.name).toBe('New');
  });

  it('rejects duplicates with existing rows in strict mode', () => {
    const table = soundTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [{ id: 1, name: 'Click Again' }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.message.includes('duplicates'))).toBe(true);
  });

  it('rejects duplicates between imported rows in strict mode', () => {
    const table = soundTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [
        { id: 9, name: 'A' },
        { id: 9, name: 'B' },
      ],
      'strict',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.issues.filter((issue) => issue.rowIndex === 1).length).toBeGreaterThan(0);
  });

  it('rejects duplicate ID registry keys in strict mode', () => {
    const table = identityTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [{ code: 'SOUND_CLICK', id: 3, name: 'Dup' }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes('duplicates'))).toBe(true);
  });

  it('regenerates the auto-increment column in auto-increment mode', () => {
    const table = soundTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [
        { id: 999, name: 'A' },
        { id: 999, name: 'B' },
      ],
      'auto-increment',
      t,
    );

    expect(report.blocked).toBe(false);
    expect(report.rows[0].values.id).toBe(3);
    expect(report.rows[1].values.id).toBe(4);
  });

  it('blocks auto-increment mode when the table has no auto-increment column', () => {
    const table: ConfigTable = {
      ...soundTable(),
      columns: soundTable().columns.map((item) =>
        item.id === 'id' ? { ...item, autoIncrement: false } : item,
      ),
    };
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [{ id: 9, name: 'A' }],
      'auto-increment',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.issues[0].message).toContain('no auto-increment');
  });

  it('blocks the whole import when a required field is missing', () => {
    const table = soundTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [{ id: 5, name: '' }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes('required'))).toBe(true);
  });

  it('blocks invalid enum values', () => {
    const table = soundTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [{ id: 5, name: 'A', kind: 'ambient' }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes('enum values'))).toBe(true);
  });

  it('blocks ref values that do not exist in the target table', () => {
    const table = inventoryTable();
    const report = buildTableImportReport(
      project([table, itemTable()]),
      table.id,
      [{ id: 2, item: 99 }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes('reference an existing value'))).toBe(true);
  });

  it('accepts ref values that exist in the target table', () => {
    const table = inventoryTable();
    const report = buildTableImportReport(
      project([table, itemTable()]),
      table.id,
      [{ id: 2, item: 10 }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(false);
  });

  it('blocks an empty import', () => {
    const parsed = parseTableJsonImport('[]', soundTable(), t);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const report = buildTableImportReport(project([soundTable()]), 'sound', parsed.rows, 'strict', t);
    expect(report.blocked).toBe(true);
    expect(report.issues[0].message).toContain('No rows to import');
  });

  it('does not block rows with only optional empty values', () => {
    const table = soundTable();
    const report = buildTableImportReport(
      project([table]),
      table.id,
      [{ id: 7, name: 'X' }],
      'strict',
      t,
    );

    expect(report.blocked).toBe(false);
    expect(report.rows[0].values.enabled).toBe(false);
    expect(report.rows[0].values.meta).toBe('{}');
  });
});
