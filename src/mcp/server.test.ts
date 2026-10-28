import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { startMcpHttpServer } from './server';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runningServers: Array<Awaited<ReturnType<typeof startMcpHttpServer>>['httpServer']> = [];

afterEach(async () => {
  await Promise.all(
    runningServers.splice(0).map(
      (server) => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    ),
  );
});

const parseToolText = (rawResult: unknown) => {
  const result = rawResult as { content: Array<{ type: string; text?: string }> };
  const block = result.content.find((content) => content.type === 'text');
  if (!block?.text) throw new Error('Tool did not return text JSON.');
  return JSON.parse(block.text) as Record<string, unknown>;
};

describe('Configra MCP server', () => {
  it('keeps previous diagnostics and exposes a health check', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-health-'));
    const configDir = join(root, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'mcp-logs.jsonl'),
      `${JSON.stringify({ timestamp: '0', level: 'error', message: 'Previous startup diagnostic.' })}\n`,
      'utf8',
    );

    const started = await startMcpHttpServer({ configDir, port: 0, repoDir: repoRoot });
    runningServers.push(started.httpServer);

    const health = await fetch(`http://127.0.0.1:${started.port}${started.healthPath}`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: 'configra' });

    const logs = readFileSync(join(configDir, 'mcp-logs.jsonl'), 'utf8');
    expect(logs).toContain('Previous startup diagnostic.');
    expect(logs).toContain('MCP service listening on 127.0.0.1:');
  });

  it('serves tools, applies scoped dirty access and writes confirmed CLI patches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-'));
    const configDir = join(root, 'config');
    const projectPath = join(root, 'project.configra.json');
    const project = {
      version: 1,
      tables: [
        {
          id: 'items',
          name: 'Items',
          position: { x: 0, y: 0 },
          columns: [
            { id: 'id', name: 'id', type: 'int', primary: true, required: true },
            { id: 'name', name: 'name', type: 'string' },
          ],
          rows: [
            { _rowId: 'row_1', values: { id: 1, name: 'Sword' } },
            { _rowId: 'row_2', values: { id: 2, name: 'Shield' } },
          ],
        },
        {
          id: 'drops',
          name: 'Drops',
          position: { x: 320, y: 0 },
          columns: [
            { id: 'drop_id', name: 'id', type: 'int', primary: true, required: true },
            {
              id: 'item_id',
              name: 'itemId',
              type: 'ref',
              ref: { tableId: 'items', columnId: 'id' },
            },
            { id: 'item_link', name: 'itemLink', type: 'string' },
          ],
          rows: [{ _rowId: 'drop_row_1', values: { drop_id: 1, item_id: 1 } }],
        },
      ],
    };
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    const writeContext = (
      dirtyScope: 'none' | 'layout' | 'content',
      fullAccess = false,
    ) => {
      writeFileSync(
        join(configDir, 'mcp-context.json'),
        `${JSON.stringify({
          version: 1,
          projectPath,
          uiDirty: dirtyScope !== 'none',
          dirtyScope,
          fullAccess,
          revision: dirtyScope === 'none' ? 1 : 2,
          updatedAt: new Date().toISOString(),
        })}\n`,
        'utf8',
      );
    };
    mkdirSync(configDir, { recursive: true });
    writeContext('none');

    const started = await startMcpHttpServer({ configDir, port: 0, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp`),
    );
    await client.connect(transport);

    expect(client.getServerVersion()).toMatchObject({
      name: 'configra',
      title: 'Configra',
    });
    expect(client.getServerCapabilities()).toHaveProperty('tools');
    expect(client.getServerCapabilities()).not.toHaveProperty('resources');

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'configra_inspect_project',
        'configra_query_rows',
        'configra_preview_patch',
        'configra_preview_define_ref',
        'configra_preview_assign_refs',
        'configra_apply_patch',
        'configra_rollback_transaction',
        'configra_export_all',
        'configra_preview_publish',
        'configra_publish_all',
        'configra_preview_set_table_publish',
        'configra_preview_set_rows_publish',
        'configra_preview_set_active_release_profile',
      ]),
    );
    const exportAllTool = tools.tools.find((tool) => tool.name === 'configra_export_all');
    expect(JSON.stringify(exportAllTool?.inputSchema)).toContain('includeUnpublished');
    expect(JSON.stringify(exportAllTool?.inputSchema)).toContain('profileId');
    expect(
      JSON.stringify(
        tools.tools.find((tool) => tool.name === 'configra_preview_publish')?.inputSchema,
      ),
    ).toContain('profileId');

    const previewTool = tools.tools.find((tool) => tool.name === 'configra_preview_patch');
    const publicPatchSchema = JSON.stringify(previewTool?.inputSchema);
    for (const operation of [
      'addTable',
      'updateTable',
      'deleteTable',
      'addColumn',
      'updateColumn',
      'moveColumn',
      'deleteColumn',
      'updateRows',
      'upsertRows',
      'addRows',
      'deleteRows',
      'setTablePublish',
      'setRowsPublish',
      'setActiveReleaseProfile',
    ]) {
      expect(publicPatchSchema).toContain(`"const":"${operation}"`);
    }
    expect(publicPatchSchema).toContain('remark');
    expect(publicPatchSchema).toContain("referenced target column's actual value");
    expect(publicPatchSchema).toContain('Optional ID-registry metadata');
    expect(publicPatchSchema).toContain('Most configuration, parameter, detail, and relationship tables');
    expect(publicPatchSchema).toContain('Do not add identity or symbol-key/runtime-ID columns');
    expect(publicPatchSchema).toContain('Do not create identity merely to define a ref');
    expect(previewTool?.description).toContain('Do not add identity or symbol-key/runtime-ID columns');

    const assignRefTool = tools.tools.find((tool) => tool.name === 'configra_preview_assign_refs');
    expect(assignRefTool?.description).toContain('targetRowId itself is never stored');

    const defineRefTool = tools.tools.find((tool) => tool.name === 'configra_preview_define_ref');
    expect(defineRefTool?.description).toContain('Do not create identity merely to define a ref');

    const status = parseToolText(await client.callTool({ name: 'configra_get_status', arguments: {} }));
    expect(status).toMatchObject({
      serverId: 'configra',
      sourceId: 'configra',
      displayName: 'Configra',
      supportedCapabilities: ['tools'],
    });

    const inspected = parseToolText(await client.callTool({ name: 'configra_inspect_table', arguments: { tableId: 'items' } }));
    expect(inspected).toHaveProperty('table');
    expect((inspected.table as { rows: unknown[] }).rows).toHaveLength(2);
    expect((inspected.table as { relationships: unknown[] }).relationships).toHaveLength(1);
    expect(
      (inspected.table as { referenceSemantics: { identity: string } }).referenceSemantics.identity,
    ).toContain('Most configuration, parameter, detail, and relationship tables');

    const definedRef = await client.callTool({
      name: 'configra_preview_define_ref',
      arguments: {
        sourceTableId: 'drops',
        sourceColumnId: 'item_link',
        targetTableId: 'items',
        targetColumnId: 'id',
      },
    });
    expect(definedRef.isError).not.toBe(true);
    expect(parseToolText(definedRef)).toMatchObject({
      accepted: true,
      referenceChanges: [
        {
          action: 'define',
          source: { tableId: 'drops', columnId: 'item_link' },
          target: { tableId: 'items', columnId: 'id' },
        },
      ],
    });

    const assignedRef = await client.callTool({
      name: 'configra_preview_assign_refs',
      arguments: {
        sourceTableId: 'drops',
        sourceColumnId: 'item_id',
        assignments: [{ sourceRowId: 'drop_row_1', targetRowId: 'row_2' }],
      },
    });
    expect(assignedRef.isError).not.toBe(true);
    const assignedRefBody = parseToolText(assignedRef);
    expect(assignedRefBody).toMatchObject({
      accepted: true,
      referenceAssignments: {
        source: { tableId: 'drops', columnId: 'item_id' },
        target: { tableId: 'items', columnId: 'id' },
        assignmentCount: 1,
        assignments: [
          { sourceRowId: 'drop_row_1', targetRowId: 'row_2', storedValue: 2 },
        ],
      },
    });
    expect(assignedRefBody.patch).toMatchObject({
      operations: [
        {
          op: 'updateRows',
          tableId: 'drops',
          rows: [{ rowId: 'drop_row_1', values: { item_id: 2 } }],
        },
      ],
    });
    const appliedRef = parseToolText(await client.callTool({
      name: 'configra_apply_patch',
      arguments: {
        patch: assignedRefBody.patch,
        confirmationHash: assignedRefBody.confirmationHash,
      },
    }));
    expect(appliedRef.written).toBe(true);
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).tables[1].rows[0].values.item_id).toBe(2);
    const rolledBackRef = parseToolText(await client.callTool({
      name: 'configra_rollback_transaction',
      arguments: {
        transactionId: appliedRef.transactionId,
        expectedProjectHash: appliedRef.resultingProjectHash,
      },
    }));
    expect(rolledBackRef.rolledBack).toBe(true);
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).tables[1].rows[0].values.item_id).toBe(1);

    const queried = parseToolText(await client.callTool({
      name: 'configra_query_rows',
      arguments: {
        tableId: 'items',
        filters: [{ columnId: 'name', op: 'contains', value: 'swo' }],
      },
    }));
    expect(queried.totalMatches).toBe(1);

    writeContext('layout');
    const layoutPreview = await client.callTool({
      name: 'configra_preview_patch',
      arguments: { operations: [{ op: 'updateRows', tableId: 'items', rows: [] }] },
    });
    expect(layoutPreview.isError).not.toBe(true);

    writeContext('content');
    const blocked = await client.callTool({
      name: 'configra_preview_patch',
      arguments: { operations: [{ op: 'updateRows', tableId: 'items', rows: [] }] },
    });
    expect(blocked.isError).toBe(true);
    expect(parseToolText(blocked).error).toMatchObject({
      code: 'UI_DIRTY_CONFLICT',
      serverId: 'configra',
      supportedCapabilities: ['tools'],
    });

    writeContext('content', true);
    const fullAccessPreview = await client.callTool({
      name: 'configra_preview_patch',
      arguments: { operations: [{ op: 'updateRows', tableId: 'items', rows: [] }] },
    });
    expect(fullAccessPreview.isError).not.toBe(true);
    expect(parseToolText(fullAccessPreview).fullAccess).toBe(true);

    writeContext('none');
    const previewResult = await client.callTool({
      name: 'configra_preview_patch',
      arguments: {
        description: 'Rename sword',
        operations: [
          { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Long Sword' } }] },
        ],
      },
    });
    expect(previewResult.isError).not.toBe(true);
    const preview = parseToolText(previewResult);
    expect(preview.confirmationHash).toMatch(/^sha256:/);

    const applied = parseToolText(await client.callTool({
      name: 'configra_apply_patch',
      arguments: { patch: preview.patch, confirmationHash: preview.confirmationHash },
    }));
    expect(applied.written).toBe(true);
    expect(applied.resultingProjectHash).toMatch(/^sha256:/);
    const updated = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(updated.tables[0].rows[0].values.name).toBe('Long Sword');
    const events = JSON.parse(
      readFileSync(join(configDir, 'mcp-events', `${String(applied.projectId)}.json`), 'utf8'),
    );
    expect(events.changeRevision).toBe(3);
    expect(events.serverId).toBe('configra');

    const rolledBack = parseToolText(await client.callTool({
      name: 'configra_rollback_transaction',
      arguments: {
        transactionId: applied.transactionId,
        expectedProjectHash: applied.resultingProjectHash,
      },
    }));
    expect(rolledBack).toMatchObject({ rolledBack: true, written: true });
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).tables[0].rows[0].values.name).toBe('Sword');

    const secondClient = new Client({ name: 'configra-test-2', version: '1.0.0' });
    await secondClient.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp`),
    ));
    const [concurrentPreviewA, concurrentPreviewB] = await Promise.all([
      client.callTool({
        name: 'configra_preview_patch',
        arguments: {
          operations: [
            { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Client A' } }] },
          ],
        },
      }),
      secondClient.callTool({
        name: 'configra_preview_patch',
        arguments: {
          operations: [
            { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Client B' } }] },
          ],
        },
      }),
    ]);
    const previewA = parseToolText(concurrentPreviewA);
    const previewB = parseToolText(concurrentPreviewB);
    const concurrentResults = await Promise.all([
      client.callTool({
        name: 'configra_apply_patch',
        arguments: { patch: previewA.patch, confirmationHash: previewA.confirmationHash },
      }),
      secondClient.callTool({
        name: 'configra_apply_patch',
        arguments: { patch: previewB.patch, confirmationHash: previewB.confirmationHash },
      }),
    ]);
    expect(concurrentResults.filter((result) => result.isError !== true)).toHaveLength(1);
    expect(concurrentResults.filter((result) => result.isError === true)).toHaveLength(1);
    const concurrencyError = parseToolText(concurrentResults.find((result) => result.isError === true));
    if ((concurrencyError.error as { code?: string }).code !== 'STALE_BASE_HASH') {
      throw new Error(`Unexpected concurrency error: ${JSON.stringify(concurrencyError)}`);
    }
    const concurrentSuccess = parseToolText(concurrentResults.find((result) => result.isError !== true));
    await client.callTool({
      name: 'configra_rollback_transaction',
      arguments: {
        transactionId: concurrentSuccess.transactionId,
        expectedProjectHash: concurrentSuccess.resultingProjectHash,
      },
    });
    await secondClient.close();

    const missingRemark = await client.callTool({
      name: 'configra_preview_patch',
      arguments: { operations: [{ op: 'addTable', tableId: 'new_table', name: 'New', remark: ' ' }] },
    });
    expect(missingRemark.isError).toBe(true);

    const stalePreview = parseToolText(await client.callTool({
      name: 'configra_preview_patch',
      arguments: {
        operations: [
          { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Axe' } }] },
        ],
      },
    }));
    writeFileSync(projectPath, `${readFileSync(projectPath, 'utf8')}\n`, 'utf8');
    const stale = await client.callTool({
      name: 'configra_apply_patch',
      arguments: { patch: stalePreview.patch, confirmationHash: stalePreview.confirmationHash },
    });
    expect(stale.isError).toBe(true);
    expect(parseToolText(stale).error).toMatchObject({ code: 'STALE_BASE_HASH' });

    const resourcesResponse = await fetch(`http://127.0.0.1:${started.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'resources/list', params: {} }),
    });
    expect(resourcesResponse.status).toBe(200);
    await expect(resourcesResponse.json()).resolves.toMatchObject({
      error: {
        code: -32601,
        data: {
          code: 'CAPABILITY_NOT_SUPPORTED',
          serverId: 'configra',
          supportedCapabilities: ['tools'],
        },
      },
    });

    await expect
      .poll(() => readFileSync(join(configDir, 'mcp-logs.jsonl'), 'utf8'), { timeout: 3000 })
      .toContain('AI called configra_preview_patch');

    await client.close();
  }, 60000);

  it('returns PROJECT_NOT_OPEN as a structured tool error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-no-project-'));
    const configDir = join(root, 'config');
    const started = await startMcpHttpServer({ configDir, port: 0, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp`),
    ));

    const result = await client.callTool({ name: 'configra_inspect_project', arguments: {} });
    expect(result.isError).toBe(true);
    expect(parseToolText(result).error).toMatchObject({
      code: 'PROJECT_NOT_OPEN',
      serverId: 'configra',
    });
    await client.close();
  });

  it('routes tools to explicit project IDs and binds confirmations to the target project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-multi-project-'));
    const configDir = join(root, 'config');
    const projectAPath = join(root, 'a.configra.json');
    const projectBPath = join(root, 'b.configra.json');
    const project = {
      version: 1,
      tables: [
        {
          id: 'items',
          name: 'Items',
          position: { x: 0, y: 0 },
          columns: [
            { id: 'id', name: 'id', type: 'int', primary: true, required: true },
            { id: 'name', name: 'name', type: 'string' },
          ],
          rows: [{ _rowId: 'row_1', values: { id: 1, name: 'Sword' } }],
        },
      ],
    };
    mkdirSync(configDir, { recursive: true });
    writeFileSync(projectAPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    writeFileSync(projectBPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(configDir, 'mcp-context.json'),
      `${JSON.stringify({
        version: 2,
        projects: {
          alpha: {
            projectId: 'alpha',
            windowLabel: 'main',
            projectName: 'a.configra.json',
            projectPath: projectAPath,
            uiDirty: false,
            dirtyScope: 'none',
            fullAccess: false,
            revision: 1,
            updatedAt: new Date().toISOString(),
          },
          beta: {
            projectId: 'beta',
            windowLabel: 'project-beta',
            projectName: 'b.configra.json',
            projectPath: projectBPath,
            uiDirty: false,
            dirtyScope: 'none',
            fullAccess: false,
            revision: 1,
            updatedAt: new Date().toISOString(),
          },
        },
      })}\n`,
      'utf8',
    );

    const started = await startMcpHttpServer({ configDir, port: 0, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-multi-project-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp`),
    ));

    const listed = parseToolText(await client.callTool({
      name: 'configra_list_projects',
      arguments: {},
    }));
    expect(listed).toMatchObject({
      projectCount: 2,
      projects: [
        { projectId: 'alpha', projectName: 'a.configra.json' },
        { projectId: 'beta', projectName: 'b.configra.json' },
      ],
    });

    const ambiguous = await client.callTool({ name: 'configra_inspect_project', arguments: {} });
    expect(ambiguous.isError).toBe(true);
    expect(parseToolText(ambiguous).error).toMatchObject({ code: 'AMBIGUOUS_PROJECT' });

    const inspectedBeta = parseToolText(await client.callTool({
      name: 'configra_inspect_project',
      arguments: { projectId: 'beta' },
    }));
    expect(inspectedBeta).toMatchObject({ projectId: 'beta', projectName: 'b.configra.json' });

    const preview = parseToolText(await client.callTool({
      name: 'configra_preview_patch',
      arguments: {
        projectId: 'alpha',
        operations: [
          { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Axe' } }] },
        ],
      },
    }));
    expect(preview).toMatchObject({ projectId: 'alpha', targetProjectId: 'alpha' });

    const wrongTarget = await client.callTool({
      name: 'configra_apply_patch',
      arguments: {
        projectId: 'beta',
        patch: preview.patch,
        confirmationHash: preview.confirmationHash,
      },
    });
    expect(wrongTarget.isError).toBe(true);
    expect(parseToolText(wrongTarget).error).toMatchObject({ code: 'PATCH_REJECTED' });

    const applied = parseToolText(await client.callTool({
      name: 'configra_apply_patch',
      arguments: {
        projectId: 'alpha',
        patch: preview.patch,
        confirmationHash: preview.confirmationHash,
      },
    }));
    expect(applied).toMatchObject({ written: true, projectId: 'alpha' });
    expect(JSON.parse(readFileSync(projectAPath, 'utf8')).tables[0].rows[0].values.name).toBe('Axe');
    expect(JSON.parse(readFileSync(projectBPath, 'utf8')).tables[0].rows[0].values.name).toBe('Sword');

    await client.close();
  }, 60000);

  it('supports publish scope changes and the full publish workflow over MCP', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-publish-'));
    const configDir = join(root, 'config');
    const projectPath = join(root, 'project.configra.json');
    const publishedDir = join(root, 'published');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      projectPath,
      `${JSON.stringify({
        version: 1,
        tables: [
          {
            id: 'items',
            name: 'Items',
            position: { x: 0, y: 0 },
            columns: [
              { id: 'id', name: 'id', type: 'int', primary: true, required: true },
              { id: 'name', name: 'name', type: 'string' },
            ],
            rows: [
              { _rowId: 'row_1', values: { id: 1, name: 'Sword' } },
              { _rowId: 'row_2', values: { id: 2, name: 'Shield' } },
            ],
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(configDir, 'mcp-context.json'),
      `${JSON.stringify({
        version: 1,
        projectPath,
        uiDirty: false,
        dirtyScope: 'none',
        fullAccess: false,
        revision: 1,
        updatedAt: new Date().toISOString(),
      })}\n`,
      'utf8',
    );

    const started = await startMcpHttpServer({ configDir, port: 0, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-test-publish', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp`),
    );
    await client.connect(transport);

    const before = parseToolText(await client.callTool({
      name: 'configra_inspect_project',
      arguments: {},
    }));
    expect(before.releaseProfiles).toMatchObject({
      activeProfileId: 'profile_default',
      profiles: [
        {
          id: 'profile_default',
          name: 'Default',
          mode: 'selected',
          tableCount: 0,
          rowCount: 0,
        },
      ],
    });
    expect(before.publishScope).toMatchObject({
      profileId: 'profile_default',
      configured: true,
      publishableTableCount: 0,
    });

    const tablePreview = parseToolText(await client.callTool({
      name: 'configra_preview_set_table_publish',
      arguments: { tableId: 'items', publish: true },
    }));
    expect(tablePreview.patch).toMatchObject({
      operations: [{ op: 'setTablePublish', tableId: 'items', publish: true }],
    });
    const appliedTable = parseToolText(await client.callTool({
      name: 'configra_apply_patch',
      arguments: {
        patch: tablePreview.patch,
        confirmationHash: tablePreview.confirmationHash,
      },
    }));
    expect(appliedTable.written).toBe(true);

    const rowPreview = parseToolText(await client.callTool({
      name: 'configra_preview_set_rows_publish',
      arguments: { tableId: 'items', rowIds: ['row_1'], publish: true },
    }));
    const appliedRow = parseToolText(await client.callTool({
      name: 'configra_apply_patch',
      arguments: {
        patch: rowPreview.patch,
        confirmationHash: rowPreview.confirmationHash,
      },
    }));
    expect(appliedRow.written).toBe(true);

    const projectAfter = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(projectAfter.version).toBe(3);
    expect(projectAfter.releaseProfiles).toMatchObject({
      activeProfileId: 'profile_default',
      profiles: [
        {
          id: 'profile_default',
          mode: 'selected',
          tables: [{ tableId: 'items', rows: ['row_1'] }],
        },
      ],
    });
    expect(projectAfter.tables[0].publish).toBeUndefined();
    expect(projectAfter.tables[0].rows[0].publish).toBeUndefined();

    const publishPreview = parseToolText(await client.callTool({
      name: 'configra_preview_publish',
      arguments: { outPath: publishedDir },
    }));
    expect(publishPreview.confirmationHash).toMatch(/^sha256:/);
    expect(publishPreview.files).toEqual(['config_ids.json', 'Items.json']);

    const published = parseToolText(await client.callTool({
      name: 'configra_publish_all',
      arguments: {
        outPath: publishedDir,
        confirmationHash: publishPreview.confirmationHash,
      },
    }));
    expect(published).toMatchObject({ status: 'published', count: 2 });
    expect(existsSync(join(publishedDir, '.configra-publish.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(publishedDir, 'Items.json'), 'utf8'))).toHaveLength(1);

    await client.close();
  }, 60000);

  it('reads, switches and publishes separate release profiles over MCP', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-profiles-'));
    const configDir = join(root, 'config');
    const projectPath = join(root, 'project.configra.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      projectPath,
      `${JSON.stringify({
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
              tables: [{ tableId: 'items', rows: ['row_1'] }],
            },
          ],
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            position: { x: 0, y: 0 },
            columns: [
              { id: 'id', name: 'id', type: 'int', primary: true, required: true },
              { id: 'name', name: 'name', type: 'string' },
            ],
            rows: [
              { _rowId: 'row_1', values: { id: 1, name: 'Sword' } },
              { _rowId: 'row_2', values: { id: 2, name: 'Shield' } },
            ],
          },
          {
            id: 'extra',
            name: 'Extra',
            position: { x: 320, y: 0 },
            columns: [{ id: 'value', name: 'value', type: 'string' }],
            rows: [{ _rowId: 'extra_1', values: { value: 'full only' } }],
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(configDir, 'mcp-context.json'),
      `${JSON.stringify({
        version: 1,
        projectPath,
        uiDirty: false,
        dirtyScope: 'none',
        fullAccess: false,
        revision: 1,
        updatedAt: new Date().toISOString(),
      })}\n`,
      'utf8',
    );

    const started = await startMcpHttpServer({ configDir, port: 0, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-test-profiles', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${started.port}/mcp`),
      ),
    );

    const inspected = parseToolText(
      await client.callTool({ name: 'configra_inspect_project', arguments: {} }),
    );
    expect(inspected.releaseProfiles).toMatchObject({
      activeProfileId: 'profile_a',
      profiles: [
        { id: 'profile_a', mode: 'all', tableCount: 2, rowCount: 3 },
        { id: 'profile_b', mode: 'selected', tableCount: 1, rowCount: 1 },
      ],
    });
    expect(inspected.publishScope).toMatchObject({
      profileId: 'profile_a',
      publishableTableCount: 2,
      publishableRowCount: 3,
    });

    const allExportDir = join(root, 'export-all');
    const selectedExportDir = join(root, 'export-selected');
    const allExport = parseToolText(
      await client.callTool({
        name: 'configra_export_all',
        arguments: { profileId: 'profile_a', outPath: allExportDir },
      }),
    );
    const selectedExport = parseToolText(
      await client.callTool({
        name: 'configra_export_all',
        arguments: { profileId: 'B selected', outPath: selectedExportDir },
      }),
    );
    expect(allExport).toMatchObject({ profileId: 'profile_a', tableCount: 2, rowCount: 3 });
    expect(selectedExport).toMatchObject({ profileId: 'profile_b', tableCount: 1, rowCount: 1 });
    expect(existsSync(join(allExportDir, 'Extra.json'))).toBe(true);
    expect(existsSync(join(selectedExportDir, 'Extra.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(allExportDir, 'Items.json'), 'utf8'))).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(selectedExportDir, 'Items.json'), 'utf8'))).toHaveLength(1);

    // 按名称切换 active profile；patch 里必须落稳定 id。
    const switchPreview = parseToolText(
      await client.callTool({
        name: 'configra_preview_set_active_release_profile',
        arguments: { profileId: 'B selected' },
      }),
    );
    expect(switchPreview.patch).toMatchObject({
      operations: [{ op: 'setActiveReleaseProfile', profileId: 'profile_b' }],
    });
    const switched = parseToolText(
      await client.callTool({
        name: 'configra_apply_patch',
        arguments: {
          patch: switchPreview.patch,
          confirmationHash: switchPreview.confirmationHash,
        },
      }),
    );
    expect(switched.written).toBe(true);
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).releaseProfiles.activeProfileId).toBe(
      'profile_b',
    );

    // 指定方案改行范围，不影响另一个方案。
    const rowsPreview = parseToolText(
      await client.callTool({
        name: 'configra_preview_set_rows_publish',
        arguments: {
          profileId: 'B selected',
          tableId: 'items',
          rowIds: ['row_2'],
          publish: true,
        },
      }),
    );
    expect(rowsPreview.patch).toMatchObject({
      operations: [
        {
          op: 'setRowsPublish',
          tableId: 'items',
          profileId: 'profile_b',
          rowIds: ['row_2'],
          publish: true,
        },
      ],
    });
    const rowsApplied = parseToolText(
      await client.callTool({
        name: 'configra_apply_patch',
        arguments: {
          patch: rowsPreview.patch,
          confirmationHash: rowsPreview.confirmationHash,
        },
      }),
    );
    expect(rowsApplied.written).toBe(true);
    const scopeAfter = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(
      scopeAfter.releaseProfiles.profiles.find(
        (profile: { id: string }) => profile.id === 'profile_b',
      ).tables,
    ).toEqual([{ tableId: 'items', rows: ['row_1', 'row_2'] }]);
    expect(
      scopeAfter.releaseProfiles.profiles.find(
        (profile: { id: string }) => profile.id === 'profile_a',
      ).mode,
    ).toBe('all');

    // 两个方案发布到各自目录，互不清理。
    const dirA = join(root, 'pub-a');
    const dirB = join(root, 'pub-b');
    const previewA = parseToolText(
      await client.callTool({
        name: 'configra_preview_publish',
        arguments: { profileId: 'profile_a', outPath: dirA },
      }),
    );
    const previewB = parseToolText(
      await client.callTool({
        name: 'configra_preview_publish',
        arguments: { profileId: 'profile_b', outPath: dirB },
      }),
    );
    expect(previewA).toMatchObject({ profileId: 'profile_a', profileMode: 'all' });
    expect(previewB).toMatchObject({ profileId: 'profile_b', profileMode: 'selected' });
    expect(previewA.confirmationHash).not.toBe(previewB.confirmationHash);

    const publishedA = parseToolText(
      await client.callTool({
        name: 'configra_publish_all',
        arguments: {
          profileId: 'profile_a',
          outPath: dirA,
          confirmationHash: previewA.confirmationHash,
        },
      }),
    );
    const publishedB = parseToolText(
      await client.callTool({
        name: 'configra_publish_all',
        arguments: {
          profileId: 'profile_b',
          outPath: dirB,
          confirmationHash: previewB.confirmationHash,
        },
      }),
    );
    expect(publishedA).toMatchObject({ status: 'published', profileId: 'profile_a' });
    expect(publishedB).toMatchObject({ status: 'published', profileId: 'profile_b' });
    expect(existsSync(join(dirA, 'Extra.json'))).toBe(true);
    expect(existsSync(join(dirB, 'Extra.json'))).toBe(false);

    const republishB = parseToolText(
      await client.callTool({
        name: 'configra_preview_publish',
        arguments: { profileId: 'profile_b', outPath: dirB },
      }),
    );
    await client.callTool({
      name: 'configra_publish_all',
      arguments: {
        profileId: 'profile_b',
        outPath: dirB,
        confirmationHash: republishB.confirmationHash,
      },
    });
    expect(existsSync(join(dirA, 'Extra.json'))).toBe(true);
    expect(existsSync(join(dirA, 'Items.json'))).toBe(true);

    const crossProfile = await client.callTool({
      name: 'configra_preview_publish',
      arguments: { profileId: 'profile_b', outPath: dirA },
    });
    expect(crossProfile.isError).toBe(true);
    const crossBody = parseToolText(crossProfile);
    expect(crossBody.error).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { kind: 'FOREIGN_RELEASE_PROFILE' },
    });
    expect(existsSync(join(dirA, 'Extra.json'))).toBe(true);

    // confirmationHash 绑定 profile 和目录。
    const sharedDir = join(root, 'shared');
    const sharedA = parseToolText(
      await client.callTool({
        name: 'configra_preview_publish',
        arguments: { profileId: 'profile_a', outPath: sharedDir },
      }),
    );
    const sharedB = parseToolText(
      await client.callTool({
        name: 'configra_preview_publish',
        arguments: { profileId: 'profile_b', outPath: sharedDir },
      }),
    );
    expect(sharedA.confirmationHash).not.toBe(sharedB.confirmationHash);

    const wrongProfile = await client.callTool({
      name: 'configra_publish_all',
      arguments: {
        profileId: 'profile_b',
        outPath: sharedDir,
        confirmationHash: sharedA.confirmationHash,
      },
    });
    expect(wrongProfile.isError).toBe(true);
    expect(parseToolText(wrongProfile).error).toMatchObject({ code: 'STALE_BASE_HASH' });

    const correctProfile = parseToolText(
      await client.callTool({
        name: 'configra_publish_all',
        arguments: {
          profileId: 'profile_b',
          outPath: sharedDir,
          confirmationHash: sharedB.confirmationHash,
        },
      }),
    );
    expect(correctProfile).toMatchObject({ status: 'published', profileId: 'profile_b' });

    await client.close();
  }, 60000);
});
