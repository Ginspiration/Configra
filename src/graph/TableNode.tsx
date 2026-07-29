import { memo, useEffect } from 'react';
import { Handle, Position, type NodeProps, useUpdateNodeInternals } from '@xyflow/react';
import { useEditorStore } from '../store/editorStore';
import {
  relationshipHandleSides,
  sourceColumnHandleId,
  targetColumnHandleId,
  type HorizontalHandleSide,
} from './graphMapping';

const shortRemark = (value: string) => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > 12 ? `${singleLine.slice(0, 12)}...` : singleLine;
};

function TableNode({ data }: NodeProps) {
  const project = useEditorStore((state) => state.project);
  const selectedTableId = useEditorStore((state) => state.selectedTableId);
  const selectTable = useEditorStore((state) => state.selectTable);
  const tableId = typeof data.tableId === 'string' ? data.tableId : '';
  const focusPulse = typeof data.focusPulse === 'number' ? data.focusPulse : 0;
  const table = project.tables.find((item) => item.id === tableId);
  const updateNodeInternals = useUpdateNodeInternals();
  const handleLayoutKey = project.tables
    .flatMap((sourceTable) =>
      sourceTable.columns.flatMap((sourceColumn) => {
        if (sourceColumn.type !== 'ref' || !sourceColumn.ref) return [];

        const targetTable = project.tables.find((item) => item.id === sourceColumn.ref?.tableId);
        if (!targetTable) return [];

        const { sourceSide, targetSide } = relationshipHandleSides(sourceTable, targetTable);
        const parts: string[] = [];
        if (sourceTable.id === tableId) parts.push(`${sourceColumn.id}:source:${sourceSide}`);
        if (targetTable.id === tableId) {
          parts.push(`${sourceColumn.ref.columnId}:target:${targetSide}`);
        }
        return parts;
      }),
    )
    .join('|');

  useEffect(() => {
    if (tableId) updateNodeInternals(tableId);
  }, [handleLayoutKey, tableId, updateNodeInternals]);

  if (!table) return null;

  const incomingColumnSides = new Map<string, Set<HorizontalHandleSide>>();
  for (const sourceTable of project.tables) {
    for (const sourceColumn of sourceTable.columns) {
      if (sourceColumn.type === 'ref' && sourceColumn.ref?.tableId === table.id) {
        const { targetSide } = relationshipHandleSides(sourceTable, table);
        const sides = incomingColumnSides.get(sourceColumn.ref.columnId) ?? new Set();
        sides.add(targetSide);
        incomingColumnSides.set(sourceColumn.ref.columnId, sides);
      }
    }
  }

  const refLabel = (tableId: string, columnId: string) => {
    const targetTable = project.tables.find((item) => item.id === tableId);
    const targetColumn = targetTable?.columns.find((item) => item.id === columnId);
    return targetTable && targetColumn ? `${targetTable.name}.${targetColumn.name}` : 'missing';
  };

  return (
    <button
      type="button"
      className={`table-node ${selectedTableId === table.id ? 'is-selected' : ''} ${
        focusPulse > 0 ? `is-locating-${focusPulse % 2 === 0 ? 'even' : 'odd'}` : ''
      }`}
      onClick={() => selectTable(table.id)}
    >
      <div className="table-node__title" title={table.remark?.trim() || undefined}>
        {table.name || table.id}
        {table.remark?.trim() ? (
          <span className="table-node__remark"> {shortRemark(table.remark)}</span>
        ) : null}
      </div>
      <div className="table-node__fields">
        {table.columns.map((column) => {
          const remark = column.remark?.trim() ?? '';
          const isRefColumn = column.type === 'ref';
          const incomingSides = [...(incomingColumnSides.get(column.id) ?? [])];
          const targetTable = project.tables.find((item) => item.id === column.ref?.tableId);
          const sourceSide = targetTable
            ? relationshipHandleSides(table, targetTable).sourceSide
            : 'right';

          return (
            <div className="table-node__field" key={column.id}>
              {incomingSides.map((side) => (
                <Handle
                  key={`target-${side}`}
                  id={targetColumnHandleId(column.id, side)}
                  type="target"
                  position={side === 'left' ? Position.Left : Position.Right}
                  className="node-handle node-handle--field"
                />
              ))}
              <span className="table-node__name" title={remark || undefined}>
                {column.name || column.id}
                {remark ? <span className="table-node__remark"> {shortRemark(remark)}</span> : null}
              </span>
              <span className="table-node__type">{column.type}</span>
              {column.primary ? <span className="table-node__badge">PK</span> : null}
              {column.autoIncrement ? <span className="table-node__badge">AI</span> : null}
              {column.required ? <span className="table-node__required">*</span> : null}
              {column.type === 'ref' && column.ref ? (
                <span className="table-node__ref">
                  {'-> '}
                  {refLabel(column.ref.tableId, column.ref.columnId)}
                </span>
              ) : null}
              {isRefColumn ? (
                <Handle
                  id={sourceColumnHandleId(column.id, sourceSide)}
                  type="source"
                  position={sourceSide === 'left' ? Position.Left : Position.Right}
                  className="node-handle node-handle--field"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </button>
  );
}

export default memo(TableNode);
