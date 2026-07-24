import { z } from 'zod';

export const MCP_SERVER_ID = 'game-config-graph-editor';
export const MCP_DISPLAY_NAME = 'Game Config Graph Editor';
export const MCP_VERSION = '0.1.0';
export const MCP_SUPPORTED_CAPABILITIES = ['tools'] as const;

const nonEmptyString = z.string().min(1);
const nonBlankString = z.string().regex(/\S/, 'Must contain at least one non-whitespace character.');
const nullableOptionalBoolean = z.boolean().nullable().optional();

const positionSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});

const identitySchema = z.strictObject({
  namespace: z.string().optional(),
  keyColumnId: z.string().optional(),
  valueColumnId: z.string().optional(),
});

const refSchema = z.strictObject({
  tableId: nonEmptyString,
  columnId: nonEmptyString,
});

const columnTypeSchema = z.enum(['int', 'float', 'string', 'bool', 'enum', 'ref', 'json']);
const rowValuesSchema = z.record(z.string(), z.json());

const columnSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  type: columnTypeSchema,
  remark: nonBlankString,
  required: z.boolean().optional(),
  primary: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  export: z.boolean().optional(),
  enumValues: z.array(z.string()).optional(),
  ref: refSchema.optional(),
});

export const dataPatchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('addTable'),
    tableId: nonEmptyString,
    name: nonEmptyString,
    remark: nonBlankString,
    position: positionSchema.optional(),
    identity: identitySchema.optional(),
  }),
  z.strictObject({
    op: z.literal('updateTable'),
    tableId: nonEmptyString,
    changes: z.strictObject({
      name: z.string().optional(),
      remark: z.string().nullable().optional(),
      position: positionSchema.optional(),
      identity: identitySchema.nullable().optional(),
    }),
  }),
  z.strictObject({
    op: z.literal('deleteTable'),
    tableId: nonEmptyString,
  }),
  z.strictObject({
    op: z.literal('addColumn'),
    tableId: nonEmptyString,
    column: columnSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    op: z.literal('updateColumn'),
    tableId: nonEmptyString,
    columnId: nonEmptyString,
    changes: z.strictObject({
      name: z.string().optional(),
      type: columnTypeSchema.optional(),
      required: nullableOptionalBoolean,
      primary: nullableOptionalBoolean,
      autoIncrement: nullableOptionalBoolean,
      export: nullableOptionalBoolean,
      remark: z.string().nullable().optional(),
      enumValues: z.array(z.string()).nullable().optional(),
      ref: refSchema.nullable().optional(),
    }),
  }),
  z.strictObject({
    op: z.literal('moveColumn'),
    tableId: nonEmptyString,
    columnId: nonEmptyString,
    targetIndex: z.number().int().min(0),
  }),
  z.strictObject({
    op: z.literal('deleteColumn'),
    tableId: nonEmptyString,
    columnId: nonEmptyString,
  }),
  z.strictObject({
    op: z.literal('updateRows'),
    tableId: nonEmptyString,
    rows: z.array(z.strictObject({ rowId: nonEmptyString, values: rowValuesSchema })),
  }),
  z.strictObject({
    op: z.literal('upsertRows'),
    tableId: nonEmptyString,
    keyColumnId: nonEmptyString,
    rows: z.array(z.strictObject({ key: z.json(), values: rowValuesSchema })),
  }),
  z.strictObject({
    op: z.literal('addRows'),
    tableId: nonEmptyString,
    rows: z.array(z.strictObject({ values: rowValuesSchema })),
  }),
  z.strictObject({
    op: z.literal('deleteRows'),
    tableId: nonEmptyString,
    rowIds: z.array(nonEmptyString),
  }),
]);

export const dataPatchSchema = z.strictObject({
  version: z.literal(1),
  baseHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  description: z.string().optional(),
  operations: z.array(dataPatchOperationSchema),
});

export type McpStructuredErrorCode =
  | 'SERVER_NOT_REGISTERED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'PROJECT_NOT_OPEN'
  | 'UI_DIRTY_CONFLICT'
  | 'STALE_BASE_HASH'
  | 'INVALID_ARGUMENT'
  | 'TARGET_NOT_FOUND'
  | 'PATCH_REJECTED'
  | 'FILESYSTEM_ERROR'
  | 'INTERNAL_ERROR';

export type McpStructuredError = {
  code: McpStructuredErrorCode;
  message: string;
  serverId: typeof MCP_SERVER_ID;
  supportedCapabilities: typeof MCP_SUPPORTED_CAPABILITIES;
  details?: unknown;
};

export const structuredError = (
  code: McpStructuredErrorCode,
  message: string,
  details?: unknown,
): McpStructuredError => ({
  code,
  message,
  serverId: MCP_SERVER_ID,
  supportedCapabilities: MCP_SUPPORTED_CAPABILITIES,
  ...(details === undefined ? {} : { details }),
});
