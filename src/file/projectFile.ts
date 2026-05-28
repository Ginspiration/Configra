import { COLUMN_TYPES, type ColumnType, type ProjectFile } from '../model/types';
import type { Translator } from '../i18n';

type ParseResult =
  | { ok: true; project: ProjectFile }
  | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isColumnType = (value: unknown): value is ColumnType =>
  typeof value === 'string' && (COLUMN_TYPES as readonly string[]).includes(value);

export function parseProjectFileText(text: string, t: Translator): ParseResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: t('parseInvalidJson') };
  }

  if (!isRecord(raw)) return { ok: false, error: t('parseRootObject') };
  if (raw.version !== 1) return { ok: false, error: t('parseUnsupportedVersion') };
  if (!Array.isArray(raw.tables)) return { ok: false, error: t('parseTablesArray') };

  for (const [tableIndex, table] of raw.tables.entries()) {
    if (!isRecord(table)) return { ok: false, error: t('parseTableObject', { index: tableIndex }) };
    if (typeof table.id !== 'string' || typeof table.name !== 'string') {
      return { ok: false, error: t('parseTableIdName', { index: tableIndex }) };
    }

    if (
      !isRecord(table.position) ||
      typeof table.position.x !== 'number' ||
      typeof table.position.y !== 'number'
    ) {
      return { ok: false, error: t('parseTablePosition', { table: table.name }) };
    }

    if (!Array.isArray(table.columns)) {
      return { ok: false, error: t('parseColumnsArray', { table: table.name }) };
    }

    if (!Array.isArray(table.rows)) {
      return { ok: false, error: t('parseRowsArray', { table: table.name }) };
    }

    for (const [columnIndex, column] of table.columns.entries()) {
      if (!isRecord(column)) {
        return {
          ok: false,
          error: t('parseColumnObject', { table: table.name, index: columnIndex }),
        };
      }

      if (
        typeof column.id !== 'string' ||
        typeof column.name !== 'string' ||
        !isColumnType(column.type)
      ) {
        return {
          ok: false,
          error: t('parseColumnShape', { table: table.name, index: columnIndex }),
        };
      }

      if (
        column.enumValues !== undefined &&
        (!Array.isArray(column.enumValues) ||
          column.enumValues.some((item) => typeof item !== 'string'))
      ) {
        return {
          ok: false,
          error: t('parseEnumValues', { table: table.name, column: column.name }),
        };
      }

      if (
        column.ref !== undefined &&
        (!isRecord(column.ref) ||
          typeof column.ref.tableId !== 'string' ||
          typeof column.ref.columnId !== 'string')
      ) {
        return {
          ok: false,
          error: t('parseRefInvalid', { table: table.name, column: column.name }),
        };
      }
    }

    for (const [rowIndex, row] of table.rows.entries()) {
      if (!isRecord(row)) {
        return {
          ok: false,
          error: t('parseRowObject', { table: table.name, index: rowIndex }),
        };
      }

      if (typeof row._rowId !== 'string' || !isRecord(row.values)) {
        return {
          ok: false,
          error: t('parseRowShape', { table: table.name, index: rowIndex }),
        };
      }
    }
  }

  return { ok: true, project: raw as ProjectFile };
}
