import {
  GridCellKind,
  type EditableGridCell,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid';
import type { ConfigColumn, ProjectFile } from '../model/types';
import { referenceValueKey } from './referenceNavigation';

export type GridEdit = {
  location: Item;
  value: EditableGridCell;
};

export type PasteValues = readonly (readonly string[])[];

export const toInputValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value) ?? '';
};

const referenceValues = (column: ConfigColumn, project: ProjectFile) => {
  if (column.type !== 'ref') return [];
  const targetTable = project.tables.find((table) => table.id === column.ref?.tableId);
  const targetColumn = targetTable?.columns.find((field) => field.id === column.ref?.columnId);
  if (!targetTable || !targetColumn) return [];

  return targetTable.rows
    .map((row) => row.values[targetColumn.id])
    .filter((value) => value !== undefined && value !== null && value !== '');
};

export const coerceGridValue = (
  column: ConfigColumn,
  rawValue: unknown,
  project: ProjectFile,
): unknown => {
  if (rawValue === null || rawValue === undefined) return '';

  if (column.type === 'string' || column.type === 'json') {
    return typeof rawValue === 'string' ? rawValue : toInputValue(rawValue);
  }

  if (column.type === 'enum') {
    return typeof rawValue === 'string' ? rawValue : toInputValue(rawValue);
  }

  if (column.type === 'ref') {
    const values = referenceValues(column, project);
    const exact = values.find(
      (value) => referenceValueKey(value) === referenceValueKey(rawValue),
    );
    if (exact !== undefined) return exact;

    const input = toInputValue(rawValue).trim();
    const textMatches = values.filter((value) => toInputValue(value) === input);
    return textMatches.length === 1 ? textMatches[0] : rawValue;
  }

  const input = typeof rawValue === 'string' ? rawValue.trim() : toInputValue(rawValue);
  if (input === '') return '';

  if (column.type === 'int' || column.type === 'float') {
    const value = typeof rawValue === 'number' ? rawValue : Number(input);
    return typeof value === 'number' && Number.isFinite(value) ? value : rawValue;
  }

  if (column.type === 'bool') {
    if (typeof rawValue === 'boolean') return rawValue;
    const normalized = input.toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }

  return rawValue;
};

export const editedCellValue = (
  column: ConfigColumn,
  cell: EditableGridCell,
  project: ProjectFile,
) => {
  const rawValue =
    cell.kind === GridCellKind.Custom
      ? (cell.data as { value?: unknown }).value ?? ''
      : cell.data;
  return coerceGridValue(column, rawValue, project);
};

const splitPastedLines = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export const normalizePasteValues = (values: PasteValues): string[][] => {
  const isSingleColumnPaste = values.length > 0 && values.every((row) => row.length <= 1);
  if (!isSingleColumnPaste) return values.map((row) => [...row]);

  const isMultiLine =
    values.length > 1 ||
    values.some((row) => /[\r\n]/.test(row[0] ?? '') || (row[0] ?? '').trim() === '');
  if (!isMultiLine) return values.map((row) => [...row]);

  const lines = values.flatMap((row) => splitPastedLines(row[0] ?? ''));
  return lines.length > 0 ? lines.map((line) => [line]) : values.map((row) => [...row]);
};

export const selectionRanges = (selection: GridSelection) =>
  selection.current
    ? [selection.current.range, ...(selection.current.rangeStack ?? [])]
    : [];

export const selectedRowIndexes = (selection: GridSelection, rowCount: number) => {
  const indexes = new Set<number>();
  for (const rowIndex of selection.rows) {
    if (rowIndex >= 0 && rowIndex < rowCount) indexes.add(rowIndex);
  }

  for (const range of selectionRanges(selection)) {
    const start = Math.max(0, range.y);
    const end = Math.min(rowCount, range.y + range.height);
    for (let rowIndex = start; rowIndex < end; rowIndex += 1) indexes.add(rowIndex);
  }

  return [...indexes].sort((left, right) => left - right);
};

export const selectedCellItems = (
  selection: GridSelection,
  columnCount: number,
  rowCount: number,
): Item[] => {
  const cells = new Map<string, Item>();
  const add = (col: number, row: number) => {
    if (col < 0 || col >= columnCount || row < 0 || row >= rowCount) return;
    cells.set(`${col}:${row}`, [col, row]);
  };

  for (const range of selectionRanges(selection)) {
    for (let row = range.y; row < range.y + range.height; row += 1) {
      for (let col = range.x; col < range.x + range.width; col += 1) add(col, row);
    }
  }

  for (const col of selection.columns) {
    for (let row = 0; row < rowCount; row += 1) add(col, row);
  }

  return [...cells.values()];
};

export type FillRect = { x: number; y: number; width: number; height: number };

export type FillEdit = { col: number; row: number; value: unknown };

/** int/float 按数值等差递增，string 支持“文本+尾随数字”递增，其余列只复制。 */
export type FillValueMode = 'number' | 'text' | 'copy';

