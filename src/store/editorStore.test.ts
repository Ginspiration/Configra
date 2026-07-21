import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sampleProject';
import { useEditorStore } from './editorStore';

describe('editor dirty scopes', () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject(createSampleProject());
  });

  it('treats graph movement as layout-only until content changes', () => {
    const table = useEditorStore.getState().project.tables[0];
    useEditorStore.getState().moveTable(table.id, {
      x: table.position.x + 20,
      y: table.position.y + 10,
    });

    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, dirtyScope: 'layout' });

    useEditorStore.getState().updateTable(table.id, { name: `${table.name}Updated` });
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, dirtyScope: 'content' });
  });

  it('preserves an unsaved layout while reloading MCP content', () => {
    const original = useEditorStore.getState().project;
    const table = original.tables[0];
    const localPosition = { x: table.position.x + 40, y: table.position.y + 30 };
    useEditorStore.getState().moveTable(table.id, localPosition);

    const externalProject = {
      ...original,
      tables: original.tables.map((item) =>
        item.id === table.id
          ? {
              ...item,
              name: `${item.name}FromMcp`,
              position: { x: -100, y: -100 },
            }
          : item,
      ),
    };
    useEditorStore.getState().reloadProject(externalProject, true);

    const reloadedTable = useEditorStore
      .getState()
      .project.tables.find((item) => item.id === table.id);
    expect(reloadedTable?.name).toBe(`${table.name}FromMcp`);
    expect(reloadedTable?.position).toEqual(localPosition);
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, dirtyScope: 'layout' });
  });
});
