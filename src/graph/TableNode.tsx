import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditorStore } from '../store/editorStore';
import { sourceColumnHandleId, targetColumnHandleId } from './graphMapping';

const shortRemark = (value: string) => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > 12 ? `${singleLine.slice(0, 12)}...` : singleLine;
};

function TableNode({ data }: NodeProps) {
  const project = useEditorStore((state) => state.project);
  const selectedTableId = useEditorStore((state) => state.selectedTableId);
  const selectTable = useEditorStore((state) => state.selectTable);
  const tableId = typeof data.tableId === 'string' ? data.tableId : '';
  const table = project.tables.find((item) => item.id === tableId);

  if (!table) return null;

  const incomingColumnIds = new Set<string>();
  for (const sourceTable of project.tables) {
    for (const sourceColumn of sourceTable.columns) {
      if (sourceColumn.type === 'ref' && sourceColumn.ref?.tableId === table.id) {
        incomingColumnIds.add(sourceColumn.ref.columnId);
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
      className={`table-node ${selectedTableId === table.id ? 'is-selected' : ''}`}
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
          const hasIncomingRef = incomingColumnIds.has(column.id);

          return (
            <div className="table-node__field" key={column.id}>
              {hasIncomingRef ? (
                <Handle
                  id={targetColumnHandleId(column.id)}
                  type="target"
                  position={Position.Left}
                  className="node-handle node-handle--field"
                />
              ) : null}
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
                  id={sourceColumnHandleId(column.id)}
                  type="source"
                  position={Position.Right}
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