export const fillValueModeForColumn = (column: ConfigColumn): FillValueMode => {
  if (column.type === 'int' || column.type === 'float') return 'number';
  if (column.type === 'string') return 'text';
  return 'copy';
};

const cleanSeriesNumber = (value: number) => Number(value.toFixed(10));

const asSeriesNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const trailingDigitsPattern = /^(.*?)(\d+)$/;

const asSeriesText = (
  value: unknown,
): { prefix: string; digits: number; width: number } | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = trailingDigitsPattern.exec(value);
  if (!match) return undefined;
  return { prefix: match[1], digits: Number(match[2]), width: match[2].length };
};

const cyclicValue = (values: readonly unknown[], offset: number) =>
  values[((offset % values.length) + values.length) % values.length];

/** Excel 式序列外推：offset 是目标位置相对源序列起点的偏移，可为负（向上/向左填充）。 */
export const extrapolatedFillValue = (
  values: readonly unknown[],
  offset: number,
  mode: FillValueMode,
): unknown => {
  if (values.length === 0) return '';
  if (values.length === 1 || offset === 0) return cyclicValue(values, offset);

  if (mode === 'number') {
    const numbers = values.map(asSeriesNumber);
    if (numbers.every((value): value is number => value !== undefined)) {
      const step = (numbers[numbers.length - 1]! - numbers[0]!) / (numbers.length - 1);
      return cleanSeriesNumber(numbers[0]! + step * offset);
    }
    return cyclicValue(values, offset);
  }

  if (mode === 'text') {
    const parts = values.map(asSeriesText);
    const prefix = parts[0]?.prefix;
    if (prefix !== undefined && parts.every((part) => part !== undefined && part.prefix === prefix)) {
      const digits = parts.map((part) => part!.digits);
      const step = (digits[digits.length - 1]! - digits[0]!) / (digits.length - 1);
      const next = cleanSeriesNumber(digits[0]! + step * offset);
      const sameWidth = parts.every((part) => part!.width === parts[0]!.width);
      const text =
        sameWidth && parts[0]!.width > 1 && Number.isInteger(next)
          ? String(next).padStart(parts[0]!.width, '0')
          : String(next);
      return `${prefix}${text}`;
    }
    return cyclicValue(values, offset);
  }

  return cyclicValue(values, offset);
};

/**
 * 计算填充柄需要写入的单元格：源区域内的等差序列向目标区域延续，
 * 无法构成序列时退回 Glide 默认的循环复制。
 */
export const computeFillPatternEdits = (
  source: FillRect,
  destination: FillRect,
  options: {
    getCellValue: (col: number, row: number) => unknown;
    getColumnMode: (col: number) => FillValueMode;
  },
): FillEdit[] => {
  const edits: FillEdit[] = [];
  const sourceBottom = source.y + source.height;
  const sourceRight = source.x + source.width;
  const destinationBottom = destination.y + destination.height;
  const destinationRight = destination.x + destination.width;

  const columnValues = (col: number) => {
    const values: unknown[] = [];
    for (let row = source.y; row < sourceBottom; row += 1) {
      values.push(options.getCellValue(col, row));
    }
    return values;
  };
  const rowValues = (row: number) => {
    const values: unknown[] = [];
    for (let col = source.x; col < sourceRight; col += 1) {
      values.push(options.getCellValue(col, row));
    }
    return values;
  };

  for (let row = destination.y; row < destinationBottom; row += 1) {
    for (let col = destination.x; col < destinationRight; col += 1) {
      const inSourceColumns = col >= source.x && col < sourceRight;
      const inSourceRows = row >= source.y && row < sourceBottom;
      if (inSourceColumns && inSourceRows) continue;

      if (inSourceColumns) {
        edits.push({
          col,
          row,
          value: extrapolatedFillValue(
            columnValues(col),
            row - source.y,
            options.getColumnMode(col),
          ),
        });
      } else if (inSourceRows) {
        edits.push({
          col,
          row,
          value: extrapolatedFillValue(
            rowValues(row),
            col - source.x,
            options.getColumnMode(col),
          ),
        });
      } else {
        const sourceCol =
          source.x + (((col - source.x) % source.width) + source.width) % source.width;
        const sourceRow =
          source.y + (((row - source.y) % source.height) + source.height) % source.height;
        edits.push({ col, row, value: options.getCellValue(sourceCol, sourceRow) });
      }
    }
  }

  return edits;
};

export const ensureRowIdsForEdits = (
  currentRowIds: readonly string[],
  edits: readonly Pick<GridEdit, 'location'>[],
  addRow: () => string | undefined,
) => {
  const rowIds = [...currentRowIds];
  const lastEditedRow = edits.reduce(
    (lastRow, edit) => Math.max(lastRow, edit.location[1]),
    -1,
  );

  while (rowIds.length <= lastEditedRow) {
    const rowId = addRow();
    if (!rowId) break;
    rowIds.push(rowId);
  }

  return rowIds;
};
