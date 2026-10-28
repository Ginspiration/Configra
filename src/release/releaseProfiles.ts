import { makeId, uniqueName } from '../model/rowFactory';
import type {
  ConfigTable,
  ProjectFile,
  ReleaseProfile,
  ReleaseProfileTable,
  ReleaseProfiles,
} from '../model/types';

/** 工程文件与发布方案的版本号；v3 起发布范围只由 releaseProfiles 决定。 */
export const PROJECT_VERSION = 3 as const;
export const RELEASE_PROFILES_VERSION = 1 as const;
export const DEFAULT_RELEASE_PROFILE_ID = 'profile_default';
export const DEFAULT_RELEASE_PROFILE_NAME = 'Default';

export type ReleaseProfileProblemCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_TABLE_NOT_FOUND'
  | 'PROFILE_ROW_NOT_FOUND'
  | 'PROFILE_DUPLICATE_NAME'
  | 'PROFILE_READ_ONLY'
  | 'PROFILE_LAST';

export class ReleaseProfileError extends Error {
  readonly code: ReleaseProfileProblemCode;
  readonly profileId?: string;
  readonly tableId?: string;
  readonly rowId?: string;

  constructor(
    code: ReleaseProfileProblemCode,
    message: string,
    details: { profileId?: string; tableId?: string; rowId?: string } = {},
  ) {
    super(message);
    this.name = 'ReleaseProfileError';
    this.code = code;
    this.profileId = details.profileId;
    this.tableId = details.tableId;
    this.rowId = details.rowId;
  }
}

export type ReleaseProfileSummary = {
  id: string;
  name: string;
  mode: ReleaseProfile['mode'];
  tableCount: number;
  rowCount: number;
};

/** 一次解析后的范围内存视图；all 模式同样展开成具体集合，便于统一判断。 */
export type ReleaseProfileScope = {
  profile: ReleaseProfile;
  tableIds: Set<string>;
  rowsByTable: Map<string, 'all' | Set<string>>;
};

const totalRows = (tables: readonly ConfigTable[]) =>
  tables.reduce((count, table) => count + table.rows.length, 0);

export const createReleaseProfileId = (existingIds: Iterable<string>): string => {
  const used = new Set(existingIds);
  let id = makeId('profile');
  while (used.has(id)) id = makeId('profile');
  return id;
};

const createDefaultProfile = (
  tables: ReadonlyArray<Pick<ConfigTable, 'id' | 'publish' | 'rows'>>,
  id = DEFAULT_RELEASE_PROFILE_ID,
  name = DEFAULT_RELEASE_PROFILE_NAME,
): ReleaseProfile => {
  const selectedTables: ReleaseProfileTable[] = [];

  for (const table of tables) {
    if (table.publish !== true) continue;
    // 始终写显式 _rowId 列表：即使旧工程恰好全部行可发布，升级后新增行
    // 仍保持“默认不发布”，不因为迁移把未来行自动纳入范围。
    const publishedRowIds = table.rows
      .filter((row) => row.publish === true)
      .map((row) => row._rowId);
    selectedTables.push({ tableId: table.id, rows: publishedRowIds });
  }

  // 没有 publish 标记时迁移成空 selected，绝不默认全量发布。
  return { id, name, mode: 'selected', tables: selectedTables };
};

/**
 * v1/v2 -> v3：把旧 publish 标记转成 default 方案，并清掉旧标记，
 * 保证新逻辑里只有一套发布范围。
 */
export function normalizeProjectFile(project: ProjectFile): ProjectFile {
  const releaseProfiles = isReleaseProfiles(project.releaseProfiles)
    ? normalizeReleaseProfiles(project.releaseProfiles)
    : normalizeReleaseProfiles({
        version: RELEASE_PROFILES_VERSION,
        activeProfileId: DEFAULT_RELEASE_PROFILE_ID,
        profiles: [createDefaultProfile(project.tables)],
      });

  return {
    version: PROJECT_VERSION,
    releaseProfiles,
    tables: project.tables.map((table) => {
      const { publish: _tablePublish, ...rest } = table;
      return {
        ...rest,
        rows: table.rows.map((row) => {
          const { publish: _rowPublish, ...rowRest } = row;
          return rowRest;
        }),
      };
    }),
  };
}

