import { describe, expect, it } from 'vitest';
import { exportIdRegistry, projectJsonFiles } from '../export/exportTables';
import { translate } from '../i18n';
import { createDefaultRow } from '../model/rowFactory';
import type { ProjectFile } from '../model/types';
import { validateProject } from '../validation/validateProject';
import {
  applyDataPatch,
  canonicalJson,
  checkDataPatch,
  confirmationHashForPatch,
  parseDataPatch,
  sha256Text,
  type DataPatch,
} from './dataPatch';

const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('en', key, vars);

const createBaseProject = (): ProjectFile => ({
  version: 1,
  tables: [
    {
      id: 'item_table',
      name: 'Item',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id_column', name: 'id', type: 'int', primary: true, required: true, autoIncrement: true },
        { id: 'name_column', name: 'name', type: 'string', required: true },
        { id: 'kind_column', name: 'kind', type: 'enum', enumValues: ['weapon', 'potion'] },
        { id: 'meta_column', name: 'meta', type: 'json' },
        { id: 'active_column', name: 'active', type: 'bool' },
      ],
      rows: [
        {
          _rowId: 'row_1',
          values: {
            id_column: 1,
            name_column: 'Sword',
            kind_column: 'weapon',
            meta_column: '{"rarity":1}',
            active_column: true,
          },
        },
        {
          _rowId: 'row_2',
          values: {
            id_column: 2,
            name_column: 'Shield',
            kind_column: 'weapon',
            meta_column: '{"rarity":2}',
            active_column: false,
          },
        },
      ],
    },
  ],
});

const createPatch = (projectHash: string): DataPatch => ({
  version: 1,
  baseHash: projectHash,
  description: 'batch edit',
  operations: [],
});

const createProjectHash = (project: ProjectFile) => sha256Text(`${JSON.stringify(project, null, 2)}\n`);

