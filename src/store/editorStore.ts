import { create } from 'zustand';
import { createSampleProject } from '../model/sampleProject';
import { createEmptyProject } from '../model/projectFactory';
import type { ConfigColumn, ConfigTable, GraphPosition, ProjectFile } from '../model/types';
import {
  createDefaultRow,
  defaultValueForColumn,
  makeId,
  uniqueName,
} from '../model/rowFactory';

export type DirtyScope = 'none' | 'layout' | 'content';

type EditorStore = {
  project: ProjectFile;
  selectedTableId?: string;
  isDirty: boolean;
  dirtyScope: DirtyScope;

  selectTable(tableId: string): void;
  addTable(position?: GraphPosition): string;
  updateTable(tableId: string, patch: Partial<ConfigTable>): void;
  moveTable(tableId: string, position: GraphPosition): void;
  deleteTable(tableId: string): void;

  addColumn(tableId: string): void;
  updateColumn(tableId: string, columnId: string, patch: Partial<ConfigColumn>): void;
  moveColumn(tableId: string, columnId: string, targetIndex: number): void;
  deleteColumn(tableId: string, columnId: string): void;

  addRow(tableId: string): string | undefined;
  insertRow(tableId: string, rowIndex: number): string | undefined;
  updateCell(tableId: string, rowId: string, columnId: string, value: unknown): void;
  deleteRow(tableId: string, rowId: string): void;
  deleteRows(tableId: string, rowIds: string[]): void;

  loadProject(project: ProjectFile): void;
  reloadProject(project: ProjectFile, preserveLayout?: boolean): void;
  markClean(): void;
  newProject(): void;
};

const initialProject = createSampleProject();

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const samePosition = (left: GraphPosition, right: GraphPosition) =>
  Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5;

const markDirty = (reason: string, currentScope: DirtyScope, nextScope: DirtyScope = 'content') => {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.debug(`[configra] dirty (${nextScope}): ${reason}`);
  }

  return {
    isDirty: true,
    dirtyScope: currentScope === 'content' || nextScope === 'content' ? 'content' : 'layout',
  } as const;
};

