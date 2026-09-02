import { CompactSelection, GridCellKind, type GridSelection } from '@glideapps/glide-data-grid';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../model/types';
import {
  coerceGridValue,
  computeFillPatternEdits,
  editedCellValue,
  ensureRowIdsForEdits,
  extrapolatedFillValue,
  fillValueModeForColumn,
  normalizePasteValues,
  selectedCellItems,
  selectedRowIndexes,
} from './gridEditing';

const project: ProjectFile = {
  version: 1,
  tables: [
    {
      id: 'items',
      name: 'Items',
      position: { x: 0, y: 0 },
      columns: [{ id: 'id', name: 'id', type: 'int' }],
      rows: [
        { _rowId: 'item-1', values: { id: 1 } },
        { _rowId: 'item-2', values: { id: 2 } },
      ],
    },
  ],
};

describe('grid editing helpers', () => {
  it('keeps JSON paste as source text and restores typed ref values', () => {
    expect(coerceGridValue({ id: 'json', name: 'json', type: 'json' }, '"hello"', project))
      .toBe('"hello"');
    expect(coerceGridValue({ id: 'json', name: 'json', type: 'json' }, 'null', project))
      .toBe('null');
    expect(
      coerceGridValue(
        { id: 'item', name: 'item', type: 'ref', ref: { tableId: 'items', columnId: 'id' } },
        '2',
        project,
      ),
    ).toBe(2);
  });

  it('coerces fill values according to the destination column', () => {
    expect(
      editedCellValue(
        { id: 'name', name: 'name', type: 'string' },
        {
          kind: GridCellKind.Number,
          data: 12,
          displayData: '12',
          allowOverlay: true,
        },
        project,
      ),
    ).toBe('12');
    expect(
      editedCellValue(
        { id: 'enabled', name: 'enabled', type: 'bool' },
        { kind: GridCellKind.Boolean, data: null, allowOverlay: false },
        project,
      ),
    ).toBe('');
  });

  it('normalizes multi-row single-column paste without changing a single plain value', () => {
    expect(normalizePasteValues([['  keep spaces  ']])).toEqual([['  keep spaces  ']]);
    expect(normalizePasteValues([['  a  '], [''], [' b ']])).toEqual([['a'], ['b']]);
    expect(normalizePasteValues([['a\r\n\r\n b']])).toEqual([['a'], ['b']]);
  });

  it('creates each ghost row once for a batched edit', () => {
    const addRow = vi.fn()
      .mockReturnValueOnce('row-2')
      .mockReturnValueOnce('row-3');
    const rowIds = ensureRowIdsForEdits(
      ['row-1'],
      [
        { location: [0, 1] },
        { location: [1, 1] },
        { location: [0, 2] },
      ],
      addRow,
    );

    expect(rowIds).toEqual(['row-1', 'row-2', 'row-3']);
    expect(addRow).toHaveBeenCalledTimes(2);
  });

  it('continues arithmetic series when filling down and up', () => {
    const edits = computeFillPatternEdits(
      { x: 0, y: 0, width: 1, height: 2 },
      { x: 0, y: 0, width: 1, height: 6 },
      {
        getCellValue: (col, row) => (col === 0 && row < 2 ? row + 1 : ''),
        getColumnMode: () => 'number',
      },
    );
    expect(edits.map((edit) => edit.value)).toEqual([3, 4, 5, 6]);

    const upward = computeFillPatternEdits(
      { x: 0, y: 4, width: 1, height: 2 },
      { x: 0, y: 0, width: 1, height: 6 },
      {
        getCellValue: (col, row) => (col === 0 && row >= 4 && row < 6 ? row + 5 : ''),
        getColumnMode: () => 'number',
      },
    );
    expect(upward.map((edit) => edit.value)).toEqual([5, 6, 7, 8]);
  });

  it('increments text with trailing digits and keeps zero padding', () => {
    expect(
      extrapolatedFillValue(['item1', 'item2'], 2, 'text'),
    ).toBe('item3');
    expect(
      extrapolatedFillValue(['ID001', 'ID002'], 3, 'text'),
    ).toBe('ID004');
    expect(
      extrapolatedFillValue(['a1', 'b2'], 1, 'text'),
    ).toBe('b2');
  });

  it('copies cyclically when a column cannot form a series', () => {
    expect(extrapolatedFillValue([1, 'x'], 2, 'number')).toBe(1);
    expect(extrapolatedFillValue(['on', 'off'], 2, 'copy')).toBe('on');
    expect(extrapolatedFillValue([5], 3, 'number')).toBe(5);
  });

  it('maps column types to fill modes and writes only changed cells', () => {
    expect(fillValueModeForColumn({ id: 'c', name: 'c', type: 'float' })).toBe('number');
    expect(fillValueModeForColumn({ id: 'c', name: 'c', type: 'string' })).toBe('text');
    expect(fillValueModeForColumn({ id: 'c', name: 'c', type: 'enum' })).toBe('copy');

    const edits = computeFillPatternEdits(
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 0, y: 0, width: 2, height: 4 },
      {
        getCellValue: (col, row) => (row < 2 ? (col + 1) * 10 + row + 1 : ''),
        getColumnMode: () => 'number',
      },
    );
    expect(edits).toEqual([
      { col: 0, row: 2, value: 13 },
      { col: 1, row: 2, value: 23 },
      { col: 0, row: 3, value: 14 },
      { col: 1, row: 3, value: 24 },
    ]);
  });

  it('includes stacked ranges and selected columns', () => {
    const selection: GridSelection = {
      columns: CompactSelection.empty(),
      rows: CompactSelection.fromSingleSelection(4),
      current: {
        cell: [0, 1],
        range: { x: 0, y: 1, width: 1, height: 2 },
        rangeStack: [{ x: 2, y: 3, width: 1, height: 2 }],
      },
    };

    expect(selectedRowIndexes(selection, 5)).toEqual([1, 2, 3, 4]);
    expect(selectedCellItems(selection, 3, 5)).toEqual([
      [0, 1],
      [0, 2],
      [2, 3],
      [2, 4],
    ]);

    expect(
      selectedCellItems(
        {
          columns: CompactSelection.fromSingleSelection(1),
          rows: CompactSelection.empty(),
        },
        3,
        2,
      ),
    ).toEqual([
      [1, 0],
      [1, 1],
    ]);
  });
});
