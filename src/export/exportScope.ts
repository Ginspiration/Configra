import { identityNamespace } from '../model/schemaUtils';
import type {
  ConfigColumn,
  ConfigRow,
  ConfigTable,
  ProjectFile,
  ValidationIssue,
} from '../model/types';

export type ExportJsonFile = {
  fileName: string;
  text: string;
};

export type ExportProblemCode =
  | 'EXPORT_SCOPE_UNCONFIGURED'
  | 'NO_PUBLISHED_TABLES'
  | 'TABLE_NOT_PUBLISHED'
  | 'TABLE_NOT_FOUND'
  | 'VALIDATION_ERRORS'
  | 'REF_NOT_PUBLISHED'
  | 'REF_TARGET_NOT_EXPORTED'
  | 'REF_TARGET_DUPLICATE'
  | 'DUPLICATE_ID'
  | 'UNSAFE_EXPORT_TARGET'
  | 'FOREIGN_PUBLISH_MANIFEST'
  | 'INVALID_PUBLISH_MANIFEST'
  | 'EXPORT_VERIFY_FAILED';

export type ExportProblem = {
  code: ExportProblemCode;
  message: string;
  tableId?: string;
  rowId?: string;
  columnId?: string;
  count?: number;
  validation?: ValidationIssue[];
};

export class ExportScopeError extends Error {
  readonly problem: ExportProblem;

  constructor(problem: ExportProblem) {
    super(problem.message);
    this.name = 'ExportScopeError';
    this.problem = problem;
  }
}

export type ExportPlanTable = {
  tableId: string;
  tableName: string;
  columns: ConfigColumn[];
  rows: ConfigRow[];
  skippedRowCount: number;
  file: ExportJsonFile;
};

export type ExportPlan = {
  mode: 'published' | 'all';
  tables: ExportPlanTable[];
  files: ExportJsonFile[];
  idRegistry: Record<string, unknown>;
  skippedTables: number;
  skippedRows: number;
  totalRows: number;
};

export type BuildExportPlanOptions = {
  /** 显式全量导出；只用于用户确认过的开发/备份场景。 */
  includeUnpublished?: boolean;
  /** 只导出一张表；该表未发布时仍会报错，除非 includeUnpublished。 */
  onlyTableId?: string;
  /** 当前工程的校验问题；只拦截已发布表/行里的错误。 */
  issues?: ValidationIssue[];
};

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '';

const valueKey = (value: unknown) => `${typeof value}:${String(value)}`;

export const safeFileName = (value: string) =>
  value.trim().replace(/[^a-z0-9_-]+/gi, '_') || 'table';

const uniqueJsonFileName = (baseName: string, usedFileNames: Set<string>) => {
  let suffix = 1;
  let fileName = `${baseName}.json`;

  while (usedFileNames.has(fileName.toLowerCase())) {
    suffix += 1;
    fileName = `${baseName}_${suffix}.json`;
  }

  usedFileNames.add(fileName.toLowerCase());
  return fileName;
};

