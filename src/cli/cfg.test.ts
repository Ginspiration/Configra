import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Text } from '../patch/dataPatch';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const npmCommand = 'npm';

const createTempDir = () => mkdtempSync(join(tmpdir(), 'cfg-cli-'));

const writeProjectFile = (dir: string, fileName: string, project: unknown) => {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return filePath;
};

const runCfg = (args: string[], input?: string) => {
  const command = `${npmCommand} run --silent cfg -- ${args.join(' ')}`;
  const result = spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    code: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

const parseJson = (stdout: string) => JSON.parse(stdout.trim());

const createProject = () => ({
  version: 1 as const,
  tables: [
    {
      id: 'item_table',
      name: 'Item',
      remark: 'Item definitions for gameplay',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id_column', name: 'id', type: 'int', primary: true, required: true, autoIncrement: true },
        { id: 'name_column', name: 'name', type: 'string', required: true },
        { id: 'kind_column', name: 'kind', type: 'enum', enumValues: ['weapon', 'potion'] },
      ],
      rows: [
        {
          _rowId: 'row_1',
          values: { id_column: 1, name_column: 'Sword', kind_column: 'weapon' },
        },
        {
          _rowId: 'row_2',
          values: { id_column: 2, name_column: 'Shield', kind_column: 'weapon' },
        },
      ],
    },
    {
      id: 'loot_table',
      name: 'Item',
      position: { x: 320, y: 0 },
      columns: [{ id: 'value_column', name: 'value', type: 'string' }],
      rows: [{ _rowId: 'row_3', values: { value_column: 'Loose' } }],
    },
  ],
});