describe('data patch engine', () => {
  it('supports ordered structure operations and requires remarks only for newly created structures', () => {
    const project = createBaseProject();
    const projectHash = createProjectHash(project);
    const patch: DataPatch = {
      version: 1,
      baseHash: projectHash,
      operations: [
        {
          op: 'updateColumn',
          tableId: 'item_table',
          columnId: 'name_column',
          changes: { name: 'display_name', remark: null },
        },
        {
          op: 'moveColumn',
          tableId: 'item_table',
          columnId: 'name_column',
          targetIndex: 0,
        },
        {
          op: 'addTable',
          tableId: 'loot_table',
          name: 'Loot',
          remark: 'Loot drop configuration created by AI',
        },
        {
          op: 'addColumn',
          tableId: 'loot_table',
          column: {
            id: 'loot_id',
            name: 'id',
            type: 'int',
            primary: true,
            autoIncrement: true,
            remark: 'Stable loot row identifier',
          },
        },
        {
          op: 'addColumn',
          tableId: 'loot_table',
          column: {
            id: 'loot_name',
            name: 'name',
            type: 'string',
            remark: 'Display name for this loot entry',
          },
        },
        {
          op: 'addRows',
          tableId: 'loot_table',
          rows: [{ values: { loot_name: 'Gold' } }],
        },
      ],
    };

    const checked = checkDataPatch(project, patch, { projectHash, validate: (next) => validateProject(next, t) });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const loot = checked.project.tables.find((table) => table.id === 'loot_table');
    expect(loot?.remark).toContain('Loot drop');
    expect(loot?.columns.map((column) => column.remark)).toEqual([
      'Stable loot row identifier',
      'Display name for this loot entry',
    ]);
    expect(loot?.rows[0]?.values.loot_id).toBe(1);
    expect(checked.diff.some((change) => change.type === 'tableAdded')).toBe(true);
    expect(checked.diff.some((change) => change.type === 'columnMoved')).toBe(true);

    const missingTableRemark = parseDataPatch({
      version: 1,
      baseHash: projectHash,
      operations: [{ op: 'addTable', tableId: 'bad', name: 'Bad', remark: '   ' }],
    });
    expect(missingTableRemark.ok).toBe(false);

    const missingColumnRemark = parseDataPatch({
      version: 1,
      baseHash: projectHash,
      operations: [
        {
          op: 'addColumn',
          tableId: 'item_table',
          column: { id: 'new_column', name: 'new', type: 'string' },
        },
      ],
    });
    expect(missingColumnRemark.ok).toBe(false);

    const clearedAfterCreation = applyDataPatch(project, {
      version: 1,
      baseHash: projectHash,
      operations: [
        { op: 'addTable', tableId: 'temporary', name: 'Temporary', remark: 'Created for a test' },
        { op: 'updateTable', tableId: 'temporary', changes: { remark: null } },
      ],
    });
    expect(clearedAfterCreation.ok).toBe(false);
  });

  it('applies batched operations in order and keeps deterministic outputs', () => {
    const project = createBaseProject();
    const projectHash = createProjectHash(project);
    const patch: DataPatch = {
      version: 1,
      baseHash: projectHash,
      description: 'batch update',
      operations: [
        {
          op: 'updateRows',
          tableId: 'item_table',
          rows: [{ rowId: 'row_1', values: { meta_column: '{"rarity":3}' } }],
        },
        {
          op: 'upsertRows',
          tableId: 'item_table',
          keyColumnId: 'id_column',
          rows: [{ key: 2, values: { name_column: 'Tower Shield' } }],
        },
        {
          op: 'addRows',
          tableId: 'item_table',
          rows: [{ values: { name_column: 'Potion' } }],
        },
        {
          op: 'deleteRows',
          tableId: 'item_table',
          rowIds: ['row_1'],
        },
      ],
    };

    const checked = checkDataPatch(project, patch, { projectHash, validate: (next) => validateProject(next, t) });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    expect(checked.confirmationHash).toBe(confirmationHashForPatch(projectHash, patch));
    expect(checked.diff.some((change) => change.type === 'rowDeleted' && change.rowId === 'row_1')).toBe(true);
    expect(checked.diff.some((change) => change.type === 'rowAdded')).toBe(true);

    const table = checked.project.tables[0];
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?._rowId).toBe('row_2');
    expect(table.rows[1]?._rowId).toMatch(/^row_[a-f0-9]{12}_1$/);
    expect(table.rows[0]?.values.name_column).toBe('Tower Shield');
    expect(table.rows[1]?.values.id_column).toBe(3);
    expect(table.rows[1]?.values.kind_column).toBe('weapon');
    expect(table.rows[1]?.values.meta_column).toBe('{}');
    expect(table.rows[1]?.values.active_column).toBe(false);
  });

  it('treats compensating ordered operations as a semantic no-op', () => {
    const project = createBaseProject();
    const projectHash = createProjectHash(project);
    const checked = checkDataPatch(
      project,
      {
        version: 1,
        baseHash: projectHash,
        operations: [
          { op: 'addTable', tableId: 'temporary', name: 'Temporary', remark: 'Temporary test table' },
          { op: 'deleteTable', tableId: 'temporary' },
        ],
      },
      { projectHash, validate: (next) => validateProject(next, t) },
    );

    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.diff).toHaveLength(0);
    expect(checked.changed).toBe(false);
    expect(canonicalJson(checked.project)).toBe(canonicalJson(project));
  });

  it('parses malformed patches and refuses unknown or conflicting targets', () => {
    const project = createBaseProject();
    const projectHash = createProjectHash(project);

    const malformed = parseDataPatch({ version: 1, baseHash: projectHash, operations: [{ op: 'noop' }] });
    expect(malformed.ok).toBe(false);

    const unknownRow = checkDataPatch(
      project,
      {
        version: 1,
        baseHash: projectHash,
        operations: [
          {
            op: 'updateRows',
            tableId: 'item_table',
            rows: [{ rowId: 'missing', values: { name_column: 'X' } }],
          },
        ],
      },
      { projectHash, validate: (next) => validateProject(next, t) },
    );
    expect(unknownRow.ok).toBe(false);
    if (unknownRow.ok) return;
    expect(unknownRow.problem.kind).toBe('target');

    const duplicateKeyProject = createBaseProject();
    duplicateKeyProject.tables[0].rows[1] = {
      ...duplicateKeyProject.tables[0].rows[1],
      values: { ...duplicateKeyProject.tables[0].rows[1].values, id_column: 1 },
    };

    const duplicateKeyHash = createProjectHash(duplicateKeyProject);
    const duplicateMatch = checkDataPatch(
      duplicateKeyProject,
      {
        version: 1,
        baseHash: duplicateKeyHash,
        operations: [
          {
            op: 'upsertRows',
            tableId: 'item_table',
            keyColumnId: 'id_column',
            rows: [{ key: 1, values: { name_column: 'Merged' } }],
          },
        ],
      },
      { projectHash: duplicateKeyHash, validate: (next) => validateProject(next, t) },
    );
    expect(duplicateMatch.ok).toBe(false);
    if (duplicateMatch.ok) return;
    expect(duplicateMatch.problem.kind).toBe('conflict');

    const typeError = checkDataPatch(
      project,
      {
        version: 1,
        baseHash: projectHash,
        operations: [
          {
            op: 'addRows',
            tableId: 'item_table',
            rows: [{ values: { name_column: 123 as unknown as string } }],
          },
        ],
      },
      { projectHash, validate: (next) => validateProject(next, t) },
    );
    expect(typeError.ok).toBe(false);
    if (typeError.ok) return;
    expect(typeError.problem.kind).toBe('validation');

    const unchanged = JSON.stringify(project);
    const applied = applyDataPatch(project, {
      version: 1,
      baseHash: projectHash,
      operations: [
        {
          op: 'deleteRows',
          tableId: 'item_table',
          rowIds: ['missing'],
        },
      ],
    });
    expect(applied.ok).toBe(false);
    expect(JSON.stringify(project)).toBe(unchanged);
  });

  it('supports default values, auto increment and pre-existing validation errors', () => {
    const project = createBaseProject();
    const duplicateProject: ProjectFile = {
      ...project,
      tables: [
        {
          ...project.tables[0],
          rows: [
            project.tables[0].rows[0],
            { ...project.tables[0].rows[1], values: { ...project.tables[0].rows[1].values, id_column: 1 } },
          ],
        },
      ],
    };
    const duplicateProjectHash = createProjectHash(duplicateProject);

    const defaults = createDefaultRow(project.tables[0], 'row_new');
    expect(defaults.values.id_column).toBe(3);
    expect(defaults.values.kind_column).toBe('weapon');
    expect(defaults.values.meta_column).toBe('{}');
    expect(defaults.values.active_column).toBe(false);

    const acceptedWithExistingError = checkDataPatch(
      duplicateProject,
      {
        version: 1,
        baseHash: duplicateProjectHash,
        operations: [
          {
            op: 'updateRows',
            tableId: 'item_table',
            rows: [{ rowId: 'row_1', values: { name_column: 'Long Sword' } }],
          },
        ],
      },
      { projectHash: duplicateProjectHash, validate: (next) => validateProject(next, t) },
    );

    expect(acceptedWithExistingError.ok).toBe(true);
    if (!acceptedWithExistingError.ok) return;
    expect(acceptedWithExistingError.validation.before.errorCount).toBeGreaterThan(0);
    expect(acceptedWithExistingError.validation.newErrors).toHaveLength(0);

    const fixedDuplicate = checkDataPatch(
      duplicateProject,
      {
        version: 1,
        baseHash: duplicateProjectHash,
        operations: [
          {
            op: 'updateRows',
            tableId: 'item_table',
            rows: [{ rowId: 'row_2', values: { id_column: 2 } }],
          },
        ],
      },
      { projectHash: duplicateProjectHash, validate: (next) => validateProject(next, t) },
    );

    expect(fixedDuplicate.ok).toBe(true);
    if (!fixedDuplicate.ok) return;
    expect(fixedDuplicate.validation.resolvedErrors.some((issue) => issue.id.includes('primary-duplicate'))).toBe(true);
  });

  it('covers json, enum, ref and primary validation rules', () => {
    const project: ProjectFile = {
      version: 1,
      tables: [
        {
          id: 'bad_table',
          name: 'Bad',
          position: { x: 0, y: 0 },
          identity: { namespace: '', keyColumnId: 'code', valueColumnId: 'runtime_id' },
          columns: [
            { id: 'id', name: 'id', type: 'int', primary: true, required: true },
            { id: 'code', name: 'code', type: 'string', required: true },
            { id: 'runtime_id', name: 'runtime_id', type: 'int', required: true },
            { id: 'kind', name: 'kind', type: 'enum', enumValues: [] },
            { id: 'meta', name: 'meta', type: 'json', required: true },
            { id: 'target', name: 'target', type: 'ref', ref: { tableId: 'missing', columnId: 'missing' } },
          ],
          rows: [
            {
              _rowId: 'row_1',
              values: {
                id: 1,
                code: 'BAD_KEY',
                runtime_id: 1,
                kind: 'weapon',
                meta: '{',
                target: 999,
              },
            },
            {
              _rowId: 'row_2',
              values: {
                id: 1,
                code: 'BAD_KEY',
                runtime_id: 1,
                kind: 'weapon',
                meta: '{}',
                target: 999,
              },
            },
          ],
        },
      ],
    };

    const issues = validateProject(project, t);
    const issueIds = issues.map((issue) => issue.id);

    expect(issueIds.some((id) => id.includes('primary-duplicate'))).toBe(true);
    expect(issueIds.some((id) => id.includes('enum-empty'))).toBe(true);
    expect(issueIds.some((id) => id.includes('type-json'))).toBe(true);
    expect(issueIds.some((id) => id.includes('ref-target-missing'))).toBe(true);
  });

  it('produces stable export helpers for config ids and duplicate table names', () => {
    const project: ProjectFile = {
      version: 1,
      tables: [
        {
          id: 'speaker_a',
          name: 'Speaker',
          position: { x: 0, y: 0 },
          identity: { namespace: 'Sound', keyColumnId: 'key', valueColumnId: 'id' },
          columns: [
            { id: 'key', name: 'key', type: 'string', required: true },
            { id: 'id', name: 'id', type: 'int', required: true },
          ],
          rows: [{ _rowId: 'row_a', values: { key: 'CLICK', id: 1 } }],
        },
        {
          id: 'speaker_b',
          name: 'Speaker',
          position: { x: 1, y: 1 },
          columns: [{ id: 'value', name: 'value', type: 'string' }],
          rows: [{ _rowId: 'row_b', values: { value: 'x' } }],
        },
      ],
    };

    const files = projectJsonFiles(project);
    expect(files.map((file) => file.fileName)).toEqual(['config_ids.json', 'Speaker.json', 'Speaker_2.json']);
    expect(exportIdRegistry(project)).toEqual({ 'Sound.CLICK': 1 });
  });
});
