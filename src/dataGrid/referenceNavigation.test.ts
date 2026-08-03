import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../model/types';
import { resolveReferenceTarget } from './referenceNavigation';

const project: ProjectFile = {
  version: 1,
  tables: [
    {
      id: 'items',
      name: 'Items',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id', name: 'ID', type: 'int', primary: true, required: true },
        { id: 'name', name: 'Name', type: 'string' },
      ],
      rows: [
        { _rowId: 'item-1', values: { id: 1, name: 'Potion' } },
        { _rowId: 'item-2', values: { id: 2, name: 'Sword' } },
      ],
    },
    {
      id: 'drops',
      name: 'Drops',
      position: { x: 200, y: 0 },
      columns: [
        {
          id: 'itemId',
          name: 'Item ID',
          type: 'ref',
          ref: { tableId: 'items', columnId: 'id' },
        },
      ],
      rows: [],
    },
  ],
};

describe('resolveReferenceTarget', () => {
  const sourceColumn = project.tables[1].columns[0];

  it('resolves a ref value to the target table, column, and stable row ID', () => {
    expect(resolveReferenceTarget(project, sourceColumn, 2)).toEqual({
      tableId: 'items',
      tableName: 'Items',
      columnId: 'id',
      rowId: 'item-2',
      columnIndex: 0,
      rowIndex: 1,
    });
  });

  it('does not mix numeric and string reference values', () => {
    expect(resolveReferenceTarget(project, sourceColumn, '2')).toBeUndefined();
  });

  it('returns no navigation target for empty or missing values', () => {
    expect(resolveReferenceTarget(project, sourceColumn, '')).toBeUndefined();
    expect(resolveReferenceTarget(project, sourceColumn, 99)).toBeUndefined();
  });
});
