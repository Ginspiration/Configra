import { create } from 'zustand';
import { createSampleProject } from '../model/sampleProject';
import { createEmptyProject } from '../model/projectFactory';
import type {
  ConfigColumn,
  ConfigRow,
  ConfigTable,
  GraphPosition,
  ProjectFile,
} from '../model/types';
import {
  createDefaultRow,
  defaultValueForColumn,
  makeId,
  uniqueName,
} from '../model/rowFactory';

export type DirtyScope = 'none' | 'layout' | 'content';

/** 撤销快照覆盖的表内容；position 属于画布布局，不参与撤销。 */
export type TableSnapshot = Pick<
  ConfigTable,
  'name' | 'remark' | 'columns' | 'rows' | 'identity'
>;

export type UndoEntry = { snapshot: TableSnapshot };

type EditorStore = {
  project: ProjectFile;
  selectedTableId?: string;
  isDirty: boolean;
  dirtyScope: DirtyScope;
  /** 有未保存内容修改的表 id（按修改顺序去重）；纯布局修改不记录。 */
  dirtyTableIds: string[];
  /** 每张表的撤销栈：修改前快照，栈顶为最近一次。 */
  undoStacks: Record<string, UndoEntry[]>;
  /** 每张表的重做栈：undo 时捕获的“改后”快照。 */
  redoStacks: Record<string, UndoEntry[]>;

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
  /** 把一行从 sourceIndex 移动到 targetIndex，返回落点索引；无需移动时返回 undefined。 */
  moveRow(tableId: string, sourceIndex: number, targetIndex: number): number | undefined;
  updateCell(tableId: string, rowId: string, columnId: string, value: unknown): void;
  deleteRow(tableId: string, rowId: string): void;
  deleteRows(tableId: string, rowIds: string[]): void;
  appendRows(tableId: string, rows: ConfigRow[], replaceExisting?: boolean): void;

  /** 开启撤销批量事务：捕获一次快照，期间所有修改合并为一条撤销记录。 */
  beginUndoBatch(tableId: string): void;
  endUndoBatch(): void;
  undo(tableId: string): void;
  redo(tableId: string): void;

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

const mergeDirtyTableIds = (current: string[], tableId: string) =>
  current.includes(tableId) ? current : [...current, tableId];

const UNDO_STACK_LIMIT = 50;

/** 批量撤销事务标记：begin/end 之间的修改共用 begin 时捕获的那条快照。 */
const undoBatch = { active: false };

const snapshotTable = (table: ConfigTable): TableSnapshot =>
  structuredClone({
    name: table.name,
    remark: table.remark,
    columns: table.columns,
    rows: table.rows,
    identity: table.identity,
  });

/** 修改前对目标表做快照，返回需要合并进本次 set 的撤销栈增量；无表或批量事务中时返回空。 */
const captureUndo = (
  state: Pick<EditorStore, 'project' | 'undoStacks' | 'redoStacks'>,
  tableId: string,
): Partial<Pick<EditorStore, 'undoStacks' | 'redoStacks'>> => {
  if (undoBatch.active) return {};

  const table = state.project.tables.find((item) => item.id === tableId);
  if (!table) return {};

  const undoStack = [...(state.undoStacks[tableId] ?? []), { snapshot: snapshotTable(table) }].slice(
    -UNDO_STACK_LIMIT,
  );

  return {
    undoStacks: { ...state.undoStacks, [tableId]: undoStack },
    redoStacks: { ...state.redoStacks, [tableId]: [] },
  };
};

const dropTableStacks = (
  stacks: Record<string, UndoEntry[]>,
  tableId: string,
): Record<string, UndoEntry[]> => {
  if (!(tableId in stacks)) return stacks;
  const { [tableId]: _removed, ...rest } = stacks;
  return rest;
};

export const useEditorStore = create<EditorStore>((set) => ({
  project: initialProject,
  selectedTableId: initialProject.tables[0]?.id,
  isDirty: false,
  dirtyScope: 'none',
  dirtyTableIds: [],
  undoStacks: {},
  redoStacks: {},

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
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, table.id),
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

      const touchesContent = Object.keys(patch).some((key) => key !== 'position');

      return {
        project: {
          ...state.project,
          tables,
        },
        ...(touchesContent ? captureUndo(state, tableId) : {}),
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
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
        undoStacks: dropTableStacks(state.undoStacks, tableId),
        redoStacks: dropTableStacks(state.redoStacks, tableId),
        ...markDirty('deleteTable', state.dirtyScope),
      };
    }),

  addColumn: (tableId) =>
    set((state) => ({
      ...captureUndo(state, tableId),
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
      dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
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
        ...captureUndo(state, tableId),
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
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
        ...captureUndo(state, tableId),
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('moveColumn', state.dirtyScope),
      };
    }),

  deleteColumn: (tableId, columnId) =>
    set((state) => ({
      ...captureUndo(state, tableId),
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
      dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
      ...markDirty('deleteColumn', state.dirtyScope),
    })),

  addRow: (tableId) => {
    const rowId = makeId('row');
    let added = false;

    set((state) => ({
      ...captureUndo(state, tableId),
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
      dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
      ...markDirty('addRow', state.dirtyScope),
    }));

    return added ? rowId : undefined;
  },

  insertRow: (tableId, rowIndex) => {
    const rowId = makeId('row');
    let inserted = false;

    set((state) => ({
      ...captureUndo(state, tableId),
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
      dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
      ...markDirty('insertRow', state.dirtyScope),
    }));

    return inserted ? rowId : undefined;
  },

  moveRow: (tableId, sourceIndex, targetIndex) => {
    let landedAt: number | undefined;

    set((state) => {
      let updated = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;
        if (sourceIndex < 0 || sourceIndex >= table.rows.length) return table;

        const clampedTarget = Math.max(0, Math.min(targetIndex, table.rows.length - 1));
        if (clampedTarget === sourceIndex) return table;

        const rows = [...table.rows];
        const [row] = rows.splice(sourceIndex, 1);
        rows.splice(clampedTarget, 0, row);
        updated = true;
        landedAt = clampedTarget;

        return { ...table, rows };
      });

      if (!updated) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...captureUndo(state, tableId),
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('moveRow', state.dirtyScope),
      };
    });

    return landedAt;
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
        ...captureUndo(state, tableId),
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('updateCell', state.dirtyScope),
      };
    }),

  deleteRow: (tableId, rowId) =>
    set((state) => ({
      ...captureUndo(state, tableId),
      project: {
        ...state.project,
        tables: state.project.tables.map((table) =>
          table.id === tableId
            ? { ...table, rows: table.rows.filter((row) => row._rowId !== rowId) }
            : table,
        ),
      },
      dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
      ...markDirty('deleteRow', state.dirtyScope),
    })),

  deleteRows: (tableId, rowIds) =>
    set((state) => {
      const rowIdSet = new Set(rowIds);

      return {
        ...captureUndo(state, tableId),
        project: {
          ...state.project,
          tables: state.project.tables.map((table) =>
            table.id === tableId
              ? { ...table, rows: table.rows.filter((row) => !rowIdSet.has(row._rowId)) }
              : table,
          ),
        },
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('deleteRows', state.dirtyScope),
      };
    }),

  appendRows: (tableId, rows, replaceExisting = false) =>
    set((state) => {
      let appended = false;
      const tables = state.project.tables.map((table) => {
        if (table.id !== tableId) return table;
        appended = true;

        const importedRows = rows.map((row) =>
          createDefaultRow(table, row._rowId || makeId('row'), row.values),
        );
        const replacements = new Map(importedRows.map((row) => [row._rowId, row]));
        const existingRowIds = new Set(table.rows.map((row) => row._rowId));

        return {
          ...table,
          rows: replaceExisting
            ? [
                ...table.rows.map((row) => replacements.get(row._rowId) ?? row),
                ...importedRows.filter((row) => !existingRowIds.has(row._rowId)),
              ]
            : [...table.rows, ...importedRows],
        };
      });

      if (!appended) return state;

      return {
        project: {
          ...state.project,
          tables,
        },
        ...captureUndo(state, tableId),
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('appendRows', state.dirtyScope),
      };
    }),

  beginUndoBatch: (tableId) => {
    undoBatch.active = true;
    set((state) => {
      const table = state.project.tables.find((item) => item.id === tableId);
      if (!table) return state;

      const undoStack = [
        ...(state.undoStacks[tableId] ?? []),
        { snapshot: snapshotTable(table) },
      ].slice(-UNDO_STACK_LIMIT);

      return {
        undoStacks: { ...state.undoStacks, [tableId]: undoStack },
        redoStacks: { ...state.redoStacks, [tableId]: [] },
      };
    });
  },

  endUndoBatch: () => {
    undoBatch.active = false;
  },

  undo: (tableId) =>
    set((state) => {
      const undoStack = state.undoStacks[tableId] ?? [];
      const entry = undoStack[undoStack.length - 1];
      const table = state.project.tables.find((item) => item.id === tableId);
      if (!entry || !table) return state;

      return {
        project: {
          ...state.project,
          tables: state.project.tables.map((item) =>
            item.id === tableId ? { ...item, ...entry.snapshot } : item,
          ),
        },
        undoStacks: { ...state.undoStacks, [tableId]: undoStack.slice(0, -1) },
        redoStacks: {
          ...state.redoStacks,
          [tableId]: [...(state.redoStacks[tableId] ?? []), { snapshot: snapshotTable(table) }],
        },
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('undo', state.dirtyScope),
      };
    }),

  redo: (tableId) =>
    set((state) => {
      const redoStack = state.redoStacks[tableId] ?? [];
      const entry = redoStack[redoStack.length - 1];
      const table = state.project.tables.find((item) => item.id === tableId);
      if (!entry || !table) return state;

      return {
        project: {
          ...state.project,
          tables: state.project.tables.map((item) =>
            item.id === tableId ? { ...item, ...entry.snapshot } : item,
          ),
        },
        undoStacks: {
          ...state.undoStacks,
          [tableId]: [...(state.undoStacks[tableId] ?? []), { snapshot: snapshotTable(table) }],
        },
        redoStacks: { ...state.redoStacks, [tableId]: redoStack.slice(0, -1) },
        dirtyTableIds: mergeDirtyTableIds(state.dirtyTableIds, tableId),
        ...markDirty('redo', state.dirtyScope),
      };
    }),

  loadProject: (project) =>
    set({
      project,
      selectedTableId: project.tables[0]?.id,
      isDirty: false,
      dirtyScope: 'none',
      dirtyTableIds: [],
      undoStacks: {},
      redoStacks: {},
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
        dirtyTableIds: [],
        undoStacks: {},
        redoStacks: {},
      };
    }),

  markClean: () => set({ isDirty: false, dirtyScope: 'none', dirtyTableIds: [] }),

  newProject: () =>
    set({
      project: createEmptyProject(),
      selectedTableId: undefined,
      isDirty: false,
      dirtyScope: 'none',
      dirtyTableIds: [],
      undoStacks: {},
      redoStacks: {},
    }),
}));
