import type { ConfigColumn, ProjectFile } from '../model/types';

export type ReferenceTargetLocation = {
  tableId: string;
  tableName: string;
  columnId: string;
  rowId: string;
  columnIndex: number;
  rowIndex: number;
};

export const referenceValueKey = (value: unknown) => JSON.stringify([typeof value, value]);

export function resolveReferenceTarget(
  project: ProjectFile,
  sourceColumn: ConfigColumn | undefined,
  value: unknown,
): ReferenceTargetLocation | undefined {
  if (
    sourceColumn?.type !== 'ref' ||
    !sourceColumn.ref ||
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  const targetTable = project.tables.find((table) => table.id === sourceColumn.ref?.tableId);
  const columnIndex =
    targetTable?.columns.findIndex((column) => column.id === sourceColumn.ref?.columnId) ?? -1;
  if (!targetTable || columnIndex < 0) return undefined;

  const targetColumn = targetTable.columns[columnIndex];
  const targetValueKey = referenceValueKey(value);
  const rowIndex = targetTable.rows.findIndex(
    (row) => referenceValueKey(row.values[targetColumn.id]) === targetValueKey,
  );
  if (rowIndex < 0) return undefined;

  return {
    tableId: targetTable.id,
    tableName: targetTable.name,
    columnId: targetColumn.id,
    rowId: targetTable.rows[rowIndex]._rowId,
    columnIndex,
    rowIndex,
  };
}
