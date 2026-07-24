import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Text } from '../patch/dataPatch';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const createTempDir = () => mkdtempSync(join(tmpdir(), 'cfg-cli-'));

const writeProjectFile = (dir: string, fileName: string, project: unknown) => {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return filePath;
};

const runCfg = (args: string[], input?: string) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/cfg.ts', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    shell: false,
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
    const backupDir = join(dir, 'backups');
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
      '--transaction-id',
      'cli-batch-edit',
      '--backup-dir',
      backupDir,
      '--json',
    ], JSON.stringify(patch));
    expect(apply.code).toBe(0);
    const applyBody = parseJson(apply.stdout);
    expect(applyBody.applied).toBe(true);
    expect(applyBody.written).toBe(true);
    expect(readFileSync(applyBody.backupPath, 'utf8')).toBe(originalText);
    expect(applyBody.backupPath.startsWith(backupDir)).toBe(true);

    const updated = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(updated.tables[0].rows).toHaveLength(2);
    expect(updated.tables[0].rows[0].values.name_column).toBe('Long Sword');
    expect(updated.tables[0].rows.some((row: { values: { name_column: string } }) => row.values.name_column === 'Potion')).toBe(true);

    const beforeReportFailure = readFileSync(projectPath, 'utf8');
    const reportFailurePatch = {
      version: 1,
      baseHash: sha256Text(beforeReportFailure),
      operations: [
        {
          op: 'updateRows',
          tableId: 'item_table',
          rows: [{ rowId: 'row_1', values: { name_column: 'Must Roll Back' } }],
        },
      ],
    };
    const reportFailureCheck = parseJson(runCfg([
      'patch', 'check', '--project', projectPath, '--patch', '-', '--json',
    ], JSON.stringify(reportFailurePatch)).stdout);
    const invalidReportPath = join(dir, 'report-is-a-directory');
    mkdirSync(invalidReportPath);
    const reportFailure = runCfg([
      'patch', 'apply',
      '--project', projectPath,
      '--patch', '-',
      '--confirm', reportFailureCheck.confirmationHash,
      '--report', invalidReportPath,
      '--transaction-id', 'report-failure',
      '--backup-dir', backupDir,
      '--json',
    ], JSON.stringify(reportFailurePatch));
    expect(reportFailure.code).toBe(4);
    expect(readFileSync(projectPath, 'utf8')).toBe(beforeReportFailure);

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

  it('restores byte-identical content across a transaction and supports rollback with unique snapshots', () => {
    const dir = createTempDir();
    const backupDir = join(dir, 'app-data-backups');
    const projectPath = join(dir, 'project.json');
    const originalText = JSON.stringify(createProject(), null, 2);
    writeFileSync(projectPath, originalText, 'utf8');

    const applyOperations = (transactionId: string, operations: unknown[]) => {
      const currentText = readFileSync(projectPath, 'utf8');
      const patch = { version: 1, baseHash: sha256Text(currentText), operations };
      const check = parseJson(runCfg([
        'patch', 'check', '--project', projectPath, '--patch', '-', '--json',
      ], JSON.stringify(patch)).stdout);
      const applied = runCfg([
        'patch', 'apply',
        '--project', projectPath,
        '--patch', '-',
        '--confirm', check.confirmationHash,
        '--transaction-id', transactionId,
        '--backup-dir', backupDir,
        '--json',
      ], JSON.stringify(patch));
      expect(applied.code).toBe(0);
      return parseJson(applied.stdout);
    };

    const first = applyOperations('round-trip', [
      { op: 'addTable', tableId: 'temporary', name: 'Temporary', remark: 'Temporary AI table' },
    ]);
    applyOperations('round-trip', [{ op: 'deleteTable', tableId: 'temporary' }]);
    expect(readFileSync(projectPath, 'utf8')).toBe(originalText);

    const second = applyOperations('rollback-case', [
      { op: 'addTable', tableId: 'rollback_me', name: 'RollbackMe', remark: 'Rollback test table' },
    ]);
    expect(second.backupPath).not.toBe(first.backupPath);
    const beforeRollbackHash = sha256Text(readFileSync(projectPath, 'utf8'));
    const rollback = runCfg([
      'patch', 'rollback',
      '--project', projectPath,
      '--transaction-id', 'rollback-case',
      '--confirm', beforeRollbackHash,
      '--backup-dir', backupDir,
      '--json',
    ]);
    expect(rollback.code).toBe(0);
    expect(parseJson(rollback.stdout)).toMatchObject({ rolledBack: true, written: true });
    expect(readFileSync(projectPath, 'utf8')).toBe(originalText);
  });

  it('handles Windows-style absolute paths and UTF-8 project content', () => {
    const dir = createTempDir();
    const unicodeDir = join(dir, '中文 配置');
    mkdirSync(unicodeDir, { recursive: true });
    const project = createProject();
    project.tables[0].remark = '中文备注：掉落与装备';
    const projectPath = writeProjectFile(unicodeDir, '游戏配置.json', project);

    const inspected = runCfg(['inspect', '--project', projectPath, '--json']);
    expect(inspected.code).toBe(0);
    expect(parseJson(inspected.stdout).tables[0].remark).toBe('中文备注：掉落与装备');
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

    const failedDir = join(dir, 'failed-all');
    mkdirSync(failedDir);
    writeFileSync(join(failedDir, 'config_ids.json'), 'original ids', 'utf8');
    mkdirSync(join(failedDir, 'Item.json'));
    const atomicFailure = runCfg([
      'export',
      'all',
      '--project',
      projectPath,
      '--out',
      failedDir,
      '--overwrite',
      '--json',
    ]);
    expect(atomicFailure.code).toBe(4);
    expect(readFileSync(join(failedDir, 'config_ids.json'), 'utf8')).toBe('original ids');
  }, 20000);
});