export const isReleaseProfileMode = (value: unknown): value is ReleaseProfile['mode'] =>
  value === 'all' || value === 'selected';

export function isReleaseProfiles(value: unknown): value is ReleaseProfiles {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<ReleaseProfiles>;
  if (candidate.version !== RELEASE_PROFILES_VERSION) return false;
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) return false;
  if (
    candidate.activeProfileId !== undefined &&
    typeof candidate.activeProfileId !== 'string'
  ) {
    return false;
  }

  const ids = new Set<string>();
  for (const profile of candidate.profiles) {
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return false;
    if (typeof profile.id !== 'string' || !profile.id) return false;
    if (typeof profile.name !== 'string' || !profile.name) return false;
    if (!isReleaseProfileMode(profile.mode)) return false;
    if (ids.has(profile.id)) return false;
    ids.add(profile.id);

    if (profile.tables === undefined) continue;
    if (!Array.isArray(profile.tables)) return false;
    if (profile.mode === 'all' && profile.tables.length > 0) return false;
    for (const entry of profile.tables) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
      if (typeof entry.tableId !== 'string' || !entry.tableId) return false;
      if (entry.rows === 'all') continue;
      if (
        !Array.isArray(entry.rows) ||
        entry.rows.some((rowId) => typeof rowId !== 'string' || !rowId)
      ) {
        return false;
      }
    }
  }

  return true;
}

/** 修复可容忍的结构问题：空方案集合、悬空 activeProfileId、all 方案的冗余表列表。 */
export function normalizeReleaseProfiles(releaseProfiles: ReleaseProfiles): ReleaseProfiles {
  const profiles: ReleaseProfile[] = [];
  const seenIds = new Set<string>();

  for (const profile of releaseProfiles.profiles ?? []) {
    if (!profile || typeof profile.id !== 'string' || !profile.id) continue;
    if (seenIds.has(profile.id)) continue;
    seenIds.add(profile.id);

    const name = typeof profile.name === 'string' && profile.name.trim()
      ? profile.name
      : profile.id;
    if (profile.mode === 'all') {
      profiles.push({ id: profile.id, name, mode: 'all' });
      continue;
    }

    profiles.push({
      id: profile.id,
      name,
      mode: 'selected',
      tables: (profile.tables ?? []).map((entry) => ({
        tableId: entry.tableId,
        rows: entry.rows === 'all' ? 'all' : [...entry.rows],
      })),
    });
  }

  if (profiles.length === 0) {
    profiles.push({
      id: DEFAULT_RELEASE_PROFILE_ID,
      name: DEFAULT_RELEASE_PROFILE_NAME,
      mode: 'selected',
      tables: [],
    });
  }

  const activeProfileId =
    typeof releaseProfiles.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === releaseProfiles.activeProfileId)
      ? releaseProfiles.activeProfileId
      : profiles[0].id;

  return { version: RELEASE_PROFILES_VERSION, activeProfileId, profiles };
}

export const releaseProfileList = (project: ProjectFile): ReleaseProfile[] =>
  project.releaseProfiles?.profiles ?? [];

export const activeReleaseProfile = (project: ProjectFile): ReleaseProfile | undefined => {
  const profiles = releaseProfileList(project);
  if (profiles.length === 0) return undefined;
  return (
    profiles.find((profile) => profile.id === project.releaseProfiles?.activeProfileId) ??
    profiles[0]
  );
};

/**
 * CLI/MCP/UI 选择方案：优先稳定 id，其次唯一名称。
 * 名称重复时必须改用 id，避免把展示名当作引用。
 */
