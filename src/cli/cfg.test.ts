import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Text } from '../patch/dataPatch';
import { projectKeyForPath } from '../export/projectKey';

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
  exportPolicy: 'explicit' as const,
  tables: [
    {
      id: 'item_table',
      name: 'Item',
      remark: 'Item definitions for gameplay',
      publish: true,
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id_column', name: 'id', type: 'int', primary: true, required: true, autoIncrement: true },
        { id: 'name_column', name: 'name', type: 'string', required: true },
        { id: 'kind_column', name: 'kind', type: 'enum', enumValues: ['weapon', 'potion'] },
      ],
      rows: [
        {
          _rowId: 'row_1',
          publish: true,
          values: { id_column: 1, name_column: 'Sword', kind_column: 'weapon' },
        },
        {
          _rowId: 'row_2',
          publish: true,
          values: { id_column: 2, name_column: 'Shield', kind_column: 'weapon' },
        },
      ],
    },
    {
      id: 'loot_table',
      name: 'Item',
      publish: true,
      position: { x: 320, y: 0 },
      columns: [
        { id: 'value_column', name: 'value', type: 'string' },
        {
          id: 'item_ref_column',
          name: 'itemId',
          type: 'ref',
          ref: { tableId: 'item_table', columnId: 'id_column' },
        },
      ],
      rows: [
        {
          _rowId: 'row_3',
          publish: true,
          values: { value_column: 'Loose', item_ref_column: 1 },
        },
      ],
    },
  ],
});

const createProfileProject = () => ({
  version: 3,
  releaseProfiles: {
    version: 1,
    activeProfileId: 'profile_a',
    profiles: [
      { id: 'profile_a', name: 'A all', mode: 'all' },
      {
        id: 'profile_b',
        name: 'B selected',
        mode: 'selected',
        tables: [{ tableId: 'item_table', rows: ['row_1'] }],
      },
    ],
  },
  tables: [
    {
      id: 'item_table',
      name: 'Item',
      remark: 'Item definitions for gameplay',
      position: { x: 0, y: 0 },
      columns: [
        { id: 'id_column', name: 'id', type: 'int', primary: true, required: true },
        { id: 'name_column', name: 'name', type: 'string', required: true },
      ],
      rows: [
        { _rowId: 'row_1', values: { id_column: 1, name_column: 'Sword' } },
        { _rowId: 'row_2', values: { id_column: 2, name_column: 'Shield' } },
      ],
    },
    {
      id: 'extra_table',
      name: 'Extra',
      remark: 'Only the full release includes this table',
      position: { x: 320, y: 0 },
      columns: [{ id: 'value_column', name: 'value', type: 'string' }],
      rows: [{ _rowId: 'row_extra', values: { value_column: 'all only' } }],
    },
  ],
});

