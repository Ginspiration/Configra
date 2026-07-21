import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';

export type ServerOptions = {
  configDir: string;
  port: number;
  token: string;
  repoDir: string;
  parentPid?: number;
};

type McpContext = {
  version: 1;
  projectPath?: string;
  uiDirty: boolean;
  dirtyScope?: 'none' | 'layout' | 'content';
  fullAccess?: boolean;
  revision: number;
  updatedAt: string;
};

type McpLogEntry = {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  requestId?: string;
  toolName?: string;
  durationMs?: number;
};

type McpLogger = {
  reset(): Promise<void>;
  log(entry: Omit<McpLogEntry, 'timestamp'>): Promise<void>;
  nextRequestId(): string;
};

type McpEvents = {
  version: 1;
  changeRevision: number;
  projectPath?: string;
  projectHash?: string;
  changedAt?: string;
};

type CliResult = {
  exitCode: number;
  body: Record<string, unknown>;
  stderr: string;
};

const parseArgs = (argv: string[]): ServerOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected MCP argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    values.set(token.slice(2), value);
    index += 1;
  }
  const configDir = path.resolve(values.get('config-dir') ?? '.codex-run/mcp');
  const repoDir = path.resolve(values.get('repo') ?? process.cwd());
  const token = values.get('token') ?? process.env.CFGGRAPH_MCP_TOKEN;
  if (!token || token.length < 16) throw new Error('MCP token must contain at least 16 characters.');
  const port = Number(values.get('port') ?? '37631');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MCP port is invalid.');
  const parentPidRaw = values.get('parent-pid');
  const parentPid = parentPidRaw === undefined ? undefined : Number(parentPidRaw);
  if (parentPid !== undefined && (!Number.isInteger(parentPid) || parentPid <= 0)) {
    throw new Error('MCP parent PID is invalid.');
  }
  return { configDir, repoDir, token, port, parentPid };
};

const atomicWriteJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
};

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
};