export function findReleaseProfile(
  project: ProjectFile,
  selector?: string,
): ReleaseProfile {
  const profiles = releaseProfileList(project);
  if (profiles.length === 0) {
    throw new ReleaseProfileError(
      'PROFILE_NOT_FOUND',
      'This project has no release profiles yet.',
    );
  }

  if (selector === undefined || selector === '') {
    const active = activeReleaseProfile(project);
    if (active) return active;
    throw new ReleaseProfileError(
      'PROFILE_NOT_FOUND',
      'This project has no active release profile.',
    );
  }

  const byId = profiles.find((profile) => profile.id === selector);
  if (byId) return byId;

  const byName = profiles.filter((profile) => profile.name === selector);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new ReleaseProfileError(
      'PROFILE_DUPLICATE_NAME',
      `Release profile name "${selector}" is not unique. Use the stable profile id.`,
    );
  }

  throw new ReleaseProfileError(
    'PROFILE_NOT_FOUND',
    `Unknown release profile "${selector}". Known profiles: ${profiles
      .map((profile) => profile.id)
      .join(', ')}.`,
  );
}

export function releaseProfileScope(
  project: ProjectFile,
  profile: ReleaseProfile,
): ReleaseProfileScope {
  if (profile.mode === 'all') {
    return {
      profile,
      tableIds: new Set(project.tables.map((table) => table.id)),
      rowsByTable: new Map(project.tables.map((table) => [table.id, 'all' as const])),
    };
  }

  const tableIds = new Set<string>();
  const rowsByTable = new Map<string, 'all' | Set<string>>();

  for (const entry of profile.tables ?? []) {
    const table = project.tables.find((candidate) => candidate.id === entry.tableId);
    if (!table) {
      throw new ReleaseProfileError(
        'PROFILE_TABLE_NOT_FOUND',
        `Release profile "${profile.name}" references unknown tableId "${entry.tableId}".`,
        { profileId: profile.id, tableId: entry.tableId },
      );
    }

    if (entry.rows === 'all') {
      tableIds.add(table.id);
      rowsByTable.set(table.id, 'all');
      continue;
    }

    const knownRowIds = new Set(table.rows.map((row) => row._rowId));
    const selectedRows = new Set<string>();
    for (const rowId of entry.rows) {
      if (!knownRowIds.has(rowId)) {
        throw new ReleaseProfileError(
          'PROFILE_ROW_NOT_FOUND',
          `Release profile "${profile.name}" references unknown rowId "${rowId}" in table "${table.id}".`,
          { profileId: profile.id, tableId: table.id, rowId },
        );
      }
      selectedRows.add(rowId);
    }

    tableIds.add(table.id);
    rowsByTable.set(table.id, selectedRows);
  }

  return { profile, tableIds, rowsByTable };
}

export const isTableInScope = (scope: ReleaseProfileScope, tableId: string) =>
  scope.tableIds.has(tableId);

export function isRowInScope(
  scope: ReleaseProfileScope,
  tableId: string,
  rowId: string,
): boolean {
  const rows = scope.rowsByTable.get(tableId);
  if (rows === undefined) return false;
  return rows === 'all' || rows.has(rowId);
}

/** 方案摘要；悬空引用只按存在的内容计数，不抛错，便于 inspect 展示。 */
export function summarizeReleaseProfile(
  project: ProjectFile,
  profile: ReleaseProfile,
): ReleaseProfileSummary {
  if (profile.mode === 'all') {
    return {
      id: profile.id,
      name: profile.name,
      mode: 'all',
      tableCount: project.tables.length,
      rowCount: totalRows(project.tables),
    };
  }

  const tableIds = new Set<string>();
  let rowCount = 0;
  for (const entry of profile.tables ?? []) {
    const table = project.tables.find((candidate) => candidate.id === entry.tableId);
    if (!table) continue;
    tableIds.add(table.id);
    rowCount += entry.rows === 'all' ? table.rows.length : new Set(entry.rows).size;
  }

  return {
    id: profile.id,
    name: profile.name,
    mode: 'selected',
    tableCount: tableIds.size,
    rowCount,
  };
}

export function summarizeReleaseProfiles(project: ProjectFile) {
  const profiles = releaseProfileList(project);
  const active = activeReleaseProfile(project);
  return {
    version: RELEASE_PROFILES_VERSION,
    activeProfileId: active?.id,
    profiles: profiles.map((profile) => summarizeReleaseProfile(project, profile)),
    active: active ? summarizeReleaseProfile(project, active) : undefined,
  };
}

export type ReleaseProfilesSummary = ReturnType<typeof summarizeReleaseProfiles>;

