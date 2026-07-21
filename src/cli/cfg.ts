import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { idRegistryJson, projectJsonFiles, tableJson } from '../export/exportTables';
import { parseProjectFileText } from '../file/projectFile';
import type { ConfigTable, ProjectFile, ValidationIssue } from '../model/types';
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
]);

const FLAG_OPTIONS = new Set(['json', 'overwrite', 'help']);

const usage = `Usage:
  npm run --silent cfg -- inspect --project <file> [--table <id|unique-name>] [--offset 0] [--limit 100] [--json]
  npm run --silent cfg -- query rows --project <file> --query <file|-> [--json]
  npm run --silent cfg -- validate --project <file> [--json]
  npm run --silent cfg -- patch check --project <file> --patch <file|-> [--report <file>] [--json]
  npm run --silent cfg -- patch apply --project <file> --patch <file|-> --confirm <hash> [--report <file>] [--json]
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
  try {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    return reportPath;
  } catch (error) {
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
    await fs.writeFile(filePath, text, {
      encoding: 'utf8',
      flag: overwrite ? 'w' : 'wx',
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

const createBackup = async (projectPath: string) => {
  const backupPath = `${projectPath}.bak`;
  try {
    await fs.copyFile(projectPath, backupPath);
    return backupPath;
  } catch (error) {
    fail(4, 'filesystem', `Could not create backup: ${backupPath}`, backupPath, String(error));
  }
};

const inspectCommand = async (args: ParsedArgs): Promise<CliOutput> => {
  const loaded = await loadProject(requiredOption(args, 'project'));
  const tableSelector = args.options.table;

  if (!tableSelector) {
    const body = {
      ok: true,
      projectHash: loaded.projectHash,
      version: loaded.project.version,
      tableCount: loaded.project.tables.length,
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
  let written = false;
  let resultingProjectHash = loaded.projectHash;
  if (result.changed) {
    backupPath = await createBackup(loaded.projectPath);
    const nextText = `${JSON.stringify(result.project, null, 2)}\n`;
    await atomicReplace(loaded.projectPath, nextText);
    resultingProjectHash = sha256Text(nextText);
    written = true;
  }

  const body = {
    ...report,
    applied: true,
    written,
    projectPath: loaded.projectPath,
    resultingProjectHash,
    backupPath,
  };
  const reportPath = await writeReport(args.options.report, body);

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

    for (const file of files) {
      await fs.writeFile(path.join(outDir, file.fileName), `${file.text}\n`, 'utf8');
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
