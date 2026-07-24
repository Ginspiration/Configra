import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { idRegistryJson, projectJsonFiles, tableJson } from '../export/exportTables';
import { parseProjectFileText } from '../file/projectFile';
import type { ConfigTable, ProjectFile, ValidationIssue } from '../model/types';
import {
  REFERENCE_SEMANTICS,
  summarizeProjectReferences,
} from '../model/referenceSemantics';
import {
  checkDataPatch,
  canonicalJson,
  confirmationHashForPatch,
  type JsonValue,
  type DataPatch,
  parseDataPatch,
  sha256Text,
  type CheckDataPatchResult,
  type PatchProblem,
} from '../patch/dataPatch';
import { translate } from '../i18n';
import { validateProject } from '../validation/validateProject';

type ExitCode = 0 | 1 | 2 | 3 | 4;

type ParsedArgs = {
  positionals: string[];
  options: Record<string, string>;
  flags: Set<string>;
};

type CliFailure = {
  cliFailure: true;
  exitCode: ExitCode;
  kind: string;
  message: string;
  path?: string;
  details?: unknown;
};

type CliOutput = {
  exitCode: ExitCode;
  body: unknown;
  text: string;
};

const VALUE_OPTIONS = new Set([
  'project',
  'table',
  'offset',
  'limit',
  'patch',
  'report',
  'confirm',
  'out',
  'query',
  'backup-dir',
  'transaction-id',
]);

const FLAG_OPTIONS = new Set(['json', 'overwrite', 'help']);

const usage = `Usage:
  npm run --silent cfg -- inspect --project <file> [--table <id|unique-name>] [--offset 0] [--limit 100] [--json]
  npm run --silent cfg -- query rows --project <file> --query <file|-> [--json]
  npm run --silent cfg -- validate --project <file> [--json]
  npm run --silent cfg -- patch check --project <file> --patch <file|-> [--report <file>] [--json]
  npm run --silent cfg -- patch apply --project <file> --patch <file|-> --confirm <hash> [--transaction-id <id>] [--backup-dir <directory>] [--report <file>] [--json]
  npm run --silent cfg -- patch rollback --project <file> --transaction-id <id> --confirm <current-project-hash> [--backup-dir <directory>] [--json]
  npm run --silent cfg -- export table --project <file> --table <id|unique-name> --out <file> [--overwrite] [--json]
  npm run --silent cfg -- export all --project <file> --out <directory> [--overwrite] [--json]
  npm run --silent cfg -- export ids --project <file> --out <file> [--overwrite] [--json]`;

const fail = (
  exitCode: ExitCode,
  kind: string,
  message: string,
  errorPath?: string,
  details?: unknown,
): never => {
  throw {
    cliFailure: true,
    exitCode,
    kind,
    message,
    path: errorPath,
    details,
  } satisfies CliFailure;
};

const isCliFailure = (error: unknown): error is CliFailure =>
  typeof error === 'object' &&
  error !== null &&
  (error as { cliFailure?: unknown }).cliFailure === true;

const parseArgs = (argv: string[]): ParsedArgs => {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    if (FLAG_OPTIONS.has(name)) {
      flags.add(name);
      continue;
    }

    if (!VALUE_OPTIONS.has(name)) {
      fail(2, 'arguments', `Unknown option --${name}.`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(2, 'arguments', `Option --${name} requires a value.`);
    }

    options[name] = value;
    index += 1;
  }

  return { positionals, options, flags };
};

const requiredOption = (args: ParsedArgs, name: string): string => {
  const value = args.options[name];
  if (value === undefined || value === '') fail(2, 'arguments', `Missing --${name}.`);
  return value;
};

const readNonNegativeInteger = (args: ParsedArgs, name: string, defaultValue: number) => {
  const raw = args.options[name];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    fail(2, 'arguments', `--${name} must be a non-negative integer.`);
  }
  return value;
};

const toAbsolutePath = (filePath: string) => path.resolve(process.cwd(), filePath);

const readFileText = async (filePath: string, label: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return fail(4, 'filesystem', `Could not read ${label}: ${filePath}`, filePath, String(error));
  }
};

const loadProject = async (
  projectOption: string,
): Promise<{
  projectPath: string;
  text: string;
  projectHash: string;
  project: ProjectFile;
}> => {
  const projectPath = toAbsolutePath(projectOption);
  const text = await readFileText(projectPath, 'project file');
  const parsed = parseProjectFileText(text, (key, vars) => translate('en', key, vars));

  if (parsed.ok) {
    return {
      projectPath,
      text,
      projectHash: sha256Text(text),
      project: parsed.project,
    };
  }

  return fail(2, 'project-json', parsed.error, projectPath);
};

