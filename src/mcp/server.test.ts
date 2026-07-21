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

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'cfggraph_inspect_project',
        'cfggraph_query_rows',
        'cfggraph_preview_patch',
        'cfggraph_apply_patch',
        'cfggraph_export_all',
      ]),
    );

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
    expect(parseToolText(blocked).error).toContain('unsaved content changes');

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

    const missingRemark = await client.callTool({
      name: 'cfggraph_preview_patch',
      arguments: { operations: [{ op: 'addTable', tableId: 'new_table', name: 'New', remark: ' ' }] },
    });
    expect(missingRemark.isError).toBe(true);

    await expect
      .poll(() => readFileSync(join(configDir, 'mcp-logs.jsonl'), 'utf8'), { timeout: 3000 })
      .toContain('AI called cfggraph_preview_patch');

    await client.close();
  }, 60000);
});
