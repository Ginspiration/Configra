import { createHash } from 'node:crypto';
import { translate } from '../i18n';
import {
  createDefaultRow,
  defaultValueForColumn,
  makeId,
  type RowIdFactory,
} from '../model/rowFactory';
import {
  COLUMN_TYPES,
  type ConfigColumn,
  type ConfigRow,
  type ConfigTable,
  type GraphPosition,
  type ProjectFile,
  type TableIdentity,
  type ValidationIssue,
} from '../model/types';
import { validateProject } from '../validation/validateProject';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type UpdateRowsOperation = {
  op: 'updateRows';
  tableId: string;
  rows: Array<{
    rowId: string;
    values: JsonObject;
  }>;
};

export type UpsertRowsOperation = {
  op: 'upsertRows';
  tableId: string;
  keyColumnId: string;
  rows: Array<{
    key: JsonValue;
    values: JsonObject;
  }>;
};

export type AddRowsOperation = {
  op: 'addRows';
  tableId: string;
  rows: Array<{
    values: JsonObject;
  }>;
};

export type DeleteRowsOperation = {
  op: 'deleteRows';
  tableId: string;
  rowIds: string[];
};

export type AddTableOperation = {
  op: 'addTable';
  tableId: string;
  name: string;
  remark: string;
  position?: GraphPosition;
  identity?: TableIdentity;
};

export type UpdateTableOperation = {
  op: 'updateTable';
  tableId: string;
  changes: {
    name?: string;
    remark?: string | null;
    position?: GraphPosition;
    identity?: TableIdentity | null;
  };
};

export type DeleteTableOperation = {
  op: 'deleteTable';
  tableId: string;
};

export type AddColumnOperation = {
  op: 'addColumn';
  tableId: string;
  column: ConfigColumn & { remark: string };
  index?: number;
};

export type UpdateColumnOperation = {
  op: 'updateColumn';
  tableId: string;
  columnId: string;
  changes: {
    name?: string;
    type?: ConfigColumn['type'];
    required?: boolean | null;
    primary?: boolean | null;
    autoIncrement?: boolean | null;
    export?: boolean | null;
    remark?: string | null;
    enumValues?: string[] | null;
    ref?: ConfigColumn['ref'] | null;
  };
};

export type MoveColumnOperation = {
  op: 'moveColumn';
  tableId: string;
  columnId: string;
  targetIndex: number;
};

export type DeleteColumnOperation = {
  op: 'deleteColumn';
  tableId: string;
  columnId: string;
};

export type DataPatchOperation =
  | AddTableOperation
  | UpdateTableOperation
  | DeleteTableOperation
  | AddColumnOperation
  | UpdateColumnOperation
  | MoveColumnOperation
  | DeleteColumnOperation
  | UpdateRowsOperation
  | UpsertRowsOperation
  | AddRowsOperation
  | DeleteRowsOperation;

export type DataPatch = {
  version: 1;
  baseHash: string;
  description?: string;
  operations: DataPatchOperation[];
};

export type PatchProblemKind =
  | 'invalid-patch'
  | 'target'
  | 'conflict'
  | 'validation'
  | 'hash';

export type PatchProblem = {
  kind: PatchProblemKind;
  message: string;
  path?: string;
};

export type PatchDiff =
  | {
      type: 'tableAdded';
      tableId: string;
      tableName: string;
      remark?: string;
      columnCount: number;
      rowCount: number;
    }
  | {
      type: 'tableDeleted';
      tableId: string;
      tableName: string;
      remark?: string;
      columnCount: number;
      rowCount: number;
    }
  | {
      type: 'tableUpdated';
      tableId: string;
      tableName: string;
      changes: Record<string, { before: unknown; after: unknown }>;
    }
  | {
      type: 'columnAdded';
      tableId: string;
      tableName: string;
      columnId: string;
      columnName: string;
      column: ConfigColumn;
      index: number;
      affectedRowCount: number;
    }
  | {
      type: 'columnDeleted';
      tableId: string;
      tableName: string;
      columnId: string;
      columnName: string;
      column: ConfigColumn;
      index: number;
      affectedRowCount: number;
    }
  | {
      type: 'columnUpdated';
      tableId: string;
      tableName: string;
      columnId: string;
      columnName: string;
      changes: Record<string, { before: unknown; after: unknown }>;
    }
  | {
      type: 'columnMoved';
      tableId: string;
      tableName: string;
      columnId: string;
      columnName: string;
      beforeIndex: number;
      afterIndex: number;
    }
  | {
      type: 'rowAdded';
      tableId: string;
      tableName: string;
      rowId: string;
      values: Record<string, unknown>;
    }
  | {
      type: 'rowDeleted';
      tableId: string;
      tableName: string;
      rowId: string;
      values: Record<string, unknown>;
    }
  | {
      type: 'cellUpdated';
      tableId: string;
      tableName: string;
      rowId: string;
      columnId: string;
      columnName: string;
      before: unknown;
      after: unknown;
    };

export type ValidationDelta = {
  before: {
    errorCount: number;
    warningCount: number;
    issues: ValidationIssue[];
  };
  after: {
    errorCount: number;
    warningCount: number;
    issues: ValidationIssue[];
  };
  newErrors: ValidationIssue[];
  resolvedErrors: ValidationIssue[];
  newWarnings: ValidationIssue[];
  resolvedWarnings: ValidationIssue[];
};

export type ApplyDataPatchOptions = {
  createRowId?: RowIdFactory;
};

export type ApplyDataPatchResult =
  | {
      ok: true;
      project: ProjectFile;
      diff: PatchDiff[];
    }
  | {
      ok: false;
      problem: PatchProblem;
    };

export type CheckDataPatchOptions = ApplyDataPatchOptions & {
  projectHash: string;
  validate?: (project: ProjectFile) => ValidationIssue[];
};

export type CheckDataPatchResult =
  | {
      ok: true;
      accepted: true;
      projectHash: string;
      patchBaseHash: string;
      confirmationHash: string;
      changed: boolean;
      project: ProjectFile;
      diff: PatchDiff[];
      validation: ValidationDelta;
    }
  | {
      ok: false;
      accepted: false;
      projectHash: string;
      patchBaseHash: string;
      confirmationHash?: string;
      changed: false;
      problem: PatchProblem;
      project?: ProjectFile;
      diff?: PatchDiff[];
      validation?: ValidationDelta;
    };

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const invalidPatch = (message: string, path?: string): PatchProblem => ({
  kind: 'invalid-patch',
  message,
  path,
});

const targetProblem = (message: string, path?: string): PatchProblem => ({
  kind: 'target',
  message,
  path,
});

const conflictProblem = (message: string, path?: string): PatchProblem => ({
  kind: 'conflict',
  message,
  path,
});

