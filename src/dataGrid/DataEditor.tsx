import type { ConfigColumn, ConfigTable, ProjectFile, ValidationIssue } from '../model/types';
import type { Translator } from '../i18n';
import { useEditorStore } from '../store/editorStore';
import { formatRefOptionLabel } from '../model/schemaUtils';

type DataEditorProps = {
  table?: ConfigTable;
  project: ProjectFile;
  issues: ValidationIssue[];
  t: Translator;
};

const toInputValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
};

const parseNumber = (value: string) => (value.trim() === '' ? '' : Number(value));

const valueKey = (value: unknown) => JSON.stringify([typeof value, value]);

function RefCell({
  project,
  column,
  value,
  onChange,
}: {
  project: ProjectFile;
  column: ConfigColumn;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const targetTable = project.tables.find((table) => table.id === column.ref?.tableId);
  const targetColumn = targetTable?.columns.find((field) => field.id === column.ref?.columnId);
  const options =
    targetTable && targetColumn
      ? targetTable.rows
          .map((row) => ({
            key: valueKey(row.values[targetColumn.id]),
            label: formatRefOptionLabel(targetTable, targetColumn, row),
            value: row.values[targetColumn.id],
          }))
          .filter((item) => item.value !== undefined && item.value !== null && item.value !== '')
      : [];

  return (
    <select
      value={valueKey(value)}
      onChange={(event) => {
        const selected = options.find((item) => item.key === event.target.value);
        onChange(selected?.value ?? '');
      }}
    >
      <option value={valueKey('')}></option>
      {options.map((option, index) => (
        <option key={`${option.key}-${index}`} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function CellEditor({
  column,
  value,
  project,
  onChange,
}: {
  column: ConfigColumn;
  value: unknown;
  project: ProjectFile;
  onChange(value: unknown): void;
}) {
  if (column.type === 'bool') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (column.type === 'enum') {
    return (
      <select value={toInputValue(value)} onChange={(event) => onChange(event.target.value)}>
        <option value=""></option>
        {(column.enumValues ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (column.type === 'ref') {
    return <RefCell project={project} column={column} value={value} onChange={onChange} />;
  }

  if (column.type === 'int' || column.type === 'float') {
    return (
      <input
        type="number"
        step={column.type === 'int' ? 1 : 'any'}
        value={toInputValue(value)}
        onChange={(event) => onChange(parseNumber(event.target.value))}
      />
    );
  }

  if (column.type === 'json') {
    return (
      <textarea
        value={toInputValue(value)}
        onChange={(event) => onChange(event.target.value)}
        rows={1}
      />
    );
  }

  return (
    <input value={toInputValue(value)} onChange={(event) => onChange(event.target.value)} />
  );
}

export default function DataEditor({ table, project, issues, t }: DataEditorProps) {
  const addRow = useEditorStore((state) => state.addRow);
  const deleteRow = useEditorStore((state) => state.deleteRow);
  const updateCell = useEditorStore((state) => state.updateCell);

  if (!table) {
    return (
      <section className="data-editor">
        <div className="panel-heading">
          <h2>{t('rows')}</h2>
        </div>
        <p className="empty-copy">{t('noTableSelected')}</p>
      </section>
    );
  }

  const errorCells = new Set(
    issues
      .filter((issue) => issue.tableId === table.id && issue.rowId && issue.columnId)
      .map((issue) => `${issue.rowId}:${issue.columnId}`),
  );

  return (
    <section className="data-editor">
      <div className="panel-heading">
        <h2>{t('rowsTitle', { name: table.name })}</h2>
        <button
          type="button"
          className="button button--primary"
          onClick={() => addRow(table.id)}
          title="R"
        >
          {t('addRow')}
        </button>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column.id}>
                  {column.name}
                  {column.primary ? <span className="th-badge">PK</span> : null}
                </th>
              ))}
              <th className="row-action-head"></th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row._rowId}>
                {table.columns.map((column) => {
                  const hasError = errorCells.has(`${row._rowId}:${column.id}`);
                  return (
                    <td key={column.id} className={hasError ? 'cell-error' : undefined}>
                      <CellEditor
                        column={column}
                        value={row.values[column.id]}
                        project={project}
                        onChange={(value) => updateCell(table.id, row._rowId, column.id, value)}
                      />
                    </td>
                  );
                })}
                <td className="row-action">
                  <button
                    type="button"
                    className="button button--ghost danger"
                    onClick={() => deleteRow(table.id, row._rowId)}
                  >
                    {t('delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length === 0 ? <p className="empty-copy">{t('noRowsYet')}</p> : null}
      </div>
    </section>
  );
}
