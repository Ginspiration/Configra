export const COLUMN_TYPES = ['int', 'float', 'string', 'bool', 'enum', 'ref', 'json'] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export type ProjectFile = {
  /** 2 = 带发布范围标记；1 = 旧工程，首次配置发布范围后升级为 2。 */
  version: 1 | 2;
  /**
   * 显式发布范围。只有存在该标记时，普通导出才允许进行；
   * 旧工程没有该字段，必须先勾选可发布表才能导出。
   */
  exportPolicy?: 'explicit';
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
  /** 关闭时整张表不参与任何导出/发布；新表默认关闭。 */
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
  /** 关闭时该行不参与导出/发布；新行默认关闭。 */
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