const replaceProfiles = (
  project: ProjectFile,
  releaseProfiles: ReleaseProfiles,
): ProjectFile => ({
  ...project,
  version: PROJECT_VERSION,
  releaseProfiles: normalizeReleaseProfiles(releaseProfiles),
});

const replaceProfile = (
  project: ProjectFile,
  profileId: string,
  update: (profile: ReleaseProfile) => ReleaseProfile,
): ProjectFile => {
  const releaseProfiles = project.releaseProfiles;
  const profile = releaseProfiles?.profiles.find((candidate) => candidate.id === profileId);
  if (!releaseProfiles || !profile) {
    throw new ReleaseProfileError(
      'PROFILE_NOT_FOUND',
      `Unknown release profile "${profileId}".`,
      { profileId },
    );
  }

  return replaceProfiles(project, {
    ...releaseProfiles,
    profiles: releaseProfiles.profiles.map((candidate) =>
      candidate.id === profileId ? update(candidate) : candidate,
    ),
  });
};

export function setActiveReleaseProfile(project: ProjectFile, profileId: string): ProjectFile {
  const profile = findReleaseProfile(project, profileId);
  return replaceProfiles(project, {
    ...project.releaseProfiles!,
    activeProfileId: profile.id,
  });
}

const uniqueProfileName = (project: ProjectFile, base: string) =>
  uniqueName(
    base.trim() || DEFAULT_RELEASE_PROFILE_NAME,
    releaseProfileList(project).map((profile) => profile.name),
  );

export function createReleaseProfile(
  project: ProjectFile,
  name?: string,
  mode: ReleaseProfile['mode'] = 'selected',
): { project: ProjectFile; profile: ReleaseProfile } {
  const profiles = releaseProfileList(project);
  const profile: ReleaseProfile = {
    id: createReleaseProfileId(profiles.map((candidate) => candidate.id)),
    name: uniqueProfileName(project, name ?? DEFAULT_RELEASE_PROFILE_NAME),
    mode,
    ...(mode === 'selected' ? { tables: [] } : {}),
  };

  return {
    project: replaceProfiles(project, {
      version: RELEASE_PROFILES_VERSION,
      activeProfileId: profile.id,
      profiles: [...profiles, profile],
    }),
    profile,
  };
}

export function duplicateReleaseProfile(
  project: ProjectFile,
  profileId: string,
  name?: string,
): { project: ProjectFile; profile: ReleaseProfile } {
  const source = findReleaseProfile(project, profileId);
  const profiles = releaseProfileList(project);
  const copy: ReleaseProfile = {
    id: createReleaseProfileId(profiles.map((candidate) => candidate.id)),
    name: uniqueProfileName(project, name ?? `${source.name} copy`),
    mode: source.mode,
    ...(source.mode === 'selected'
      ? {
          tables: (source.tables ?? []).map((entry) => ({
            tableId: entry.tableId,
            rows: entry.rows === 'all' ? ('all' as const) : [...entry.rows],
          })),
        }
      : {}),
  };

  return {
    project: replaceProfiles(project, {
      version: RELEASE_PROFILES_VERSION,
      activeProfileId: copy.id,
      profiles: [...profiles, copy],
    }),
    profile: copy,
  };
}

export function renameReleaseProfile(
  project: ProjectFile,
  profileId: string,
  name: string,
): ProjectFile {  const trimmed = name.trim();
  if (!trimmed) {
    throw new ReleaseProfileError('PROFILE_DUPLICATE_NAME', 'Release profile name is empty.', {
      profileId,
    });
  }

  const duplicate = releaseProfileList(project).some(
    (profile) => profile.id !== profileId && profile.name === trimmed,
  );
  if (duplicate) {
    throw new ReleaseProfileError(
      'PROFILE_DUPLICATE_NAME',
      `Release profile name "${trimmed}" is already used.`,
      { profileId },
    );
  }

  return replaceProfile(project, profileId, (profile) => ({ ...profile, name: trimmed }));
}

/**
 * 切换方案范围模式。切成 all 会丢弃 explicit 表/行范围；
 * 切回 selected 时从空范围开始，避免把“刚切成部分模式”误当成全选。
 */
