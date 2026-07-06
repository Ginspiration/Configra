import type { ConfigColumn, ConfigRow, ConfigTable } from './types';

const DISPLAY_FIELD_NAMES = [
  'name',
  'title',
  'label',
  'display_name',
  'displayName',
  'desc',
  'description',
];

const isPresent = (value: unknown) => value !== null && value !== undefined && value !== '';

const normalized = (value: string) => value.trim().toLowerCase();

export function getPrimaryColumn(table: ConfigTable | undefined) {
  if (!table) return undefined;

  return (
    table.columns.find((column) => column.primary) ??
    table.columns.find((column) => normalized(column.name) === 'id' || normalized(column.id) === 'id') ??
    table.columns[0]
  );
}

export function getDisplayColumn(table: ConfigTable | undefined, valueColumnId?: string) {
  if (!table) return undefined;

  const byCommonName = DISPLAY_FIELD_NAMES.map((name) =>
    table.columns.find(
      (column) =>
        column.id !== valueColumnId &&
        (normalized(column.name) === normalized(name) || normalized(column.id) === normalized(name)),
    ),
  ).find(Boolean);

  return (
    byCommonName ??
    table.columns.find(
      (column) =>
        column.id !== valueColumnId && (column.type === 'string' || column.type === 'enum'),
    )
  );
}

export function getIdentityColumns(table: ConfigTable | undefined) {
  const keyColumn = table?.columns.find((column) => column.id === table.identity?.keyColumnId);
  const valueColumn = table?.columns.find((column) => column.id === table.identity?.valueColumnId);
  return { keyColumn, valueColumn };
}

export function identityNamespace(table: ConfigTable) {
  return table.identity?.namespace?.trim() || table.name || table.id;
}

export function formatRefOptionLabel(
  table: ConfigTable,
  targetColumn: ConfigColumn,
  row: ConfigRow,
) {
  const value = row.values[targetColumn.id];
  const { keyColumn, valueColumn } = getIdentityColumns(table);
  const keyValue = keyColumn ? row.values[keyColumn.id] : undefined;

  if (
    keyColumn &&
    valueColumn?.id === targetColumn.id &&
    isPresent(keyValue) &&
    String(keyValue) !== String(value)
  ) {
    return `${String(keyValue)} (${String(value)})`;
  }

  const displayColumn = getDisplayColumn(table, targetColumn.id);
  const displayValue = displayColumn ? row.values[displayColumn.id] : undefined;

  if (!isPresent(displayValue) || String(displayValue) === String(value)) {
    return String(value);
  }

  return `${String(value)} · ${String(displayValue)}`;
}
