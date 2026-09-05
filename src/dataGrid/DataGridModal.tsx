import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor as GlideDataEditor,
  GridCellKind,
  type CellClickedEventArgs,
  type CustomCell,
  type CustomRenderer,
  type DataEditorProps,
  type DataEditorRef,
  type GridCell,
  type GridColumn,
  type GridMouseEventArgs,
  type GridSelection,
  type HeaderClickedEventArgs,
  type Item,
  type ProvideEditorCallback,
  type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import type { ConfigColumn, ConfigTable, ProjectFile, ValidationIssue } from '../model/types';
import type { Translator } from '../i18n';
import type { ResolvedTheme } from '../theme';
import { useEditorStore } from '../store/editorStore';
import { formatRefOptionLabel } from '../model/schemaUtils';
import TableInspector from '../inspector/TableInspector';
import ContextMenu, { type ContextMenuItem } from '../contextMenu/ContextMenu';
import WindowFrame from '../window/WindowFrame';
import { useWindowManager } from '../window/WindowManager';
import TablePreviewModal from './TablePreviewModal';
import { filterChoiceOptions, type ChoiceOption } from './choiceSearch';
import { referenceValueKey, resolveReferenceTarget } from './referenceNavigation';
import { resolveGridShortcut } from './gridShortcuts';
import {
  coerceGridValue,
  computeFillPatternEdits,
  editedCellValue,
  ensureRowIdsForEdits,
  fillValueModeForColumn,
  normalizePasteValues,
  selectedCellItems,
  selectedRowIndexes,
  selectionRanges,
  toInputValue,
  type GridEdit,
} from './gridEditing';

export type DataGridFocusRequest = {
  tableId: string;
  rowId: string;
  columnId: string;
  sequence: number;
};

type DataGridModalProps = {
  open: boolean;
  /** 任务栏中的窗口唯一 ID（同一张表的编辑窗口保持稳定）。 */
  windowId?: string;
  table?: ConfigTable;
  project: ProjectFile;
  issues: ValidationIssue[];
  theme: ResolvedTheme;
  t: Translator;
  focusRequest?: DataGridFocusRequest;
  onClose(): void;
  onOpenTable(tableId: string, focus?: { rowId: string; columnId: string }): void;
};

type ChoiceCellData = {
  kind: 'choice-cell';
  value: unknown;
  display: string;
  options: ChoiceOption[];
  searchPlaceholder: string;
  noMatchesLabel: string;
  clearLabel: string;
  onNavigate?: () => void;
};

type ChoiceCell = CustomCell<ChoiceCellData>;

const GHOST_ROW_COUNT = 16;
const DEFAULT_COLUMN_WIDTH = 120;

type CellMenuState = {
  x: number;
  y: number;
  colIndex: number;
  rowIndex: number;
};

type HeaderMenuState = {
  x: number;
  y: number;
  colIndex: number;
};

type RemarkEditorState = {
  columnId: string;
  draft: string;
};

type HeaderTooltipState = {
  x: number;
  y: number;
  text: string;
};

type PasteHandler = (target: Item, values: readonly (readonly string[])[]) => boolean;

/** Glide DataGrid 的行拖拽回调未包含在官方 Props 类型中，但运行时支持。 */
type RowMoveProps = {
  onRowMoved: (startIndex: number, endIndex: number) => void;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

const columnRemark = (column: ConfigColumn) => column.remark?.trim() ?? '';

const shortRemark = (remark: string) => {
  const singleLine = remark.replace(/\s+/g, ' ').trim();
  return singleLine.length > 18 ? `${singleLine.slice(0, 18)}...` : singleLine;
};

const ellipsizeCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  if (ellipsisWidth > maxWidth) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}${ellipsis}`).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${text.slice(0, low)}${ellipsis}`;
};

const drawRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x + radius, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const emptySelection = (): GridSelection => ({
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
});

const CELL_FLASH_MS = 450;
const CELL_FLASH_COUNT = 2;
const CELL_FLASH_LIGHT = '#93c5fd';
const CELL_FLASH_DARK = '#1e3a5f';
const CELL_FLASH_ACCENT_LIGHT = '#60a5fa';
const CELL_FLASH_ACCENT_DARK = '#3b82f6';

