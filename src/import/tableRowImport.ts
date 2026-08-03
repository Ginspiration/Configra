import type { Translator } from '../i18n';
import { createDefaultRow, makeId } from '../model/rowFactory';
import type {
  ConfigColumn,
  ConfigRow,
  ConfigTable,
  ProjectFile,
} from '../model/types';
import { validateProject } from '../validation/validateProject';

export type TableImportMode = 'strict' | 'auto-increment';

/** Imported row values keyed by stable column id. */
export type TableImportRow = Record<string, unknown>;

export type TableImportIssue = {
  severity: 'error' | 'warning';
  rowIndex?: number;
  columnId?: string;
  columnName?: string;
  message: string;
};

export type TableImportParseResult =
  | { ok: true; rows: TableImportRow[] }
  | { ok: false; issues: TableImportIssue[] };

export type TableImportReport = {
  rows: ConfigRow[];
  issues: TableImportIssue[];
  errorCount: number;
  warningCount: number;
  blocked: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const columnForKey = (table: ConfigTable, key: string): ConfigColumn | undefined =>
  table.columns.find((column) => column.name === key) ??
  table.columns.find((column) => column.id === key);

type CoerceResult = { ok: true; value: unknown } | { ok: false };

const coerceValue = (column: ConfigColumn, rawValue: unknown): CoerceResult => {
  if (rawValue === null || rawValue === undefined) return { ok: true, value: '' };

  if (column.type === 'int') {
    const value = typeof rawValue === 'string' && rawValue.trim() !== '' ? Number(rawValue) : rawValue;
    return typeof value === 'number' && Number.isInteger(value)
      ? { ok: true, value }
      : { ok: false };
  }

  if (column.type === 'float') {
    const value = typeof rawValue === 'string' && rawValue.trim() !== '' ? Number(rawValue) : rawValue;
    return typeof value === 'number' && Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false };
  }

  if (column.type === 'bool') {
    if (typeof rawValue === 'boolean') return { ok: true, value: rawValue };
    if (typeof rawValue === 'string') {
      const normalized = rawValue.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) return { ok: true, value: true };
      if (['false', '0', 'no', 'n'].includes(normalized)) return { ok: true, value: false };
    }
    return { ok: false };
  }

  if (column.type === 'string') {
    return typeof rawValue === 'string' ? { ok: true, value: rawValue } : { ok: false };
  }

  if (column.type === 'enum') {
    return typeof rawValue === 'string' ? { ok: true, value: rawValue } : { ok: false };
  }

  if (column.type === 'ref') {
    return typeof rawValue === 'string' || typeof rawValue === 'number'
      ? { ok: true, value: rawValue }
      : { ok: false };
  }

  if (column.type === 'json') {
    return { ok: true, value: typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue) };
  }

  return { ok: true, value: rawValue };
};

export function parseTableJsonImport(
  text: string,
  table: ConfigTable,
  t: Translator,
): TableImportParseResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ severity: 'error', message: t('parseInvalidJson') }] };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, issues: [{ severity: 'error', message: t('importRootArray') }] };
  }

  const issues: TableImportIssue[] = [];
  const rows: TableImportRow[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      issues.push({
        severity: 'error',
        rowIndex: index,
        message: t('importRowObject', { row: index + 1 }),
      });
      continue;
    }

    const values: TableImportRow = {};

    for (const [key, value] of Object.entries(item)) {
      const column = columnForKey(table, key);
      if (!column) {
        issues.push({
          severity: 'error',
          rowIndex: index,
          message: t('importUnknownField', { row: index + 1, field: key }),
        });
        continue;
      }

      const coerced = coerceValue(column, value);
      if (!coerced.ok) {
        issues.push({
          severity: 'error',
          rowIndex: index,
          columnId: column.id,
          columnName: column.name,
          message: t('importInvalidValue', {
            row: index + 1,
            column: column.name || column.id,
          }),
        });
        continue;
      }

      values[column.id] = coerced.value;
    }

    rows.push(values);
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, rows };
}

const nextAutoIncrementStart = (table: ConfigTable, column: ConfigColumn) => {
  const numericValues = table.rows
    .map((row) => row.values[column.id])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return numericValues.length === 0 ? 1 : Math.max(...numericValues) + 1;
};

export function buildTableImportReport(
  project: ProjectFile,
  tableId: string,
  incoming: TableImportRow[],
  mode: TableImportMode,
  t: Translator,
): TableImportReport {
  const table = project.tables.find((item) => item.id === tableId);
  if (!table) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('noTableSelected') }],
      errorCount: 1,
      warningCount: 0,
      blocked: true,
    };
  }

  if (incoming.length === 0) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('importNoRows') }],
      errorCount: 1,
      warningCount: 0,
      blocked: true,
    };
  }

  const autoIncrementColumn = table.columns.find((column) => column.autoIncrement);
  if (mode === 'auto-increment' && !autoIncrementColumn) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('importNoAutoIncrement') }],
      errorCount: 1,
      warningCount: 0,
      blocked: true,
    };
  }

  const autoIncrementStart =
    mode === 'auto-increment' && autoIncrementColumn
      ? nextAutoIncrementStart(table, autoIncrementColumn)
      : 0;

  const rows = incoming.map((values, index) => {
    const row = createDefaultRow(table, makeId('row'), values);

    if (mode === 'auto-increment' && autoIncrementColumn) {
      row.values[autoIncrementColumn.id] = autoIncrementStart + index;
    }

    return row;
  });

  const importedRowIds = new Set(rows.map((row) => row._rowId));
  const candidate: ProjectFile = {
    ...project,
    tables: project.tables.map((item) =>
      item.id === tableId ? { ...item, rows: [...item.rows, ...rows] } : item,
    ),
  };

  const rowIndexByRowId = new Map(rows.map((row, index) => [row._rowId, index]));
  const columnById = new Map(table.columns.map((column) => [column.id, column]));
  const issues = validateProject(candidate, t)
    .filter((issue) => issue.rowId !== undefined && importedRowIds.has(issue.rowId))
    .map((issue) => {
      const column = issue.columnId ? columnById.get(issue.columnId) : undefined;
      return {
        severity: issue.severity,
        rowIndex: rowIndexByRowId.get(issue.rowId ?? ''),
        columnId: issue.columnId,
        columnName: column?.name,
        message: issue.message,
      } satisfies TableImportIssue;
    });

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return {
    rows,
    issues,
    errorCount,
    warningCount,
    blocked: errorCount > 0,
  };
}