const unknownKeysProblem = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
) => {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  return unknownKey ? invalidPatch(`Unknown property "${unknownKey}".`, `${path}.${unknownKey}`) : undefined;
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null) return true;

  if (typeof value === 'string' || typeof value === 'boolean') return true;

  if (typeof value === 'number') return Number.isFinite(value);

  if (Array.isArray(value)) return value.every(isJsonValue);

  if (isRecord(value)) return Object.values(value).every(isJsonValue);

  return false;
};

const readString = (
  value: Record<string, unknown>,
  key: string,
  path: string,
): { ok: true; value: string } | { ok: false; problem: PatchProblem } => {
  const raw = value[key];
  if (typeof raw !== 'string' || !raw) {
    return { ok: false, problem: invalidPatch(`${key} must be a non-empty string.`, `${path}.${key}`) };
  }
  return { ok: true, value: raw };
};

const readRowsArray = (
  value: Record<string, unknown>,
  path: string,
): { ok: true; value: unknown[] } | { ok: false; problem: PatchProblem } => {
  if (!Array.isArray(value.rows)) {
    return { ok: false, problem: invalidPatch('rows must be an array.', `${path}.rows`) };
  }
  return { ok: true, value: value.rows };
};

const readValues = (
  value: Record<string, unknown>,
  path: string,
): { ok: true; value: JsonObject } | { ok: false; problem: PatchProblem } => {
  if (!isRecord(value.values)) {
    return { ok: false, problem: invalidPatch('values must be an object.', `${path}.values`) };
  }

  for (const [key, cellValue] of Object.entries(value.values)) {
    if (!isJsonValue(cellValue)) {
      return {
        ok: false,
        problem: invalidPatch(`values.${key} must be a JSON-compatible value.`, `${path}.values.${key}`),
      };
    }
  }

  return { ok: true, value: value.values as JsonObject };
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: PatchProblem };

const parsePosition = (raw: unknown, path: string): ParseResult<GraphPosition> => {
  if (!isRecord(raw)) {
    return { ok: false, problem: invalidPatch('position must be an object.', path) };
  }
  const unknownKeys = unknownKeysProblem(raw, ['x', 'y'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x)) {
    return { ok: false, problem: invalidPatch('x must be a finite number.', `${path}.x`) };
  }
  if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
    return { ok: false, problem: invalidPatch('y must be a finite number.', `${path}.y`) };
  }
  return { ok: true, value: { x: raw.x, y: raw.y } };
};

const parseIdentity = (raw: unknown, path: string): ParseResult<TableIdentity> => {
  if (!isRecord(raw)) {
    return { ok: false, problem: invalidPatch('identity must be an object.', path) };
  }
  const unknownKeys = unknownKeysProblem(raw, ['namespace', 'keyColumnId', 'valueColumnId'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  for (const key of ['namespace', 'keyColumnId', 'valueColumnId'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      return { ok: false, problem: invalidPatch(`${key} must be a string.`, `${path}.${key}`) };
    }
  }

  return {
    ok: true,
    value: {
      ...(raw.namespace !== undefined ? { namespace: raw.namespace as string } : {}),
      ...(raw.keyColumnId !== undefined ? { keyColumnId: raw.keyColumnId as string } : {}),
      ...(raw.valueColumnId !== undefined ? { valueColumnId: raw.valueColumnId as string } : {}),
    },
  };
};

const parseRef = (raw: unknown, path: string): ParseResult<NonNullable<ConfigColumn['ref']>> => {
  if (!isRecord(raw)) return { ok: false, problem: invalidPatch('ref must be an object.', path) };
  const unknownKeys = unknownKeysProblem(raw, ['tableId', 'columnId'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  const columnId = readString(raw, 'columnId', path);
  if (!columnId.ok) return columnId;
  return { ok: true, value: { tableId: tableId.value, columnId: columnId.value } };
};

const parseColumn = (
  raw: unknown,
  path: string,
  requireRemark: boolean,
): ParseResult<ConfigColumn> => {
  if (!isRecord(raw)) return { ok: false, problem: invalidPatch('column must be an object.', path) };
  const unknownKeys = unknownKeysProblem(
    raw,
    ['id', 'name', 'type', 'required', 'primary', 'autoIncrement', 'export', 'remark', 'enumValues', 'ref'],
    path,
  );
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  const id = readString(raw, 'id', path);
  if (!id.ok) return id;
  const name = readString(raw, 'name', path);
  if (!name.ok) return name;
  if (typeof raw.type !== 'string' || !(COLUMN_TYPES as readonly string[]).includes(raw.type)) {
    return { ok: false, problem: invalidPatch('type must be a supported column type.', `${path}.type`) };
  }
  if (raw.remark !== undefined && typeof raw.remark !== 'string') {
    return { ok: false, problem: invalidPatch('remark must be a string.', `${path}.remark`) };
  }
  if (requireRemark && (typeof raw.remark !== 'string' || !raw.remark.trim())) {
    return {
      ok: false,
      problem: invalidPatch('A newly added column requires a non-empty remark.', `${path}.remark`),
    };
  }
  for (const key of ['required', 'primary', 'autoIncrement', 'export'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') {
      return { ok: false, problem: invalidPatch(`${key} must be a boolean.`, `${path}.${key}`) };
    }
  }
  if (
    raw.enumValues !== undefined &&
    (!Array.isArray(raw.enumValues) || raw.enumValues.some((value) => typeof value !== 'string'))
  ) {
    return { ok: false, problem: invalidPatch('enumValues must be an array of strings.', `${path}.enumValues`) };
  }
  let ref: ConfigColumn['ref'];
  if (raw.ref !== undefined) {
    const parsedRef = parseRef(raw.ref, `${path}.ref`);
    if (!parsedRef.ok) return parsedRef;
    ref = parsedRef.value;
  }

  return {
    ok: true,
    value: {
      id: id.value,
      name: name.value,
      type: raw.type as ConfigColumn['type'],
      ...(raw.required !== undefined ? { required: raw.required as boolean } : {}),
      ...(raw.primary !== undefined ? { primary: raw.primary as boolean } : {}),
      ...(raw.autoIncrement !== undefined ? { autoIncrement: raw.autoIncrement as boolean } : {}),
      ...(raw.export !== undefined ? { export: raw.export as boolean } : {}),
      ...(raw.remark !== undefined ? { remark: raw.remark as string } : {}),
      ...(raw.enumValues !== undefined ? { enumValues: raw.enumValues as string[] } : {}),
      ...(ref !== undefined ? { ref } : {}),
    },
  };
};

const parseAddTableOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<AddTableOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'name', 'remark', 'position', 'identity'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  const name = readString(raw, 'name', path);
  if (!name.ok) return name;
  if (typeof raw.remark !== 'string' || !raw.remark.trim()) {
    return {
      ok: false,
      problem: invalidPatch('A newly added table requires a non-empty remark.', `${path}.remark`),
    };
  }

  let position: GraphPosition | undefined;
  if (raw.position !== undefined) {
    const parsedPosition = parsePosition(raw.position, `${path}.position`);
    if (!parsedPosition.ok) return parsedPosition;
    position = parsedPosition.value;
  }
  let identity: TableIdentity | undefined;
  if (raw.identity !== undefined) {
    const parsedIdentity = parseIdentity(raw.identity, `${path}.identity`);
    if (!parsedIdentity.ok) return parsedIdentity;
    identity = parsedIdentity.value;
  }

  return {
    ok: true,
    value: {
      op: 'addTable',
      tableId: tableId.value,
      name: name.value,
      remark: raw.remark,
      ...(position ? { position } : {}),
      ...(identity ? { identity } : {}),
    },
  };
};

const parseUpdateTableOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<UpdateTableOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'changes'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  if (!isRecord(raw.changes)) {
    return { ok: false, problem: invalidPatch('changes must be an object.', `${path}.changes`) };
  }
  const changePath = `${path}.changes`;
  const changeUnknownKeys = unknownKeysProblem(raw.changes, ['name', 'remark', 'position', 'identity'], changePath);
  if (changeUnknownKeys) return { ok: false, problem: changeUnknownKeys };
  const changes: UpdateTableOperation['changes'] = {};
  if (raw.changes.name !== undefined) {
    if (typeof raw.changes.name !== 'string') {
      return { ok: false, problem: invalidPatch('name must be a string.', `${changePath}.name`) };
    }
    changes.name = raw.changes.name;
  }
  if (raw.changes.remark !== undefined) {
    if (raw.changes.remark !== null && typeof raw.changes.remark !== 'string') {
      return { ok: false, problem: invalidPatch('remark must be a string or null.', `${changePath}.remark`) };
    }
    changes.remark = raw.changes.remark as string | null;
  }
  if (raw.changes.position !== undefined) {
    const parsedPosition = parsePosition(raw.changes.position, `${changePath}.position`);
    if (!parsedPosition.ok) return parsedPosition;
    changes.position = parsedPosition.value;
  }
  if (raw.changes.identity !== undefined) {
    if (raw.changes.identity === null) {
      changes.identity = null;
    } else {
      const parsedIdentity = parseIdentity(raw.changes.identity, `${changePath}.identity`);
      if (!parsedIdentity.ok) return parsedIdentity;
      changes.identity = parsedIdentity.value;
    }
  }
  return { ok: true, value: { op: 'updateTable', tableId: tableId.value, changes } };
};

const parseDeleteTableOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<DeleteTableOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  return { ok: true, value: { op: 'deleteTable', tableId: tableId.value } };
};

const parseAddColumnOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<AddColumnOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'column', 'index'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  const column = parseColumn(raw.column, `${path}.column`, true);
  if (!column.ok) return column;
  if (raw.index !== undefined && (!Number.isInteger(raw.index) || (raw.index as number) < 0)) {
    return { ok: false, problem: invalidPatch('index must be a non-negative integer.', `${path}.index`) };
  }
  return {
    ok: true,
    value: {
      op: 'addColumn',
      tableId: tableId.value,
      column: column.value as AddColumnOperation['column'],
      ...(raw.index !== undefined ? { index: raw.index as number } : {}),
    },
  };
};

const parseUpdateColumnOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<UpdateColumnOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'columnId', 'changes'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  const columnId = readString(raw, 'columnId', path);
  if (!columnId.ok) return columnId;
  if (!isRecord(raw.changes)) {
    return { ok: false, problem: invalidPatch('changes must be an object.', `${path}.changes`) };
  }
  const changesPath = `${path}.changes`;
  const allowed = ['name', 'type', 'required', 'primary', 'autoIncrement', 'export', 'remark', 'enumValues', 'ref'];
  const changeUnknownKeys = unknownKeysProblem(raw.changes, allowed, changesPath);
  if (changeUnknownKeys) return { ok: false, problem: changeUnknownKeys };
  const changes: UpdateColumnOperation['changes'] = {};

  if (raw.changes.name !== undefined) {
    if (typeof raw.changes.name !== 'string') {
      return { ok: false, problem: invalidPatch('name must be a string.', `${changesPath}.name`) };
    }
    changes.name = raw.changes.name;
  }
  if (raw.changes.type !== undefined) {
    if (typeof raw.changes.type !== 'string' || !(COLUMN_TYPES as readonly string[]).includes(raw.changes.type)) {
      return { ok: false, problem: invalidPatch('type must be a supported column type.', `${changesPath}.type`) };
    }
    changes.type = raw.changes.type as ConfigColumn['type'];
  }
  for (const key of ['required', 'primary', 'autoIncrement', 'export'] as const) {
    const value = raw.changes[key];
    if (value !== undefined) {
      if (value !== null && typeof value !== 'boolean') {
        return { ok: false, problem: invalidPatch(`${key} must be a boolean or null.`, `${changesPath}.${key}`) };
      }
      changes[key] = value as boolean | null;
    }
  }
  if (raw.changes.remark !== undefined) {
    if (raw.changes.remark !== null && typeof raw.changes.remark !== 'string') {
      return { ok: false, problem: invalidPatch('remark must be a string or null.', `${changesPath}.remark`) };
    }
    changes.remark = raw.changes.remark as string | null;
  }
  if (raw.changes.enumValues !== undefined) {
    if (
      raw.changes.enumValues !== null &&
      (!Array.isArray(raw.changes.enumValues) || raw.changes.enumValues.some((value) => typeof value !== 'string'))
    ) {
      return { ok: false, problem: invalidPatch('enumValues must be an array of strings or null.', `${changesPath}.enumValues`) };
    }
    changes.enumValues = raw.changes.enumValues as string[] | null;
  }
  if (raw.changes.ref !== undefined) {
    if (raw.changes.ref === null) {
      changes.ref = null;
    } else {
      const parsedRef = parseRef(raw.changes.ref, `${changesPath}.ref`);
      if (!parsedRef.ok) return parsedRef;
      changes.ref = parsedRef.value;
    }
  }
  return {
    ok: true,
    value: { op: 'updateColumn', tableId: tableId.value, columnId: columnId.value, changes },
  };
};

const parseMoveColumnOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<MoveColumnOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'columnId', 'targetIndex'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  const columnId = readString(raw, 'columnId', path);
  if (!columnId.ok) return columnId;
  if (!Number.isInteger(raw.targetIndex) || (raw.targetIndex as number) < 0) {
    return { ok: false, problem: invalidPatch('targetIndex must be a non-negative integer.', `${path}.targetIndex`) };
  }
  return {
    ok: true,
    value: { op: 'moveColumn', tableId: tableId.value, columnId: columnId.value, targetIndex: raw.targetIndex as number },
  };
};

