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

describe('cfggraph MCP server', () => {
  it('keeps previous diagnostics and exposes a token-protected health check', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cfggraph-mcp-health-'));
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
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: 'game-config-graph-editor' });

    const unauthorized = await fetch(`http://127.0.0.1:${started.port}/health/not-the-token`);
    expect(unauthorized.status).toBe(404);

    const logs = readFileSync(join(configDir, 'mcp-logs.jsonl'), 'utf8');
    expect(logs).toContain('Previous startup diagnostic.');
    expect(logs).toContain('MCP service listening on 127.0.0.1:');
  });

  it('serves tools, applies scoped dirty access and writes confirmed CLI patches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cfggraph-mcp-'));
    const configDir = join(root, 'config');
    const projectPath = join(root, 'project.cfggraph.json');
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
    const client = new Client({ name: 'cfggraph-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp/${token}`),
    );
    await client.connect(transport);

    expect(client.getServerVersion()).toMatchObject({
      name: 'game-config-graph-editor',
      title: 'Game Config Graph Editor',
    });
    expect(client.getServerCapabilities()).toHaveProperty('tools');
    expect(client.getServerCapabilities()).not.toHaveProperty('resources');

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'cfggraph_inspect_project',
        'cfggraph_query_rows',
        'cfggraph_preview_patch',
        'cfggraph_apply_patch',
        'cfggraph_rollback_transaction',
        'cfggraph_export_all',
      ]),
    );
    const previewTool = tools.tools.find((tool) => tool.name === 'cfggraph_preview_patch');
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

    const status = parseToolText(await client.callTool({ name: 'cfggraph_get_status', arguments: {} }));
    expect(status).toMatchObject({
      serverId: 'game-config-graph-editor',
      sourceId: 'game-config-graph-editor',
      displayName: 'Game Config Graph Editor',
      supportedCapabilities: ['tools'],
    });

    const inspected = parseToolText(await client.callTool({ name: 'cfggraph_inspect_table', arguments: { tableId: 'items' } }));
    expect(inspected).toHaveProperty('table');
    expect((inspected.table as { rows: unknown[] }).rows).toHaveLength(1);

    const queried = parseToolText(await client.callTool({
      name: 'cfggraph_query_rows',
      arguments: {
        tableId: 'items',
        filters: [{ columnId: 'name', op: 'contains', value: 'swo' }],
      },
    }));
    expect(queried.totalMatches).toBe(1);

    writeContext('layout');
    const layoutPreview = await client.callTool({
      name: 'cfggraph_preview_patch',
      arguments: { operations: [{ op: 'updateRows', tableId: 'items', rows: [] }] },
    });
    expect(layoutPreview.isError).not.toBe(true);

    writeContext('content');
    const blocked = await client.callTool({
      name: 'cfggraph_preview_patch',
      arguments: { operations: [{ op: 'updateRows', tableId: 'items', rows: [] }] },
    });
    expect(blocked.isError).toBe(true);
    expect(parseToolText(blocked).error).toMatchObject({
      code: 'UI_DIRTY_CONFLICT',
      serverId: 'game-config-graph-editor',
      supportedCapabilities: ['tools'],
    });

    writeContext('content', true);
    const fullAccessPreview = await client.callTool({
      name: 'cfggraph_preview_patch',
      arguments: { operations: [{ op: 'updateRows', tableId: 'items', rows: [] }] },
    });
    expect(fullAccessPreview.isError).not.toBe(true);
    expect(parseToolText(fullAccessPreview).fullAccess).toBe(true);

    writeContext('none');
    const previewResult = await client.callTool({
      name: 'cfggraph_preview_patch',
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
      name: 'cfggraph_apply_patch',
      arguments: { patch: preview.patch, confirmationHash: preview.confirmationHash },
    }));
    expect(applied.written).toBe(true);
    expect(applied.resultingProjectHash).toMatch(/^sha256:/);
    const updated = JSON.parse(readFileSync(projectPath, 'utf8'));
    expect(updated.tables[0].rows[0].values.name).toBe('Long Sword');
    const events = JSON.parse(readFileSync(join(configDir, 'mcp-events.json'), 'utf8'));
    expect(events.changeRevision).toBe(1);
    expect(events.serverId).toBe('game-config-graph-editor');

    const rolledBack = parseToolText(await client.callTool({
      name: 'cfggraph_rollback_transaction',
      arguments: {
        transactionId: applied.transactionId,
        expectedProjectHash: applied.resultingProjectHash,
      },
    }));
    expect(rolledBack).toMatchObject({ rolledBack: true, written: true });
    expect(JSON.parse(readFileSync(projectPath, 'utf8')).tables[0].rows[0].values.name).toBe('Sword');

    const secondClient = new Client({ name: 'cfggraph-test-2', version: '1.0.0' });
    await secondClient.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp/${token}`),
    ));
    const [concurrentPreviewA, concurrentPreviewB] = await Promise.all([
      client.callTool({
        name: 'cfggraph_preview_patch',
        arguments: {
          operations: [
            { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Client A' } }] },
          ],
        },
      }),
      secondClient.callTool({
        name: 'cfggraph_preview_patch',
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
        name: 'cfggraph_apply_patch',
        arguments: { patch: previewA.patch, confirmationHash: previewA.confirmationHash },
      }),
      secondClient.callTool({
        name: 'cfggraph_apply_patch',
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
      name: 'cfggraph_rollback_transaction',
      arguments: {
        transactionId: concurrentSuccess.transactionId,
        expectedProjectHash: concurrentSuccess.resultingProjectHash,
      },
    });
    await secondClient.close();

    const missingRemark = await client.callTool({
      name: 'cfggraph_preview_patch',
      arguments: { operations: [{ op: 'addTable', tableId: 'new_table', name: 'New', remark: ' ' }] },
    });
    expect(missingRemark.isError).toBe(true);

    const stalePreview = parseToolText(await client.callTool({
      name: 'cfggraph_preview_patch',
      arguments: {
        operations: [
          { op: 'updateRows', tableId: 'items', rows: [{ rowId: 'row_1', values: { name: 'Axe' } }] },
        ],
      },
    }));
    writeFileSync(projectPath, `${readFileSync(projectPath, 'utf8')}\n`, 'utf8');
    const stale = await client.callTool({
      name: 'cfggraph_apply_patch',
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
          serverId: 'game-config-graph-editor',
          supportedCapabilities: ['tools'],
        },
      },
    });

    await expect
      .poll(() => readFileSync(join(configDir, 'mcp-logs.jsonl'), 'utf8'), { timeout: 3000 })
      .toContain('AI called cfggraph_preview_patch');

    await client.close();
  }, 60000);

  it('returns PROJECT_NOT_OPEN as a structured tool error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cfggraph-mcp-no-project-'));
    const configDir = join(root, 'config');
    const token = '0123456789abcdef0123456789abcdef';
    const started = await startMcpHttpServer({ configDir, port: 0, token, repoDir: repoRoot });
    runningServers.push(started.httpServer);
    const client = new Client({ name: 'cfggraph-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${started.port}/mcp/${token}`),
    ));

    const result = await client.callTool({ name: 'cfggraph_inspect_project', arguments: {} });
    expect(result.isError).toBe(true);
    expect(parseToolText(result).error).toMatchObject({
      code: 'PROJECT_NOT_OPEN',
      serverId: 'game-config-graph-editor',
    });
    await client.close();
  });
});
