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

  it('clears a stale layout dirty flag when the reloaded positions match disk', () => {
    const project = createSampleProject();
    const table = project.tables[0];
    useEditorStore.getState().loadProject(project);
    useEditorStore.getState().moveTable(table.id, { x: table.position.x + 10, y: table.position.y });

    const externalProject = createSampleProject();
    externalProject.tables[0].position = { x: table.position.x + 10, y: table.position.y };
    useEditorStore.getState().reloadProject(externalProject, true);

    expect(useEditorStore.getState()).toMatchObject({ isDirty: false, dirtyScope: 'none' });
  });

  it('creates a clean empty project with no selected table', () => {
    const table = useEditorStore.getState().project.tables[0];
    useEditorStore.getState().updateTable(table.id, { name: 'UnsavedName' });

    useEditorStore.getState().newProject();

    expect(useEditorStore.getState()).toMatchObject({
      project: { version: 1, tables: [] },
      selectedTableId: undefined,
      isDirty: false,
      dirtyScope: 'none',
    });
  });

  it('appends imported rows with fresh defaults and marks content dirty', () => {
    const project = createSampleProject();
    const table = project.tables[0];
    useEditorStore.getState().loadProject(project);
    const beforeCount = table.rows.length;

    useEditorStore
      .getState()
      .appendRows(table.id, [
        { _rowId: 'imported_row', values: { [table.columns[0].id]: 'ImportedValue' } },
      ]);

    const nextTable = useEditorStore
      .getState()
      .project.tables.find((item) => item.id === table.id);
    expect(nextTable?.rows).toHaveLength(beforeCount + 1);
    expect(nextTable?.rows[beforeCount]._rowId).toBe('imported_row');
    expect(nextTable?.rows[beforeCount].values[table.columns[0].id]).toBe('ImportedValue');
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, dirtyScope: 'content' });
  });
});
