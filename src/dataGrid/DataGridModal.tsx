import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor as GlideDataEditor,
  GridCellKind,
  type CellClickedEventArgs,
  type DataEditorProps,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type ProvideEditorCallback,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import type { ConfigColumn, ConfigTable, ProjectFile, ValidationIssue } from '../model/types';
import type { Translator } from '../i18n';
import { useEditorStore } from '../store/editorStore';
import { formatRefOptionLabel } from '../model/schemaUtils';
import TableInspector from '../inspector/TableInspector';
import ContextMenu, { type ContextMenuItem } from '../contextMenu/ContextMenu';

type DataGridModalProps = {
  open: boolean;
  table?: ConfigTable;
  project: ProjectFile;
  issues: ValidationIssue[];
  t: Translator;
  onClose(): void;
  onOpenTable(tableId: string): void;
};

type ChoiceCellData = {
  value: unknown;
  display: string;
  options: Array<{ key: string; label: string; value: unknown }>;
};

const GHOST_ROW_COUNT = 16;
const DEFAULT_COLUMN_WIDTH = 120;

type GridMenuState = {
  x: number;
  y: number;
  colIndex: number;
  rowIndex: number;
};

type PasteHandler = (target: Item, values: readonly (readonly string[])[]) => boolean;
type PasteValues = readonly (readonly string[])[];

const toInputValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
};

const parseNumber = (value: string) => (value.trim() === '' ? '' : Number(value));

const valueKey = (value: unknown) => JSON.stringify([typeof value, value]);

const emptySelection = (): GridSelection => ({
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
});

const columnWidthStorageKey = (tableId: string) => `cfggraph:column-widths:${tableId}`;

const defaultColumnWidth = (column: ConfigColumn) =>
  Math.max(DEFAULT_COLUMN_WIDTH, Math.min(260, (column.name || column.id).length * 10 + 64));

