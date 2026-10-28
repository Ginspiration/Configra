import type { ConfigColumn, ConfigRow, ConfigTable } from './types';

export type RowIdFactory = (prefix?: string) => string;

export const makeId: RowIdFactory = (prefix = 'id') =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

export const uniqueName = (base: string, existing: string[]) => {
  let name = base;
  let index = 1;
  while (existing.includes(name)) {
    index += 1;
    name = `${base}${index}`;
  }
  return name;
};

export const defaultValueForColumn = (column: ConfigColumn): unknown => {
  if (column.type === 'bool') return false;
  if (column.type === 'enum') return column.enumValues?.[0] ?? '';
  if (column.type === 'json') return '{}';
  return '';
};

export const autoIncrementValue = (table: ConfigTable, column: ConfigColumn) => {
  const lastValue = table.rows[table.rows.length - 1]?.values[column.id];
  if (typeof lastValue === 'number' && Number.isFinite(lastValue)) return lastValue + 1;

  const numericValues = table.rows
    .map((row) => row.values[column.id])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return numericValues.length === 0 ? 1 : Math.max(...numericValues) + 1;
};

export const defaultValuesForTable = (table: ConfigTable) =>
  Object.fromEntries(
    table.columns.map((column) => [
      column.id,
      column.autoIncrement && column.type === 'int'
        ? autoIncrementValue(table, column)
        : defaultValueForColumn(column),
    ]),
  );

export const createDefaultRow = (
  table: ConfigTable,
  rowId = makeId('row'),
  values: Record<string, unknown> = {},
): ConfigRow => ({
  _rowId: rowId,
  values: {
    ...defaultValuesForTable(table),
    ...values,
  },
});
