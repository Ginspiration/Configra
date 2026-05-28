import { create } from 'zustand';
import { createSampleProject } from '../model/sampleProject';
import type { ConfigColumn, ConfigTable, GraphPosition, ProjectFile } from '../model/types';

type EditorStore = {
  project: ProjectFile;
  selectedTableId?: string;

  selectTable(tableId: string): void;
  addTable(): void;
  updateTable(tableId: string, patch: Partial<ConfigTable>): void;
  moveTable(tableId: string, position: GraphPosition): void;
  deleteTable(tableId: string): void;

  addColumn(tableId: string): void;
  updateColumn(tableId: string, columnId: string, patch: Partial<ConfigColumn>): void;
  deleteColumn(tableId: string, columnId: string): void;

  addRow(tableId: string): void;
  updateCell(tableId: string, rowId: string, columnId: string, value: unknown): void;
  deleteRow(tableId: string, rowId: string): void;

  loadProject(project: ProjectFile): void;
  resetProject(): void;
};

const makeId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

const uniqueName = (base: string, existing: string[]) => {
  let name = base;
  let index = 1;
  while (existing.includes(name)) {
    index += 1;
    name = `${base}${index}`;
  }
  return name;
};

const defaultValueForColumn = (column: ConfigColumn): unknown => {
  if (column.type === 'bool') return false;
  if (column.type === 'enum') return column.enumValues?.[0] ?? '';
  if (column.type === 'json') return '{}';
  return '';
};

const initialProject = createSampleProject();

export const useEditorStore = create<EditorStore>((set, get) => ({
  project: initialProject,
  selectedTableId: initialProject.tables[0]?.id,

  selectTable: (tableId) => set({ selectedTableId: tableId }),

  addTable: () =>
    set((state) => {
      const tableId = makeId('table');
      const columnId = 'id';
      const table: ConfigTable = {
        id: tableId,
        name: uniqueName('NewTable', state.project.tables.map((item) => item.name)),
        position: {
          x: 160 + state.project.tables.length * 48,
          y: 140 + state.project.tables.length * 34,
        },
        columns: [{ id: columnId, name: 'id', type: 'int', primary: true, required: true }],
        rows: [],
      };

      return {
        project: { ...state.project, tables: [...state.project.tables, table] },
        selectedTableId: table.id,
      };
    }),

  updateTable: (tableId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) =>
          table.id === tableId ? { ...table, ...patch } : table,
        ),
      },
    })),

  moveTable: (tableId, position) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) =>
          table.id === tableId ? { ...table, position } : table,
        ),
      },
    })),

  deleteTable: (tableId) =>
    set((state) => {
      const tables = state.project.tables.filter((table) => table.id !== tableId);
      const selectedTableId =
        state.selectedTableId === tableId ? tables[0]?.id : state.selectedTableId;

      return {
        project: { ...state.project, tables },
        selectedTableId,
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
    })),

  updateColumn: (tableId, columnId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          const nextColumns = table.columns.map((column) => {
            if (column.id !== columnId) {
              return patch.primary ? { ...column, primary: false } : column;
            }

            const nextColumn = { ...column, ...patch };
            if (patch.primary) nextColumn.required = true;
            return nextColumn;
          });

          return { ...table, columns: nextColumns };
        }),
      },
    })),

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
    })),

  addRow: (tableId) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          const values = Object.fromEntries(
            table.columns.map((column) => [column.id, defaultValueForColumn(column)]),
          );

          return {
            ...table,
            rows: [...table.rows, { _rowId: makeId('row'), values }],
          };
        }),
      },
    })),

  updateCell: (tableId, rowId, columnId, value) =>
    set((state) => ({
      project: {
        ...state.project,
        tables: state.project.tables.map((table) => {
          if (table.id !== tableId) return table;

          return {
            ...table,
            rows: table.rows.map((row) =>
              row._rowId === rowId
                ? { ...row, values: { ...row.values, [columnId]: value } }
                : row,
            ),
          };
        }),
      },
    })),

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
    })),

  loadProject: (project) =>
    set({
      project,
      selectedTableId: project.tables[0]?.id,
    }),

  resetProject: () => {
    const project = createSampleProject();
    get().loadProject(project);
  },
}));