const createMcpLogger = (logPath: string): McpLogger => {
  let sequence = 0;
  let writeQueue = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    writeQueue = writeQueue.then(action).catch((error) => {
      process.stderr.write(
        `[cfggraph-mcp] Could not write MCP log: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
    return writeQueue;
  };

  return {
    reset: () =>
      enqueue(async () => {
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.writeFile(logPath, '', 'utf8');
      }),
    log: (entry) =>
      enqueue(() =>
        fs.appendFile(
          logPath,
          `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry } satisfies McpLogEntry)}\n`,
          'utf8',
        ),
      ),
    nextRequestId: () => `${Date.now().toString(36)}-${++sequence}`,
  };
};

const runCli = async (
  options: ServerOptions,
  cliArgs: string[],
  stdin?: unknown,
): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/cli/cfg.ts', ...cliArgs, '--json'],
      {
        cwd: options.repoDir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      let body: unknown;
      try {
        body = JSON.parse(stdout);
      } catch {
        reject(new Error(`CLI returned non-JSON output (exit ${code ?? -1}): ${stdout || stderr}`));
        return;
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        reject(new Error('CLI JSON output must be an object.'));
        return;
      }
      resolve({ exitCode: code ?? 4, body: body as Record<string, unknown>, stderr });
    });
    if (stdin !== undefined) child.stdin.end(`${JSON.stringify(stdin)}\n`);
    else child.stdin.end();
  });

const toolResult = (value: Record<string, unknown>, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  isError,
});

const cliToolResult = (result: CliResult, extra: Record<string, unknown> = {}) => {
  const value = { ...result.body, cliExitCode: result.exitCode, ...extra };
  return toolResult(value, result.exitCode >= 2);
};

const createServer = (options: ServerOptions) => {
  const server = new McpServer({ name: 'game-config-graph-editor', version: '0.1.0' });
  const contextPath = path.join(options.configDir, 'mcp-context.json');
  const eventsPath = path.join(options.configDir, 'mcp-events.json');

  const readContext = () =>
    readJsonFile<McpContext>(contextPath, {
      version: 1,
      uiDirty: false,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
    });

  const requireProject = async (mode: 'read' | 'write') => {
    const context = await readContext();
    if (!context.projectPath) throw new Error('No saved project is active in the desktop editor.');
    const dirtyScope = context.dirtyScope ?? (context.uiDirty ? 'content' : 'none');
    if (mode === 'write' && dirtyScope === 'content' && !context.fullAccess) {
      throw new Error(
        'The desktop editor has unsaved content changes. Save or discard them, or explicitly enable MCP Full Access before using this tool.',
      );
    }
    return { ...context, dirtyScope, fullAccess: context.fullAccess ?? false };
  };

  const accessState = (context: Awaited<ReturnType<typeof requireProject>>) => ({
    uiDirty: context.uiDirty,
    dirtyScope: context.dirtyScope,
    fullAccess: context.fullAccess,
  });

  const guarded = <T>(handler: () => Promise<T>) => async () => {
    try {
      return await handler();
    } catch (error) {
      return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
    }
  };

  server.registerTool(
    'cfggraph_get_status',
    {
      description: 'Return the local MCP service and active desktop project status.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async () => {
      const context = await readContext();
      let project: Record<string, unknown> | undefined;
      if (context.projectPath) {
        const inspected = await runCli(options, ['inspect', '--project', context.projectPath]);
        project = { ...inspected.body, cliExitCode: inspected.exitCode };
      }
      return toolResult({
        ok: true,
        running: true,
        port: options.port,
        activeProjectPath: context.projectPath,
        uiDirty: context.uiDirty,
        dirtyScope: context.dirtyScope ?? (context.uiDirty ? 'content' : 'none'),
        fullAccess: context.fullAccess ?? false,
        contextRevision: context.revision,
        project,
      });
    }),
  );

  server.registerTool(
    'cfggraph_inspect_project',
    {
      description: 'Inspect the active project and list stable table IDs, names, remarks and row/column counts.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async () => {
      const context = await requireProject('read');
      const result = await runCli(options, ['inspect', '--project', context.projectPath!]);
      return cliToolResult(result, accessState(context));
    }),
  );

  server.registerTool(
    'cfggraph_inspect_table',
    {
      description: 'Inspect one table by stable tableId, including schema remarks and paginated rows with stable row IDs.',
      inputSchema: {
        tableId: z.string().min(1),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(0).max(500).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tableId, offset, limit }) => {
      try {
        const context = await requireProject('read');
        const result = await runCli(options, [
          'inspect',
          '--project',
          context.projectPath!,
          '--table',
          tableId,
          '--offset',
          String(offset),
          '--limit',
          String(limit),
        ]);
        return cliToolResult(result, accessState(context));
      } catch (error) {
        return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  const queryFilterSchema = z.discriminatedUnion('op', [
    z.object({ columnId: z.string().min(1), op: z.literal('eq'), value: z.json() }),
    z.object({ columnId: z.string().min(1), op: z.literal('contains'), value: z.string() }),
  ]);
  server.registerTool(
    'cfggraph_query_rows',
    {
      description: 'Query rows in one table by stable column IDs using typed equality or case-insensitive string contains.',
      inputSchema: {
        tableId: z.string().min(1),
        match: z.enum(['all', 'any']).default('all'),
        filters: z.array(queryFilterSchema).min(1),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (query) => {
      try {
        const context = await requireProject('read');
        const result = await runCli(
          options,
          ['query', 'rows', '--project', context.projectPath!, '--query', '-'],
          query,
        );
        return cliToolResult(result, accessState(context));
      } catch (error) {
        return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    'cfggraph_validate',
    {
      description: 'Validate the active project and return all structured validation issues.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async () => {
      const context = await requireProject('read');
      const result = await runCli(options, ['validate', '--project', context.projectPath!]);
      return cliToolResult(result, accessState(context));
    }),
  );

  const operationSchema = z.record(z.string(), z.unknown());
  server.registerTool(
    'cfggraph_preview_patch',
    {
      description:
        'Preview an ordered project patch. New addTable operations require table remarks and new addColumn operations require field remarks. Returns the exact patch and confirmationHash without writing.',
      inputSchema: {
        description: z.string().optional(),
        operations: z.array(operationSchema),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ description, operations }) => {
      try {
        const context = await requireProject('write');
        const inspected = await runCli(options, ['inspect', '--project', context.projectPath!]);
        if (inspected.exitCode !== 0 || typeof inspected.body.projectHash !== 'string') {
          return cliToolResult(inspected);
        }
        const patch = {
          version: 1,
          baseHash: inspected.body.projectHash,
          ...(description !== undefined ? { description } : {}),
          operations,
        };
        const checked = await runCli(
          options,
          ['patch', 'check', '--project', context.projectPath!, '--patch', '-'],
          patch,
        );
        return cliToolResult(checked, { patch, ...accessState(context) });
      } catch (error) {
        return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  const patchSchema = z.object({
    version: z.literal(1),
    baseHash: z.string(),
    description: z.string().optional(),
    operations: z.array(operationSchema),
  });
  server.registerTool(
    'cfggraph_apply_patch',
    {
      description: 'Apply an exact patch previously returned by cfggraph_preview_patch using its confirmationHash.',
      inputSchema: {
        patch: patchSchema,
        confirmationHash: z.string().min(1),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ patch, confirmationHash }) => {
      try {
        const context = await requireProject('write');
        const result = await runCli(
          options,
          [
            'patch',
            'apply',
            '--project',
            context.projectPath!,
            '--patch',
            '-',
            '--confirm',
            confirmationHash,
          ],
          patch,
        );
        if (result.exitCode === 0 && result.body.written === true) {
          const previous = await readJsonFile<McpEvents>(eventsPath, { version: 1, changeRevision: 0 });
          await atomicWriteJson(eventsPath, {
            version: 1,
            changeRevision: previous.changeRevision + 1,
            projectPath: context.projectPath,
            projectHash:
              typeof result.body.resultingProjectHash === 'string'
                ? result.body.resultingProjectHash
                : undefined,
            changedAt: new Date().toISOString(),
          } satisfies McpEvents);
        }
        return cliToolResult(result, accessState(context));
      } catch (error) {
        return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  const ensureAbsolute = (outputPath: string) => {
    if (!path.isAbsolute(outputPath)) throw new Error('Export output path must be absolute.');
  };
  const runExport = async (
    mode: 'table' | 'all' | 'ids',
    outPath: string,
    overwrite: boolean,
    tableId?: string,
  ) => {
    try {
      const context = await requireProject('write');
      ensureAbsolute(outPath);
      const cliArgs = ['export', mode, '--project', context.projectPath!];
      if (tableId) cliArgs.push('--table', tableId);
      cliArgs.push('--out', outPath);
      if (overwrite) cliArgs.push('--overwrite');
      return cliToolResult(await runCli(options, cliArgs), accessState(context));
    } catch (error) {
      return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
    }
  };

  server.registerTool(
    'cfggraph_export_table',
    {
      description: 'Export one table JSON to an absolute local file path.',
      inputSchema: {
        tableId: z.string().min(1),
        outPath: z.string().min(1),
        overwrite: z.boolean().default(false),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ tableId, outPath, overwrite }) => runExport('table', outPath, overwrite, tableId),
  );
  server.registerTool(
    'cfggraph_export_all',
    {
      description: 'Export every table and config_ids.json to an absolute local directory.',
      inputSchema: { outPath: z.string().min(1), overwrite: z.boolean().default(false) },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ outPath, overwrite }) => runExport('all', outPath, overwrite),
  );
  server.registerTool(
    'cfggraph_export_ids',
    {
      description: 'Export config_ids.json to an absolute local file path.',
      inputSchema: { outPath: z.string().min(1), overwrite: z.boolean().default(false) },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ outPath, overwrite }) => runExport('ids', outPath, overwrite),
  );

  return server;
};

const isLoopback = (address: string | undefined) =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

export async function startMcpHttpServer(options: ServerOptions) {
  await fs.mkdir(options.configDir, { recursive: true });
  const logger = createMcpLogger(path.join(options.configDir, 'mcp-logs.jsonl'));
  await logger.reset();
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  const encodedToken = encodeURIComponent(options.token);
  const mcpPath = `/mcp/${encodedToken}`;
  const healthPath = `/health/${encodedToken}`;

  app.use((req, res, next) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'Loopback access only.' });
      return;
    }
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== 'tauri://localhost' &&
      origin !== 'http://tauri.localhost' &&
      origin !== `http://127.0.0.1:${options.port}` &&
      origin !== `http://localhost:${options.port}`
    ) {
      res.status(403).json({ error: 'Origin is not allowed.' });
      return;
    }
    next();
  });

  app.get(healthPath, (_req, res) => {
    res.json({ ok: true, service: 'game-config-graph-editor', port: options.port });
  });
  app.post(mcpPath, async (req, res) => {
    const requestId = logger.nextRequestId();
    const requestBody = req.body as {
      method?: string;
      params?: { name?: string };
    };
    const method = requestBody?.method ?? 'unknown';
    const toolName = method === 'tools/call' ? requestBody.params?.name : undefined;
    const action = toolName ? `AI called ${toolName}` : `MCP request ${method}`;
    const startedAt = Date.now();
    void logger.log({ level: 'info', message: action, requestId, toolName });
    res.on('finish', () => {
      void logger.log({
        level: res.statusCode >= 400 ? 'error' : 'info',
        message: `${action} completed with HTTP ${res.statusCode}`,
        requestId,
        toolName,
        durationMs: Date.now() - startedAt,
      });
    });
    const server = createServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      void logger.log({
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
        requestId,
        toolName,
        durationMs: Date.now() - startedAt,
      });
      process.stderr.write(`[cfggraph-mcp] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });
  app.get(mcpPath, (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });
  app.delete(mcpPath, (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });

  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(options.port, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const address = httpServer.address() as AddressInfo;
  await logger.log({
    level: 'info',
    message: `MCP service listening on 127.0.0.1:${address.port}`,
  });
  process.stderr.write(`[cfggraph-mcp] listening on http://127.0.0.1:${address.port}${mcpPath}\n`);
  if (options.parentPid !== undefined) {
    const parentWatch = setInterval(() => {
      try {
        process.kill(options.parentPid!, 0);
      } catch {
        httpServer.close(() => process.exit(0));
      }
    }, 1000);
    parentWatch.unref();
  }
  return { httpServer, port: address.port, mcpPath, healthPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const started = await startMcpHttpServer(options);
  const shutdown = () => {
    started.httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
