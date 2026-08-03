import type { Translator } from '../i18n';
import type { ConfigTable, GraphPosition, ProjectFile, ValidationIssue } from '../model/types';
import { validateProject } from '../validation/validateProject';

export type MergeConflictKind = 'id' | 'name';

export type MergeConflict = {
  kind: MergeConflictKind;
  incomingTableId: string;
  incomingTableName: string;
  existingTableId: string;
  existingTableName: string;
};

export type MergeResolution =
  | { kind: 'overwrite' }
  | { kind: 'skip' }
  | { kind: 'rename'; newTableId: string; newTableName: string };

export type MergeResolutions = Record<string, MergeResolution>;

export type RenameSuggestion = {
  newTableId: string;
  newTableName: string;
};

export type MergeReport = {
  candidate: ProjectFile;
  issues: ValidationIssue[];
  newIssues: ValidationIssue[];
  existingIssues: ValidationIssue[];
  newErrorCount: number;
  newWarningCount: number;
  counts: {
    added: number;
    overwritten: number;
    skipped: number;
    renamed: number;
  };
};

const POSITION_NUDGE = 40;

const positionKey = (position: GraphPosition) => `${position.x},${position.y}`;

const uniqueId = (base: string, taken: Set<string>) => {
  let index = 2;
  let id = `${base}_${index}`;
  while (taken.has(id)) {
    index += 1;
    id = `${base}_${index}`;
  }
  return id;
};

const uniqueDisplayName = (base: string, taken: Set<string>) => {
  let index = 2;
  let name = `${base} (${index})`;
  while (taken.has(name)) {
    index += 1;
    name = `${base} (${index})`;
  }
  return name;
};

const nudgePosition = (position: GraphPosition, taken: Set<string>): GraphPosition => {
  let next = position;
  while (taken.has(positionKey(next))) {
    next = { x: next.x + POSITION_NUDGE, y: next.y + POSITION_NUDGE };
  }
  return next;
};

export function findConflicts(current: ProjectFile, incoming: ProjectFile): MergeConflict[] {
  const existingById = new Map(current.tables.map((table) => [table.id, table]));
  const existingByName = new Map<string, ConfigTable>();
  for (const table of current.tables) {
    const key = table.name.trim();
    if (key && !existingByName.has(key)) existingByName.set(key, table);
  }

  const conflicts: MergeConflict[] = [];
  for (const incomingTable of incoming.tables) {
    const byId = existingById.get(incomingTable.id);
    if (byId) {
      conflicts.push({
        kind: 'id',
        incomingTableId: incomingTable.id,
        incomingTableName: incomingTable.name,
        existingTableId: byId.id,
        existingTableName: byId.name,
      });
      continue;
    }

    const nameKey = incomingTable.name.trim();
    if (!nameKey) continue;
    const byName = existingByName.get(nameKey);
    if (byName) {
      conflicts.push({
        kind: 'name',
        incomingTableId: incomingTable.id,
        incomingTableName: incomingTable.name,
        existingTableId: byName.id,
        existingTableName: byName.name,
      });
    }
  }

  return conflicts;
}

export function defaultResolutions(
  conflicts: MergeConflict[],
  current: ProjectFile,
  incoming: ProjectFile,
): { defaults: MergeResolutions; renameSuggestions: Record<string, RenameSuggestion> } {
  const takenIds = new Set<string>([
    ...current.tables.map((table) => table.id),
    ...incoming.tables.map((table) => table.id),
  ]);
  const takenNames = new Set<string>([
    ...current.tables.map((table) => table.name),
    ...incoming.tables.map((table) => table.name),
  ]);

  const defaults: MergeResolutions = {};
  const renameSuggestions: Record<string, RenameSuggestion> = {};

  for (const conflict of conflicts) {
    const newTableId =
      conflict.kind === 'id' ? uniqueId(conflict.incomingTableId, takenIds) : conflict.incomingTableId;
    const newTableName = uniqueDisplayName(conflict.incomingTableName, takenNames);

    if (conflict.kind === 'id') takenIds.add(newTableId);
    takenNames.add(newTableName);

    renameSuggestions[conflict.incomingTableId] = { newTableId, newTableName };
    defaults[conflict.incomingTableId] =
      conflict.kind === 'id'
        ? { kind: 'overwrite' }
        : { kind: 'rename', newTableId, newTableName };
  }

  return { defaults, renameSuggestions };
}