const readColumnWidths = (tableId: string): Record<string, number> => {
  try {
    const raw = window.localStorage.getItem(columnWidthStorageKey(tableId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
};

const writeColumnWidths = (tableId: string, widths: Record<string, number>) => {
  try {
    window.localStorage.setItem(columnWidthStorageKey(tableId), JSON.stringify(widths));
  } catch {
    // Local persistence is a convenience; ignore quota/private-mode failures.
  }
};

const parsePastedValue = (column: ConfigColumn, rawValue: string): unknown => {
  const value = rawValue.trim();
  if (value === '') return '';

  if (column.type === 'int') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : rawValue;
  }

  if (column.type === 'float') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : rawValue;
  }

  if (column.type === 'bool') {
    const normalized = value.toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return rawValue;
  }

  if (column.type === 'json') {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }

  return rawValue;
};

const splitPastedLines = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const normalizePasteValues = (values: PasteValues): string[][] => {
  const isSingleColumnPaste = values.length > 0 && values.every((row) => row.length <= 1);
  if (!isSingleColumnPaste) return values.map((row) => [...row]);

  const hasLineBreaks = values.some((row) => /[\r\n]/.test(row[0] ?? ''));
  const hasBlankRows = values.some((row) => (row[0] ?? '').trim() === '');
  if (!hasLineBreaks && !hasBlankRows) return values.map((row) => [...row]);

  const lines = values.flatMap((row) => splitPastedLines(row[0] ?? ''));
  return lines.length > 0 ? lines.map((line) => [line]) : values.map((row) => [...row]);
};

const optionCellData = (column: ConfigColumn, project: ProjectFile) => {
  if (column.type === 'enum') {
    return (column.enumValues ?? []).map((value) => ({
      label: value,
      value,
      key: valueKey(value),
    }));
  }

  if (column.type !== 'ref') return [];

  const targetTable = project.tables.find((table) => table.id === column.ref?.tableId);
  const targetColumn = targetTable?.columns.find((field) => field.id === column.ref?.columnId);
  if (!targetTable || !targetColumn) return [];

  return targetTable.rows
    .map((row) => ({
      label: formatRefOptionLabel(targetTable, targetColumn, row),
      value: row.values[targetColumn.id],
      key: valueKey(row.values[targetColumn.id]),
    }))
    .filter((item) => item.value !== undefined && item.value !== null && item.value !== '');
};

function ChoiceEditor({
  value,
  onChange,
  onFinishedEditing,
}: {
  value: GridCell;
  onChange(newValue: GridCell): void;
  onFinishedEditing(newValue?: GridCell): void;
}) {
  const [draftCell, setDraftCell] = useState(value);
  const [changed, setChanged] = useState(false);

  if (draftCell.kind !== GridCellKind.Custom) return null;

  const data = draftCell.data as ChoiceCellData;

  return (
    <select
      autoFocus
      className="glide-choice-editor"
      value={valueKey(data.value)}
      onBlur={() => onFinishedEditing(changed ? draftCell : undefined)}
      onChange={(event) => {
        const selected = data.options.find((item) => item.key === event.target.value);
        const nextValue = selected?.value ?? '';
        const nextCell: GridCell = {
          ...draftCell,
          copyData: toInputValue(nextValue),
          data: { ...data, value: nextValue },
        };
        setDraftCell(nextCell);
        setChanged(true);
        onChange(nextCell);
        onFinishedEditing(nextCell);
      }}
    >
      <option value={valueKey('')}></option>
      {data.options.map((option, index) => (
        <option key={`${option.key}-${index}`} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function DataGridModal({
  open,
  table,
  project,
  issues,
  t,
  onClose,
  onOpenTable,
}: DataGridModalProps) {
  const addRow = useEditorStore((state) => state.addRow);
  const insertRow = useEditorStore((state) => state.insertRow);
  const deleteRow = useEditorStore((state) => state.deleteRow);
  const deleteRows = useEditorStore((state) => state.deleteRows);
  const updateCell = useEditorStore((state) => state.updateCell);
  const gridRef = useRef<DataEditorRef>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<GridSelection>(emptySelection);
  const [showSearch, setShowSearch] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [menu, setMenu] = useState<GridMenuState>();
  const gridRowCount = table ? table.rows.length + GHOST_ROW_COUNT : 0;

  useEffect(() => {
    setSelection(emptySelection());
    setMenu(undefined);
    setShowSearch(false);
    setSearchStatus('');
    setColumnWidths(table ? readColumnWidths(table.id) : {});
  }, [table?.id]);

  const columns = useMemo<readonly GridColumn[]>(
    () =>
      table?.columns.map((column) => ({
        id: column.id,
        title: `${column.name || column.id}${column.primary ? ' PK' : ''}`,
        width: columnWidths[column.id] ?? defaultColumnWidth(column),
      })) ?? [],
    [columnWidths, table],
  );

  const errorCells = useMemo(
    () =>
      new Set(
        issues
          .filter((issue) => issue.tableId === table?.id && issue.rowId && issue.columnId)
          .map((issue) => `${issue.rowId}:${issue.columnId}`),
      ),
    [issues, table?.id],
  );

  const getSelectedRowIndexes = useCallback(() => {
    if (!table) return [];
    const indexes = new Set<number>();

    for (const rowIndex of selection.rows) {
      if (rowIndex >= 0 && rowIndex < table.rows.length) indexes.add(rowIndex);
    }

    const currentRange = selection.current?.range;
    if (currentRange) {
      const start = Math.max(0, currentRange.y);
      const end = Math.min(table.rows.length, currentRange.y + currentRange.height);
      for (let index = start; index < end; index += 1) {
        indexes.add(index);
      }
    }

    return [...indexes].sort((left, right) => left - right);
  }, [selection, table]);

  const getCellContent = useCallback(
    ([col, rowIndex]: Item): GridCell => {
      const column = table?.columns[col];
      const row = table?.rows[rowIndex];
      if (!table || !column) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      }

      const value = row?.values[column.id] ?? '';
      const hasError = row ? errorCells.has(`${row._rowId}:${column.id}`) : false;
      const themeOverride = hasError
        ? { bgCell: '#fff1ed', textDark: '#9a3412' }
        : row
          ? undefined
          : { bgCell: '#fbfcfe', textLight: '#cbd5e1' };

      if (column.type === 'bool') {
        return {
          kind: GridCellKind.Boolean,
          data: Boolean(value),
          allowOverlay: false,
          themeOverride,
        };
      }

      if (column.type === 'int' || column.type === 'float') {
        return {
          kind: GridCellKind.Number,
          data: typeof value === 'number' ? value : undefined,
          displayData: toInputValue(value),
          allowOverlay: true,
          themeOverride,
        };
      }

      if (column.type === 'enum' || column.type === 'ref') {
        const options = optionCellData(column, project);
        const selected = options.find((option) => valueKey(option.value) === valueKey(value));

        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: toInputValue(value),
          data: {
            kind: 'choice-cell',
            value,
            display: selected?.label ?? toInputValue(value),
            options,
          },
          themeOverride,
        };
      }

      return {
        kind: column.type === 'json' ? GridCellKind.Markdown : GridCellKind.Text,
        data: toInputValue(value),
        displayData: toInputValue(value),
        allowOverlay: true,
        themeOverride,
      };
    },
    [errorCells, project, table],
  );

  const onCellEdited = useCallback(
    ([col, rowIndex]: Item, newValue: EditableGridCell) => {
      const column = table?.columns[col];
      const row = table?.rows[rowIndex];
      if (!table || !column) return;

      let rowId = row?._rowId;
      if (!rowId) {
        for (let index = table.rows.length; index <= rowIndex; index += 1) {
          rowId = addRow(table.id);
        }
      }
      if (!rowId) return;

      if (newValue.kind === GridCellKind.Boolean) {
        updateCell(table.id, rowId, column.id, Boolean(newValue.data));
        return;
      }

      if (newValue.kind === GridCellKind.Number) {
        updateCell(table.id, rowId, column.id, newValue.data ?? '');
        return;
      }

      if (newValue.kind === GridCellKind.Custom) {
        updateCell(
          table.id,
          rowId,
          column.id,
          (newValue.data as { value?: unknown }).value ?? '',
        );
        return;
      }

      if (newValue.kind === GridCellKind.Text || newValue.kind === GridCellKind.Markdown) {
        updateCell(
          table.id,
          rowId,
          column.id,
          column.type === 'int' || column.type === 'float' ? parseNumber(newValue.data) : newValue.data,
        );
      }
    },
    [addRow, table, updateCell],
  );

  const onCellsEdited = useCallback<NonNullable<DataEditorProps['onCellsEdited']>>(
    (items) => {
      for (const item of items) {
        onCellEdited(item.location, item.value);
      }

      return true;
    },
    [onCellEdited],
  );

  const addRowAtEnd = useCallback(() => {
    if (!table) return;
    const rowIndex = table.rows.length;
    addRow(table.id);
    setSelection({
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
      current: {
        cell: [0, rowIndex],
        range: { x: 0, y: rowIndex, width: 1, height: 1 },
        rangeStack: [],
      },
    });
    requestAnimationFrame(() => {
      gridRef.current?.scrollTo(0, rowIndex, 'both', 40, 40);
      gridRef.current?.focus();
    });
  }, [addRow, table]);

  const insertRowAt = useCallback(
    (rowIndex: number) => {
      if (!table) return;
      const insertAt = Math.max(0, Math.min(rowIndex, table.rows.length));
      insertRow(table.id, insertAt);
      setSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
        current: {
          cell: [0, insertAt],
          range: { x: 0, y: insertAt, width: 1, height: 1 },
          rangeStack: [],
        },
      });
      requestAnimationFrame(() => {
        gridRef.current?.scrollTo(0, insertAt, 'both', 40, 40);
        gridRef.current?.focus();
      });
    },
    [insertRow, table],
  );

  const deleteSelectedRows = useCallback(() => {
    if (!table) return;

    const rowIndexes = getSelectedRowIndexes();
    const rowIds = rowIndexes
      .map((rowIndex) => table.rows[rowIndex]?._rowId)
      .filter((rowId): rowId is string => Boolean(rowId));
    if (rowIds.length === 0) return;

    deleteRows(table.id, rowIds);
    setSelection(emptySelection());
  }, [deleteRows, getSelectedRowIndexes, table]);

  const copyRowsAsJson = useCallback(async (rowIndexes: number[]) => {
    if (!table) return;

    const rows = rowIndexes
      .map((rowIndex) => table.rows[rowIndex])
      .filter(Boolean)
      .map((row) =>
        Object.fromEntries(
          table.columns.map((column) => [column.name || column.id, row.values[column.id]]),
        ),
      );

    if (rows.length === 0) return;
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
  }, [table]);

  const onPaste = useCallback<PasteHandler>(
    ([targetCol, targetRow], values) => {
      if (!table) return false;

      const rowIds = [...table.rows.map((row) => row._rowId)];
      const pasteValues = normalizePasteValues(values);

      for (let rowOffset = 0; rowOffset < pasteValues.length; rowOffset += 1) {
        const rowIndex = targetRow + rowOffset;
        if (rowIndex < 0) continue;

        while (rowIds.length <= rowIndex) {
          const rowId = addRow(table.id);
          if (!rowId) return false;
          rowIds.push(rowId);
        }

        const rowId = rowIds[rowIndex];
        const rowValues = pasteValues[rowOffset];

        for (let colOffset = 0; colOffset < rowValues.length; colOffset += 1) {
          const column = table.columns[targetCol + colOffset];
          if (!column) continue;
          updateCell(table.id, rowId, column.id, parsePastedValue(column, rowValues[colOffset]));
        }
      }

      return false;
    },
    [addRow, table, updateCell],
  );

  const onDelete = useCallback<NonNullable<DataEditorProps['onDelete']>>(
    (nextSelection) => {
      if (!table) return false;

      const rows = [...nextSelection.rows].filter(
        (rowIndex) => rowIndex >= 0 && rowIndex < table.rows.length,
      );
      if (rows.length > 0 && !nextSelection.current) {
        deleteRows(
          table.id,
          rows
            .map((rowIndex) => table.rows[rowIndex]?._rowId)
            .filter((rowId): rowId is string => Boolean(rowId)),
        );
        return false;
      }

      const range = nextSelection.current?.range;
      if (!range) return false;

      for (let y = range.y; y < range.y + range.height; y += 1) {
        const row = table.rows[y];
        if (!row) continue;

        for (let x = range.x; x < range.x + range.width; x += 1) {
          const column = table.columns[x];
          if (!column) continue;
          updateCell(table.id, row._rowId, column.id, '');
        }
      }

      return false;
    },
    [deleteRows, table, updateCell],
  );

  const onColumnResize = useCallback<NonNullable<DataEditorProps['onColumnResize']>>(
    (column, newSize) => {
      if (!table || !column.id) return;

      setColumnWidths((current) => {
        const next = { ...current, [column.id as string]: Math.round(newSize) };
        writeColumnWidths(table.id, next);
        return next;
      });
    },
    [table],
  );

  const openCellMenu = useCallback((cell: Item, event: CellClickedEventArgs) => {
    event.preventDefault();
    setMenu({
      colIndex: cell[0],
      rowIndex: cell[1],
      x: event.bounds.x + event.localEventX,
      y: event.bounds.y + event.localEventY,
    });
  }, []);

  const uppercaseCells = useCallback((cells: Item[]) => {
    if (!table) return;

    for (const [colIndex, rowIndex] of cells) {
      const column = table.columns[colIndex];
      const row = table.rows[rowIndex];
      if (!column || !row || column.type !== 'string') continue;

      const value = row.values[column.id];
      if (typeof value !== 'string') continue;

      const nextValue = value.toUpperCase();
      if (nextValue !== value) updateCell(table.id, row._rowId, column.id, nextValue);
    }
  }, [table, updateCell]);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!table || !menu) return [];

    const hasExistingRow = menu.rowIndex >= 0 && menu.rowIndex < table.rows.length;
    const selectedRows = getSelectedRowIndexes();
    const selectedRowCount = selectedRows.length;
    const selectedIncludesMenuRow = selectedRows.includes(menu.rowIndex);
    const actionRowIndexes =
      selectedRowCount > 1 && selectedIncludesMenuRow
        ? selectedRows
        : hasExistingRow
          ? [menu.rowIndex]
          : [];
    const deleteLabel =
      actionRowIndexes.length > 1
        ? t('deleteRowsCount', { count: actionRowIndexes.length })
        : t('deleteRow');
    const selectedRanges = selection.current
      ? [selection.current.range, ...(selection.current.rangeStack ?? [])]
      : [];
    const menuCellIsSelected =
      menu.colIndex >= 0 &&
      selectedRanges.some(
        (range) =>
          menu.colIndex >= range.x &&
          menu.colIndex < range.x + range.width &&
          menu.rowIndex >= range.y &&
          menu.rowIndex < range.y + range.height,
      );
    const uppercaseTargetMap = new Map<string, Item>();
    const addUppercaseTarget = (colIndex: number, rowIndex: number) => {
      const column = table.columns[colIndex];
      const row = table.rows[rowIndex];
      if (!column || !row || column.type !== 'string') return;
      if (typeof row.values[column.id] !== 'string') return;
      uppercaseTargetMap.set(`${colIndex}:${rowIndex}`, [colIndex, rowIndex]);
    };

    if (selectedRanges.length > 0 && menuCellIsSelected) {
      for (const range of selectedRanges) {
        const startCol = Math.max(0, range.x);
        const endCol = Math.min(table.columns.length, range.x + range.width);
        const startRow = Math.max(0, range.y);
        const endRow = Math.min(table.rows.length, range.y + range.height);

        for (let rowIndex = startRow; rowIndex < endRow; rowIndex += 1) {
          for (let colIndex = startCol; colIndex < endCol; colIndex += 1) {
            addUppercaseTarget(colIndex, rowIndex);
          }
        }
      }
    } else if (selectedRowCount > 0 && selectedIncludesMenuRow) {
      for (const rowIndex of selectedRows) {
        for (let colIndex = 0; colIndex < table.columns.length; colIndex += 1) {
          addUppercaseTarget(colIndex, rowIndex);
        }
      }
    } else if (hasExistingRow && menu.colIndex >= 0) {
      addUppercaseTarget(menu.colIndex, menu.rowIndex);
    } else if (hasExistingRow) {
      for (let colIndex = 0; colIndex < table.columns.length; colIndex += 1) {
        addUppercaseTarget(colIndex, menu.rowIndex);
      }
    }

    const uppercaseTargets = [...uppercaseTargetMap.values()];

    return [
      {
        id: 'row-label',
        type: 'label',
        label: hasExistingRow ? t('rowLabel', { index: menu.rowIndex + 1 }) : t('blankRow'),
      },
      {
        id: 'insert-above',
        label: t('insertRowAbove'),
        onSelect: () => insertRowAt(menu.rowIndex),
      },
      {
        id: 'insert-below',
        label: t('insertRowBelow'),
        onSelect: () => insertRowAt(menu.rowIndex + 1),
      },
      {
        id: 'add-row-end',
        label: t('addRowToEnd'),
        onSelect: addRowAtEnd,
      },
      {
        id: 'uppercase',
        label: t('uppercase'),
        disabled: uppercaseTargets.length === 0,
        onSelect: () => uppercaseCells(uppercaseTargets),
      },
      { id: 'row-separator-copy', type: 'separator' },
      {
        id: 'copy-selection',
        label: actionRowIndexes.length > 1 ? t('copySelectedRowsJson') : t('copyRowJson'),
        shortcut: 'Ctrl+C',
        disabled: actionRowIndexes.length === 0,
        onSelect: () => copyRowsAsJson(actionRowIndexes),
      },
      { id: 'row-separator-danger', type: 'separator' },
      {
        id: 'delete-row',
        label: deleteLabel,
        shortcut: 'Del',
        danger: true,
        disabled: actionRowIndexes.length === 0,
        onSelect: () => {
          if (actionRowIndexes.length > 1) {
            deleteSelectedRows();
            return;
          }

          const row = table.rows[actionRowIndexes[0]];
          if (row) deleteRow(table.id, row._rowId);
        },
      },
    ];
  }, [
    addRowAtEnd,
    copyRowsAsJson,
    deleteRow,
    deleteSelectedRows,
    getSelectedRowIndexes,
    insertRowAt,
    menu,
    selection,
    t,
    table,
    uppercaseCells,
  ]);

  const primaryColumnIndex = useMemo(
    () => table?.columns.findIndex((column) => column.primary) ?? -1,
    [table],
  );
  const freezeColumns = primaryColumnIndex === 0 ? 1 : 0;
  const tableIssueCount = table ? issues.filter((issue) => issue.tableId === table.id).length : 0;
  const selectedRowCount = getSelectedRowIndexes().length;

  const focusGridCell = useCallback(
    ([col, row]: Item) => {
      if (col < 0 || row < 0 || col >= columns.length || row >= gridRowCount) return;

      setSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
        current: {
          cell: [col, row],
          range: { x: col, y: row, width: 1, height: 1 },
          rangeStack: [],
        },
      });

      requestAnimationFrame(() => {
        gridRef.current?.scrollTo(col, row, 'both', 80, 80, {
          hAlign: 'center',
          vAlign: 'center',
        });
      });
    },
    [columns.length, gridRowCount],
  );

  const provideEditor = useMemo<ProvideEditorCallback<GridCell>>(
    () => (cell) => {
      if (cell.kind !== GridCellKind.Custom) return undefined;
      return {
        editor: ChoiceEditor,
        disablePadding: true,
        disableStyling: true,
      };
    },
    [],
  );

  const drawCell = useCallback(
    (
      args: Parameters<NonNullable<DataEditorProps['drawCell']>>[0],
      drawContent: () => void,
    ) => {
      if (args.cell.kind === GridCellKind.Custom) {
        const data = args.cell.data as { display?: string };
        args.ctx.fillStyle = args.highlighted ? args.theme.accentLight : args.theme.bgCell;
        args.ctx.fillRect(args.rect.x, args.rect.y, args.rect.width, args.rect.height);
        args.ctx.fillStyle = '#f8fafc';
        args.ctx.fillRect(args.rect.x + 1, args.rect.y + 1, args.rect.width - 2, args.rect.height - 2);
        args.ctx.fillStyle = args.theme.textDark;
        args.ctx.font = `${args.theme.baseFontStyle} ${args.theme.fontFamily}`;
        args.ctx.textBaseline = 'middle';
        args.ctx.fillText(data.display ?? '', args.rect.x + 8, args.rect.y + args.rect.height / 2);
        args.ctx.fillStyle = args.theme.textLight;
        args.ctx.beginPath();
        args.ctx.moveTo(args.rect.x + args.rect.width - 15, args.rect.y + args.rect.height / 2 - 2);
        args.ctx.lineTo(args.rect.x + args.rect.width - 7, args.rect.y + args.rect.height / 2 - 2);
        args.ctx.lineTo(args.rect.x + args.rect.width - 11, args.rect.y + args.rect.height / 2 + 3);
        args.ctx.closePath();
        args.ctx.fill();
        return;
      }

      drawContent();
    },
    [],
  );

  if (!open || !table) return null;

  return (
    <div
      className={`modal-backdrop ${isFullscreen ? 'is-fullscreen' : ''}`}
      role="presentation"
      onContextMenu={(event) => event.preventDefault()}
    >
      <section
        className={`data-modal ${isFullscreen ? 'is-fullscreen' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('edit')}
      >
        <div className="data-modal__header">
          <div>
            <h2>
              {table.name} {t('edit')}
            </h2>
            <span>
              {t('fieldsRows', { fields: table.columns.length, rows: table.rows.length })}
              {tableIssueCount > 0 ? ` / ${tableIssueCount}` : ''}
              {selectedRowCount > 0 ? ` / ${t('selectedRowsCount', { count: selectedRowCount })}` : ''}
              {searchStatus ? ` / ${searchStatus}` : ''}
            </span>
          </div>
          <div className="data-modal__actions">
            <button type="button" className="button" onClick={() => setShowSearch(true)} title="Ctrl+F">
              {t('search')}
            </button>
            <button
              type="button"
              className="icon-button icon-button--compact"
              onClick={() => setIsFullscreen((value) => !value)}
              aria-label={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
              title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
            >
              {isFullscreen ? '⇲' : '⛶'}
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
              ×
            </button>
          </div>
        </div>
        <div className="data-modal__body">
          <aside className="data-modal__side">
            <div className="data-modal__inspector">
              <TableInspector table={table} project={project} t={t} compact />
            </div>
            <section className="data-modal__issues">
              <div className="panel-heading">
                <h2>{t('issues')}</h2>
                <span>{issues.length}</span>
              </div>
              <div className="issue-list">
                {issues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    className={`issue-item issue-item--${issue.severity}`}
                    onClick={() => onOpenTable(issue.tableId)}
                  >
                    <span>{issue.severity === 'error' ? t('issueError') : t('issueWarning')}</span>
                    <p>{issue.message}</p>
                  </button>
                ))}
                {issues.length === 0 ? <p className="empty-copy">{t('noIssues')}</p> : null}
              </div>
            </section>
          </aside>
          <div className="data-modal__grid">
            <GlideDataEditor
              ref={gridRef}
              columns={columns}
              rows={gridRowCount}
              getCellContent={getCellContent}
              onCellEdited={onCellEdited}
              onCellsEdited={onCellsEdited}
              onPaste={onPaste}
              onDelete={onDelete}
              onColumnResize={onColumnResize}
              onCellContextMenu={openCellMenu}
              gridSelection={selection}
              onGridSelectionChange={(nextSelection) => setSelection(nextSelection)}
              provideEditor={provideEditor}
              drawCell={drawCell}
              showSearch={showSearch}
              onSearchClose={() => {
                setShowSearch(false);
                setSearchStatus('');
              }}
              onSearchResultsChanged={(results, navIndex) => {
                const activeCell = results[navIndex];
                if (activeCell) focusGridCell(activeCell);

                setSearchStatus(
                  results.length > 0 && navIndex >= 0
                    ? t('searchPosition', { index: navIndex + 1, count: results.length })
                    : results.length > 0
                      ? t('searchCount', { count: results.length })
                      : '',
                );
              }}
              cellActivationBehavior="double-click"
              editOnType={false}
              rowMarkers="clickable-number"
              rowSelectionMode="multi"
              rangeSelect="multi-rect"
              freezeColumns={freezeColumns}
              fillHandle
              rowHeight={30}
              headerHeight={32}
              smoothScrollX
              smoothScrollY
              width="100%"
              height="100%"
              getCellsForSelection
              theme={{
                accentColor: '#2563eb',
                accentLight: '#dbeafe',
                bgHeader: '#eef2f5',
                bgCell: '#ffffff',
                borderColor: '#d5dce3',
                fontFamily:
                  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                baseFontStyle: '12px',
                headerFontStyle: '600 12px',
                editorFontSize: '12px',
              }}
            />
          </div>
        </div>
      </section>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={contextMenuItems}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
