export const COLUMN_TYPES = ['int', 'float', 'string', 'bool', 'enum', 'ref', 'json'] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export type ProjectFile = {
  version: 1;
  tables: ConfigTable[];
};

export type ConfigTable = {
  id: string;
  name: string;
  position: GraphPosition;
  columns: ConfigColumn[];
  rows: ConfigRow[];
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
  enumValues?: string[];
  ref?: ColumnRef;
};

export type ColumnRef = {
  tableId: string;
  columnId: string;
};

export type ConfigRow = {
  _rowId: string;
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