type ResolvedTarget =
  | { mode: 'skip' }
  | { mode: 'add' | 'overwrite' | 'rename'; id: string; name: string };

const resolveTarget = (
  incomingTable: ConfigTable,
  resolution: MergeResolution | undefined,
): ResolvedTarget => {
  if (resolution?.kind === 'skip') return { mode: 'skip' };
  if (resolution?.kind === 'rename') {
    return { mode: 'rename', id: resolution.newTableId, name: resolution.newTableName };
  }
  if (resolution?.kind === 'overwrite') {
    return { mode: 'overwrite', id: incomingTable.id, name: incomingTable.name };
  }
  return { mode: 'add', id: incomingTable.id, name: incomingTable.name };
};

export function applyMerge(
  current: ProjectFile,
  incoming: ProjectFile,
  resolutions: MergeResolutions = {},
): ProjectFile {
  const tables = current.tables.map((table) => ({ ...table }));
  const takenPositions = new Set(tables.map((table) => positionKey(table.position)));
  const idMap = new Map<string, string>();
  const derived: ConfigTable[] = [];

  for (const incomingTable of incoming.tables) {
    const target = resolveTarget(incomingTable, resolutions[incomingTable.id]);
    if (target.mode === 'skip') continue;

    if (target.id !== incomingTable.id) idMap.set(incomingTable.id, target.id);

    const table: ConfigTable = { ...incomingTable, id: target.id, name: target.name };

    if (target.mode === 'overwrite') {
      const index = tables.findIndex((item) => item.id === incomingTable.id);
      if (index >= 0) {
        const replaced = { ...table, position: tables[index].position };
        tables[index] = replaced;
        derived.push(replaced);
        continue;
      }
    }

    const position = nudgePosition(incomingTable.position, takenPositions);
    const appended = { ...table, position };
    tables.push(appended);
    derived.push(appended);
    takenPositions.add(positionKey(position));
  }

  for (const table of derived) {
    table.columns = table.columns.map((column) => {
      if (!column.ref) return column;
      const newTargetId = idMap.get(column.ref.tableId);
      if (!newTargetId || newTargetId === column.ref.tableId) return column;
      return { ...column, ref: { ...column.ref, tableId: newTargetId } };
    });
  }

  return { version: 1, tables };
}

export function computeMergeReport(
  current: ProjectFile,
  incoming: ProjectFile,
  resolutions: MergeResolutions,
  t: Translator,
): MergeReport {
  const candidate = applyMerge(current, incoming, resolutions);
  const issues = validateProject(candidate, t);
  const baselineIds = new Set(validateProject(current, t).map((issue) => issue.id));
  const newIssues = issues.filter((issue) => !baselineIds.has(issue.id));
  const existingIssues = issues.filter((issue) => baselineIds.has(issue.id));

  const counts = { added: 0, overwritten: 0, skipped: 0, renamed: 0 };
  for (const table of incoming.tables) {
    const resolution = resolutions[table.id];
    if (resolution?.kind === 'skip') counts.skipped += 1;
    else if (resolution?.kind === 'rename') counts.renamed += 1;
    else if (resolution?.kind === 'overwrite') counts.overwritten += 1;
    else counts.added += 1;
  }

  return {
    candidate,
    issues,
    newIssues,
    existingIssues,
    newErrorCount: newIssues.filter((issue) => issue.severity === 'error').length,
    newWarningCount: newIssues.filter((issue) => issue.severity === 'warning').length,
    counts,
  };
}