const parseDeleteColumnOperation = (
  raw: Record<string, unknown>,
  path: string,
): ParseResult<DeleteColumnOperation> => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'columnId'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };
  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;
  const columnId = readString(raw, 'columnId', path);
  if (!columnId.ok) return columnId;
  return { ok: true, value: { op: 'deleteColumn', tableId: tableId.value, columnId: columnId.value } };
};

const parseUpdateRowsOperation = (
  raw: Record<string, unknown>,
  path: string,
): { ok: true; value: UpdateRowsOperation } | { ok: false; problem: PatchProblem } => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'rows'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;

  const rows = readRowsArray(raw, path);
  if (!rows.ok) return rows;

  const parsedRows: UpdateRowsOperation['rows'] = [];
  for (const [index, row] of rows.value.entries()) {
    const rowPath = `${path}.rows[${index}]`;
    if (!isRecord(row)) return { ok: false, problem: invalidPatch('row must be an object.', rowPath) };

    const rowUnknownKeys = unknownKeysProblem(row, ['rowId', 'values'], rowPath);
    if (rowUnknownKeys) return { ok: false, problem: rowUnknownKeys };

    const rowId = readString(row, 'rowId', rowPath);
    if (!rowId.ok) return rowId;

    const values = readValues(row, rowPath);
    if (!values.ok) return values;

    parsedRows.push({ rowId: rowId.value, values: values.value });
  }

  return { ok: true, value: { op: 'updateRows', tableId: tableId.value, rows: parsedRows } };
};

const parseUpsertRowsOperation = (
  raw: Record<string, unknown>,
  path: string,
): { ok: true; value: UpsertRowsOperation } | { ok: false; problem: PatchProblem } => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'keyColumnId', 'rows'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;

  const keyColumnId = readString(raw, 'keyColumnId', path);
  if (!keyColumnId.ok) return keyColumnId;

  const rows = readRowsArray(raw, path);
  if (!rows.ok) return rows;

  const parsedRows: UpsertRowsOperation['rows'] = [];
  for (const [index, row] of rows.value.entries()) {
    const rowPath = `${path}.rows[${index}]`;
    if (!isRecord(row)) return { ok: false, problem: invalidPatch('row must be an object.', rowPath) };

    const rowUnknownKeys = unknownKeysProblem(row, ['key', 'values'], rowPath);
    if (rowUnknownKeys) return { ok: false, problem: rowUnknownKeys };

    if (!hasOwn(row, 'key') || !isJsonValue(row.key)) {
      return { ok: false, problem: invalidPatch('key must be a JSON-compatible value.', `${rowPath}.key`) };
    }

    const values = readValues(row, rowPath);
    if (!values.ok) return values;

    parsedRows.push({ key: row.key, values: values.value });
  }

  return {
    ok: true,
    value: { op: 'upsertRows', tableId: tableId.value, keyColumnId: keyColumnId.value, rows: parsedRows },
  };
};

const parseAddRowsOperation = (
  raw: Record<string, unknown>,
  path: string,
): { ok: true; value: AddRowsOperation } | { ok: false; problem: PatchProblem } => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'rows'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;

  const rows = readRowsArray(raw, path);
  if (!rows.ok) return rows;

  const parsedRows: AddRowsOperation['rows'] = [];
  for (const [index, row] of rows.value.entries()) {
    const rowPath = `${path}.rows[${index}]`;
    if (!isRecord(row)) return { ok: false, problem: invalidPatch('row must be an object.', rowPath) };

    const rowUnknownKeys = unknownKeysProblem(row, ['values'], rowPath);
    if (rowUnknownKeys) return { ok: false, problem: rowUnknownKeys };

    const values = readValues(row, rowPath);
    if (!values.ok) return values;

    parsedRows.push({ values: values.value });
  }

  return { ok: true, value: { op: 'addRows', tableId: tableId.value, rows: parsedRows } };
};

const parseDeleteRowsOperation = (
  raw: Record<string, unknown>,
  path: string,
): { ok: true; value: DeleteRowsOperation } | { ok: false; problem: PatchProblem } => {
  const unknownKeys = unknownKeysProblem(raw, ['op', 'tableId', 'rowIds'], path);
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  const tableId = readString(raw, 'tableId', path);
  if (!tableId.ok) return tableId;

  if (!Array.isArray(raw.rowIds) || raw.rowIds.some((rowId) => typeof rowId !== 'string' || !rowId)) {
    return { ok: false, problem: invalidPatch('rowIds must be an array of non-empty strings.', `${path}.rowIds`) };
  }

  return { ok: true, value: { op: 'deleteRows', tableId: tableId.value, rowIds: raw.rowIds } };
};

const parseOperation = (
  raw: unknown,
  path: string,
): { ok: true; value: DataPatchOperation } | { ok: false; problem: PatchProblem } => {
  if (!isRecord(raw)) return { ok: false, problem: invalidPatch('operation must be an object.', path) };

  if (typeof raw.op !== 'string') {
    return { ok: false, problem: invalidPatch('op must be a string.', `${path}.op`) };
  }

  if (raw.op === 'addTable') return parseAddTableOperation(raw, path);
  if (raw.op === 'updateTable') return parseUpdateTableOperation(raw, path);
  if (raw.op === 'deleteTable') return parseDeleteTableOperation(raw, path);
  if (raw.op === 'addColumn') return parseAddColumnOperation(raw, path);
  if (raw.op === 'updateColumn') return parseUpdateColumnOperation(raw, path);
  if (raw.op === 'moveColumn') return parseMoveColumnOperation(raw, path);
  if (raw.op === 'deleteColumn') return parseDeleteColumnOperation(raw, path);
  if (raw.op === 'updateRows') return parseUpdateRowsOperation(raw, path);
  if (raw.op === 'upsertRows') return parseUpsertRowsOperation(raw, path);
  if (raw.op === 'addRows') return parseAddRowsOperation(raw, path);
  if (raw.op === 'deleteRows') return parseDeleteRowsOperation(raw, path);

  return { ok: false, problem: invalidPatch(`Unsupported operation "${raw.op}".`, `${path}.op`) };
};