const exportValue = (column: ConfigColumn, value: unknown) => {
  if (column.type !== 'json' || typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const exportRowObject = (
  columns: ConfigColumn[],
  row: ConfigRow,
): Record<string, unknown> =>
  Object.fromEntries(
    columns.map((column) => [
      column.name || column.id,
      exportValue(column, row.values[column.id]),
    ]),
  );

const tableJsonText = (columns: ConfigColumn[], rows: ConfigRow[]) =>
  `${JSON.stringify(
    rows.map((row) => exportRowObject(columns, row)),
    null,
    2,
  )}\n`;

const fail = (problem: ExportProblem): never => {
  throw new ExportScopeError(problem);
};

/**
 * 计算一次导出/发布实际会写出的内容。
 *
 * 安全规则：
 * - 工程未声明 exportPolicy 时，普通导出直接拒绝；
 * - 只有 publish=true 的表和行会进入文件；
 * - config_ids.json 与表 JSON 使用同一批行，避免 ID 注册表泄漏未发布行；
 * - 已发布行引用未发布行时拒绝导出；
 * - 写完前自检行数、字段名和 ID 集合。
 */
export function buildExportPlan(
  project: ProjectFile,
  options: BuildExportPlanOptions = {},
): ExportPlan {
  const includeUnpublished = options.includeUnpublished === true;
  const onlyTableId = options.onlyTableId;

  if (!includeUnpublished && project.exportPolicy !== 'explicit') {
    fail({
      code: 'EXPORT_SCOPE_UNCONFIGURED',
      message:
        'This project has no explicit publish scope. Mark at least one table as publishable before exporting.',
    });
  }

  const candidateTables = onlyTableId
    ? project.tables.filter((table) => table.id === onlyTableId)
    : project.tables;

  if (onlyTableId && candidateTables.length === 0) {
    fail({
      code: 'TABLE_NOT_FOUND',
      message: `Table "${onlyTableId}" does not exist.`,
      tableId: onlyTableId,
    });
  }

  const includedTables = candidateTables.filter(
    (table) => includeUnpublished || table.publish === true,
  );

  if (includedTables.length === 0 && candidateTables.length > 0) {
    if (onlyTableId) {
      const table = candidateTables[0];
      fail({
        code: 'TABLE_NOT_PUBLISHED',
        message: `Table "${table.name || table.id}" is not marked as publishable.`,
        tableId: table.id,
      });
    }

    fail({
      code: 'NO_PUBLISHED_TABLES',
      message: 'No tables are marked as publishable.',
    });
  }

  const selectedRowsByTable = new Map<string, ConfigRow[]>();
  for (const table of includedTables) {
    selectedRowsByTable.set(
      table.id,
      includeUnpublished
        ? table.rows
        : table.rows.filter((row) => row.publish === true),
    );
  }

  // 单表导出时，被引用的目标表不一定也在本次输出里；只要它在工程里
  // 是可发布的，就按它的可发布行做引用一致性校验。
  const referenceTables = includeUnpublished
    ? project.tables
    : project.tables.filter((table) => table.publish === true);
  const referenceRowsByTable = new Map<string, ConfigRow[]>();
  for (const table of referenceTables) {
    referenceRowsByTable.set(
      table.id,
      includeUnpublished
        ? table.rows
        : table.rows.filter((row) => row.publish === true),
    );
  }

  const includedTableIds = new Set(includedTables.map((table) => table.id));
  const includedRowIds = new Map<string, Set<string>>();
  for (const [tableId, rows] of selectedRowsByTable) {
    includedRowIds.set(tableId, new Set(rows.map((row) => row._rowId)));
  }

  const skippedRows = candidateTables.reduce((count, table) => {
    const selected = selectedRowsByTable.get(table.id)?.length ?? 0;
    return count + (table.rows.length - selected);
  }, 0);

  const blockingIssues = (options.issues ?? []).filter((issue) => {
    if (issue.severity !== 'error') return false;
    if (!includedTableIds.has(issue.tableId)) return false;
    if (!issue.rowId) return true;
    return includedRowIds.get(issue.tableId)?.has(issue.rowId) === true;
  });

  if (blockingIssues.length > 0) {
    const first = blockingIssues[0];
    fail({
      code: 'VALIDATION_ERRORS',
      message: `Published content has ${blockingIssues.length} validation error(s). ${first.message}`,
      tableId: first.tableId,
      rowId: first.rowId,
      columnId: first.columnId,
      count: blockingIssues.length,
      validation: blockingIssues,
    });
  }

  const valueSets = new Map<string, Set<string>>();
  const valueCounts = new Map<string, Map<string, number>>();
  for (const table of referenceTables) {
    const rows = referenceRowsByTable.get(table.id) ?? [];
    for (const column of table.columns) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const value = row.values[column.id];
        if (isEmpty(value)) continue;
        const key = valueKey(value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      valueCounts.set(`${table.id}\0${column.id}`, counts);
      valueSets.set(`${table.id}\0${column.id}`, new Set(counts.keys()));
    }
  }

  for (const table of includedTables) {
    const rows = selectedRowsByTable.get(table.id) ?? [];
    for (const column of table.columns) {
      if (column.export === false || column.type !== 'ref' || !column.ref) continue;

      const targetTable = project.tables.find(
        (candidate) => candidate.id === column.ref?.tableId,
      );
      const targetColumn = targetTable?.columns.find(
        (candidate) => candidate.id === column.ref?.columnId,
      );

      if (!targetTable || !targetColumn) {
        throw new ExportScopeError({
          code: 'REF_NOT_PUBLISHED',
          message: `Published column ${table.name}.${column.name || column.id} references a table that is not published.`,
          tableId: table.id,
          columnId: column.id,
        });
      }
      if (!referenceRowsByTable.has(targetTable.id)) {
        throw new ExportScopeError({
          code: 'REF_NOT_PUBLISHED',
          message: `Published column ${table.name}.${column.name || column.id} references a table that is not published.`,
          tableId: table.id,
          columnId: column.id,
        });
      }

      const publishedTargetTable = targetTable;
      const publishedTargetColumn = targetColumn;
      if (publishedTargetColumn.export === false) {
        fail({
          code: 'REF_TARGET_NOT_EXPORTED',
          message: `Published column ${table.name}.${column.name || column.id} references ${publishedTargetTable.name}.${publishedTargetColumn.name || publishedTargetColumn.id}, which is excluded from export.`,
          tableId: table.id,
          columnId: column.id,
        });
      }

      const targetKey = `${publishedTargetTable.id}\0${publishedTargetColumn.id}`;
      const targetValues = valueSets.get(targetKey) ?? new Set();
      const targetCounts = valueCounts.get(targetKey) ?? new Map();
      for (const row of rows) {
        const value = row.values[column.id];
        if (isEmpty(value)) continue;
        const key = valueKey(value);
        if (!targetValues.has(key)) {
          fail({
            code: 'REF_NOT_PUBLISHED',
            message: `Published row ${table.name} references a value that is not in the published ${publishedTargetTable.name} data.`,
            tableId: table.id,
            rowId: row._rowId,
            columnId: column.id,
          });
        }
        if ((targetCounts.get(key) ?? 0) > 1) {
          fail({
            code: 'REF_TARGET_DUPLICATE',
            message: `Published ${publishedTargetTable.name}.${publishedTargetColumn.name || publishedTargetColumn.id} contains duplicate ref target values.`,
            tableId: table.id,
            rowId: row._rowId,
            columnId: column.id,
          });
        }
      }
    }
  }

  const idRegistry = new Map<string, unknown>();
  for (const table of includedTables) {
    const keyColumn = table.columns.find(
      (column) => column.id === table.identity?.keyColumnId,
    );
    const valueColumn = table.columns.find(
      (column) => column.id === table.identity?.valueColumnId,
    );
    if (!keyColumn || !valueColumn) continue;

    const namespace = identityNamespace(table);
    for (const row of selectedRowsByTable.get(table.id) ?? []) {
      const key = row.values[keyColumn.id];
      const value = row.values[valueColumn.id];
      if (isEmpty(key) || isEmpty(value)) continue;

      const registryKey = `${namespace}.${String(key)}`;
      if (idRegistry.has(registryKey)) {
        fail({
          code: 'DUPLICATE_ID',
          message: `Published ID registry contains duplicate key ${registryKey}.`,
          tableId: table.id,
          rowId: row._rowId,
          columnId: keyColumn.id,
        });
      }
      idRegistry.set(registryKey, value);
    }
  }

  const usedFileNames = new Set<string>();
  const configIdsFile: ExportJsonFile = {
    fileName: uniqueJsonFileName('config_ids', usedFileNames),
    text: `${JSON.stringify(Object.fromEntries(idRegistry), null, 2)}\n`,
  };

  const tables: ExportPlanTable[] = includedTables.map((table) => {
    const columns = table.columns.filter((column) => column.export !== false);
    const rows = selectedRowsByTable.get(table.id) ?? [];
    return {
      tableId: table.id,
      tableName: table.name || table.id,
      columns,
      rows,
      skippedRowCount: table.rows.length - rows.length,
      file: {
        fileName: uniqueJsonFileName(safeFileName(table.name), usedFileNames),
        text: tableJsonText(columns, rows),
      },
    };
  });

  const plan: ExportPlan = {
    mode: includeUnpublished ? 'all' : 'published',
    tables,
    files: [configIdsFile, ...tables.map((table) => table.file)],
    idRegistry: Object.fromEntries(idRegistry),
    skippedTables: candidateTables.length - includedTables.length,
    skippedRows,
    totalRows: tables.reduce((count, table) => count + table.rows.length, 0),
  };

  verifyExportPlan(plan);
  return plan;
}

/** 导出自检：防止生成代码回归成“多写一行/多带一个字段”。 */
export function verifyExportPlan(plan: ExportPlan): void {
  const fileNames = new Set<string>();
  for (const file of plan.files) {
    if (fileNames.has(file.fileName)) {
      fail({
        code: 'EXPORT_VERIFY_FAILED',
        message: `Export produced duplicate file name ${file.fileName}.`,
      });
    }
    fileNames.add(file.fileName);
  }

  const configFile = plan.files[0];
  if (!configFile || configFile.fileName !== 'config_ids.json') {
    fail({
      code: 'EXPORT_VERIFY_FAILED',
      message: 'Export did not produce config_ids.json first.',
    });
  }

  let parsedRegistry: unknown;
  try {
    parsedRegistry = JSON.parse(configFile.text);
  } catch {
    fail({
      code: 'EXPORT_VERIFY_FAILED',
      message: 'config_ids.json is not valid JSON.',
    });
  }

  if (
    typeof parsedRegistry !== 'object' ||
    parsedRegistry === null ||
    Array.isArray(parsedRegistry)
  ) {
    fail({
      code: 'EXPORT_VERIFY_FAILED',
      message: 'config_ids.json is not a JSON object.',
    });
  }

  const registry = parsedRegistry as Record<string, unknown>;
  const actualKeys = Object.keys(registry).sort();
  const expectedKeys = Object.keys(plan.idRegistry).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail({
      code: 'EXPORT_VERIFY_FAILED',
      message: 'config_ids.json keys do not match the export plan.',
    });
  }
  for (const key of expectedKeys) {
    if (registry[key] !== plan.idRegistry[key]) {
      fail({
        code: 'EXPORT_VERIFY_FAILED',
        message: `config_ids.json value for ${key} does not match the export plan.`,
      });
    }
  }

  for (const table of plan.tables) {
    let parsedRows: unknown;
    try {
      parsedRows = JSON.parse(table.file.text);
    } catch {
      fail({
        code: 'EXPORT_VERIFY_FAILED',
        message: `${table.file.fileName} is not valid JSON.`,
      });
    }

    if (!Array.isArray(parsedRows) || parsedRows.length !== table.rows.length) {
      fail({
        code: 'EXPORT_VERIFY_FAILED',
        message: `${table.file.fileName} row count does not match the export plan.`,
        tableId: table.tableId,
      });
    }

    const allowedKeys = new Set(
      table.columns.map((column) => column.name || column.id),
    );
    for (const row of parsedRows as unknown[]) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        fail({
          code: 'EXPORT_VERIFY_FAILED',
          message: `${table.file.fileName} contains a non-object row.`,
          tableId: table.tableId,
        });
      }
      for (const key of Object.keys(row as Record<string, unknown>)) {
        if (!allowedKeys.has(key)) {
          fail({
            code: 'EXPORT_VERIFY_FAILED',
            message: `${table.file.fileName} contains unexpected field ${key}.`,
            tableId: table.tableId,
          });
        }
      }
    }
  }
}
