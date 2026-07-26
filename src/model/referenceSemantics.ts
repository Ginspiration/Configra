import type { ProjectFile } from './types';

export const REF_CELL_VALUE_DESCRIPTION =
  "A ref cell stores the referenced target column's actual value. tableId and columnId identify the target schema only; never store a tableId, columnId, or _rowId in the cell.";

export const IDENTITY_USAGE_DESCRIPTION =
  'Optional ID-registry metadata. Configure it only when rows in this table must be exposed through the global ${namespace}.${symbolKey} ID registry. Most configuration, parameter, detail, and relationship tables do not need identity. Do not add identity or symbol-key/runtime-ID columns merely because a table has a primary key, stable IDs, or ref relationships.';

export const REF_TARGET_PREFERENCE_DESCRIPTION =
  'Prefer a primary column, an already-configured identity.valueColumnId, or another unique stable target. Do not create identity merely to define a ref.';

export const REFERENCE_SEMANTICS = {
  schemaLink:
    'Set the source column type to ref and sourceColumn.ref to the stable target tableId and columnId.',
  cellValue: REF_CELL_VALUE_DESCRIPTION,
  preferredTargets: [
    'Prefer the target table primary column.',
    'Otherwise, if the target table already defines identity, prefer its identity.valueColumnId runtime-ID column.',
    'Otherwise use a target column whose values are unique and stable.',
  ],
  identity:
    `${IDENTITY_USAGE_DESCRIPTION} When identity is present, identity.keyColumnId is a readable symbol and identity.valueColumnId is normally the runtime value stored by a ref that targets it.`,
} as const;

export const summarizeProjectReferences = (project: ProjectFile) =>
  project.tables.flatMap((sourceTable) =>
    sourceTable.columns.flatMap((sourceColumn) => {
      if (sourceColumn.type !== 'ref' || !sourceColumn.ref) return [];

      const targetTable = project.tables.find((table) => table.id === sourceColumn.ref?.tableId);
      const targetColumn = targetTable?.columns.find(
        (column) => column.id === sourceColumn.ref?.columnId,
      );
      const targetExists = Boolean(targetTable && targetColumn);

      return [
        {
          source: {
            tableId: sourceTable.id,
            tableName: sourceTable.name,
            columnId: sourceColumn.id,
            columnName: sourceColumn.name,
          },
          target: {
            tableId: sourceColumn.ref.tableId,
            ...(targetTable ? { tableName: targetTable.name } : {}),
            columnId: sourceColumn.ref.columnId,
            ...(targetColumn ? { columnName: targetColumn.name } : {}),
            exists: targetExists,
            isPrimary: targetColumn?.primary === true,
            isIdentityValue:
              targetColumn !== undefined && targetTable?.identity?.valueColumnId === targetColumn.id,
            ...(targetTable?.identity?.keyColumnId
              ? { identityKeyColumnId: targetTable.identity.keyColumnId }
              : {}),
            ...(targetTable?.identity?.namespace
              ? { identityNamespace: targetTable.identity.namespace }
              : {}),
          },
          status: targetExists ? ('valid' as const) : ('missing-target' as const),
          cellValueMeaning: targetColumn
            ? `Stores values from ${sourceColumn.ref.tableId}.${sourceColumn.ref.columnId} (${targetTable?.name}.${targetColumn.name}).`
            : `Intended to store values from ${sourceColumn.ref.tableId}.${sourceColumn.ref.columnId}, but that target is missing.`,
        },
      ];
    }),
  );
