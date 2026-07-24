import type { ProjectFile } from './types';

export const REF_CELL_VALUE_DESCRIPTION =
  "A ref cell stores the referenced target column's actual value. tableId and columnId identify the target schema only; never store a tableId, columnId, or _rowId in the cell.";

export const REFERENCE_SEMANTICS = {
  schemaLink:
    'Set the source column type to ref and sourceColumn.ref to the stable target tableId and columnId.',
  cellValue: REF_CELL_VALUE_DESCRIPTION,
  preferredTargets: [
    'Prefer the target table primary column.',
    'Otherwise prefer the target table identity.valueColumnId runtime-ID column.',
    'Otherwise use a target column whose values are unique and stable.',
  ],
  identity:
    'identity.keyColumnId is a readable symbol; identity.valueColumnId is normally the runtime value stored by a ref that targets it.',
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
