import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  it('keeps previous diagnostics and exposes a token-protected health check', async () => {
    const root = mkdtempSync(join(tmpdir(), 'configra-mcp-health-'));
    const configDir = join(root, 'config');
    const token = '0123456789abcdef0123456789abcdef';
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'mcp-logs.jsonl'),
      `${JSON.stringify({ timestamp: '0', level: 'error', message: 'Previous startup diagnostic.' })}\n`,
      'utf8',
    );

    const started = await startMcpHttpServer({ configDir, port: 0, token, repoDir: repoRoot });
    runningServers.push(started.httpServer);

    const health = await fetch(`http://127.0.0.1:${started.port}${started.healthPath}`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: 'configra' });

    const unauthorized = await fetch(`http://127.0.0.1:${started.port}/health/not-the-token`);
    expect(unauthorized.status).toBe(404);

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

    const token = '0123456789abcdef0123456789abcdef';
    const started = await startMcpHttpServer({ configDir, port: 0, token, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp/${token}`),
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
      ]),
    );
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
    const events = JSON.parse(readFileSync(join(configDir, 'mcp-events.json'), 'utf8'));
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
      new URL(`http://127.0.0.1:${started.port}/mcp/${token}`),
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

    const resourcesResponse = await fetch(`http://127.0.0.1:${started.port}/mcp/${token}`, {
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
    const token = '0123456789abcdef0123456789abcdef';
    const started = await startMcpHttpServer({ configDir, port: 0, token, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'configra-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp/${token}`),
    ));

    const result = await client.callTool({ name: 'configra_inspect_project', arguments: {} });
    expect(result.isError).toBe(true);
    expect(parseToolText(result).error).toMatchObject({
      code: 'PROJECT_NOT_OPEN',
      serverId: 'configra',
    });
    await client.close();
  });
});
