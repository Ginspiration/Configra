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

  it('replaces imported rows with matching internal IDs and appends new rows', () => {
    const project = createSampleProject();
    const table = project.tables[0];
    const existingRow = table.rows[0];
    useEditorStore.getState().loadProject(project);

    useEditorStore.getState().appendRows(
      table.id,
      [
        { _rowId: existingRow._rowId, values: { [table.columns[0].id]: 'Replaced' } },
        { _rowId: 'new_row', values: { [table.columns[0].id]: 'New' } },
      ],
      true,
    );

    const rows = useEditorStore.getState().project.tables[0].rows;
    expect(rows).toHaveLength(table.rows.length + 1);
    expect(rows[0]._rowId).toBe(existingRow._rowId);
    expect(rows[0].values[table.columns[0].id]).toBe('Replaced');
    expect(rows[rows.length - 1]?._rowId).toBe('new_row');
  });

  describe('moveRow', () => {
    const loadThreeRowTable = () => {
      const project = createSampleProject();
      const table = project.tables[0];
      table.rows.push({
        _rowId: 'row_speaker_3',
        values: { id: 1003, name: '商人' },
      });
      useEditorStore.getState().loadProject(project);
      return table.id;
    };

    const rowIdsOf = (tableId: string) =>
      useEditorStore.getState().project.tables.find((item) => item.id === tableId)!.rows.map(
        (row) => row._rowId,
      );

    it('moves a row down and keeps every value attached to its row', () => {
      const tableId = loadThreeRowTable();
      useEditorStore.getState().markClean();

      const landedAt = useEditorStore.getState().moveRow(tableId, 0, 2);

      expect(landedAt).toBe(2);
      expect(rowIdsOf(tableId)).toEqual(['row_speaker_2', 'row_speaker_3', 'row_speaker_1']);
      const rows = useEditorStore.getState().project.tables[0].rows;
      expect(rows[2].values).toEqual({ id: 1001, name: '人类' });
      expect(useEditorStore.getState()).toMatchObject({ isDirty: true, dirtyScope: 'content' });
    });

    it('moves a row up', () => {
      const tableId = loadThreeRowTable();

      const landedAt = useEditorStore.getState().moveRow(tableId, 2, 0);

      expect(landedAt).toBe(0);
      expect(rowIdsOf(tableId)).toEqual(['row_speaker_3', 'row_speaker_1', 'row_speaker_2']);
    });

    it('clamps a target beyond the last row to the end of the table', () => {
      const tableId = loadThreeRowTable();

      const landedAt = useEditorStore.getState().moveRow(tableId, 0, 99);

      expect(landedAt).toBe(2);
      expect(rowIdsOf(tableId)).toEqual(['row_speaker_2', 'row_speaker_3', 'row_speaker_1']);
    });

    it('returns undefined and stays clean when the row does not move', () => {
      const tableId = loadThreeRowTable();

      expect(useEditorStore.getState().moveRow(tableId, 1, 1)).toBeUndefined();
      expect(useEditorStore.getState().moveRow(tableId, 16, 0)).toBeUndefined();
      expect(useEditorStore.getState().moveRow(tableId, 0, -5)).toBeUndefined();
      expect(rowIdsOf(tableId)).toEqual(['row_speaker_1', 'row_speaker_2', 'row_speaker_3']);
      expect(useEditorStore.getState().isDirty).toBe(false);
    });
  });
});