const readStdin = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const loadPatch = async (patchOption: string): Promise<DataPatch> => {
  const text = patchOption === '-' ? await readStdin() : await readFileText(toAbsolutePath(patchOption), 'patch file');
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(2, 'patch-json', 'Patch file is not valid JSON.', patchOption, String(error));
  }

  const parsed = parseDataPatch(raw);
  if (parsed.ok) {
    return parsed.patch;
  }

  return fail(2, parsed.problem.kind, parsed.problem.message, parsed.problem.path);
};

type RowQuery = {
  tableId: string;
  match: 'all' | 'any';
  filters: Array<
    | { columnId: string; op: 'eq'; value: JsonValue }
    | { columnId: string; op: 'contains'; value: string }
  >;
  offset: number;
  limit: number;
};

const loadJsonInput = async (inputOption: string, label: string) => {
  const text = inputOption === '-' ? await readStdin() : await readFileText(toAbsolutePath(inputOption), label);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return fail(2, 'arguments', `${label} is not valid JSON.`, inputOption, String(error));
  }
};

const parseRowQuery = (raw: unknown): RowQuery => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail(2, 'arguments', 'Query must be an object.', '--query');
  }
  const value = raw as Record<string, unknown>;
  const allowedKeys = new Set(['tableId', 'match', 'filters', 'offset', 'limit']);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) return fail(2, 'arguments', `Unknown query property "${unknownKey}".`, `--query.${unknownKey}`);
  if (typeof value.tableId !== 'string' || !value.tableId) {
    return fail(2, 'arguments', 'Query tableId must be a non-empty string.', '--query.tableId');
  }
  const match = value.match ?? 'all';
  if (match !== 'all' && match !== 'any') {
    return fail(2, 'arguments', 'Query match must be "all" or "any".', '--query.match');
  }
  if (!Array.isArray(value.filters) || value.filters.length === 0) {
    return fail(2, 'arguments', 'Query filters must be a non-empty array.', '--query.filters');
  }
  const filters: RowQuery['filters'] = value.filters.map((filter, index) => {
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
      return fail(2, 'arguments', 'Query filter must be an object.', `--query.filters[${index}]`);
    }
    const entry = filter as Record<string, unknown>;
    const filterUnknownKey = Object.keys(entry).find((key) => !['columnId', 'op', 'value'].includes(key));
    if (filterUnknownKey) {
      return fail(2, 'arguments', `Unknown filter property "${filterUnknownKey}".`, `--query.filters[${index}].${filterUnknownKey}`);
    }
    if (typeof entry.columnId !== 'string' || !entry.columnId) {
      return fail(2, 'arguments', 'Filter columnId must be a non-empty string.', `--query.filters[${index}].columnId`);
    }
    if (entry.op === 'contains') {
      if (typeof entry.value !== 'string') {
        return fail(2, 'arguments', 'contains filter value must be a string.', `--query.filters[${index}].value`);
      }
      return { columnId: entry.columnId, op: 'contains', value: entry.value };
    }
    if (entry.op === 'eq') {
      if (entry.value === undefined || canonicalJson(entry.value) === undefined) {
        return fail(2, 'arguments', 'eq filter value must be JSON-compatible.', `--query.filters[${index}].value`);
      }
      return { columnId: entry.columnId, op: 'eq', value: entry.value as JsonValue };
    }
    return fail(2, 'arguments', 'Filter op must be "eq" or "contains".', `--query.filters[${index}].op`);
  });
  const offset = value.offset ?? 0;
  const limit = value.limit ?? 100;
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    return fail(2, 'arguments', 'Query offset must be a non-negative integer.', '--query.offset');
  }
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500) {
    return fail(2, 'arguments', 'Query limit must be an integer from 1 to 500.', '--query.limit');
  }
  return { tableId: value.tableId, match, filters, offset: offset as number, limit: limit as number };
};

const resolveTable = (project: ProjectFile, selector: string): ConfigTable => {
  const byId = project.tables.filter((table) => table.id === selector);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) fail(2, 'target', `tableId "${selector}" matches multiple tables.`, '--table');

  const byName = project.tables.filter((table) => table.name === selector);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    fail(2, 'target', `Table name "${selector}" is not unique. Use the stable tableId.`, '--table');
  }

  return fail(2, 'target', `Unknown table "${selector}".`, '--table');
};