describe('cfg cli', () => {  it('prints inspect and validate JSON with stable hashes', () => {
    const dir = createTempDir();
    const project = createProject();
    const projectPath = writeProjectFile(dir, 'project.json', project);

    const inspect = runCfg(['inspect', '--project', projectPath, '--json']);
    expect(inspect.code).toBe(0);
    const inspectBody = parseJson(inspect.stdout);
    expect(inspectBody.ok).toBe(true);
    expect(inspectBody.projectHash).toBe(sha256Text(`${JSON.stringify(project, null, 2)}\n`));
    expect(inspectBody.version).toBe(3);
    expect(inspectBody.tableCount).toBe(2);
    expect(inspectBody.releaseProfiles).toMatchObject({
      activeProfileId: 'profile_default',
      profiles: [
        {
          id: 'profile_default',
          name: 'Default',
          mode: 'selected',
          tableCount: 2,
          rowCount: 3,
        },
      ],
    });
    expect(inspectBody.profile).toMatchObject({
      id: 'profile_default',
      mode: 'selected',
      tableCount: 2,
      rowCount: 3,
    });
    expect(inspectBody.publishScope).toMatchObject({
      profileId: 'profile_default',
      configured: true,
      publishableTableCount: 2,
      publishableRowCount: 3,
    });
    expect(inspectBody.tables[0]).toMatchObject({
      tableId: 'item_table',
      publish: true,
      publishableRowCount: 2,
    });
    expect(inspectBody.referenceSemantics.cellValue).toContain("target column's actual value");
    expect(inspectBody.relationships).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ tableId: 'loot_table', columnId: 'item_ref_column' }),
        target: expect.objectContaining({
          tableId: 'item_table',
          columnId: 'id_column',
          exists: true,
          isPrimary: true,
        }),
        status: 'valid',
      }),
    ]);

    const tableInspect = runCfg(['inspect', '--project', projectPath, '--table', 'item_table', '--offset', '1', '--limit', '1', '--json']);
    expect(tableInspect.code).toBe(0);
    const tableBody = parseJson(tableInspect.stdout);
    expect(tableBody.table.tableId).toBe('item_table');
    expect(tableBody.table.remark).toBe('Item definitions for gameplay');
    expect(tableBody.table.publish).toBe(true);
    expect(tableBody.table.rows[0].publish).toBe(true);
    expect(tableBody.table.offset).toBe(1);
    expect(tableBody.table.returnedRows).toBe(1);
    expect(tableBody.table.rows[0].rowId).toBe('row_2');
    expect(tableBody.table.relationships).toHaveLength(1);

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
    expect(body.rows[0].publish).toBe(true);

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
    const outDir = join(dir, 'out');
    mkdirSync(outDir, { recursive: true });

    const tableOut = join(outDir, 'item.json');
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

    const idsOut = join(outDir, 'config_ids.json');
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

    const allDir = join(outDir, 'all');
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

  it('previews and publishes with a confirmation hash and stale-file cleanup', () => {
    const dir = createTempDir();
    const projectPath = writeProjectFile(dir, 'project.json', createProject());
    const outDir = join(dir, 'published');
    mkdirSync(outDir, { recursive: true });

    const preview = runCfg([
      'publish',
      '--project',
      projectPath,
      '--out',
      outDir,
      '--dry-run',
      '--json',
    ]);
    expect(preview.code).toBe(0);
    const previewBody = parseJson(preview.stdout);
    expect(previewBody.confirmationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(previewBody.files).toEqual(
      expect.arrayContaining(['config_ids.json', 'Item.json', 'Item_2.json']),
    );
    expect(existsSync(join(outDir, 'Item.json'))).toBe(false);

    const published = runCfg([
      'publish',
      '--project',
      projectPath,
      '--out',
      outDir,
      '--confirm',
      previewBody.confirmationHash,
      '--json',
    ]);
    expect(published.code).toBe(0);
    expect(existsSync(join(outDir, 'Item.json'))).toBe(true);
    expect(existsSync(join(outDir, 'Item_2.json'))).toBe(true);
    expect(existsSync(join(outDir, '.configra-publish.json'))).toBe(true);

    const changed = createProject();
    changed.tables[1].publish = false;
    writeFileSync(projectPath, `${JSON.stringify(changed, null, 2)}\n`, 'utf8');

    const secondPreview = runCfg([
      'publish',
      '--project',
      projectPath,
      '--out',
      outDir,
      '--dry-run',
      '--json',
    ]);
    const secondBody = parseJson(secondPreview.stdout);
    expect(secondBody.files).not.toContain('Item_2.json');
    const secondPublished = runCfg([
      'publish',
      '--project',
      projectPath,
      '--out',
      outDir,
      '--confirm',
      secondBody.confirmationHash,
      '--json',
    ]);
    expect(secondPublished.code).toBe(0);
    expect(existsSync(join(outDir, 'Item_2.json'))).toBe(false);
  }, 20000);

  it('runs export, publish and confirmation binding per release profile', () => {
    const dir = createTempDir();
    const projectPath = writeProjectFile(dir, 'project.json', createProfileProject());
    const runExportFor = (profile: string, outDir: string) =>
      runCfg([
        'export',
        'all',
        '--project',
        projectPath,
        '--profile',
        profile,
        '--out',
        outDir,
        '--json',
      ]);

    const allDir = join(dir, 'export-all');
    const selectedDir = join(dir, 'export-selected');
    const allExport = runExportFor('profile_a', allDir);
    const selectedExport = runExportFor('profile_b', selectedDir);
    expect(allExport.code).toBe(0);
    expect(selectedExport.code).toBe(0);

    expect(JSON.parse(allExport.stdout)).toMatchObject({
      profileId: 'profile_a',
      profileMode: 'all',
      tableCount: 2,
      rowCount: 3,
    });
    expect(JSON.parse(selectedExport.stdout)).toMatchObject({
      profileId: 'profile_b',
      profileMode: 'selected',
      tableCount: 1,
      rowCount: 1,
    });

    expect(existsSync(join(allDir, 'Extra.json'))).toBe(true);
    expect(existsSync(join(selectedDir, 'Extra.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(allDir, 'Item.json'), 'utf8'))).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(selectedDir, 'Item.json'), 'utf8'))).toHaveLength(1);

    // 目录 A / B 各自发布，互不清理。
    const publishFor = (profile: string, outDir: string, confirm?: string) =>
      runCfg(
        [
          'publish',
          '--project',
          projectPath,
          '--profile',
          profile,
          '--out',
          outDir,
          ...(confirm ? ['--confirm', confirm] : ['--dry-run']),
          '--json',
        ],
      );
    const publishDirA = join(dir, 'pub-a');
    const publishDirB = join(dir, 'pub-b');
    const previewA = parseJson(publishFor('profile_a', publishDirA).stdout);
    const previewB = parseJson(publishFor('profile_b', publishDirB).stdout);
    expect(publishFor('profile_a', publishDirA, previewA.confirmationHash).code).toBe(0);
    expect(publishFor('profile_b', publishDirB, previewB.confirmationHash).code).toBe(0);

    expect(existsSync(join(publishDirA, 'Extra.json'))).toBe(true);
    expect(existsSync(join(publishDirA, 'Item.json'))).toBe(true);
    expect(existsSync(join(publishDirB, 'Extra.json'))).toBe(false);
    expect(existsSync(join(publishDirB, 'Item.json'))).toBe(true);

    const republishB = parseJson(publishFor('profile_b', publishDirB).stdout);
    expect(publishFor('profile_b', publishDirB, republishB.confirmationHash).code).toBe(0);
    expect(existsSync(join(publishDirA, 'Extra.json'))).toBe(true);
    expect(existsSync(join(publishDirA, 'Item.json'))).toBe(true);

    const crossProfile = publishFor('profile_b', publishDirA);
    expect(crossProfile.code).toBe(2);
    expect(parseJson(crossProfile.stdout).error.kind).toBe('FOREIGN_RELEASE_PROFILE');
    expect(existsSync(join(publishDirA, 'Extra.json'))).toBe(true);

    // 确认值绑定 profile 与目录：换方案或换目录后旧确认值失效。
    const sharedDir = join(dir, 'shared');
    const hashForA = parseJson(publishFor('profile_a', sharedDir).stdout);
    const hashForB = parseJson(publishFor('profile_b', sharedDir).stdout);
    expect(hashForA.confirmationHash).not.toBe(hashForB.confirmationHash);

    const wrongProfileConfirm = publishFor('profile_b', sharedDir, hashForA.confirmationHash);
    expect(wrongProfileConfirm.code).toBe(3);

    const otherDirConfirm = runCfg([
      'publish',
      '--project',
      projectPath,
      '--profile',
      'profile_a',
      '--out',
      join(dir, 'shared-other'),
      '--confirm',
      hashForA.confirmationHash,
      '--json',
    ]);
    expect(otherDirConfirm.code).toBe(3);
    expect(publishFor('profile_b', sharedDir, hashForB.confirmationHash).code).toBe(0);

    // 多方案时未显式传 --profile 使用 active profile，并在结果中标记。
    const implicitActive = parseJson(
      runCfg([
        'publish',
        '--project',
        projectPath,
        '--out',
        join(dir, 'implicit'),
        '--dry-run',
        '--json',
      ]).stdout,
    );
    expect(implicitActive).toMatchObject({
      profileId: 'profile_a',
      profileSource: 'active',
      profileImplicit: true,
    });
  }, 30000);

  it('adopts a legacy publish manifest only with an explicit confirmation and keeps unknown files', () => {
    const dir = createTempDir();
    const projectPath = writeProjectFile(dir, 'project.json', createProfileProject());
    const outDir = join(dir, 'legacy');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Old.json'), '[]', 'utf8');
    writeFileSync(
      join(outDir, '.configra-publish.json'),
      `${JSON.stringify({
        version: 1,
        projectKey: projectKeyForPath(projectPath),
        updatedAt: '2025-01-01T00:00:00.000Z',
        files: { 'Old.json': 'sha256:unknown' },
      })}\n`,
      'utf8',
    );

    const preview = runCfg([
      'publish',
      '--project',
      projectPath,
      '--profile',
      'profile_a',
      '--out',
      outDir,
      '--dry-run',
      '--json',
    ]);
    expect(preview.code).toBe(0);
    const previewBody = parseJson(preview.stdout);
    expect(previewBody.legacyManifest).toBe(true);
    expect(previewBody.manifestProfileId).toBeNull();

    const published = runCfg([
      'publish',
      '--project',
      projectPath,
      '--profile',
      'profile_a',
      '--out',
      outDir,
      '--confirm',
      previewBody.confirmationHash,
      '--json',
    ]);
    expect(published.code).toBe(0);
    expect(existsSync(join(outDir, 'Old.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(outDir, '.configra-publish.json'), 'utf8'));
    expect(manifest.profileId).toBe('profile_a');
    expect(manifest.files).not.toHaveProperty('Old.json');
  }, 30000);

  it('blocks unscoped export unless --all is explicit', () => {
    const dir = createTempDir();
    const project = createProject();
    delete (project as { exportPolicy?: string }).exportPolicy;
    for (const table of project.tables) {
      delete (table as { publish?: boolean }).publish;
      for (const row of table.rows) {
        delete (row as { publish?: boolean }).publish;
      }
    }
    const projectPath = writeProjectFile(dir, 'project.json', project);
    const outDir = join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    const tableOut = join(outDir, 'item.json');

    const blocked = runCfg([
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
    expect(blocked.code).toBe(2);
    expect(parseJson(blocked.stdout).error.kind).toBe('TABLE_NOT_PUBLISHED');

    const explicit = runCfg([
      'export',
      'table',
      '--project',
      projectPath,
      '--table',
      'item_table',
      '--out',
      tableOut,
      '--all',
      '--json',
    ]);
    expect(explicit.code).toBe(0);
    expect(JSON.parse(readFileSync(tableOut, 'utf8'))).toHaveLength(2);
  });
});
