import { identityNamespace } from '../model/schemaUtils';
import {
  findReleaseProfile,
  releaseProfileScope,
  ReleaseProfileError,
  type ReleaseProfileScope,
} from '../release/releaseProfiles';
import type {
  ConfigColumn,
  ConfigRow,
  ConfigTable,
  ProjectFile,
  ReleaseProfile,
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
  | 'FOREIGN_RELEASE_PROFILE'
  | 'LEGACY_PUBLISH_MANIFEST'
  | 'INVALID_PUBLISH_MANIFEST'
  | 'EXPORT_VERIFY_FAILED'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_TABLE_NOT_FOUND'
  | 'PROFILE_ROW_NOT_FOUND';

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
  /** 本次导出所使用的发布方案；includeUnpublished 显式全量导出时为空。 */
  profileId?: string;
  profileName?: string;
  profileMode?: ReleaseProfile['mode'];
  tables: ExportPlanTable[];
  files: ExportJsonFile[];
  idRegistry: Record<string, unknown>;
  skippedTables: number;
  skippedRows: number;
  totalRows: number;
};

export type BuildExportPlanOptions = {
  /** 发布方案 id 或唯一名称；不传时使用 activeProfileId。 */
  profileId?: string;
  /** 显式全量导出；只用于用户确认过的开发/备份场景，发布流程不允许使用。 */
  includeUnpublished?: boolean;
  /** 只导出一张表；该表不在方案范围内时仍会报错，除非 includeUnpublished。 */
  onlyTableId?: string;
  /** 当前工程的校验问题；只拦截方案范围内表/行里的错误。 */
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

const profileProblem = (error: ReleaseProfileError): ExportProblem => {
  if (error.code === 'PROFILE_TABLE_NOT_FOUND') {
    return {
      code: 'PROFILE_TABLE_NOT_FOUND',
      message: error.message,
      ...(error.tableId ? { tableId: error.tableId } : {}),
    };
  }
  if (error.code === 'PROFILE_ROW_NOT_FOUND') {
    return {
      code: 'PROFILE_ROW_NOT_FOUND',
      message: error.message,
      ...(error.tableId ? { tableId: error.tableId } : {}),
      ...(error.rowId ? { rowId: error.rowId } : {}),
    };
  }
  return { code: 'PROFILE_NOT_FOUND', message: error.message };
};

const rowsInScope = (
  table: ConfigTable,
  scope: ReleaseProfileScope,
): ConfigRow[] => {
  const rows = scope.rowsByTable.get(table.id);
  if (rows === undefined) return [];
  if (rows === 'all') return table.rows;
  return table.rows.filter((row) => rows.has(row._rowId));
};

/**
 * 计算一次导出/发布实际会写出的内容。
 *
 * 安全规则：
 * - 发布范围只来自 releaseProfiles；不接受旧的 table/row publish 标记；
 * - 方案引用了不存在的 tableId/_rowId 时直接报错，不静默跳过；
 * - config_ids.json 与表 JSON 使用同一批行，避免 ID 注册表泄漏方案外内容；
 * - 方案外的源/目标行引用时拒绝导出；
 * - 显式全量导出（includeUnpublished）仍绕过方案，但发布流程不允许调用；
 * - 写完前自检行数、字段名和 ID 集合。
 */
export function buildExportPlan(
  project: ProjectFile,
  options: BuildExportPlanOptions = {},
): ExportPlan {
  const includeUnpublished = options.includeUnpublished === true;
  const onlyTableId = options.onlyTableId;

  let profile: ReleaseProfile | undefined;
  let scope: ReleaseProfileScope | undefined;
  if (!includeUnpublished) {
    if (!project.releaseProfiles || project.releaseProfiles.profiles.length === 0) {
      fail({
        code: 'EXPORT_SCOPE_UNCONFIGURED',
        message:
          'This project has no release profiles. Open it in Configra to migrate its publish scope before exporting.',
      });
    }

    try {
      profile = findReleaseProfile(project, options.profileId);
      scope = releaseProfileScope(project, profile);
    } catch (error) {
      if (error instanceof ReleaseProfileError) fail(profileProblem(error));
      throw error;
    }
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
    (table) => includeUnpublished || scope?.tableIds.has(table.id) === true,
  );

  if (includedTables.length === 0 && candidateTables.length > 0) {
    if (onlyTableId) {
      const table = candidateTables[0];
      fail({
        code: 'TABLE_NOT_PUBLISHED',
        message: `Table "${table.name || table.id}" is not included in release profile "${profile?.name ?? ''}".`,
        tableId: table.id,
      });
    }

    fail({
      code: 'NO_PUBLISHED_TABLES',
      message: profile
        ? `Release profile "${profile.name}" does not include any tables.`
        : 'No tables are marked as publishable.',
    });
  }

  const selectedRowsByTable = new Map<string, ConfigRow[]>();
  for (const table of includedTables) {
    selectedRowsByTable.set(
      table.id,
      includeUnpublished || !scope ? table.rows : rowsInScope(table, scope),
    );
  }

  // 单表导出时，被引用的目标表不一定也在本次输出里；只要它在方案范围内，
  // 就按它的方案内行做引用一致性校验。
  const referenceTables = includeUnpublished
    ? project.tables
    : project.tables.filter((table) => scope?.tableIds.has(table.id) === true);
  const referenceRowsByTable = new Map<string, ConfigRow[]>();
  for (const table of referenceTables) {
    referenceRowsByTable.set(
      table.id,
      includeUnpublished || !scope ? table.rows : rowsInScope(table, scope),
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
          message: `Exported column ${table.name}.${column.name || column.id} references a table that is not part of the release scope.`,
          tableId: table.id,
          columnId: column.id,
        });
      }
      // 单表导出时目标表不必出现在输出文件里，但必须在方案范围内。
      if (!referenceRowsByTable.has(targetTable.id)) {
        throw new ExportScopeError({
          code: 'REF_NOT_PUBLISHED',
          message: `Exported column ${table.name}.${column.name || column.id} references table "${targetTable.name}", which is not in release profile "${profile?.name ?? ''}".`,
          tableId: table.id,
          columnId: column.id,
        });
      }

      const publishedTargetTable = targetTable;
      const publishedTargetColumn = targetColumn;
      if (publishedTargetColumn.export === false) {
        fail({
          code: 'REF_TARGET_NOT_EXPORTED',
          message: `Exported column ${table.name}.${column.name || column.id} references ${publishedTargetTable.name}.${publishedTargetColumn.name || publishedTargetColumn.id}, which is excluded from export.`,
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
            message: `Exported row ${table.name} references a value that is not in the exported ${publishedTargetTable.name} rows of release profile "${profile?.name ?? ''}".`,
            tableId: table.id,
            rowId: row._rowId,
            columnId: column.id,
          });
        }
        if ((targetCounts.get(key) ?? 0) > 1) {
          fail({
            code: 'REF_TARGET_DUPLICATE',
            message: `Exported ${publishedTargetTable.name}.${publishedTargetColumn.name || publishedTargetColumn.id} contains duplicate ref target values.`,
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
    ...(profile
      ? {
          profileId: profile.id,
          profileName: profile.name,
          profileMode: profile.mode,
        }
      : {}),
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
