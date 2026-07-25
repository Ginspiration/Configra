import type { Edge, Node } from '@xyflow/react';
import type { ConfigTable, ProjectFile } from '../model/types';

export const TABLE_NODE_WIDTH = 210;
export const TABLE_NODE_MIN_HEIGHT = 84;

export type HorizontalHandleSide = 'left' | 'right';

export const sourceColumnHandleId = (columnId: string, side: HorizontalHandleSide) =>
  `source-column:${columnId}:${side}`;
export const targetColumnHandleId = (columnId: string, side: HorizontalHandleSide) =>
  `target-column:${columnId}:${side}`;

export const relationshipHandleSides = (sourceTable: ConfigTable, targetTable: ConfigTable) => {
  const sourceLeft = sourceTable.position.x;
  const sourceRight = sourceLeft + TABLE_NODE_WIDTH;
  const targetLeft = targetTable.position.x;
  const targetRight = targetLeft + TABLE_NODE_WIDTH;
  const sourceCenterX = sourceTable.position.x + TABLE_NODE_WIDTH / 2;
  const targetCenterX = targetTable.position.x + TABLE_NODE_WIDTH / 2;

  if (targetLeft >= sourceRight) {
    return { sourceSide: 'right' as const, targetSide: 'left' as const };
  }

  if (targetRight <= sourceLeft) {
    return { sourceSide: 'left' as const, targetSide: 'right' as const };
  }

  const sharedSide = targetCenterX >= sourceCenterX ? ('right' as const) : ('left' as const);

  return {
    sourceSide: sharedSide,
    targetSide: sharedSide,
  };
};

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
      const { sourceSide, targetSide } = relationshipHandleSides(table, targetTable);

      return [
        {
          id: `${table.id}.${column.id}->${targetTable.id}.${targetColumn.id}`,
          source: table.id,
          sourceHandle: sourceColumnHandleId(column.id, sourceSide),
          target: targetTable.id,
          targetHandle: targetColumnHandleId(targetColumn.id, targetSide),
          type: 'smoothstep',
          className: 'ref-edge',
        },
      ];
    }),
  );

  return { nodes, edges };
}