describe('cfg cli', () => {
  it('prints inspect and validate JSON with stable hashes', () => {
    const dir = createTempDir();
    const project = createProject();
    const projectPath = writeProjectFile(dir, 'project.json', project);

    const inspect = runCfg(['inspect', '--project', projectPath, '--json']);
    expect(inspect.code).toBe(0);
    const inspectBody = parseJson(inspect.stdout);
    expect(inspectBody.ok).toBe(true);
    expect(inspectBody.projectHash).toBe(sha256Text(`${JSON.stringify(project, null, 2)}\n`));
    expect(inspectBody.tableCount).toBe(2);

    const tableInspect = runCfg(['inspect', '--project', projectPath, '--table', 'item_table', '--offset', '1', '--limit', '1', '--json']);
    expect(tableInspect.code).toBe(0);
    const tableBody = parseJson(tableInspect.stdout);
    expect(tableBody.table.tableId).toBe('item_table');
    expect(tableBody.table.remark).toBe('Item definitions for gameplay');
    expect(tableBody.table.offset).toBe(1);
    expect(tableBody.table.returnedRows).toBe(1);
    expect(tableBody.table.rows[0].rowId).toBe('row_2');

    const validate = runCfg(['validate', '--project', projectPath, '--json']);
    expect(validate.code).toBe(0);
    const validateBody = parseJson(validate.stdout);
    expect(validateBody.ok).toBe(true);
    expect(validateBody.errorCount).toBe(0);
  });

  it('queries rows with typed equality, contains, all/any and pagination', () => {
    const dir = createTempDir();
    const projectPath = writeProjectFile(dir, 'project.json', createProject());
    const query = runCfg(
      ['query', 'rows', '--project', projectPath, '--query', '-', '--json'],
      JSON.stringify({
        tableId: 'item_table',
        match: 'all',
        filters: [
          { columnId: 'kind_column', op: 'eq', value: 'weapon' },
          { columnId: 'name_column', op: 'contains', value: 'swo' },
        ],
        offset: 0,
        limit: 10,
      }),
    );
    expect(query.code).toBe(0);
    const body = parseJson(query.stdout);
    expect(body.totalMatches).toBe(1);
    expect(body.rows[0].rowId).toBe('row_1');

    const wrongType = runCfg(
      ['query', 'rows', '--project', projectPath, '--query', '-', '--json'],
      JSON.stringify({
        tableId: 'item_table',
        filters: [{ columnId: 'id_column', op: 'eq', value: '1' }],
      }),
    );
    expect(wrongType.code).toBe(0);
    expect(parseJson(wrongType.stdout).totalMatches).toBe(0);
  });

  it('checks, applies, backs up and rejects stale confirmations', () => {
    const dir = createTempDir();
    const project = createProject();
    const projectPath = writeProjectFile(dir, 'project.json', project);
    const originalText = readFileSync(projectPath, 'utf8');

    const patch = {
      version: 1,
      baseHash: sha256Text(originalText),
      description: 'cli batch edit',
      operations: [
        {
          op: 'updateRows',
          tableId: 'item_table',
          rows: [{ rowId: 'row_1', values: { name_column: 'Long Sword' } }],
        },
        {
          op: 'addRows',
          tableId: 'item_table',
          rows: [{ values: { name_column: 'Potion' } }],
        },
        {
          op: 'deleteRows',
          tableId: 'item_table',
          rowIds: ['row_2'],
        },
      ],
    };

    const check = runCfg(['patch', 'check', '--project', projectPath, '--patch', '-', '--json'], JSON.stringify(patch));
    expect(check.code).toBe(0);
    const checkBody = parseJson(check.stdout);
    expect(checkBody.ok).toBe(true);
    expect(checkBody.confirmationHash).toMatch(/^sha256:/);
    expect(checkBody.changeCount).toBeGreaterThan(0);

    const apply = runCfg([
      'patch',
      'apply',
      '--project',
      projectPath,
      '--patch',
      '-',
      '--confirm',
      checkBody.confirmationHash,
      '--json',
    ], JSON.stringify(patch));
    expect(apply.code).toBe(0);
    const applyBody = parseJson(apply.stdout);
    expect(applyBody.applied).toBe(true);
    expect(applyBody.written).toBe(true);
    expect(readFileSync(`${projectPath}.bak`, 'utf8')).toBe(originalText);

    const updated = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(updated.tables[0].rows).toHaveLength(2);
    expect(updated.tables[0].rows[0].values.name_column).toBe('Long Sword');
    expect(updated.tables[0].rows.some((row: { values: { name_column: string } }) => row.values.name_column === 'Potion')).toBe(true);

    const staleApply = runCfg([
      'patch',
      'apply',
      '--project',
      projectPath,
      '--patch',
      '-',
      '--confirm',
      checkBody.confirmationHash,
      '--json',
    ], JSON.stringify({
      ...patch,
      description: 'tampered after review',
      operations: [
        {
          op: 'updateRows',
          tableId: 'item_table',
          rows: [{ rowId: 'row_1', values: { name_column: 'Great Sword' } }],
        },
      ],
    }));
    expect(staleApply.code).toBe(3);

    const beforeRejected = readFileSync(projectPath, 'utf8');
    const rejected = runCfg([
      'patch',
      'apply',
      '--project',
      projectPath,
      '--patch',
      '-',
      '--confirm',
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      '--json',
    ], JSON.stringify(patch));
    expect(rejected.code).toBe(3);
    expect(readFileSync(projectPath, 'utf8')).toBe(beforeRejected);
  });

  it('exports tables, ids and all files without overwriting by default', () => {
    const dir = createTempDir();
    const project = createProject();
    const projectPath = writeProjectFile(dir, 'project.json', project);

    const tableOut = join(dir, 'item.json');
    const exportTable = runCfg([
      'export',
      'table',
      '--project',
      projectPath,
      '--table',
      'item_table',
      '--out',
      tableOut,
      '--json',
    ]);
    expect(exportTable.code).toBe(0);
    expect(JSON.parse(readFileSync(tableOut, 'utf8'))).toHaveLength(2);
    expect(readFileSync(tableOut, 'utf8')).not.toContain('Item definitions for gameplay');

    const idsOut = join(dir, 'config_ids.json');
    const exportIds = runCfg([
      'export',
      'ids',
      '--project',
      projectPath,
      '--out',
      idsOut,
      '--json',
    ]);
    expect(exportIds.code).toBe(0);
    expect(JSON.parse(readFileSync(idsOut, 'utf8'))).toEqual({});

    const allDir = join(dir, 'all');
    const exportAll = runCfg([
      'export',
      'all',
      '--project',
      projectPath,
      '--out',
      allDir,
      '--json',
    ]);
    expect(exportAll.code).toBe(0);
    expect(readFileSync(join(allDir, 'config_ids.json'), 'utf8')).toContain('{}');
    expect(readFileSync(join(allDir, 'Item.json'), 'utf8')).toContain('Sword');
    expect(readFileSync(join(allDir, 'Item_2.json'), 'utf8')).toContain('Loose');

    const refused = runCfg([
      'export',
      'all',
      '--project',
      projectPath,
      '--out',
      allDir,
      '--json',
    ]);
    expect(refused.code).toBe(4);

    const overwrite = runCfg([
      'export',
      'all',
      '--project',
      projectPath,
      '--out',
      allDir,
      '--overwrite',
      '--json',
    ]);
    expect(overwrite.code).toBe(0);
  }, 20000);
});
