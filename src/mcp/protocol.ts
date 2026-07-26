import { z } from 'zod';
import {
  IDENTITY_USAGE_DESCRIPTION,
  REF_CELL_VALUE_DESCRIPTION,
  REF_TARGET_PREFERENCE_DESCRIPTION,
} from '../model/referenceSemantics';

export const MCP_SERVER_ID = 'configra';
export const MCP_DISPLAY_NAME = 'Configra';
export const MCP_VERSION = '0.1.0';
export const MCP_SUPPORTED_CAPABILITIES = ['tools'] as const;

const nonEmptyString = z.string().min(1);
const nonBlankString = z.string().regex(/\S/, 'Must contain at least one non-whitespace character.');
const nullableOptionalBoolean = z.boolean().nullable().optional();

const positionSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});

const identitySchema = z
  .strictObject({
    namespace: z
      .string()
      .optional()
      .describe('Namespace prefix used in exported ID-registry keys, such as Sound in Sound.SOUND_CLICK.'),
    keyColumnId: z
      .string()
      .optional()
      .describe('Stable column ID whose row values provide readable symbol keys for ID-registry entries.'),
    valueColumnId: z
      .string()
      .optional()
      .describe('Stable column ID whose row values provide runtime IDs for ID-registry entries.'),
  })
  .describe(IDENTITY_USAGE_DESCRIPTION);

const refSchema = z
  .strictObject({
    tableId: nonEmptyString.describe(
      'Stable ID of the target table whose column values may be stored in this ref field.',
    ),
    columnId: nonEmptyString.describe(
      'Stable ID of the target column. Source ref cells store values from this column, not this columnId.',
    ),
  })
  .describe(
    `Schema-level reference target. ${REF_CELL_VALUE_DESCRIPTION} ${REF_TARGET_PREFERENCE_DESCRIPTION}`,
  );

const columnTypeSchema = z
  .enum(['int', 'float', 'string', 'bool', 'enum', 'ref', 'json'])
  .describe('Column data type. A ref type also requires ref.tableId and ref.columnId.');
const rowValuesSchema = z
  .record(z.string(), z.json())
  .describe(
    `Map stable source columnId keys to JSON cell values. For ref columns: ${REF_CELL_VALUE_DESCRIPTION}`,
  );

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
    tableId: nonEmptyString.describe('Stable ID of the source table containing the column.'),
    columnId: nonEmptyString.describe('Stable ID of the source column to update.'),
    changes: z.strictObject({
      name: z.string().optional(),
      type: columnTypeSchema.optional(),
      required: nullableOptionalBoolean,
      primary: nullableOptionalBoolean,
      autoIncrement: nullableOptionalBoolean,
      export: nullableOptionalBoolean,
      remark: z.string().nullable().optional(),
      enumValues: z.array(z.string()).nullable().optional(),
      ref: refSchema
        .nullable()
        .optional()
        .describe('Set the schema-level target for a ref column, or null to remove it.'),
    }).describe(
      `Column changes. To define a relationship, set type to ref and set ref to the target schema. ${REF_CELL_VALUE_DESCRIPTION}`,
    ),
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

export type DataPatchOperationInput = z.infer<typeof dataPatchOperationSchema>;

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
