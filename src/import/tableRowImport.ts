import type { Translator } from '../i18n';
import { createDefaultRow, makeId } from '../model/rowFactory';
import type {
  ConfigColumn,
  ConfigRow,
  ConfigTable,
  ProjectFile,
} from '../model/types';
import { validateProject } from '../validation/validateProject';

export type TableImportMode = 'strict' | 'overwrite-id' | 'auto-increment' | 'partial';

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
  | { ok: true; rows: TableImportRow[]; issues: TableImportIssue[] }
  | { ok: false; issues: TableImportIssue[] };

export type TableImportReport = {
  rows: ConfigRow[];
  issues: TableImportIssue[];
  errorCount: number;
  warningCount: number;
  overwrittenCount: number;
  blocked: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const columnForKey = (table: ConfigTable, key: string): ConfigColumn | undefined =>
  table.columns.find((column) => column.name === key) ??
  table.columns.find((column) => column.id === key);

const valueKey = (value: unknown) => `${typeof value}:${String(value)}`;

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
  mode: TableImportMode = 'strict',
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
        severity: mode === 'partial' ? 'warning' : 'error',
        rowIndex: index,
        message: t('importRowObject', { row: index + 1 }),
      });
      continue;
    }

    const values: TableImportRow = {};

    for (const [key, value] of Object.entries(item)) {
      const column = columnForKey(table, key);
      if (!column) {
        if (mode === 'partial') {
          issues.push({
            severity: 'warning',
            rowIndex: index,
            columnName: key,
            message: t('importSkippedField', { row: index + 1, field: key }),
          });
        } else {
          issues.push({
            severity: 'error',
            rowIndex: index,
            message: t('importUnknownField', { row: index + 1, field: key }),
          });
        }
        continue;
      }

      const coerced = coerceValue(column, value);
      if (!coerced.ok) {
        if (mode === 'partial') {
          // 部分导入不阻止导入：按原样保留值，由用户到表配置中手动修复。
          issues.push({
            severity: 'warning',
            rowIndex: index,
            columnId: column.id,
            columnName: column.name,
            message: t('importInvalidValueKept', {
              row: index + 1,
              column: column.name || column.id,
            }),
          });
          values[column.id] = value;
        } else {
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
        }
        continue;
      }

      values[column.id] = coerced.value;
    }

    rows.push(values);
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) return { ok: false, issues };
  return { ok: true, rows, issues };
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
  incomingIssues: TableImportIssue[] = [],
): TableImportReport {
  const table = project.tables.find((item) => item.id === tableId);
  if (!table) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('noTableSelected') }],
      errorCount: 1,
      warningCount: 0,
      overwrittenCount: 0,
      blocked: true,
    };
  }

  if (incoming.length === 0) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('importNoRows') }],
      errorCount: 1,
      warningCount: 0,
      overwrittenCount: 0,
      blocked: true,
    };
  }

  const primaryColumn = table.columns.find((column) => column.primary);
  if (mode === 'overwrite-id' && !primaryColumn) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('importModeOverwriteIdUnavailable') }],
      errorCount: 1,
      warningCount: 0,
      overwrittenCount: 0,
      blocked: true,
    };
  }

  const autoIncrementColumn = table.columns.find((column) => column.autoIncrement);
  const autoIncrementMode = mode === 'auto-increment' || mode === 'partial';
  if (autoIncrementMode && !autoIncrementColumn) {
    return {
      rows: [],
      issues: [{ severity: 'error', message: t('importNoAutoIncrement') }],
      errorCount: 1,
      warningCount: 0,
      overwrittenCount: 0,
      blocked: true,
    };
  }

  const autoIncrementStart =
    autoIncrementMode && autoIncrementColumn
      ? nextAutoIncrementStart(table, autoIncrementColumn)
      : 0;

  const existingRowByPrimaryValue = new Map(
    primaryColumn
      ? table.rows.map((row) => [valueKey(row.values[primaryColumn.id]), row] as const)
      : [],
  );

  const rows = incoming.map((values, index) => {
    const existingRow =
      mode === 'overwrite-id' && primaryColumn
        ? existingRowByPrimaryValue.get(valueKey(values[primaryColumn.id]))
        : undefined;
    const row = createDefaultRow(table, existingRow?._rowId ?? makeId('row'), values);

    if (autoIncrementMode && autoIncrementColumn) {
      row.values[autoIncrementColumn.id] = autoIncrementStart + index;
    }

    return row;
  });

  const importedRowIds = new Set(rows.map((row) => row._rowId));
  const existingRowIds = new Set(table.rows.map((row) => row._rowId));
  const overwrittenRowIds = new Set(
    mode === 'overwrite-id'
      ? rows.filter((row) => existingRowIds.has(row._rowId)).map((row) => row._rowId)
      : [],
  );
  const candidate: ProjectFile = {
    ...project,
    tables: project.tables.map((item) =>
      item.id === tableId
        ? {
            ...item,
            rows: [
              ...item.rows.filter((row) => !overwrittenRowIds.has(row._rowId)),
              ...rows,
            ],
          }
        : item,
    ),
  };

  const rowIndexByRowId = new Map(rows.map((row, index) => [row._rowId, index]));
  const columnById = new Map(table.columns.map((column) => [column.id, column]));
  const originalIssueIds = new Set(validateProject(project, t).map((issue) => issue.id));
  const issues = [
    ...incomingIssues,
    ...validateProject(candidate, t)
      .filter(
        (issue) =>
          (issue.tableId === tableId &&
            issue.rowId !== undefined &&
            importedRowIds.has(issue.rowId)) ||
          (mode === 'overwrite-id' && !originalIssueIds.has(issue.id)),
      )
      .map((issue) => {
        const column = issue.columnId ? columnById.get(issue.columnId) : undefined;
        return {
          severity: issue.severity,
          rowIndex: rowIndexByRowId.get(issue.rowId ?? ''),
          columnId: issue.columnId,
          columnName: column?.name,
          message: issue.message,
        } satisfies TableImportIssue;
      }),
  ];

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return {
    rows,
    issues,
    errorCount,
    warningCount,
    overwrittenCount: overwrittenRowIds.size,
    // 部分导入不阻止导入，报错由用户导入后手动进表配置修复。
    blocked: mode === 'partial' ? false : errorCount > 0,
  };
}