export function parseDataPatch(raw: unknown):
  | { ok: true; patch: DataPatch }
  | { ok: false; problem: PatchProblem } {
  if (!isRecord(raw)) return { ok: false, problem: invalidPatch('Patch root must be an object.', '$') };

  const unknownKeys = unknownKeysProblem(raw, ['version', 'baseHash', 'description', 'operations'], '$');
  if (unknownKeys) return { ok: false, problem: unknownKeys };

  if (raw.version !== 1) {
    return { ok: false, problem: invalidPatch('version must be 1.', '$.version') };
  }

  if (typeof raw.baseHash !== 'string' || !HASH_PATTERN.test(raw.baseHash)) {
    return {
      ok: false,
      problem: invalidPatch('baseHash must be sha256:<64 lowercase hex chars>.', '$.baseHash'),
    };
  }

  if (raw.description !== undefined && typeof raw.description !== 'string') {
    return { ok: false, problem: invalidPatch('description must be a string.', '$.description') };
  }

  if (!Array.isArray(raw.operations)) {
    return { ok: false, problem: invalidPatch('operations must be an array.', '$.operations') };
  }

  const operations: DataPatchOperation[] = [];
  for (const [index, operation] of raw.operations.entries()) {
    const parsed = parseOperation(operation, `$.operations[${index}]`);
    if (!parsed.ok) return parsed;
    operations.push(parsed.value);
  }

  return {
    ok: true,
    patch: {
      version: 1,
      baseHash: raw.baseHash,
      description: raw.description,
      operations,
    },
  };
}

const cloneProject = (project: ProjectFile): ProjectFile => JSON.parse(JSON.stringify(project));

const sortForCanonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForCanonicalJson(value[key])]),
    );
  }

  return value;
};

export const canonicalJson = (value: unknown) => JSON.stringify(sortForCanonicalJson(value));

