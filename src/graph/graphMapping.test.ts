import { describe, expect, it } from 'vitest';
import type { ConfigTable, ProjectFile } from '../model/types';
import { projectToFlow } from './graphMapping';

const table = (id: string, x: number, refTableId?: string): ConfigTable => ({
  id,
  name: id,
  position: { x, y: 0 },
  columns: [
    {
      id: refTableId ? 'ref_column' : 'target_column',
      name: refTableId ? 'ref_column' : 'target_column',
      type: refTableId ? 'ref' : 'string',
      ...(refTableId
        ? { ref: { tableId: refTableId, columnId: 'target_column' } }
        : {}),
    },
  ],
  rows: [],
});

const projectWithTargetAt = (targetX: number): ProjectFile => ({
  version: 1,
  tables: [table('source', 100, 'target'), table('target', targetX)],
});

describe('projectToFlow', () => {
  it('connects from right to left when the target table is on the right', () => {
    const edge = projectToFlow(projectWithTargetAt(500)).edges[0];

    expect(edge.sourceHandle).toBe('source-column:ref_column:right');
    expect(edge.targetHandle).toBe('target-column:target_column:left');
    expect(edge.markerEnd).toBeUndefined();
  });

  it('connects from left to right when the target table is on the left', () => {
    const edge = projectToFlow(projectWithTargetAt(-300)).edges[0];

    expect(edge.sourceHandle).toBe('source-column:ref_column:left');
    expect(edge.targetHandle).toBe('target-column:target_column:right');
    expect(edge.markerEnd).toBeUndefined();
  });

  it('uses one outer side when the tables overlap horizontally', () => {
    const edge = projectToFlow(projectWithTargetAt(100)).edges[0];

    expect(edge.sourceHandle).toBe('source-column:ref_column:right');
    expect(edge.targetHandle).toBe('target-column:target_column:right');
  });
});
