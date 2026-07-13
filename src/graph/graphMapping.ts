import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { ProjectFile } from '../model/types';

export const TABLE_NODE_WIDTH = 210;
export const TABLE_NODE_MIN_HEIGHT = 84;

export const sourceColumnHandleId = (columnId: string) => `source-column:${columnId}`;
export const targetColumnHandleId = (columnId: string) => `target-column:${columnId}`;

export type TableNodeData = Record<string, unknown> & {
  tableId: string;
};

export type TableFlowNode = Node<TableNodeData, 'tableNode'>;

export function projectToFlow(project: ProjectFile): {
  nodes: TableFlowNode[];
  edges: Edge[];
} {
  const nodes: TableFlowNode[] = project.tables.map((table) => ({
    id: table.id,
    type: 'tableNode',
    position: table.position,
    initialWidth: TABLE_NODE_WIDTH,
    initialHeight: Math.max(TABLE_NODE_MIN_HEIGHT, 42 + table.columns.length * 20),
    width: TABLE_NODE_WIDTH,
    height: Math.max(TABLE_NODE_MIN_HEIGHT, 42 + table.columns.length * 20),
    data: { tableId: table.id },
  }));

  const edges: Edge[] = project.tables.flatMap((table) =>
    table.columns.flatMap((column) => {
      if (column.type !== 'ref' || !column.ref) return [];

      const targetTable = project.tables.find((item) => item.id === column.ref?.tableId);
      const targetColumn = targetTable?.columns.find((item) => item.id === column.ref?.columnId);
      if (!targetTable || !targetColumn) return [];

      return [
        {
          id: `${table.id}.${column.id}->${targetTable.id}.${targetColumn.id}`,
          source: table.id,
          sourceHandle: sourceColumnHandleId(column.id),
          target: targetTable.id,
          targetHandle: targetColumnHandleId(targetColumn.id),
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          label: `${table.name}.${column.name} -> ${targetTable.name}.${targetColumn.name}`,
          className: 'ref-edge',
        },
      ];
    }),
  );

  return { nodes, edges };
}