describe('editor undo/redo', () => {
  const tableId = 'speaker';

  beforeEach(() => {
    useEditorStore.getState().loadProject(createSampleProject());
  });

  const cellValue = (rowId: string, columnId: string) =>
    useEditorStore.getState().project.tables.find((table) => table.id === tableId)?.rows.find(
      (row) => row._rowId === rowId,
    )?.values[columnId];

  const rowCount = () =>
    useEditorStore.getState().project.tables.find((table) => table.id === tableId)?.rows.length;

  it('undoes and redoes a cell edit', () => {
    useEditorStore.getState().updateCell(tableId, 'row_speaker_1', 'name', '兽人');
    expect(useEditorStore.getState().undoStacks[tableId]).toHaveLength(1);

    useEditorStore.getState().undo(tableId);
    expect(cellValue('row_speaker_1', 'name')).toBe('人类');
    expect(useEditorStore.getState().redoStacks[tableId]).toHaveLength(1);

    useEditorStore.getState().redo(tableId);
    expect(cellValue('row_speaker_1', 'name')).toBe('兽人');
    expect(useEditorStore.getState().undoStacks[tableId]).toHaveLength(1);
  });

  it('restores deleted rows on undo', () => {
    useEditorStore.getState().deleteRows(tableId, ['row_speaker_2']);
    expect(rowCount()).toBe(1);

    useEditorStore.getState().undo(tableId);
    expect(rowCount()).toBe(2);
    expect(cellValue('row_speaker_2', 'name')).toBe('旁白');
  });

  it('restores column changes on undo', () => {
    useEditorStore.getState().addColumn(tableId);
    expect(useEditorStore.getState().project.tables[0].columns).toHaveLength(3);

    useEditorStore.getState().undo(tableId);
    expect(useEditorStore.getState().project.tables[0].columns).toHaveLength(2);
  });

  it('keeps table position while undoing content', () => {
    useEditorStore.getState().moveTable(tableId, { x: 500, y: 500 });
    useEditorStore.getState().updateCell(tableId, 'row_speaker_1', 'name', 'x');

    useEditorStore.getState().undo(tableId);

    const table = useEditorStore.getState().project.tables[0];
    expect(table.position).toEqual({ x: 500, y: 500 });
    expect(table.rows[0].values.name).toBe('人类');
  });

  it('records one undo entry per batch', () => {
    const store = useEditorStore.getState();
    store.beginUndoBatch(tableId);
    try {
      store.updateCell(tableId, 'row_speaker_1', 'name', 'a');
      store.updateCell(tableId, 'row_speaker_1', 'id', 42);
      store.updateCell(tableId, 'row_speaker_2', 'name', 'b');
    } finally {
      store.endUndoBatch();
    }

    expect(useEditorStore.getState().undoStacks[tableId]).toHaveLength(1);

    useEditorStore.getState().undo(tableId);
    const rows = useEditorStore.getState().project.tables[0].rows;
    expect(rows[0].values).toEqual({ id: 1001, name: '人类' });
    expect(rows[1].values).toEqual({ id: 1002, name: '旁白' });
  });

  it('does not record undo entries for layout moves or no-op updates', () => {
    const store = useEditorStore.getState();
    store.moveTable(tableId, { x: 1, y: 2 });
    store.updateCell(tableId, 'row_speaker_1', 'name', '人类');

    expect(useEditorStore.getState().undoStacks[tableId]).toBeUndefined();
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('drops the undo stack when the table is deleted', () => {
    useEditorStore.getState().updateCell(tableId, 'row_speaker_1', 'name', 'x');
    expect(useEditorStore.getState().undoStacks[tableId]).toHaveLength(1);

    useEditorStore.getState().deleteTable(tableId);
    expect(useEditorStore.getState().undoStacks[tableId]).toBeUndefined();
    expect(useEditorStore.getState().redoStacks[tableId]).toBeUndefined();
  });

  it('clears all undo stacks when the project is reloaded', () => {
    useEditorStore.getState().updateCell(tableId, 'row_speaker_1', 'name', 'x');
    expect(useEditorStore.getState().undoStacks[tableId]).toHaveLength(1);

    useEditorStore.getState().reloadProject(createSampleProject());
    expect(useEditorStore.getState().undoStacks).toEqual({});
    expect(useEditorStore.getState().redoStacks).toEqual({});
  });
});
