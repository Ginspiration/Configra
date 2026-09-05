import { describe, expect, it } from 'vitest';
import { idRegistryJson, projectJsonFiles, tableJson } from './exportTables';
import type { ProjectFile } from '../model/types';

const project: ProjectFile = {
  version: 1,
  tables: [
    {
      id: 'table-1',
      name: 'Sound',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'col-key', name: 'key', type: 'string' },
        { id: 'col-id', name: 'id', type: 'int', primary: true, required: true },
      ],
      rows: [{ _rowId: 'row-1', values: { 'col-key': 'SOUND_CLICK', 'col-id': 1 } }],
      identity: {
        namespace: 'Sound',
        keyColumnId: 'col-key',
        valueColumnId: 'col-id',
      },
    },
  ],
};

describe('exported JSON text', () => {
  it('ends every exported artifact with exactly one trailing newline', () => {
    for (const text of [tableJson(project, 'table-1'), idRegistryJson(project)]) {
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    }

    for (const file of projectJsonFiles(project)) {
      expect(file.text.endsWith('\n')).toBe(true);
      expect(file.text.endsWith('\n\n')).toBe(false);
    }
  });

  it('keeps empty tables and registries on a single line before the newline', () => {
    const emptyProject: ProjectFile = { version: 1, tables: [] };

    expect(idRegistryJson(emptyProject)).toBe('{}\n');
    expect(projectJsonFiles(emptyProject)[0].text).toBe('{}\n');
  });
});
