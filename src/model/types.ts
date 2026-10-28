export const COLUMN_TYPES = ['int', 'float', 'string', 'bool', 'enum', 'ref', 'json'] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export type ReleaseProfileMode = 'all' | 'selected';

/**
 * 一个发布方案在 selected 模式下的表/行范围。
 * rows 为 'all' 表示该表所有行；否则是稳定的 _rowId 列表。
 */
export type ReleaseProfileTable = {
  tableId: string;
  rows: 'all' | string[];
};

/** 一个发布方案；id 稳定，name 只用于展示和 CLI 选择。 */
export type ReleaseProfile = {
  id: string;
  name: string;
  mode: ReleaseProfileMode;
  /** 只在 selected 模式使用；all 模式忽略该字段。 */
  tables?: ReleaseProfileTable[];
};

/** 工程内的发布方案集合；activeProfileId 指向当前生效的方案。 */
export type ReleaseProfiles = {
  version: 1;
  activeProfileId?: string;
  profiles: ReleaseProfile[];
};

export type ProjectFile = {
  /**
   * 3 = 带发布方案（releaseProfiles）；2 = 带旧的 publish 标记；
   * 1 = 更旧的工程。打开 1/2 时迁移为 3 并写回 default 方案。
   * 旧版 Configra 会拒绝 3，避免忽略方案后按旧标记错误导出。
   */
  version: 1 | 2 | 3;
  /** @deprecated 仅用于读取 v1/v2 旧工程；v3 以 releaseProfiles 为唯一发布范围。 */
  exportPolicy?: 'explicit';
  releaseProfiles?: ReleaseProfiles;
  tables: ConfigTable[];
};

export type ConfigTable = {
  id: string;
  name: string;
  remark?: string;
  position: GraphPosition;
  columns: ConfigColumn[];
  rows: ConfigRow[];
  identity?: TableIdentity;
  /**
   * @deprecated 仅用于读取 v1/v2 旧工程并迁移成 default 方案。
   * v3 起发布范围只由 releaseProfiles 决定，不能两套范围同时生效。
   */
  publish?: boolean;
};

export type TableIdentity = {
  namespace?: string;
  keyColumnId?: string;
  valueColumnId?: string;
};

export type GraphPosition = {
  x: number;
  y: number;
};

export type ConfigColumn = {
  id: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  primary?: boolean;
  autoIncrement?: boolean;
  export?: boolean;
  remark?: string;
  enumValues?: string[];
  ref?: ColumnRef;
};

export type ColumnRef = {
  tableId: string;
  columnId: string;
};

export type ConfigRow = {
  _rowId: string;
  /** @deprecated 仅用于读取 v1/v2 旧工程并迁移成 default 方案。 */
  publish?: boolean;
  values: Record<string, unknown>;
};

export type ValidationIssue = {
  id: string;
  severity: 'error' | 'warning';
  tableId: string;
  rowId?: string;
  columnId?: string;
  message: string;
};