const validate = (project: ProjectFile) =>
  validateProject(project, (key, vars) => translate('en', key, vars));

const validationCounts = (issues: ValidationIssue[]) => ({
  errorCount: issues.filter((issue) => issue.severity === 'error').length,
  warningCount: issues.filter((issue) => issue.severity === 'warning').length,
});

const patchExitCode = (problem: PatchProblem): ExitCode => {
  if (problem.kind === 'hash') return 3;
  if (problem.kind === 'invalid-patch' || problem.kind === 'target') return 2;
  return 1;
};

const patchReport = (result: CheckDataPatchResult) => ({
  ok: result.ok,
  accepted: result.accepted,
  projectHash: result.projectHash,
  patchBaseHash: result.patchBaseHash,
  confirmationHash: result.confirmationHash,
  changed: result.ok ? result.changed : false,
  changeCount: result.diff?.length ?? 0,
  diff: result.diff ?? [],
  validation: result.validation,
  problem: result.ok ? undefined : result.problem,
});

const writeReport = async (reportPathOption: string | undefined, body: unknown) => {
  if (!reportPathOption) return undefined;

  const reportPath = toAbsolutePath(reportPathOption);
  const tempPath = path.join(
    path.dirname(reportPath),
    `.${path.basename(reportPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, reportPath);
    return reportPath;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    fail(4, 'filesystem', `Could not write report: ${reportPath}`, reportPath, String(error));
  }
};

const pathExists = async (filePath: string) => {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    fail(4, 'filesystem', `Could not inspect path: ${filePath}`, filePath, String(error));
  }
};

const writeTextFile = async (filePath: string, text: string, overwrite: boolean) => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (overwrite) {
      await atomicReplace(filePath, text);
      return;
    }
    await fs.writeFile(filePath, text, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason = code === 'EEXIST' ? 'Refusing to overwrite existing file.' : String(error);
    fail(4, 'filesystem', `${reason} ${filePath}`, filePath, String(error));
  }
};

const atomicReplace = async (filePath: string, text: string) => {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, text, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup after a failed atomic write.
    }
    fail(4, 'filesystem', `Could not write project file: ${filePath}`, filePath, String(error));
  }
};

type TransactionBackup = {
  version: 1;
  transactionId: string;
  projectPath: string;
  originalProjectHash: string;
  backupPath: string;
  createdAt: string;
};

const defaultBackupDirectory = () => {
  const dataRoot =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA ?? process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Local')
      : process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share');
  return path.join(dataRoot, 'configra', 'backups');
};

const backupDirectory = (args: ParsedArgs) =>
  args.options['backup-dir'] ? toAbsolutePath(args.options['backup-dir']) : defaultBackupDirectory();

const readTransactionId = (args: ParsedArgs) => {
  const transactionId = args.options['transaction-id'];
  if (
    transactionId !== undefined &&
    (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(transactionId) || transactionId === '.' || transactionId === '..')
  ) {
    fail(2, 'arguments', '--transaction-id must be 1-128 URL-safe characters.', '--transaction-id');
  }
  return transactionId;
};

const transactionMetadataPath = (backupDir: string, projectPath: string, transactionId: string) => {
  const key = sha256Text(`${projectPath}\0${transactionId}`).slice('sha256:'.length, 'sha256:'.length + 32);
  return path.join(backupDir, `transaction-${key}.json`);
};

const readTransactionBackup = async (
  backupDir: string,
  projectPath: string,
  transactionId: string,
): Promise<TransactionBackup | undefined> => {
  const metadataPath = transactionMetadataPath(backupDir, projectPath, transactionId);
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as TransactionBackup;
    if (
      metadata.version !== 1 ||
      metadata.transactionId !== transactionId ||
      path.resolve(metadata.projectPath) !== path.resolve(projectPath) ||
      typeof metadata.backupPath !== 'string' ||
      typeof metadata.originalProjectHash !== 'string'
    ) {
      fail(4, 'filesystem', `Transaction metadata is invalid: ${metadataPath}`, metadataPath);
    }
    return metadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (isCliFailure(error)) throw error;
    fail(4, 'filesystem', `Could not read transaction metadata: ${metadataPath}`, metadataPath, String(error));
  }
};

const rotateSnapshots = async (backupDir: string, maximum = 20) => {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('snapshot-') && entry.name.endsWith('.bak'))
      .map(async (entry) => {
        const filePath = path.join(backupDir, entry.name);
        return { filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs };
      }),
  );
  snapshots.sort((left, right) => right.mtimeMs - left.mtimeMs);
  await Promise.all(snapshots.slice(maximum).map(({ filePath }) => fs.rm(filePath, { force: true })));
};

const rotateTransactionBackups = async (backupDir: string, maximum = 20) => {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const transactions: Array<{
    metadataPath: string;
    backupPath: string;
    mtimeMs: number;
  }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('transaction-') || !entry.name.endsWith('.json')) continue;
    const metadataPath = path.join(backupDir, entry.name);
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as TransactionBackup;
      const resolvedBackupPath = path.resolve(metadata.backupPath);
      if (
        path.dirname(resolvedBackupPath) !== path.resolve(backupDir) ||
        !path.basename(resolvedBackupPath).startsWith('transaction-') ||
        !path.basename(resolvedBackupPath).endsWith('.bak')
      ) {
        continue;
      }
      transactions.push({
        metadataPath,
        backupPath: resolvedBackupPath,
        mtimeMs: (await fs.stat(metadataPath)).mtimeMs,
      });
    } catch {
      // Preserve malformed metadata for manual inspection instead of deleting an uncertain target.
    }
  }
  transactions.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const transaction of transactions.slice(maximum)) {
    await fs.rm(transaction.backupPath, { force: true });
    await fs.rm(transaction.metadataPath, { force: true });
  }
};

const createBackup = async (
  args: ParsedArgs,
  projectPath: string,
  originalText: string,
  originalProjectHash: string,
): Promise<TransactionBackup> => {
  const backupDir = backupDirectory(args);
  const transactionId = readTransactionId(args);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    if (transactionId) {
      const existing = await readTransactionBackup(backupDir, projectPath, transactionId);
      if (existing) return existing;

      const backupPath = path.join(
        backupDir,
        `transaction-${Date.now()}-${randomUUID()}.bak`,
      );
      const metadata: TransactionBackup = {
        version: 1,
        transactionId,
        projectPath,
        originalProjectHash,
        backupPath,
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(backupPath, originalText, { encoding: 'utf8', flag: 'wx' });
      const metadataPath = transactionMetadataPath(backupDir, projectPath, transactionId);
      await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rotateTransactionBackups(backupDir);
      return metadata;
    }

    const backupPath = path.join(backupDir, `snapshot-${Date.now()}-${randomUUID()}.bak`);
    await fs.writeFile(backupPath, originalText, { encoding: 'utf8', flag: 'wx' });
    await rotateSnapshots(backupDir);
    return {
      version: 1,
      transactionId: randomUUID(),
      projectPath,
      originalProjectHash,
      backupPath,
      createdAt: new Date().toISOString(),
    } satisfies TransactionBackup;
  } catch (error) {
    if (isCliFailure(error)) throw error;
    return fail(4, 'filesystem', `Could not create backup in ${backupDir}`, backupDir, String(error));
  }
};

const withProjectWriteLock = async <T>(projectPath: string, action: () => Promise<T>): Promise<T> => {
  const lockPath = path.join(path.dirname(projectPath), `.${path.basename(projectPath)}.configra.lock`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
    return await action();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      fail(3, 'hash', 'Another writer is currently modifying this project.', projectPath);
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    if (handle) await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
};

const inspectCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const tableSelector = args.options.table;
  const relationships = summarizeProjectReferences(loaded.project);

  if (!tableSelector) {
    const body = {
      ok: true,
      projectHash: loaded.projectHash,
      version: loaded.project.version,
      tableCount: loaded.project.tables.length,
      referenceSemantics: REFERENCE_SEMANTICS,
      relationships,
      tables: loaded.project.tables.map((table) => ({
        tableId: table.id,
        name: table.name,
        remark: table.remark,
        columnCount: table.columns.length,
        rowCount: table.rows.length,
        identity: table.identity,
      })),
    };

    return {
      exitCode: 0,
      body,
      text: [
        `Project hash: ${loaded.projectHash}`,
        `Tables: ${loaded.project.tables.length}`,
        ...loaded.project.tables.map(
          (table) => `- ${table.id} (${table.name}): ${table.columns.length} columns, ${table.rows.length} rows`,
        ),
      ].join('\n'),
    };
  }

  const table = resolveTable(loaded.project, tableSelector);
  const offset = readNonNegativeInteger(args, 'offset', 0);
  const limit = readNonNegativeInteger(args, 'limit', 100);
  const rows = table.rows.slice(offset, offset + limit);
  const body = {
    ok: true,
    projectHash: loaded.projectHash,
    table: {
      tableId: table.id,
      name: table.name,
      remark: table.remark,
      identity: table.identity,
      referenceSemantics: REFERENCE_SEMANTICS,
      relationships: relationships.filter(
        (relationship) =>
          relationship.source.tableId === table.id || relationship.target.tableId === table.id,
      ),
      columns: table.columns.map((column) => ({
        columnId: column.id,
        name: column.name,
        type: column.type,
        required: column.required === true,
        primary: column.primary === true,
        autoIncrement: column.autoIncrement === true,
        export: column.export !== false,
        enumValues: column.enumValues,
        ref: column.ref,
        remark: column.remark,
      })),
      rows: rows.map((row) => ({
        rowId: row._rowId,
        values: row.values,
      })),
      offset,
      limit,
      returnedRows: rows.length,
      totalRows: table.rows.length,
    },
  };

  return {
    exitCode: 0,
    body,
    text: [
      `Project hash: ${loaded.projectHash}`,
      `Table: ${table.id} (${table.name})`,
      `Rows: ${offset}-${offset + rows.length} of ${table.rows.length}`,
      JSON.stringify(body.table, null, 2),
    ].join('\n'),
  };
};

const queryRowsCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const query = parseRowQuery(await loadJsonInput(requiredOption(args, 'query'), 'query file'));
  const table = resolveTable(loaded.project, query.tableId);
  const columnIds = new Set(table.columns.map((column) => column.id));
  for (const [index, filter] of query.filters.entries()) {
    if (!columnIds.has(filter.columnId)) {
      fail(2, 'target', `Unknown columnId "${filter.columnId}" in table "${table.id}".`, `--query.filters[${index}].columnId`);
    }
  }
  const matchesFilter = (row: ConfigTable['rows'][number], filter: RowQuery['filters'][number]) => {
    const value = row.values[filter.columnId];
    if (filter.op === 'eq') return typeof value === typeof filter.value && canonicalJson(value) === canonicalJson(filter.value);
    return typeof value === 'string' && value.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
  };
  const matched = table.rows.filter((row) => {
    const results = query.filters.map((filter) => matchesFilter(row, filter));
    return query.match === 'all' ? results.every(Boolean) : results.some(Boolean);
  });
  const rows = matched.slice(query.offset, query.offset + query.limit).map((row) => ({
    rowId: row._rowId,
    values: row.values,
  }));
  const body = {
    ok: true,
    projectHash: loaded.projectHash,
    tableId: table.id,
    query,
    rows,
    offset: query.offset,
    limit: query.limit,
    returnedRows: rows.length,
    totalMatches: matched.length,
  };
  return {
    exitCode: 0,
    body,
    text: `Matched ${matched.length} row(s); returned ${rows.length}.`,
  };
};

const validateCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const issues = validate(loaded.project);
  const counts = validationCounts(issues);
  const body = {
    ok: counts.errorCount === 0,
    projectHash: loaded.projectHash,
    ...counts,
    issues,
  };

  return {
    exitCode: counts.errorCount === 0 ? 0 : 1,
    body,
    text:
      issues.length === 0
        ? `Valid. Project hash: ${loaded.projectHash}`
        : [
            `${counts.errorCount} error(s), ${counts.warningCount} warning(s). Project hash: ${loaded.projectHash}`,
            ...issues.map(
              (issue) =>
                `- ${issue.severity.toUpperCase()} ${issue.id}: ${issue.message}`,
            ),
          ].join('\n'),
  };
};

const patchCheckCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const patch = await loadPatch(requiredOption(args, 'patch'));
  const result = checkDataPatch(loaded.project, patch, {
    projectHash: loaded.projectHash,
    validate,
  });
  const report = patchReport(result);
  const reportPath = await writeReport(args.options.report, report);
  const body = reportPath ? { ...report, reportPath } : report;
  const exitCode: ExitCode = result.ok ? 0 : patchExitCode(result.problem);

  return {
    exitCode,
    body,
    text: result.ok
      ? [
          'Patch accepted.',
          `Confirmation hash: ${result.confirmationHash}`,
          `Changes: ${result.diff.length}`,
          `Validation: ${result.validation.after.errorCount} error(s), ${result.validation.after.warningCount} warning(s)`,
          reportPath ? `Report: ${reportPath}` : '',
        ].filter(Boolean).join('\n')
      : [
          `Patch rejected: ${result.problem.message}`,
          result.confirmationHash ? `Confirmation hash: ${result.confirmationHash}` : '',
          result.validation ? `New errors: ${result.validation.newErrors.length}` : '',
          reportPath ? `Report: ${reportPath}` : '',
        ].filter(Boolean).join('\n'),
  };
};

const patchApplyCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const patch = await loadPatch(requiredOption(args, 'patch'));
  const confirm = requiredOption(args, 'confirm');
  const expectedConfirm = confirmationHashForPatch(loaded.projectHash, patch);

  if (confirm !== expectedConfirm) {
    const body = {
      ok: false,
      accepted: false,
      projectHash: loaded.projectHash,
      patchBaseHash: patch.baseHash,
      expectedConfirmationHash: expectedConfirm,
      providedConfirmationHash: confirm,
      changed: false,
      problem: {
        kind: 'hash',
        message: 'Confirmation hash does not match the current project and patch.',
        path: '--confirm',
      },
    };

    await writeReport(args.options.report, body);

    return {
      exitCode: 3,
      body,
      text: `Hash conflict: expected ${expectedConfirm}, got ${confirm}`,
    };
  }

  const result = checkDataPatch(loaded.project, patch, {
    projectHash: loaded.projectHash,
    validate,
  });
  const report = patchReport(result);

  if (!result.ok) {
    const reportPath = await writeReport(args.options.report, report);
    const body = reportPath ? { ...report, reportPath } : report;

    return {
      exitCode: patchExitCode(result.problem),
      body,
      text: `Patch rejected: ${result.problem.message}${reportPath ? `\nReport: ${reportPath}` : ''}`,
    };
  }

  let backupPath: string | undefined;
  const transactionId = readTransactionId(args);
  let written = false;
  let resultingProjectHash = loaded.projectHash;
  let previousProjectText: string | undefined;
  if (result.changed) {
    await withProjectWriteLock(loaded.projectPath, async () => {
      const currentText = await readFileText(loaded.projectPath, 'project file');
      const currentHash = sha256Text(currentText);
      if (currentHash !== loaded.projectHash) {
        fail(
          3,
          'hash',
          `Project changed after patch validation. Expected ${loaded.projectHash}, found ${currentHash}.`,
          loaded.projectPath,
        );
      }
      previousProjectText = currentText;

      const backup = await createBackup(
        args,
        loaded.projectPath,
        currentText,
        loaded.projectHash,
      );
      backupPath = backup.backupPath;
      let nextText = `${JSON.stringify(result.project, null, 2)}\n`;

      if (transactionId) {
        const originalText = await readFileText(backup.backupPath, 'transaction backup');
        if (sha256Text(originalText) !== backup.originalProjectHash) {
          fail(4, 'filesystem', 'Transaction backup hash does not match its metadata.', backup.backupPath);
        }
        const originalParsed = parseProjectFileText(originalText, (key, vars) => translate('en', key, vars));
        if (!originalParsed.ok) {
          return fail(4, 'filesystem', `Transaction backup is not a valid project: ${originalParsed.error}`, backup.backupPath);
        }
        if (canonicalJson(originalParsed.project) === canonicalJson(result.project)) {
          nextText = originalText;
        }
      }

      if (nextText !== currentText) {
        await atomicReplace(loaded.projectPath, nextText);
        written = true;
      }
      resultingProjectHash = sha256Text(nextText);
    });
  }

  const body = {
    ...report,
    applied: true,
    written,
    projectPath: loaded.projectPath,
    resultingProjectHash,
    backupPath,
    transactionId,
  };
  let reportPath: string | undefined;
  try {
    reportPath = await writeReport(args.options.report, body);
  } catch (error) {
    if (written && previousProjectText !== undefined) {
      await withProjectWriteLock(loaded.projectPath, async () => {
        const currentText = await readFileText(loaded.projectPath, 'project file');
        if (sha256Text(currentText) !== resultingProjectHash) {
          fail(
            3,
            'hash',
            'Project changed after patch write while recovering from a report failure.',
            loaded.projectPath,
          );
        }
        await atomicReplace(loaded.projectPath, previousProjectText!);
      });
    }
    throw error;
  }

  return {
    exitCode: 0,
    body: reportPath ? { ...body, reportPath } : body,
    text: [
      result.changed ? 'Patch applied.' : 'Patch checked; no changes to write.',
      `Changes: ${result.diff.length}`,
      backupPath ? `Backup: ${backupPath}` : '',
      reportPath ? `Report: ${reportPath}` : '',
    ].filter(Boolean).join('\n'),
  };
};

const patchRollbackCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const transactionId = requiredOption(args, 'transaction-id');
  readTransactionId(args);
  const confirm = requiredOption(args, 'confirm');
  if (confirm !== loaded.projectHash) {
    return {
      exitCode: 3,
      body: {
        ok: false,
        rolledBack: false,
        projectHash: loaded.projectHash,
        providedProjectHash: confirm,
        problem: {
          kind: 'hash',
          message: 'Rollback confirmation hash does not match the current project.',
          path: '--confirm',
        },
      },
      text: `Hash conflict: expected ${loaded.projectHash}, got ${confirm}`,
    };
  }

  const backupDir = backupDirectory(args);
  const transaction = await readTransactionBackup(backupDir, loaded.projectPath, transactionId);
  if (!transaction) {
    return fail(2, 'target', `Unknown transactionId "${transactionId}".`, '--transaction-id');
  }

  let written = false;
  await withProjectWriteLock(loaded.projectPath, async () => {
    const currentText = await readFileText(loaded.projectPath, 'project file');
    const currentHash = sha256Text(currentText);
    if (currentHash !== loaded.projectHash) {
      fail(
        3,
        'hash',
        `Project changed before rollback. Expected ${loaded.projectHash}, found ${currentHash}.`,
        loaded.projectPath,
      );
    }
    const originalText = await readFileText(transaction.backupPath, 'transaction backup');
    if (sha256Text(originalText) !== transaction.originalProjectHash) {
      fail(4, 'filesystem', 'Transaction backup hash does not match its metadata.', transaction.backupPath);
    }
    if (originalText !== currentText) {
      await atomicReplace(loaded.projectPath, originalText);
      written = true;
    }
  });

  return {
    exitCode: 0,
    body: {
      ok: true,
      rolledBack: true,
      written,
      transactionId,
      projectPath: loaded.projectPath,
      previousProjectHash: loaded.projectHash,
      resultingProjectHash: transaction.originalProjectHash,
      backupPath: transaction.backupPath,
    },
    text: written
      ? `Rolled back transaction ${transactionId}.`
      : `Transaction ${transactionId} was already at its original project bytes.`,
  };
};

const exportTableCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const table = resolveTable(loaded.project, requiredOption(args, 'table'));
  const outPath = toAbsolutePath(requiredOption(args, 'out'));
  const overwrite = args.flags.has('overwrite');

  await writeTextFile(outPath, `${tableJson(loaded.project, table.id)}\n`, overwrite);

  const body = {
    ok: true,
    projectHash: loaded.projectHash,
    tableId: table.id,
    outPath,
    overwritten: overwrite,
  };

  return {
    exitCode: 0,
    body,
    text: `Exported ${table.id} to ${outPath}`,
  };
};

const exportIdsCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const outPath = toAbsolutePath(requiredOption(args, 'out'));
  const overwrite = args.flags.has('overwrite');

  await writeTextFile(outPath, `${idRegistryJson(loaded.project)}\n`, overwrite);

  const body = {
    ok: true,
    projectHash: loaded.projectHash,
    outPath,
    overwritten: overwrite,
  };

  return {
    exitCode: 0,
    body,
    text: `Exported config_ids.json to ${outPath}`,
  };
};

const exportAllCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const outDir = toAbsolutePath(requiredOption(args, 'out'));
  const overwrite = args.flags.has('overwrite');
  const files = projectJsonFiles(loaded.project);

  try {
    const exists = await pathExists(outDir);
    if (exists) {
      const stat = await fs.stat(outDir);
      if (!stat.isDirectory()) {
        fail(4, 'filesystem', `Export output is not a directory: ${outDir}`, outDir);
      }
    } else {
      await fs.mkdir(outDir, { recursive: true });
    }

    for (const file of files) {
      if (path.basename(file.fileName) !== file.fileName) {
        fail(4, 'filesystem', `Unsafe export file name: ${file.fileName}`, outDir);
      }
      const filePath = path.join(outDir, file.fileName);
      if (await pathExists(filePath)) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          fail(4, 'filesystem', `Export target is not a regular file: ${filePath}`, filePath);
        }
      }
    }

    if (!overwrite) {
      const conflicts: string[] = [];
      for (const file of files) {
        const filePath = path.join(outDir, file.fileName);
        if (await pathExists(filePath)) conflicts.push(filePath);
      }

      if (conflicts.length > 0) {
        fail(4, 'filesystem', `Refusing to overwrite ${conflicts.length} existing export file(s).`, outDir, conflicts);
      }
    }

    const stageDir = await fs.mkdtemp(path.join(outDir, '.configra-export-'));
    const commits: Array<{
      finalPath: string;
      backupPath?: string;
      installed: boolean;
    }> = [];
    try {
      for (const [index, file] of files.entries()) {
        await fs.writeFile(path.join(stageDir, `new-${index}`), `${file.text}\n`, 'utf8');
      }

      for (const [index, file] of files.entries()) {
        const finalPath = path.join(outDir, file.fileName);
        const finalExists = await pathExists(finalPath);
        if (finalExists && !overwrite) {
          fail(4, 'filesystem', `Refusing to overwrite existing export file: ${finalPath}`, finalPath);
        }
        const commit: { finalPath: string; backupPath?: string; installed: boolean } = {
          finalPath,
          installed: false,
        };
        commits.push(commit);
        if (finalExists) {
          commit.backupPath = path.join(stageDir, `original-${index}`);
          await fs.rename(finalPath, commit.backupPath);
        }
        await fs.rename(path.join(stageDir, `new-${index}`), finalPath);
        commit.installed = true;
      }
    } catch (error) {
      for (const commit of [...commits].reverse()) {
        if (commit.installed) await fs.rm(commit.finalPath, { force: true }).catch(() => undefined);
        if (commit.backupPath && (await pathExists(commit.backupPath))) {
          await fs.rename(commit.backupPath, commit.finalPath).catch(() => undefined);
        }
      }
      throw error;
    } finally {
      await fs.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (isCliFailure(error)) throw error;
    fail(4, 'filesystem', `Could not export files to ${outDir}`, outDir, String(error));
  }

  const body = {
    ok: true,
    projectHash: loaded.projectHash,
    outDir,
    overwritten: overwrite,
    files: files.map((file) => path.join(outDir, file.fileName)),
  };

  return {
    exitCode: 0,
    body,
    text: `Exported ${files.length} file(s) to ${outDir}`,
  };
};

const dispatch = async (args: ParsedArgs): Promise<CliOutput> => {
  if (args.flags.has('help') || args.positionals.length === 0) {
    return { exitCode: 0, body: { ok: true, usage }, text: usage };
  }

  const [command, subcommand] = args.positionals;

  if (command === 'inspect') return inspectCommand(args);
  if (command === 'query' && subcommand === 'rows') return queryRowsCommand(args);
  if (command === 'validate') return validateCommand(args);

  if (command === 'patch' && subcommand === 'check') return patchCheckCommand(args);
  if (command === 'patch' && subcommand === 'apply') return patchApplyCommand(args);
  if (command === 'patch' && subcommand === 'rollback') return patchRollbackCommand(args);

  if (command === 'export' && subcommand === 'table') return exportTableCommand(args);
  if (command === 'export' && subcommand === 'all') return exportAllCommand(args);
  if (command === 'export' && subcommand === 'ids') return exportIdsCommand(args);

  return fail(2, 'arguments', `Unknown command: ${args.positionals.join(' ') || '(empty)'}`);
};

export async function main(argv = process.argv.slice(2)): Promise<ExitCode> {
  const wantsJson = argv.includes('--json');

  try {
    const args = parseArgs(argv);
    const output = await dispatch(args);
    process.stdout.write(`${wantsJson ? JSON.stringify(output.body, null, 2) : output.text}\n`);
    return output.exitCode;
  } catch (error) {
    const failure = isCliFailure(error)
      ? error
      : ({
          cliFailure: true,
          exitCode: 4,
          kind: 'internal',
          message: error instanceof Error ? error.message : String(error),
        } satisfies CliFailure);

    const body = {
      ok: false,
      error: {
        kind: failure.kind,
        message: failure.message,
        path: failure.path,
        details: failure.details,
      },
    };

    if (wantsJson) {
      process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      process.stderr.write(`Error: ${failure.message}\n`);
    }

    return failure.exitCode;
  }
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