export const useEditorStore = create<EditorStore>((set) => ({
  project: initialProject,
  selectedTableId: initialProject.tables[0]?.id,
  isDirty: false,
  dirtyScope: 'none',

  selectTable: (tableId) => set({ selectedTableId: tableId }),

  addTable: (position) => {
    const tableId = makeId('table');

    set((state) => {
      const table: ConfigTable = {
        id: tableId,
        name: uniqueName('NewTable', state.project.tables.map((item) => item.name)),
        position: position ?? {
          x: 160 + state.project.tables.length * 48,
          y: 140 + state.project.tables.length * 34,
        },
        columns: [],
        rows: [],
      };

      return {
        project: { ...state.project, tables: [...state.project.tables, table] },
        selectedTableId: table.id,
        ...markDirty('addTable', state.dirtyScope),
      };
    });

    return tableId;
  },

  updateTable: (tableId, patch) =>
    set((state) => {
      let updated = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;
        const nextTable = { ...table, ...patch };
        if (sameValue(table, nextTable)) return table;
        updated = true;
        return nextTable;
      });

      if (!updated) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...markDirty('updateTable', state.dirtyScope),
      };
    }),

  moveTable: (tableId, position) =>
    set((state) => {
      let moved = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;
        if (samePosition(table.position, position)) return table;
        moved = true;
        return { ...table, position };
      });

      if (!moved) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...markDirty('moveTable', state.dirtyScope, 'layout'),
      };
    }),

  deleteTable: (tableId) =>
    set((state) => {
      const tables = state.project.tables.filter((table) => table.id !== tableId);
      const selectedTableId =
        state.selectedTableId === tableId ? tables[0]?.id : state.selectedTableId;

      return {
        project: { ...state.project, tables },
        selectedTableId,
        ...markDirty('deleteTable', state.dirtyScope),
      };
    }),

  addColumn: (tableId) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          const column: ConfigColumn = {
            id: makeId('col'),
            name: uniqueName('field', table.columns.map((item) => item.name)),
            type: 'string',
            export: true,
          };

          return {
            ...table,
            columns: [...table.columns, column],
            rows: table.rows.map((row) => ({
              ...row,
              values: { ...row.values, [column.id]: defaultValueForColumn(column) },
            })),
          };
        }),
      },
      ...markDirty('addColumn', state.dirtyScope),
    })),

  updateColumn: (tableId, columnId, patch) =>
    set((state) => {
      let updated = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;

        const nextColumns = table.columns.map((column) => {
          let nextColumn = column;

          if (column.id !== columnId) {
            if (patch.primary) nextColumn = { ...column, primary: false };
          } else {
            nextColumn = { ...column, ...patch };
            if (patch.primary) nextColumn.required = true;
            if (nextColumn.autoIncrement && (nextColumn.type !== 'int' || !nextColumn.primary)) {
              nextColumn.autoIncrement = false;
            }
          }

          if (!sameValue(column, nextColumn)) updated = true;
          return nextColumn;
        });

        return updated ? { ...table, columns: nextColumns } : table;
      });

      if (!updated) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...markDirty('updateColumn', state.dirtyScope),
      };
    }),

  moveColumn: (tableId, columnId, targetIndex) =>
    set((state) => {
      let updated = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;

        const sourceIndex = table.columns.findIndex((column) => column.id === columnId);
        if (sourceIndex < 0) return table;

        const clampedTargetIndex = Math.max(0, Math.min(targetIndex, table.columns.length));
        const insertIndex =
          clampedTargetIndex > sourceIndex ? clampedTargetIndex - 1 : clampedTargetIndex;

        if (insertIndex === sourceIndex) return table;

        const columns = [...table.columns];
        const [column] = columns.splice(sourceIndex, 1);
        columns.splice(insertIndex, 0, column);
        updated = true;

        return { ...table, columns };
      });

      if (!updated) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...markDirty('moveColumn', state.dirtyScope),
      };
    }),

  deleteColumn: (tableId, columnId) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          return {
            ...table,
            columns: table.columns.filter((column) => column.id !== columnId),
            rows: table.rows.map((row) => {
              const nextValues = { ...row.values };
              delete nextValues[columnId];
              return { ...row, values: nextValues };
            }),
          };
        }),
      },
      ...markDirty('deleteColumn', state.dirtyScope),
    })),

  addRow: (tableId) => {
    const rowId = makeId('row');
    let added = false;

    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          added = true;

          return {
            ...table,
            rows: [...table.rows, createDefaultRow(table, rowId)],
          };
        }),
      },
      ...markDirty('addRow', state.dirtyScope),
    }));

    return added ? rowId : undefined;
  },

  insertRow: (tableId, rowIndex) => {
    const rowId = makeId('row');
    let inserted = false;

    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          inserted = true;
          const nextRows = [...table.rows];
          const insertAt = Math.max(0, Math.min(rowIndex, nextRows.length));
          nextRows.splice(insertAt, 0, createDefaultRow(table, rowId));

          return {
            ...table,
            rows: nextRows,
          };
        }),
      },
      ...markDirty('insertRow', state.dirtyScope),
    }));

    return inserted ? rowId : undefined;
  },

  updateCell: (tableId, rowId, columnId, value) =>
    set((state) => {
      let updated = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;

        const rows = table.rows.map((row) => {
          if (row._rowId !== rowId) return row;
          if (sameValue(row.values[columnId], value)) return row;

          updated = true;
          return { ...row, values: { ...row.values, [columnId]: value } };
        });

        return updated ? { ...table, rows } : table;
      });

      if (!updated) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...markDirty('updateCell', state.dirtyScope),
      };
    }),

  deleteRow: (tableId, rowId) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) =>
          table.id === tableId
            ? { ...table, rows: table.rows.filter((row) => row._rowId !== rowId) }
            : table,
        ),
      },
      ...markDirty('deleteRow', state.dirtyScope),
    })),

  deleteRows: (tableId, rowIds) =>
    set((state) => {
      const rowIdSet = new Set(rowIds);

      return {
        project: {
          ...state.project,
          tables: state.project.tables.map((table) =>
            table.id === tableId
              ? { ...table, rows: table.rows.filter((row) => !rowIdSet.has(row._rowId)) }
              : table,
          ),
        },
        ...markDirty('deleteRows', state.dirtyScope),
      };
    }),

  loadProject: (project) =>
    set({
      project,
      selectedTableId: project.tables[0]?.id,
      isDirty: false,
      dirtyScope: 'none',
    }),

  reloadProject: (project, preserveLayout = false) =>
    set((state) => {
      const reloadedProject = preserveLayout
        ? {
            ...project,
            tables: project.tables.map((table) => {
              const currentTable = state.project.tables.find((item) => item.id === table.id);
              return currentTable ? { ...table, position: currentTable.position } : table;
            }),
          }
        : project;
      const hasUnsavedLayout =
        preserveLayout &&
        reloadedProject.tables.some((table) => {
          const savedTable = project.tables.find((item) => item.id === table.id);
          return savedTable !== undefined && !samePosition(table.position, savedTable.position);
        });

      return {
        project: reloadedProject,
        selectedTableId: project.tables.some((table) => table.id === state.selectedTableId)
          ? state.selectedTableId
          : project.tables[0]?.id,
        isDirty: hasUnsavedLayout,
        dirtyScope: hasUnsavedLayout ? 'layout' : 'none',
      };
    }),

  markClean: () => set({ isDirty: false, dirtyScope: 'none' }),

  newProject: () =>
    set({
      project: createEmptyProject(),
      selectedTableId: undefined,
      isDirty: false,
      dirtyScope: 'none',
    }),
}));