export const sha256Text = (text: string) =>
  `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

export const confirmationHashForPatch = (projectHash: string, patch: DataPatch) =>
  sha256Text(`${projectHash}\n${canonicalJson(patch)}`);

export const createDeterministicRowIdFactory = (confirmationHash: string): RowIdFactory => {
  let index = 0;
  const seed = confirmationHash.replace(/^sha256:/, '').slice(0, 12) || 'patch';

  return () => {
    index += 1;
    return `row_${seed}_${index.toString(36)}`;
  };
};

const valueFingerprint = (value: unknown) => {
  if (value === undefined) return 'undefined';
  return `${typeof value}:${canonicalJson(value)}`;
};

const sameValue = (left: unknown, right: unknown) => valueFingerprint(left) === valueFingerprint(right);

const findTable = (
  project: ProjectFile,
  tableId: string,
  path: string,
): { ok: true; table: ConfigTable } | { ok: false; problem: PatchProblem } => {
  const matches = project.tables.filter((table) => table.id === tableId);
  if (matches.length === 0) {
    return { ok: false, problem: targetProblem(`Unknown tableId "${tableId}".`, path) };
  }
  if (matches.length > 1) {
    return { ok: false, problem: conflictProblem(`tableId "${tableId}" matches multiple tables.`, path) };
  }
  return { ok: true, table: matches[0] };
};

const findColumn = (
  table: ConfigTable,
  columnId: string,
  path: string,
): { ok: true; column: ConfigColumn } | { ok: false; problem: PatchProblem } => {
  const matches = table.columns.filter((column) => column.id === columnId);
  if (matches.length === 0) {
    return {
      ok: false,
      problem: targetProblem(`Unknown columnId "${columnId}" in table "${table.id}".`, path),
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      problem: conflictProblem(`columnId "${columnId}" matches multiple columns in table "${table.id}".`, path),
    };
  }
  return { ok: true, column: matches[0] };
};

const findRowIndex = (
  table: ConfigTable,
  rowId: string,
  path: string,
): { ok: true; index: number; row: ConfigRow } | { ok: false; problem: PatchProblem } => {
  const matches = table.rows
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row._rowId === rowId);

  if (matches.length === 0) {
    return { ok: false, problem: targetProblem(`Unknown rowId "${rowId}" in table "${table.id}".`, path) };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      problem: conflictProblem(`rowId "${rowId}" matches multiple rows in table "${table.id}".`, path),
    };
  }
  return { ok: true, index: matches[0].index, row: matches[0].row };
};

const validateValueTargets = (
  table: ConfigTable,
  values: Record<string, unknown>,
  path: string,
): PatchProblem | undefined => {
  for (const columnId of Object.keys(values)) {
    const column = findColumn(table, columnId, `${path}.${columnId}`);
    if (!column.ok) return column.problem;
  }
  return undefined;
};

const duplicateText = (values: string[]) => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
};

const createUniqueRowId = (
  usedRowIds: Set<string>,
  createRowId: RowIdFactory,
): string | undefined => {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = createRowId('row');
    if (candidate && !usedRowIds.has(candidate)) {
      usedRowIds.add(candidate);
      return candidate;
    }
  }

  return undefined;
};

const applyAddTable = (
  project: ProjectFile,
  operation: AddTableOperation,
  operationPath: string,
): PatchProblem | undefined => {
  if (project.tables.some((table) => table.id === operation.tableId)) {
    return conflictProblem(`tableId "${operation.tableId}" already exists.`, `${operationPath}.tableId`);
  }
  if (!operation.remark.trim()) {
    return invalidPatch('A newly added table requires a non-empty remark.', `${operationPath}.remark`);
  }

  project.tables.push({
    id: operation.tableId,
    name: operation.name,
    remark: operation.remark,
    position: operation.position ?? {
      x: 160 + project.tables.length * 48,
      y: 140 + project.tables.length * 34,
    },
    columns: [],
    rows: [],
    ...(operation.identity ? { identity: operation.identity } : {}),
  });
  return undefined;
};

const applyUpdateTable = (
  project: ProjectFile,
  operation: UpdateTableOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;
  const changes = operation.changes;
  if (changes.name !== undefined) target.table.name = changes.name;
  if (changes.position !== undefined) target.table.position = changes.position;
  if (changes.remark !== undefined) {
    if (changes.remark === null) delete target.table.remark;
    else target.table.remark = changes.remark;
  }
  if (changes.identity !== undefined) {
    if (changes.identity === null) delete target.table.identity;
    else target.table.identity = changes.identity;
  }
  return undefined;
};

const applyDeleteTable = (
  project: ProjectFile,
  operation: DeleteTableOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;
  project.tables = project.tables.filter((table) => table.id !== operation.tableId);
  return undefined;
};

const normalizePrimaryAndAutoIncrement = (table: ConfigTable, column: ConfigColumn) => {
  if (column.primary) {
    column.required = true;
    for (const candidate of table.columns) {
      if (candidate.id !== column.id) {
        candidate.primary = false;
        candidate.autoIncrement = false;
      }
    }
  }
  if (column.autoIncrement && (column.type !== 'int' || !column.primary)) {
    column.autoIncrement = false;
  }
};

const applyAddColumn = (
  project: ProjectFile,
  operation: AddColumnOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;
  if (target.table.columns.some((column) => column.id === operation.column.id)) {
    return conflictProblem(
      `columnId "${operation.column.id}" already exists in table "${target.table.id}".`,
      `${operationPath}.column.id`,
    );
  }
  if (!operation.column.remark.trim()) {
    return invalidPatch('A newly added column requires a non-empty remark.', `${operationPath}.column.remark`);
  }
  const index = operation.index ?? target.table.columns.length;
  if (index > target.table.columns.length) {
    return conflictProblem(`index ${index} is outside the column list.`, `${operationPath}.index`);
  }

  const column: ConfigColumn = JSON.parse(JSON.stringify(operation.column)) as ConfigColumn;
  normalizePrimaryAndAutoIncrement(target.table, column);
  target.table.columns.splice(index, 0, column);
  target.table.rows = target.table.rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      [column.id]: defaultValueForColumn(column),
    },
  }));
  return undefined;
};

const setOptionalColumnValue = <K extends keyof ConfigColumn>(
  column: ConfigColumn,
  key: K,
  value: ConfigColumn[K] | null | undefined,
) => {
  if (value === undefined) return;
  if (value === null) delete column[key];
  else column[key] = value;
};

const applyUpdateColumn = (
  project: ProjectFile,
  operation: UpdateColumnOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;
  const found = findColumn(target.table, operation.columnId, `${operationPath}.columnId`);
  if (!found.ok) return found.problem;
  const column = found.column;
  const changes = operation.changes;

  if (changes.name !== undefined) column.name = changes.name;
  if (changes.type !== undefined) {
    column.type = changes.type;
    if (changes.type !== 'enum' && changes.enumValues === undefined) delete column.enumValues;
    if (changes.type !== 'ref' && changes.ref === undefined) delete column.ref;
  }
  setOptionalColumnValue(column, 'required', changes.required);
  setOptionalColumnValue(column, 'primary', changes.primary);
  setOptionalColumnValue(column, 'autoIncrement', changes.autoIncrement);
  setOptionalColumnValue(column, 'export', changes.export);
  setOptionalColumnValue(column, 'remark', changes.remark);
  setOptionalColumnValue(column, 'enumValues', changes.enumValues);
  setOptionalColumnValue(column, 'ref', changes.ref);
  normalizePrimaryAndAutoIncrement(target.table, column);
  return undefined;
};

const applyMoveColumn = (
  project: ProjectFile,
  operation: MoveColumnOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;
  const found = findColumn(target.table, operation.columnId, `${operationPath}.columnId`);
  if (!found.ok) return found.problem;
  if (operation.targetIndex >= target.table.columns.length) {
    return conflictProblem(
      `targetIndex ${operation.targetIndex} is outside the column list.`,
      `${operationPath}.targetIndex`,
    );
  }
  const sourceIndex = target.table.columns.findIndex((column) => column.id === operation.columnId);
  if (sourceIndex === operation.targetIndex) return undefined;
  const [column] = target.table.columns.splice(sourceIndex, 1);
  target.table.columns.splice(operation.targetIndex, 0, column);
  return undefined;
};

const applyDeleteColumn = (
  project: ProjectFile,
  operation: DeleteColumnOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;
  const found = findColumn(target.table, operation.columnId, `${operationPath}.columnId`);
  if (!found.ok) return found.problem;
  target.table.columns = target.table.columns.filter((column) => column.id !== operation.columnId);
  target.table.rows = target.table.rows.map((row) => {
    const values = { ...row.values };
    delete values[operation.columnId];
    return { ...row, values };
  });
  return undefined;
};

const applyUpdateRows = (
  project: ProjectFile,
  operation: UpdateRowsOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;

  const duplicateRowId = duplicateText(operation.rows.map((row) => row.rowId));
  if (duplicateRowId) {
    return conflictProblem(`rowId "${duplicateRowId}" appears more than once in one updateRows operation.`, `${operationPath}.rows`);
  }

  for (const [index, rowPatch] of operation.rows.entries()) {
    const rowPath = `${operationPath}.rows[${index}]`;
    const row = findRowIndex(target.table, rowPatch.rowId, `${rowPath}.rowId`);
    if (!row.ok) return row.problem;

    const valueProblem = validateValueTargets(target.table, rowPatch.values, `${rowPath}.values`);
    if (valueProblem) return valueProblem;

    target.table.rows[row.index] = {
      ...row.row,
      values: {
        ...row.row.values,
        ...rowPatch.values,
      },
    };
  }

  return undefined;
};

const applyAddRows = (
  project: ProjectFile,
  operation: AddRowsOperation,
  operationPath: string,
  usedRowIds: Set<string>,
  createRowId: RowIdFactory,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;

  for (const [index, rowPatch] of operation.rows.entries()) {
    const rowPath = `${operationPath}.rows[${index}]`;
    const valueProblem = validateValueTargets(target.table, rowPatch.values, `${rowPath}.values`);
    if (valueProblem) return valueProblem;

    const rowId = createUniqueRowId(usedRowIds, createRowId);
    if (!rowId) return conflictProblem('Could not generate a unique rowId.', rowPath);

    target.table.rows.push(createDefaultRow(target.table, rowId, rowPatch.values));
  }

  return undefined;
};

const applyUpsertRows = (
  project: ProjectFile,
  operation: UpsertRowsOperation,
  operationPath: string,
  usedRowIds: Set<string>,
  createRowId: RowIdFactory,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;

  const keyColumn = findColumn(target.table, operation.keyColumnId, `${operationPath}.keyColumnId`);
  if (!keyColumn.ok) return keyColumn.problem;

  const seenKeys = new Set<string>();
  for (const [index, rowPatch] of operation.rows.entries()) {
    const rowPath = `${operationPath}.rows[${index}]`;
    const keyFingerprint = valueFingerprint(rowPatch.key);

    if (seenKeys.has(keyFingerprint)) {
      return conflictProblem(`key ${canonicalJson(rowPatch.key)} appears more than once in one upsertRows operation.`, `${rowPath}.key`);
    }
    seenKeys.add(keyFingerprint);

    const valueProblem = validateValueTargets(target.table, rowPatch.values, `${rowPath}.values`);
    if (valueProblem) return valueProblem;

    if (
      hasOwn(rowPatch.values, operation.keyColumnId) &&
      !sameValue(rowPatch.values[operation.keyColumnId], rowPatch.key)
    ) {
      return conflictProblem(
        `values.${operation.keyColumnId} conflicts with upsert key.`,
        `${rowPath}.values.${operation.keyColumnId}`,
      );
    }

    const matches = target.table.rows
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter((entry) => sameValue(entry.row.values[keyColumn.column.id], rowPatch.key));

    if (matches.length > 1) {
      return conflictProblem(
        `key ${canonicalJson(rowPatch.key)} matches multiple rows in table "${target.table.id}".`,
        `${rowPath}.key`,
      );
    }

    if (matches.length === 1) {
      const match = matches[0];
      target.table.rows[match.rowIndex] = {
        ...match.row,
        values: {
          ...match.row.values,
          ...rowPatch.values,
        },
      };
      continue;
    }

    const rowId = createUniqueRowId(usedRowIds, createRowId);
    if (!rowId) return conflictProblem('Could not generate a unique rowId.', rowPath);

    target.table.rows.push(
      createDefaultRow(target.table, rowId, {
        ...rowPatch.values,
        [operation.keyColumnId]: rowPatch.key,
      }),
    );
  }

  return undefined;
};

const applyDeleteRows = (
  project: ProjectFile,
  operation: DeleteRowsOperation,
  operationPath: string,
): PatchProblem | undefined => {
  const target = findTable(project, operation.tableId, `${operationPath}.tableId`);
  if (!target.ok) return target.problem;

  const duplicateRowId = duplicateText(operation.rowIds);
  if (duplicateRowId) {
    return conflictProblem(`rowId "${duplicateRowId}" appears more than once in one deleteRows operation.`, `${operationPath}.rowIds`);
  }

  const rowIdSet = new Set(operation.rowIds);
  for (const [index, rowId] of operation.rowIds.entries()) {
    const row = findRowIndex(target.table, rowId, `${operationPath}.rowIds[${index}]`);
    if (!row.ok) return row.problem;
  }

  target.table.rows = target.table.rows.filter((row) => !rowIdSet.has(row._rowId));
  return undefined;
};

const propertyChanges = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
) => {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of keys) {
    if (!sameValue(before[key], after[key])) {
      changes[key] = { before: before[key], after: after[key] };
    }
  }
  return changes;
};

const makeDiff = (before: ProjectFile, after: ProjectFile): PatchDiff[] => {
  const diff: PatchDiff[] = [];
  const beforeTables = new Map(before.tables.map((table) => [table.id, table]));
  const afterTables = new Map(after.tables.map((table) => [table.id, table]));

  for (const beforeTable of before.tables) {
    if (!afterTables.has(beforeTable.id)) {
      diff.push({
        type: 'tableDeleted',
        tableId: beforeTable.id,
        tableName: beforeTable.name,
        remark: beforeTable.remark,
        columnCount: beforeTable.columns.length,
        rowCount: beforeTable.rows.length,
      });
    }
  }

  for (const afterTable of after.tables) {
    const beforeTable = beforeTables.get(afterTable.id);
    if (!beforeTable) {
      diff.push({
        type: 'tableAdded',
        tableId: afterTable.id,
        tableName: afterTable.name,
        remark: afterTable.remark,
        columnCount: afterTable.columns.length,
        rowCount: afterTable.rows.length,
      });
      for (const [index, column] of afterTable.columns.entries()) {
        diff.push({
          type: 'columnAdded',
          tableId: afterTable.id,
          tableName: afterTable.name,
          columnId: column.id,
          columnName: column.name || column.id,
          column,
          index,
          affectedRowCount: afterTable.rows.length,
        });
      }
      continue;
    }

    const tableChanges = propertyChanges(
      beforeTable as unknown as Record<string, unknown>,
      afterTable as unknown as Record<string, unknown>,
      ['name', 'remark', 'position', 'identity'],
    );
    if (Object.keys(tableChanges).length > 0) {
      diff.push({
        type: 'tableUpdated',
        tableId: afterTable.id,
        tableName: afterTable.name,
        changes: tableChanges,
      });
    }

    const beforeColumns = new Map(beforeTable.columns.map((column, index) => [column.id, { column, index }]));
    const afterColumns = new Map(afterTable.columns.map((column, index) => [column.id, { column, index }]));

    for (const [columnId, entry] of beforeColumns) {
      if (!afterColumns.has(columnId)) {
        diff.push({
          type: 'columnDeleted',
          tableId: afterTable.id,
          tableName: afterTable.name,
          columnId,
          columnName: entry.column.name || columnId,
          column: entry.column,
          index: entry.index,
          affectedRowCount: beforeTable.rows.filter((row) => hasOwn(row.values, columnId)).length,
        });
      }
    }

    for (const [columnId, entry] of afterColumns) {
      const beforeEntry = beforeColumns.get(columnId);
      if (!beforeEntry) {
        diff.push({
          type: 'columnAdded',
          tableId: afterTable.id,
          tableName: afterTable.name,
          columnId,
          columnName: entry.column.name || columnId,
          column: entry.column,
          index: entry.index,
          affectedRowCount: afterTable.rows.length,
        });
        continue;
      }

      const columnChanges = propertyChanges(
        beforeEntry.column as unknown as Record<string, unknown>,
        entry.column as unknown as Record<string, unknown>,
        ['name', 'type', 'required', 'primary', 'autoIncrement', 'export', 'remark', 'enumValues', 'ref'],
      );
      if (Object.keys(columnChanges).length > 0) {
        diff.push({
          type: 'columnUpdated',
          tableId: afterTable.id,
          tableName: afterTable.name,
          columnId,
          columnName: entry.column.name || columnId,
          changes: columnChanges,
        });
      }
      if (beforeEntry.index !== entry.index) {
        diff.push({
          type: 'columnMoved',
          tableId: afterTable.id,
          tableName: afterTable.name,
          columnId,
          columnName: entry.column.name || columnId,
          beforeIndex: beforeEntry.index,
          afterIndex: entry.index,
        });
      }
    }

    const afterRows = new Map(afterTable.rows.map((row) => [row._rowId, row]));
    for (const beforeRow of beforeTable.rows) {
      if (!afterRows.has(beforeRow._rowId)) {
        diff.push({
          type: 'rowDeleted',
          tableId: beforeTable.id,
          tableName: beforeTable.name,
          rowId: beforeRow._rowId,
          values: beforeRow.values,
        });
      }
    }

    const beforeRows = new Map(beforeTable.rows.map((row) => [row._rowId, row]));
    for (const afterRow of afterTable.rows) {
      const beforeRow = beforeRows.get(afterRow._rowId);
      if (!beforeRow) {
        diff.push({
          type: 'rowAdded',
          tableId: afterTable.id,
          tableName: afterTable.name,
          rowId: afterRow._rowId,
          values: afterRow.values,
        });
        continue;
      }

      for (const column of afterTable.columns) {
        if (!beforeColumns.has(column.id)) continue;
        const beforeValue = beforeRow.values[column.id];
        const afterValue = afterRow.values[column.id];
        if (!sameValue(beforeValue, afterValue)) {
          diff.push({
            type: 'cellUpdated',
            tableId: afterTable.id,
            tableName: afterTable.name,
            rowId: afterRow._rowId,
            columnId: column.id,
            columnName: column.name || column.id,
            before: beforeValue,
            after: afterValue,
          });
        }
      }
    }
  }

  return diff;
};

export function applyDataPatch(
  project: ProjectFile,
  patch: DataPatch,
  options: ApplyDataPatchOptions = {},
): ApplyDataPatchResult {
  const nextProject = cloneProject(project);
  const usedRowIds = new Set(nextProject.tables.flatMap((table) => table.rows.map((row) => row._rowId)));
  const createRowId = options.createRowId ?? makeId;
  const createdTableIds = new Set<string>();
  const createdColumnIds = new Set<string>();

  for (const [index, operation] of patch.operations.entries()) {
    const operationPath = `$.operations[${index}]`;
    let problem: PatchProblem | undefined;

    if (operation.op === 'addTable') {
      problem = applyAddTable(nextProject, operation, operationPath);
      if (!problem) createdTableIds.add(operation.tableId);
    } else if (operation.op === 'updateTable') {
      problem = applyUpdateTable(nextProject, operation, operationPath);
    } else if (operation.op === 'deleteTable') {
      problem = applyDeleteTable(nextProject, operation, operationPath);
    } else if (operation.op === 'addColumn') {
      problem = applyAddColumn(nextProject, operation, operationPath);
      if (!problem) createdColumnIds.add(`${operation.tableId}\u0000${operation.column.id}`);
    } else if (operation.op === 'updateColumn') {
      problem = applyUpdateColumn(nextProject, operation, operationPath);
    } else if (operation.op === 'moveColumn') {
      problem = applyMoveColumn(nextProject, operation, operationPath);
    } else if (operation.op === 'deleteColumn') {
      problem = applyDeleteColumn(nextProject, operation, operationPath);
    } else if (operation.op === 'updateRows') {
      problem = applyUpdateRows(nextProject, operation, operationPath);
    } else if (operation.op === 'addRows') {
      problem = applyAddRows(nextProject, operation, operationPath, usedRowIds, createRowId);
    } else if (operation.op === 'upsertRows') {
      problem = applyUpsertRows(nextProject, operation, operationPath, usedRowIds, createRowId);
    } else {
      problem = applyDeleteRows(nextProject, operation, operationPath);
    }

    if (problem) return { ok: false, problem };
  }

  for (const tableId of createdTableIds) {
    const table = nextProject.tables.find((candidate) => candidate.id === tableId);
    if (table && !table.remark?.trim()) {
      return {
        ok: false,
        problem: invalidPatch(
          `New table "${tableId}" must keep a non-empty remark through the end of the patch.`,
          '$.operations',
        ),
      };
    }
  }
  for (const key of createdColumnIds) {
    const [tableId, columnId] = key.split('\u0000');
    const column = nextProject.tables
      .find((table) => table.id === tableId)
      ?.columns.find((candidate) => candidate.id === columnId);
    if (column && !column.remark?.trim()) {
      return {
        ok: false,
        problem: invalidPatch(
          `New column "${tableId}.${columnId}" must keep a non-empty remark through the end of the patch.`,
          '$.operations',
        ),
      };
    }
  }

  return {
    ok: true,
    project: nextProject,
    diff: makeDiff(project, nextProject),
  };
}

const defaultValidateProject = (project: ProjectFile) =>
  validateProject(project, (key, vars) => translate('en', key, vars));

const issueCounts = (issues: ValidationIssue[]) => ({
  errorCount: issues.filter((issue) => issue.severity === 'error').length,
  warningCount: issues.filter((issue) => issue.severity === 'warning').length,
  issues,
});

const issuesBySeverity = (issues: ValidationIssue[], severity: ValidationIssue['severity']) =>
  new Map(issues.filter((issue) => issue.severity === severity).map((issue) => [issue.id, issue]));

const validationDelta = (before: ValidationIssue[], after: ValidationIssue[]): ValidationDelta => {
  const beforeErrors = issuesBySeverity(before, 'error');
  const afterErrors = issuesBySeverity(after, 'error');
  const beforeWarnings = issuesBySeverity(before, 'warning');
  const afterWarnings = issuesBySeverity(after, 'warning');

  return {
    before: issueCounts(before),
    after: issueCounts(after),
    newErrors: [...afterErrors.values()].filter((issue) => !beforeErrors.has(issue.id)),
    resolvedErrors: [...beforeErrors.values()].filter((issue) => !afterErrors.has(issue.id)),
    newWarnings: [...afterWarnings.values()].filter((issue) => !beforeWarnings.has(issue.id)),
    resolvedWarnings: [...beforeWarnings.values()].filter((issue) => !afterWarnings.has(issue.id)),
  };
};

export function checkDataPatch(
  project: ProjectFile,
  patch: DataPatch,
  options: CheckDataPatchOptions,
): CheckDataPatchResult {
  if (patch.baseHash !== options.projectHash) {
    return {
      ok: false,
      accepted: false,
      projectHash: options.projectHash,
      patchBaseHash: patch.baseHash,
      changed: false,
      problem: {
        kind: 'hash',
        message: `Patch baseHash ${patch.baseHash} does not match project hash ${options.projectHash}.`,
        path: '$.baseHash',
      },
    };
  }

  const confirmationHash = confirmationHashForPatch(options.projectHash, patch);
  const validate = options.validate ?? defaultValidateProject;
  const beforeIssues = validate(project);
  const applied = applyDataPatch(project, patch, {
    createRowId: options.createRowId ?? createDeterministicRowIdFactory(confirmationHash),
  });

  if (!applied.ok) {
    return {
      ok: false,
      accepted: false,
      projectHash: options.projectHash,
      patchBaseHash: patch.baseHash,
      confirmationHash,
      changed: false,
      problem: applied.problem,
    };
  }

  const afterIssues = validate(applied.project);
  const validation = validationDelta(beforeIssues, afterIssues);

  if (validation.newErrors.length > 0) {
    return {
      ok: false,
      accepted: false,
      projectHash: options.projectHash,
      patchBaseHash: patch.baseHash,
      confirmationHash,
      changed: false,
      problem: {
        kind: 'validation',
        message: `Patch introduces ${validation.newErrors.length} new validation error(s).`,
      },
      project: applied.project,
      diff: applied.diff,
      validation,
    };
  }

  return {
    ok: true,
    accepted: true,
    projectHash: options.projectHash,
    patchBaseHash: patch.baseHash,
    confirmationHash,
    changed: canonicalJson(applied.project) !== canonicalJson(project),
    project: applied.project,
    diff: applied.diff,
    validation,
  };
}
