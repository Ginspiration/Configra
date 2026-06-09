import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditorStore } from '../store/editorStore';

function TableNode({ data }: NodeProps) {
  const project = useEditorStore((state) => state.project);
  const selectedTableId = useEditorStore((state) => state.selectedTableId);
  const selectTable = useEditorStore((state) => state.selectTable);
  const tableId = typeof data.tableId === 'string' ? data.tableId : '';
  const table = project.tables.find((item) => item.id === tableId);

  if (!table) return null;

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
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="table-node__title">{table.name || table.id}</div>
      <div className="table-node__fields">
        {table.columns.map((column) => (
          <div className="table-node__field" key={column.id}>
            <span className="table-node__name">{column.name || column.id}</span>
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
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="node-handle" />
    </button>
  );
}

export default memo(TableNode);