export function setReleaseProfileMode(
  project: ProjectFile,
  profileId: string,
  mode: ReleaseProfile['mode'],
): ProjectFile {
  return replaceProfile(project, profileId, (profile) => {
    if (profile.mode === mode) return profile;
    if (mode === 'all') {
      return { id: profile.id, name: profile.name, mode: 'all' };
    }
    return { id: profile.id, name: profile.name, mode: 'selected', tables: [] };
  });
}

export function deleteReleaseProfile(project: ProjectFile, profileId: string): ProjectFile {
  const profiles = releaseProfileList(project);
  findReleaseProfile(project, profileId);
  if (profiles.length <= 1) {
    throw new ReleaseProfileError(
      'PROFILE_LAST',
      'At least one release profile must be kept.',
      { profileId },
    );
  }

  const remaining = profiles.filter((profile) => profile.id !== profileId);
  return replaceProfiles(project, {
    version: RELEASE_PROFILES_VERSION,
    activeProfileId:
      project.releaseProfiles?.activeProfileId === profileId
        ? remaining[0].id
        : project.releaseProfiles?.activeProfileId,
    profiles: remaining,
  });
}

const assertEditableProfile = (profile: ReleaseProfile): ReleaseProfile => {
  if (profile.mode === 'all') {
    throw new ReleaseProfileError(
      'PROFILE_READ_ONLY',
      `Release profile "${profile.name}" publishes all tables and rows; switch it to selected mode to edit its scope.`,
      { profileId: profile.id },
    );
  }
  return profile;
};

export function setReleaseProfileTable(
  project: ProjectFile,
  profileId: string,
  tableId: string,
  included: boolean,
): ProjectFile {
  const profile = assertEditableProfile(findReleaseProfile(project, profileId));
  if (!project.tables.some((table) => table.id === tableId)) {
    throw new ReleaseProfileError(
      'PROFILE_TABLE_NOT_FOUND',
      `Unknown tableId "${tableId}".`,
      { profileId, tableId },
    );
  }

  return replaceProfile(project, profile.id, (current) => {
    const tables = current.tables ?? [];
    const existing = tables.find((entry) => entry.tableId === tableId);
    if (included) {
      if (existing) return current;
      // 勾选表只把表加入方案，不自动把现有行标记为可发布。
      return { ...current, tables: [...tables, { tableId, rows: [] }] };
    }
    if (!existing) return current;
    return { ...current, tables: tables.filter((entry) => entry.tableId !== tableId) };
  });
}

export function setReleaseProfileRows(
  project: ProjectFile,
  profileId: string,
  tableId: string,
  rowIds: readonly string[],
  included: boolean,
): ProjectFile {
  const profile = assertEditableProfile(findReleaseProfile(project, profileId));
  const table = project.tables.find((candidate) => candidate.id === tableId);
  if (!table) {
    throw new ReleaseProfileError(
      'PROFILE_TABLE_NOT_FOUND',
      `Unknown tableId "${tableId}".`,
      { profileId, tableId },
    );
  }

  const knownRowIds = new Set(table.rows.map((row) => row._rowId));
  for (const rowId of rowIds) {
    if (!knownRowIds.has(rowId)) {
      throw new ReleaseProfileError(
        'PROFILE_ROW_NOT_FOUND',
        `Unknown rowId "${rowId}" in table "${tableId}".`,
        { profileId, tableId, rowId },
      );
    }
  }

  const requested = new Set(rowIds);
  return replaceProfile(project, profile.id, (current) => {
    const tables = current.tables ?? [];
    const existing = tables.find((entry) => entry.tableId === tableId);

    if (included) {
      if (!existing) {
        return {
          ...current,
          tables: [...tables, { tableId, rows: [...requested] }],
        };
      }
      if (existing.rows === 'all') return current;
      const nextRows = new Set([...existing.rows, ...requested]);
      return {
        ...current,
        tables: tables.map((entry) =>
          entry.tableId === tableId ? { ...entry, rows: [...nextRows] } : entry,
        ),
      };
    }

    if (!existing) return current;
    const nextRows =
      existing.rows === 'all'
        ? table.rows
            .map((row) => row._rowId)
            .filter((rowId) => !requested.has(rowId))
        : existing.rows.filter((rowId) => !requested.has(rowId));

    return {
      ...current,
      tables: tables.map((entry) =>
        entry.tableId === tableId ? { ...entry, rows: nextRows } : entry,
      ),
    };
  });
}