const mixHexColors = (from: string, to: string, ratio: number) => {
  const channel = (hex: string, offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const mix = (fromChannel: number, toChannel: number) =>
    Math.round(fromChannel + (toChannel - fromChannel) * ratio);
  const channels = [1, 3, 5]
    .map((offset) => mix(channel(from, offset), channel(to, offset)))
    .map((value) => value.toString(16).padStart(2, '0'));
  return `#${channels.join('')}`;
};

const columnWidthStorageKey = (tableId: string) => `configra:column-widths:${tableId}`;

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

const optionCellData = (column: ConfigColumn, project: ProjectFile) => {
  if (column.type === 'enum') {
    return (column.enumValues ?? []).map((value) => ({
      label: value,
      value,
      key: referenceValueKey(value),
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
      key: referenceValueKey(row.values[targetColumn.id]),
    }))
    .filter((item) => item.value !== undefined && item.value !== null && item.value !== '');
};

function ChoiceEditor({
  value,
  initialValue,
  onChange,
  onFinishedEditing,
}: {
  value: GridCell;
  initialValue?: string;
  onChange(newValue: GridCell): void;
  onFinishedEditing(newValue?: GridCell): void;
}) {
  const [query, setQuery] = useState(initialValue ?? '');
  const [activeIndex, setActiveIndex] = useState(0);
  const optionsRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const choiceValue = value as ChoiceCell;
  const data = choiceValue.data;
  const selectedKey = referenceValueKey(data.value);
  const filteredOptions = useMemo(
    () => filterChoiceOptions(data.options, query),
    [data.options, query],
  );

  useEffect(() => {
    const selectedIndex = filteredOptions.findIndex((option) => option.key === selectedKey);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filteredOptions, selectedKey]);

  useEffect(() => {
    optionsRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const finishWithOption = (option?: ChoiceOption) => {
    const nextValue = option?.value ?? '';
    const nextCell: ChoiceCell = {
      ...choiceValue,
      copyData: toInputValue(nextValue),
      data: {
        ...data,
        value: nextValue,
        display: option?.label ?? '',
      },
    };
    onChange(nextCell);
    onFinishedEditing(nextCell);
  };

  return (
    <div
      className="choice-editor"
      onKeyDown={(event) => {
        if (event.key === 'Tab') return;
        event.stopPropagation();

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((current) =>
            Math.min(Math.max(0, filteredOptions.length - 1), current + 1),
          );
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((current) => Math.max(0, current - 1));
          return;
        }

        if (event.key === 'Home') {
          event.preventDefault();
          setActiveIndex(0);
          return;
        }

        if (event.key === 'End') {
          event.preventDefault();
          setActiveIndex(Math.max(0, filteredOptions.length - 1));
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          const option = filteredOptions[activeIndex];
          if (option) finishWithOption(option);
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          onFinishedEditing(undefined);
        }
      }}
    >
      <div className="choice-editor__search">
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={
            filteredOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
          }
          value={query}
          placeholder={data.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
        {data.value !== null && data.value !== undefined && data.value !== '' ? (
          <button
            type="button"
            className="choice-editor__clear"
            title={data.clearLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => finishWithOption()}
          >
            {data.clearLabel}
          </button>
        ) : null}
      </div>
      <div id={listboxId} ref={optionsRef} className="choice-editor__options" role="listbox">
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option, index) => {
            const selected = option.key === selectedKey;
            return (
              <button
                id={`${listboxId}-option-${index}`}
                key={`${option.key}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                data-option-index={index}
                className={`choice-editor__option ${index === activeIndex ? 'is-active' : ''} ${selected ? 'is-selected' : ''}`}
                title={option.label}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => finishWithOption(option)}
              >
                <span>{option.label}</span>
                {selected ? <span className="choice-editor__check">✓</span> : null}
              </button>
            );
          })
        ) : (
          <div className="choice-editor__empty">{data.noMatchesLabel}</div>
        )}
      </div>
    </div>
  );
}

const choiceCellRenderer: CustomRenderer<ChoiceCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell): cell is ChoiceCell =>
    (cell.data as { kind?: unknown } | undefined)?.kind === 'choice-cell',
  needsHover: (cell) => Boolean(cell.data.onNavigate),
  needsHoverPosition: true,
  onClick: ({ cell, posX, bounds, theme, preventDefault }) => {
    if (!cell.data.onNavigate) return undefined;

    const horizontalPadding = theme.cellHorizontalPadding;
    const dropdownWidth = 18;
    const navigateWidth = 22;
    const navigateRight = bounds.width - horizontalPadding - dropdownWidth;
    const navigateLeft = navigateRight - navigateWidth;
    if (posX < navigateLeft || posX > navigateRight) return undefined;

    preventDefault();
    cell.data.onNavigate();
    return undefined;
  },
  draw: ({ ctx, rect, theme, cell, hoverX, overrideCursor }) => {
    const horizontalPadding = theme.cellHorizontalPadding;
    const arrowWidth = 18;
    const navigateWidth = cell.data.onNavigate ? 22 : 0;
    const textWidth = Math.max(
      0,
      rect.width - horizontalPadding * 2 - arrowWidth - navigateWidth,
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    ctx.font = theme.baseFontFull;
    ctx.fillStyle = theme.textDark;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      ellipsizeCanvasText(ctx, cell.data.display, textWidth),
      rect.x + horizontalPadding,
      rect.y + rect.height / 2,
    );

    if (cell.data.onNavigate) {
      const navigateRight = rect.width - horizontalPadding - arrowWidth;
      const navigateLeft = navigateRight - navigateWidth;
      const isNavigateHovered =
        hoverX !== undefined && hoverX >= navigateLeft && hoverX <= navigateRight;
      if (isNavigateHovered) overrideCursor?.('pointer');

      const iconCenterX = rect.x + navigateLeft + navigateWidth / 2;
      const iconCenterY = rect.y + rect.height / 2;
      ctx.strokeStyle = isNavigateHovered ? theme.linkColor : theme.textLight;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(iconCenterX - 5, iconCenterY - 3);
      ctx.lineTo(iconCenterX - 5, iconCenterY + 5);
      ctx.lineTo(iconCenterX + 3, iconCenterY + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(iconCenterX - 1, iconCenterY + 1);
      ctx.lineTo(iconCenterX + 5, iconCenterY - 5);
      ctx.moveTo(iconCenterX + 1, iconCenterY - 5);
      ctx.lineTo(iconCenterX + 5, iconCenterY - 5);
      ctx.lineTo(iconCenterX + 5, iconCenterY - 1);
      ctx.stroke();
    }

    const arrowCenterX = rect.x + rect.width - horizontalPadding - 4;
    const arrowCenterY = rect.y + rect.height / 2;
    ctx.fillStyle = theme.textLight;
    ctx.beginPath();
    ctx.moveTo(arrowCenterX - 4, arrowCenterY - 2);
    ctx.lineTo(arrowCenterX + 4, arrowCenterY - 2);
    ctx.lineTo(arrowCenterX, arrowCenterY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
};

const choiceCellRenderers = [choiceCellRenderer];

export default function DataGridModal({
  open,
  windowId,
  table,
  project,
  issues,
  theme,
  t,
  focusRequest,
  onClose,
  onOpenTable,
}: DataGridModalProps) {
  const isDarkTheme = theme === 'dark';
  const { isFront } = useWindowManager();
  const addRow = useEditorStore((state) => state.addRow);
  const insertRow = useEditorStore((state) => state.insertRow);
  const moveRow = useEditorStore((state) => state.moveRow);
  const deleteRows = useEditorStore((state) => state.deleteRows);
  const updateColumn = useEditorStore((state) => state.updateColumn);
  const updateCell = useEditorStore((state) => state.updateCell);
  const undoTable = useEditorStore((state) => state.undo);
  const redoTable = useEditorStore((state) => state.redo);
  const beginUndoBatch = useEditorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useEditorStore((state) => state.endUndoBatch);
  const isTableDirty = useEditorStore((state) =>
    table ? state.dirtyTableIds.includes(table.id) : false,
  );
  const undoDepth = useEditorStore((state) =>
    table ? state.undoStacks[table.id]?.length ?? 0 : 0,
  );
  const redoDepth = useEditorStore((state) =>
    table ? state.redoStacks[table.id]?.length ?? 0 : 0,
  );
  const gridRef = useRef<DataEditorRef>(null);
  const handledFocusSequenceRef = useRef<number>();
  const hoverTimeoutRef = useRef<number>();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<GridSelection>(emptySelection);
  const [showSearch, setShowSearch] = useState(false);
  const [showTablePreview, setShowTablePreview] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [cellMenu, setCellMenu] = useState<CellMenuState>();
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuState>();
  const [remarkEditor, setRemarkEditor] = useState<RemarkEditorState>();
  const [headerTooltip, setHeaderTooltip] = useState<HeaderTooltipState>();
  const [cellFlash, setCellFlash] = useState<{ col: number; row: number; startedAt: number }>();
  const [cellFlashRatio, setCellFlashRatio] = useState(0);
  const gridRowCount = table ? table.rows.length + GHOST_ROW_COUNT : 0;

  useEffect(() => {
    // StrictMode 会在开发模式重复执行挂载 effect；重置后需要允许 focusRequest 重新应用高亮。
    handledFocusSequenceRef.current = undefined;
    setSelection(emptySelection());
    setCellMenu(undefined);
    setHeaderMenu(undefined);
    setRemarkEditor(undefined);
    setHeaderTooltip(undefined);
    setShowSearch(false);
    setShowTablePreview(false);
    setSearchStatus('');
    setColumnWidths(table ? readColumnWidths(table.id) : {});
  }, [table?.id]);

  useEffect(() => {
    if (!cellFlash) return;

    let timer: number | undefined;
    const step = () => {
      const elapsed = Date.now() - cellFlash.startedAt;
      if (elapsed >= CELL_FLASH_MS * CELL_FLASH_COUNT) {
        setCellFlash(undefined);
        setCellFlashRatio(0);
        return;
      }
      setCellFlashRatio(1 - (elapsed % CELL_FLASH_MS) / CELL_FLASH_MS);
      timer = window.setTimeout(step, 50);
    };
    step();

    return () => window.clearTimeout(timer);
  }, [cellFlash]);

  useEffect(
    () => () => {
      if (hoverTimeoutRef.current !== undefined) window.clearTimeout(hoverTimeoutRef.current);
    },
    [],
  );

  // Esc 关闭当前行编辑窗口；单元格编辑（Glide/ChoiceEditor 自行消费）、右键菜单、
  // 备注编辑和表格预览等叠层优先处理 Esc，且仅在本窗口处于前台时整体关闭。
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      if (cellMenu || headerMenu || remarkEditor || showTablePreview) return;
      if (isEditableTarget(event.target)) return;
      if (windowId && !isFront(windowId)) return;
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cellMenu, headerMenu, isFront, onClose, open, remarkEditor, showTablePreview, windowId]);

  // 撤销/重做：Glide 不消费 Ctrl+Z，画布聚焦时按键会冒泡到 window，统一在这里处理；
  // 焦点在输入框时让位给浏览器原生文本撤销，且仅本窗口处于前台时生效。
  useEffect(() => {
    if (!open || !table) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
      if (!isUndo && !isRedo) return;
      if (isEditableTarget(event.target)) return;
      if (windowId && !isFront(windowId)) return;

      event.preventDefault();
      if (isUndo) undoTable(table.id);
      else redoTable(table.id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFront, open, redoTable, table, undoTable, windowId]);

  const columns = useMemo<readonly GridColumn[]>(
    () =>
      table?.columns.map((column) => {
        return {
          id: column.id,
          title: column.name || column.id,
          width: columnWidths[column.id] ?? defaultColumnWidth(column),
        };
      }) ?? [],
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
    return table ? selectedRowIndexes(selection, table.rows.length) : [];
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
      const baseThemeOverride = hasError
        ? isDarkTheme
          ? { bgCell: '#3a2119', textDark: '#fed7aa' }
          : { bgCell: '#fff1ed', textDark: '#9a3412' }
        : row
          ? undefined
          : isDarkTheme
            ? { bgCell: '#172033', textLight: '#718096' }
            : { bgCell: '#fbfcfe', textLight: '#cbd5e1' };

      const isFlashingCell =
        cellFlash !== undefined &&
        cellFlashRatio > 0 &&
        cellFlash.col === col &&
        cellFlash.row === rowIndex;
      const themeOverride = isFlashingCell
        ? {
            ...baseThemeOverride,
            bgCell: mixHexColors(
              isDarkTheme ? CELL_FLASH_DARK : CELL_FLASH_LIGHT,
              baseThemeOverride?.bgCell ?? (isDarkTheme ? '#111827' : '#ffffff'),
              1 - cellFlashRatio,
            ),
          }
        : baseThemeOverride;

      if (column.type === 'bool') {
        return {
          kind: GridCellKind.Boolean,
          data: typeof value === 'boolean' ? value : null,
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
        const selected = options.find(
          (option) => referenceValueKey(option.value) === referenceValueKey(value),
        );
        const referenceTarget = resolveReferenceTarget(project, column, value);

        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          activationBehaviorOverride: 'single-click',
          copyData: toInputValue(value),
          data: {
            kind: 'choice-cell',
            value,
            display: selected?.label ?? toInputValue(value),
            options,
            searchPlaceholder: t('searchChoices'),
            noMatchesLabel: t('noMatchingChoices'),
            clearLabel: t('clearChoice'),
            onNavigate: referenceTarget
              ? () =>
                  onOpenTable(referenceTarget.tableId, {
                    rowId: referenceTarget.rowId,
                    columnId: referenceTarget.columnId,
                  })
              : undefined,
          },
          themeOverride,
        };
      }

      return {
        kind: GridCellKind.Text,
        data: toInputValue(value),
        displayData: toInputValue(value),
        allowOverlay: true,
        allowWrapping: column.type === 'json',
        themeOverride,
      };
    },
    [cellFlash, cellFlashRatio, errorCells, isDarkTheme, onOpenTable, project, t, table],
  );

  const applyCellEdits = useCallback(
    (items: readonly GridEdit[]) => {
      if (!table) return;

      beginUndoBatch(table.id);
      try {
        const rowIds = ensureRowIdsForEdits(
          table.rows.map((row) => row._rowId),
          items,
          () => addRow(table.id),
        );

        for (const item of items) {
          const [col, rowIndex] = item.location;
          const column = table.columns[col];
          const rowId = rowIds[rowIndex];
          if (!column || !rowId) continue;
          updateCell(table.id, rowId, column.id, editedCellValue(column, item.value, project));
        }
      } finally {
        endUndoBatch();
      }
    },
    [addRow, beginUndoBatch, endUndoBatch, project, table, updateCell],
  );

  const onCellEdited = useCallback<NonNullable<DataEditorProps['onCellEdited']>>(
    (location, value) => applyCellEdits([{ location, value }]),
    [applyCellEdits],
  );

  const onCellsEdited = useCallback<NonNullable<DataEditorProps['onCellsEdited']>>(
    (items) => {
      applyCellEdits(items);
      return true;
    },
    [applyCellEdits],
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

  // Ctrl/Cmd+Enter 在当前行下方插入行，Ctrl/Cmd+Shift+Enter 在上方插入行，
  // Ctrl/Cmd+F 打开搜索；cancel() 阻止 Glide 的默认键绑定。
  const onGridKeyDown = useCallback<NonNullable<DataEditorProps['onKeyDown']>>(
    (event) => {
      const action = resolveGridShortcut(event);
      if (!action) return;

      event.cancel();
      if (action === 'open-search') {
        setShowSearch(true);
        return;
      }

      if (!table) return;
      const currentRow = selection.current?.cell[1];
      if (currentRow === undefined) {
        addRowAtEnd();
      } else if (action === 'insert-row-above') {
        insertRowAt(currentRow);
      } else {
        insertRowAt(currentRow + 1);
      }
    },
    [addRowAtEnd, insertRowAt, selection, table],
  );

  const onRowMoved = useCallback<RowMoveProps['onRowMoved']>(
    (startIndex, endIndex) => {
      if (!table) return;
      const targetIndex = moveRow(table.id, startIndex, endIndex);
      if (targetIndex === undefined) return;
      setSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.fromSingleSelection(targetIndex),
      });
    },
    [moveRow, table],
  );

  const rowMoveProps = useMemo<RowMoveProps>(() => ({ onRowMoved }), [onRowMoved]);

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

      beginUndoBatch(table.id);
      try {
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
            updateCell(
              table.id,
              rowId,
              column.id,
              coerceGridValue(column, rowValues[colOffset], project),
            );
          }
        }
      } finally {
        endUndoBatch();
      }

      return false;
    },
    [addRow, beginUndoBatch, endUndoBatch, project, table, updateCell],
  );

  const onFillPattern = useCallback<NonNullable<DataEditorProps['onFillPattern']>>(
    (event) => {
      // 拦截 Glide 默认的循环复制，改用 Excel 式序列填充（1、2 → 3、4、5…）。
      event.preventDefault();
      if (!table) return;

      beginUndoBatch(table.id);
      try {
        const edits = computeFillPatternEdits(event.patternSource, event.fillDestination, {
          getCellValue: (col, row) => table.rows[row]?.values[table.columns[col]?.id ?? ''],
          getColumnMode: (col) => {
            const column = table.columns[col];
            return column ? fillValueModeForColumn(column) : 'copy';
          },
        });

        const existingRowCount = table.rows.length;
        const applicableEdits = edits.filter((edit) => {
          const column = table.columns[edit.col];
          if (!column) return false;
          // 拖过表尾的空白行时跳过空值，避免无意义地创建真实行。
          if (edit.row >= existingRowCount) {
            return edit.value !== '' && edit.value !== undefined && edit.value !== null;
          }
          const current = table.rows[edit.row]?.values[column.id] ?? '';
          return edit.value !== current;
        });
        if (applicableEdits.length === 0) return;

        const rowIds = ensureRowIdsForEdits(
          table.rows.map((row) => row._rowId),
          applicableEdits.map((edit) => ({ location: [edit.col, edit.row] as Item })),
          () => addRow(table.id),
        );

        for (const edit of applicableEdits) {
          const column = table.columns[edit.col];
          const rowId = rowIds[edit.row];
          if (!column || !rowId) continue;
          updateCell(table.id, rowId, column.id, edit.value);
        }
      } finally {
        endUndoBatch();
      }
    },
    [addRow, beginUndoBatch, endUndoBatch, table, updateCell],
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
        setSelection(emptySelection());
        return false;
      }

      for (const [colIndex, rowIndex] of selectedCellItems(
        nextSelection,
        table.columns.length,
        table.rows.length,
      )) {
        const row = table.rows[rowIndex];
        const column = table.columns[colIndex];
        if (row && column) updateCell(table.id, row._rowId, column.id, '');
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
    setHeaderMenu(undefined);
    setHeaderTooltip(undefined);
    setCellMenu({
      colIndex: cell[0],
      rowIndex: cell[1],
      x: event.bounds.x + event.localEventX,
      y: event.bounds.y + event.localEventY,
    });
  }, []);

  const openHeaderMenu = useCallback((colIndex: number, event: HeaderClickedEventArgs) => {
    event.preventDefault();
    setCellMenu(undefined);
    setHeaderTooltip(undefined);
    setHeaderMenu({
      colIndex,
      x: event.bounds.x + event.localEventX,
      y: event.bounds.y + event.localEventY,
    });
  }, []);

  const onItemHovered = useCallback((args: GridMouseEventArgs) => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }

    if (args.kind !== 'header') {
      setHeaderTooltip(undefined);
      return;
    }

    const column = table?.columns[args.location[0]];
    const remark = column ? columnRemark(column) : '';
    if (!remark) {
      setHeaderTooltip(undefined);
      return;
    }

    hoverTimeoutRef.current = window.setTimeout(() => {
      setHeaderTooltip({
        x: args.bounds.x + 8,
        y: args.bounds.y + args.bounds.height + 6,
        text: remark,
      });
    }, 350);
  }, [table]);

  const saveRemark = useCallback(() => {
    if (!table || !remarkEditor) return;

    const remark = remarkEditor.draft.trim();
    updateColumn(table.id, remarkEditor.columnId, { remark: remark || undefined });
    setRemarkEditor(undefined);
    setHeaderTooltip(undefined);
  }, [remarkEditor, table, updateColumn]);

  const uppercaseCells = useCallback(
    (cells: Item[]) => {
      if (!table) return;

      beginUndoBatch(table.id);
      try {
        for (const [colIndex, rowIndex] of cells) {
          const column = table.columns[colIndex];
          const row = table.rows[rowIndex];
          if (!column || !row || column.type !== 'string') continue;

          const value = row.values[column.id];
          if (typeof value !== 'string') continue;

          const nextValue = value.toUpperCase();
          if (nextValue !== value) updateCell(table.id, row._rowId, column.id, nextValue);
        }
      } finally {
        endUndoBatch();
      }
    },
    [beginUndoBatch, endUndoBatch, table, updateCell],
  );

  const cellMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!table || !cellMenu) return [];

    const hasExistingRow = cellMenu.rowIndex >= 0 && cellMenu.rowIndex < table.rows.length;
    const selectedRows = getSelectedRowIndexes();
    const selectedRowCount = selectedRows.length;
    const selectedIncludesMenuRow = selectedRows.includes(cellMenu.rowIndex);
    const actionRowIndexes =
      selectedRowCount > 1 && selectedIncludesMenuRow
        ? selectedRows
        : hasExistingRow
          ? [cellMenu.rowIndex]
          : [];
    const deleteLabel =
      actionRowIndexes.length > 1
        ? t('deleteRowsCount', { count: actionRowIndexes.length })
        : t('deleteRow');
    const selectedRanges = selectionRanges(selection);
    const menuCellIsSelected =
      cellMenu.colIndex >= 0 &&
      selectedRanges.some(
        (range) =>
          cellMenu.colIndex >= range.x &&
          cellMenu.colIndex < range.x + range.width &&
          cellMenu.rowIndex >= range.y &&
          cellMenu.rowIndex < range.y + range.height,
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
    } else if (hasExistingRow && cellMenu.colIndex >= 0) {
      addUppercaseTarget(cellMenu.colIndex, cellMenu.rowIndex);
    } else if (hasExistingRow) {
      for (let colIndex = 0; colIndex < table.columns.length; colIndex += 1) {
        addUppercaseTarget(colIndex, cellMenu.rowIndex);
      }
    }

    const uppercaseTargets = [...uppercaseTargetMap.values()];
    const menuColumn = table.columns[cellMenu.colIndex];
    const menuRow = table.rows[cellMenu.rowIndex];
    const referenceTarget = resolveReferenceTarget(
      project,
      menuColumn,
      menuColumn && menuRow ? menuRow.values[menuColumn.id] : undefined,
    );

    return [
      {
        id: 'row-label',
        type: 'label',
        label: hasExistingRow ? t('rowLabel', { index: cellMenu.rowIndex + 1 }) : t('blankRow'),
      },
      ...(referenceTarget
        ? [
            {
              id: 'open-reference',
              label: t('goToReferencedRow', { table: referenceTarget.tableName }),
              shortcut: '↗',
              onSelect: () =>
                onOpenTable(referenceTarget.tableId, {
                  rowId: referenceTarget.rowId,
                  columnId: referenceTarget.columnId,
                }),
            } satisfies ContextMenuItem,
            { id: 'row-separator-reference', type: 'separator' as const },
          ]
        : []),
      {
        id: 'insert-above',
        label: t('insertRowAbove'),
        shortcut: 'Ctrl+Shift+Enter',
        onSelect: () => insertRowAt(cellMenu.rowIndex),
      },
      {
        id: 'insert-below',
        label: t('insertRowBelow'),
        shortcut: 'Ctrl+Enter',
        onSelect: () => insertRowAt(cellMenu.rowIndex + 1),
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
          const rowIds = actionRowIndexes
            .map((rowIndex) => table.rows[rowIndex]?._rowId)
            .filter((rowId): rowId is string => Boolean(rowId));
          if (rowIds.length === 0) return;
          deleteRows(table.id, rowIds);
          setSelection(emptySelection());
        },
      },
    ];
  }, [
    addRowAtEnd,
    copyRowsAsJson,
    deleteRows,
    getSelectedRowIndexes,
    insertRowAt,
    cellMenu,
    onOpenTable,
    project,
    selection,
    t,
    table,
    uppercaseCells,
  ]);

  const headerMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!table || !headerMenu) return [];

    const column = table.columns[headerMenu.colIndex];
    if (!column) return [];

    return [
      {
        id: 'field-label',
        type: 'label',
        label: column.name || column.id,
      },
      {
        id: 'insert-remark',
        label: t('insertRemark'),
        onSelect: () => {
          setRemarkEditor({ columnId: column.id, draft: column.remark ?? '' });
        },
      },
    ];
  }, [headerMenu, t, table]);

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
      setCellFlash({ col, row, startedAt: Date.now() });
      setCellFlashRatio(1);

      requestAnimationFrame(() => {
        gridRef.current?.scrollTo(col, row, 'both', 80, 80, {
          hAlign: 'center',
          vAlign: 'center',
        });
      });
    },
    [columns.length, gridRowCount],
  );

  useEffect(() => {
    if (!table || !focusRequest || focusRequest.tableId !== table.id) return;
    if (handledFocusSequenceRef.current === focusRequest.sequence) return;

    const col = table.columns.findIndex((column) => column.id === focusRequest.columnId);
    const row = table.rows.findIndex((item) => item._rowId === focusRequest.rowId);
    if (col < 0 || row < 0) return;

    handledFocusSequenceRef.current = focusRequest.sequence;
    focusGridCell([col, row]);
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [focusGridCell, focusRequest, table]);

  const focusGridColumn = useCallback(
    (columnId: string) => {
      const col = table?.columns.findIndex((column) => column.id === columnId) ?? -1;
      if (col < 0 || col >= columns.length) return;

      setShowTablePreview(false);
      setSelection({
        columns: CompactSelection.fromSingleSelection(col),
        rows: CompactSelection.empty(),
      });

      requestAnimationFrame(() => {
        gridRef.current?.scrollTo(col, 0, 'horizontal', 80, 0, { hAlign: 'center' });
      });
    },
    [columns.length, table],
  );

  const provideEditor = useMemo<ProvideEditorCallback<GridCell>>(
    () => (cell) => {
      if (cell.kind !== GridCellKind.Custom) return undefined;
      return {
        editor: ChoiceEditor,
        disablePadding: true,
      };
    },
    [],
  );

  const drawHeader = useCallback<NonNullable<DataEditorProps['drawHeader']>>(
    (args, drawContent) => {
      const column = table?.columns[args.columnIndex];
      if (!column) {
        drawContent();
        return;
      }

      const remark = columnRemark(column);
      drawContent();

      const paddingLeft = 8;
      const paddingRight = 8;
      const centerY = args.rect.y + args.rect.height / 2;
      const title = column.name || column.id;
      const remarkText = remark ? shortRemark(remark) : '';
      const badgeWidth = column.primary ? 22 : 0;
      const badgeGap = column.primary ? 7 : 0;
      const contentWidth = args.rect.width - paddingLeft - paddingRight;
      const textRight = args.rect.x + args.rect.width - paddingRight - badgeWidth - badgeGap;
      const textLeft = args.rect.x + paddingLeft;

      args.ctx.save();
      args.ctx.beginPath();
      args.ctx.rect(textLeft, args.rect.y, Math.max(0, contentWidth), args.rect.height);
      args.ctx.clip();

      args.ctx.fillStyle = args.isSelected ? args.theme.accentColor : args.hasSelectedCell ? args.theme.bgHeaderHasFocus : args.theme.bgHeader;
      args.ctx.fillRect(textLeft, args.rect.y, Math.max(0, contentWidth), args.rect.height);

      args.ctx.textBaseline = 'middle';
      args.ctx.textAlign = 'left';
      args.ctx.font = `${args.theme.headerFontStyle} ${args.theme.fontFamily}`;
      args.ctx.fillStyle = args.isSelected ? args.theme.textHeaderSelected : args.theme.textHeader;

      const titleWidth = Math.ceil(args.ctx.measureText(title).width);
      const remarkGap = remarkText ? 8 : 0;
      const remarkFont = `italic 11px ${args.theme.fontFamily}`;
      args.ctx.font = remarkFont;
      const remarkWidth = remarkText ? Math.ceil(args.ctx.measureText(remarkText).width) : 0;
      args.ctx.font = `${args.theme.headerFontStyle} ${args.theme.fontFamily}`;

      const availableTextWidth = Math.max(0, textRight - textLeft);
      const idealTextWidth = titleWidth + remarkGap + remarkWidth;
      let displayTitle = title;
      let displayRemark = remarkText;

      if (idealTextWidth > availableTextWidth) {
        const minTitleWidth = Math.min(titleWidth, Math.max(28, availableTextWidth * 0.55));
        displayTitle = ellipsizeCanvasText(args.ctx, title, remarkText ? minTitleWidth : availableTextWidth);
        const usedTitleWidth = Math.ceil(args.ctx.measureText(displayTitle).width);
        const remainingWidth = availableTextWidth - usedTitleWidth - remarkGap;
        args.ctx.font = remarkFont;
        displayRemark = remarkText ? ellipsizeCanvasText(args.ctx, remarkText, remainingWidth) : '';
        args.ctx.font = `${args.theme.headerFontStyle} ${args.theme.fontFamily}`;
      }

      args.ctx.fillText(displayTitle, textLeft, centerY);
      const titleDrawWidth = Math.ceil(args.ctx.measureText(displayTitle).width);

      if (displayRemark) {
        args.ctx.font = `italic 11px ${args.theme.fontFamily}`;
        args.ctx.fillStyle = '#64748b';
        args.ctx.fillText(displayRemark, textLeft + titleDrawWidth + remarkGap, centerY);
      }

      args.ctx.restore();

      if (column.primary) {
        const badgeHeight = 14;
        const badgeX = args.rect.x + args.rect.width - badgeWidth - paddingRight;
        const badgeY = args.rect.y + Math.floor((args.rect.height - badgeHeight) / 2);
        args.ctx.save();
        drawRoundRect(args.ctx, badgeX, badgeY, badgeWidth, badgeHeight, 3);
        args.ctx.fillStyle = '#dcfce7';
        args.ctx.fill();
        args.ctx.fillStyle = '#166534';
        args.ctx.font = `700 9px ${args.theme.fontFamily}`;
        args.ctx.textBaseline = 'middle';
        args.ctx.textAlign = 'center';
        args.ctx.fillText('PK', badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
        args.ctx.restore();
      }
    },
    [table],
  );

  const gridTheme = useMemo(() => {
    const accentLight = theme === 'dark' ? '#1e3a5f' : '#dbeafe';
    const base: Partial<Theme> = {
      accentColor: theme === 'dark' ? '#60a5fa' : '#2563eb',
      accentFg: '#ffffff',
      accentLight,
      bgHeader: theme === 'dark' ? '#1e293b' : '#eef2f5',
      bgHeaderHasFocus: theme === 'dark' ? '#29415f' : '#d9e4f4',
      bgHeaderHovered: theme === 'dark' ? '#263852' : '#e4ebf5',
      bgCell: theme === 'dark' ? '#111827' : '#ffffff',
      bgCellMedium: theme === 'dark' ? '#172033' : '#fafafb',
      bgBubble: theme === 'dark' ? '#263852' : '#e8eef6',
      bgBubbleSelected: theme === 'dark' ? '#334d6d' : '#ffffff',
      bgSearchResult: theme === 'dark' ? '#4a3a16' : '#fff9e3',
      borderColor: theme === 'dark' ? '#3b4a60' : '#d5dce3',
      drilldownBorder: 'transparent',
      linkColor: theme === 'dark' ? '#93c5fd' : '#1d4ed8',
      textDark: theme === 'dark' ? '#e5edf7' : '#18212c',
      textMedium: theme === 'dark' ? '#a8b6c8' : '#657282',
      textLight: theme === 'dark' ? '#7f8ea3' : '#7a8798',
      textBubble: theme === 'dark' ? '#d7e2f0' : '#405063',
      textHeader: theme === 'dark' ? '#d7e2f0' : '#405063',
      textHeaderSelected: '#ffffff',
      bgIconHeader: theme === 'dark' ? '#a8b6c8' : '#657282',
      fgIconHeader: theme === 'dark' ? '#111827' : '#ffffff',
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      baseFontStyle: '12px',
      headerFontStyle: '600 12px',
      editorFontSize: '12px',
    };

    // 跳转定位时选区填充色（accentLight）从高亮蓝渐隐回常态，重复 CELL_FLASH_COUNT 次形成闪烁。
    if (cellFlash && cellFlashRatio > 0) {
      base.accentLight = mixHexColors(
        theme === 'dark' ? CELL_FLASH_ACCENT_DARK : CELL_FLASH_ACCENT_LIGHT,
        accentLight,
        1 - cellFlashRatio,
      );
    }

    return base;
  }, [cellFlash, cellFlashRatio, theme]);

  if (!open || !table) return null;

  return (
    <WindowFrame
      windowId={windowId}
      className="data-modal"
      title={
        <>
          {isTableDirty ? (
            <span className="dirty-mark" title={t('unsavedTable')} aria-label={t('unsavedTable')}>
              *
            </span>
          ) : null}
          {table.name} {t('edit')}
        </>
      }
      subtitle={
        <>
          {t('fieldsRows', { fields: table.columns.length, rows: table.rows.length })}
          {tableIssueCount > 0 ? ` / ${tableIssueCount}` : ''}
          {selectedRowCount > 0 ? ` / ${t('selectedRowsCount', { count: selectedRowCount })}` : ''}
          {searchStatus ? ` / ${searchStatus}` : ''}
        </>
      }
      actions={
        <>
          <button
            type="button"
            className="button"
            disabled={undoDepth === 0}
            onClick={() => undoTable(table.id)}
            title={`${t('undo')} (Ctrl+Z)`}
          >
            {t('undo')}
          </button>
          <button
            type="button"
            className="button"
            disabled={redoDepth === 0}
            onClick={() => redoTable(table.id)}
            title={`${t('redo')} (Ctrl+Y)`}
          >
            {t('redo')}
          </button>
          <button type="button" className="button" onClick={() => setShowTablePreview(true)}>
            {t('tablePreview')}
          </button>
          <button type="button" className="button" onClick={() => setShowSearch(true)} title="Ctrl+F">
            {t('search')}
          </button>
        </>
      }
      onClose={onClose}
      t={t}
    >
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
              onKeyDown={onGridKeyDown}
              onPaste={onPaste}
              onFillPattern={onFillPattern}
              onDelete={onDelete}
              onColumnResize={onColumnResize}
              onCellContextMenu={openCellMenu}
              onHeaderContextMenu={openHeaderMenu}
              onItemHovered={onItemHovered}
              gridSelection={selection}
              onGridSelectionChange={(nextSelection) => setSelection(nextSelection)}
              {...rowMoveProps}
              provideEditor={provideEditor}
              customRenderers={choiceCellRenderers}
              drawHeader={drawHeader}
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
              cellActivationBehavior="second-click"
              editOnType
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
              theme={gridTheme}
            />
          </div>
        </div>
      {cellMenu ? (
        <ContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          items={cellMenuItems}
          onClose={() => setCellMenu(undefined)}
        />
      ) : null}
      {headerMenu ? (
        <ContextMenu
          x={headerMenu.x}
          y={headerMenu.y}
          items={headerMenuItems}
          onClose={() => setHeaderMenu(undefined)}
        />
      ) : null}
      {headerTooltip ? (
        <div className="field-remark-tooltip" style={{ left: headerTooltip.x, top: headerTooltip.y }}>
          {headerTooltip.text}
        </div>
      ) : null}
      {remarkEditor ? (
        <div className="remark-editor-backdrop" role="presentation" onMouseDown={() => setRemarkEditor(undefined)}>
          <form
            className="remark-editor"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              saveRemark();
            }}
          >
            <label className="field-stack">
              <span>{t('fieldRemark')}</span>
              <textarea
                autoFocus
                rows={5}
                value={remarkEditor.draft}
                onChange={(event) =>
                  setRemarkEditor((current) =>
                    current ? { ...current, draft: event.target.value } : current,
                  )
                }
              />
            </label>
            <div className="remark-editor__actions">
              <button type="button" className="button" onClick={() => setRemarkEditor(undefined)}>
                {t('cancel')}
              </button>
              <button type="submit" className="button button--primary">
                {t('save')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {showTablePreview ? (
        <TablePreviewModal
          table={table}
          t={t}
          onClose={() => setShowTablePreview(false)}
          onSelectColumn={focusGridColumn}
        />
      ) : null}
    </WindowFrame>
  );
}
