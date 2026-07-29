import { useEffect, useMemo } from 'react';
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
import type { ResolvedTheme } from '../theme';
import { projectToFlow, type TableFlowNode } from './graphMapping';
import TableNode from './TableNode';

const nodeTypes: NodeTypes = {
  tableNode: TableNode,
};

type GraphCanvasProps = {
  showMiniMap: boolean;
  theme: ResolvedTheme;
  focusRequest?: {
    tableId: string;
    sequence: number;
  };
  onOpenTableData(tableId: string): void;
  onOpenTableContext(tableId: string, position: { x: number; y: number }): void;
  onOpenCanvasContext(position: { x: number; y: number }, graphPosition: GraphPosition): void;
};

function GraphCanvasInner({
  showMiniMap,
  theme,
  focusRequest,
  onOpenTableData,
  onOpenTableContext,
  onOpenCanvasContext,
}: GraphCanvasProps) {
  const project = useEditorStore((state) => state.project);
  const moveTable = useEditorStore((state) => state.moveTable);
  const selectTable = useEditorStore((state) => state.selectTable);
  const { screenToFlowPosition, getNode, getZoom, setCenter } = useReactFlow();
  const { nodes: mappedNodes, edges } = useMemo(() => projectToFlow(project), [project]);
  const nodes = useMemo(
    () =>
      mappedNodes.map((node) =>
        node.id === focusRequest?.tableId
          ? { ...node, data: { ...node.data, focusPulse: focusRequest.sequence } }
          : node,
      ),
    [focusRequest, mappedNodes],
  );

  useEffect(() => {
    if (!focusRequest) return;
    const table = project.tables.find((item) => item.id === focusRequest.tableId);
    if (!table) return;

    const node = getNode(focusRequest.tableId);
    const width = node?.measured?.width ?? node?.width ?? 210;
    const height = node?.measured?.height ?? node?.height ?? Math.max(84, 42 + table.columns.length * 20);
    void setCenter(table.position.x + width / 2, table.position.y + height / 2, {
      duration: 450,
      zoom: Math.max(0.85, getZoom()),
    });
  }, [focusRequest?.sequence, focusRequest?.tableId, getNode, getZoom, setCenter]);

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
      <Background gap={18} size={1} color={theme === 'dark' ? '#41516a' : '#9aa7b6'} />
      <Controls position="bottom-left" />
      {showMiniMap ? (
        <MiniMap
          pannable
          zoomable
          bgColor={theme === 'dark' ? '#0e1625' : '#f8fafc'}
          maskColor={theme === 'dark' ? 'rgba(15, 23, 42, 0.52)' : 'rgba(148, 163, 184, 0.18)'}
          maskStrokeColor={theme === 'dark' ? '#60a5fa' : '#2563eb'}
          maskStrokeWidth={1}
          nodeBorderRadius={4}
          nodeColor={(node) => (node.selected ? (theme === 'dark' ? '#1e3a5f' : '#bfdbfe') : theme === 'dark' ? '#24344f' : '#dbeafe')}
          nodeStrokeColor={(node) => (node.selected ? (theme === 'dark' ? '#60a5fa' : '#2563eb') : theme === 'dark' ? '#64748b' : '#64748b')}
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