/**
 * 表和行被删除后清理所有方案里的悬空引用，避免下次导出才报错。
 * 只清理 selected 方案；all 模式没有显式引用。
 */
export function pruneReleaseProfiles(project: ProjectFile): ProjectFile {
  if (!project.releaseProfiles) return normalizeProjectFile(project);

  const tableById = new Map(project.tables.map((table) => [table.id, table]));
  let changed = false;
  const profiles = project.releaseProfiles.profiles.map((profile) => {
    if (profile.mode === 'all') return profile;

    const tables: ReleaseProfileTable[] = [];
    for (const entry of profile.tables ?? []) {
      const table = tableById.get(entry.tableId);
      if (!table) {
        changed = true;
        continue;
      }
      if (entry.rows === 'all') {
        tables.push(entry);
        continue;
      }
      const knownRowIds = new Set(table.rows.map((row) => row._rowId));
      const rows = entry.rows.filter((rowId) => knownRowIds.has(rowId));
      if (rows.length !== entry.rows.length) changed = true;
      tables.push({ tableId: entry.tableId, rows });
    }

    const previousTables = profile.tables ?? [];
    if (tables.length === previousTables.length) {
      const same = tables.every((entry, index) => {
        const previous = previousTables[index];
        if (previous.tableId !== entry.tableId) return false;
        if (previous.rows === 'all' || entry.rows === 'all') {
          return previous.rows === entry.rows;
        }
        return (
          previous.rows.length === entry.rows.length &&
          previous.rows.every((rowId, rowIndex) => rowId === entry.rows[rowIndex])
        );
      });
      if (same) return profile;
    }

    changed = true;
    return { ...profile, tables };
  });

  if (!changed) return project;

  return replaceProfiles(project, {
    ...project.releaseProfiles,
    profiles,
  });
}

/** 当前方案下判断表/行是否在发布范围；没有方案时一律不在范围内。 */
export function tableInActiveProfile(project: ProjectFile, tableId: string): boolean {
  const profile = activeReleaseProfile(project);
  if (!profile) return false;
  return profileTableScope(project, profile, tableId).included;
}

export function rowInActiveProfile(
  project: ProjectFile,
  tableId: string,
  rowId: string,
): boolean {
  const profile = activeReleaseProfile(project);
  if (!profile) return false;
  const scope = profileTableScope(project, profile, tableId);
  if (!scope.included) return false;
  return scope.rows === 'all' || scope.rows.has(rowId);
}

/**
 * 展示/检查用的容错范围：方案引用了不存在的表/行时按“不存在即不包含”处理，
 * 不抛错。导出/发布计划仍使用严格版本，遇到悬空引用会失败。
 */
export function profileTableScope(
  project: ProjectFile,
  profile: ReleaseProfile,
  tableId: string,
): { included: boolean; rows: 'all' | Set<string> } {
  if (profile.mode === 'all') {
    const exists = project.tables.some((table) => table.id === tableId);
    return exists ? { included: true, rows: 'all' } : { included: false, rows: new Set() };
  }

  const entry = profile.tables?.find((candidate) => candidate.tableId === tableId);
  const table = project.tables.find((candidate) => candidate.id === tableId);
  if (!entry || !table) return { included: false, rows: new Set() };
  if (entry.rows === 'all') return { included: true, rows: 'all' };

  const knownRowIds = new Set(table.rows.map((row) => row._rowId));
  return {
    included: true,
    rows: new Set(entry.rows.filter((rowId) => knownRowIds.has(rowId))),
  };
}

/** 行范围的内存视图；all 模式返回 'all'，避免逐行判断时重复解析方案。 */
export function activeProfileRowScope(
  project: ProjectFile,
  tableId: string,
): 'all' | Set<string> {
  const profile = activeReleaseProfile(project);
  if (!profile) return new Set();
  return profileTableScope(project, profile, tableId).rows;
}

export const activeProfileMode = (project: ProjectFile): ReleaseProfile['mode'] | undefined =>
  activeReleaseProfile(project)?.mode;
