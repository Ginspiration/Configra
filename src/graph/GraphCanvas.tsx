import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
  type OnNodeDrag,
  useReactFlow,
} from '@xyflow/react';
import type { GraphPosition } from '../model/types';
import { useEditorStore } from '../store/editorStore';
import { projectToFlow, type TableFlowNode } from './graphMapping';
import TableNode from './TableNode';

const nodeTypes: NodeTypes = {
  tableNode: TableNode,
};

type GraphCanvasProps = {
  showMiniMap: boolean;
  onOpenTableData(tableId: string): void;
  onOpenTableContext(tableId: string, position: { x: number; y: number }): void;
  onOpenCanvasContext(position: { x: number; y: number }, graphPosition: GraphPosition): void;
};

function GraphCanvasInner({
  showMiniMap,
  onOpenTableData,
  onOpenTableContext,
  onOpenCanvasContext,
}: GraphCanvasProps) {
  const project = useEditorStore((state) => state.project);
  const moveTable = useEditorStore((state) => state.moveTable);
  const selectTable = useEditorStore((state) => state.selectTable);
  const { screenToFlowPosition } = useReactFlow();
  const { nodes, edges } = useMemo(() => projectToFlow(project), [project]);

  const handleNodeDragStop: OnNodeDrag<TableFlowNode> = (_, node) => {
    moveTable(node.id, node.position);
  };

  const handleNodeDrag: OnNodeDrag<TableFlowNode> = (_, node) => {
    moveTable(node.id, node.position);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.35}
      maxZoom={1.6}
      onNodeDrag={handleNodeDrag}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={(_, node) => selectTable(node.id)}
      onNodeDoubleClick={(_, node) => {
        selectTable(node.id);
        onOpenTableData(node.id);
      }}
      onNodeContextMenu={(event, node) => {
        event.preventDefault();
        selectTable(node.id);
        onOpenTableContext(node.id, { x: event.clientX, y: event.clientY });
      }}
      onPaneContextMenu={(event) => {
        event.preventDefault();
        onOpenCanvasContext(
          { x: event.clientX, y: event.clientY },
          screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        );
      }}
    >
      <Background gap={18} size={1} />
      <Controls position="bottom-left" />
      {showMiniMap ? (
        <MiniMap
          pannable
          zoomable
          bgColor="#f8fafc"
          maskColor="rgba(148, 163, 184, 0.18)"
          maskStrokeColor="#2563eb"
          maskStrokeWidth={1}
          nodeBorderRadius={4}
          nodeColor={(node) => (node.selected ? '#bfdbfe' : '#dbeafe')}
          nodeStrokeColor={(node) => (node.selected ? '#2563eb' : '#64748b')}
          nodeStrokeWidth={2}
          offsetScale={12}
        />
      ) : null}
    </ReactFlow>
  );
}

export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
