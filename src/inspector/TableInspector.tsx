import type { ConfigTable, ProjectFile, TableIdentity } from '../model/types';
import type { Translator } from '../i18n';
import { useEditorStore } from '../store/editorStore';
import ColumnEditor from './ColumnEditor';

type TableInspectorProps = {
  table?: ConfigTable;
  project: ProjectFile;
  t: Translator;
  compact?: boolean;
};

export default function TableInspector({ table, project, t, compact = false }: TableInspectorProps) {
  const updateTable = useEditorStore((state) => state.updateTable);
  const deleteTable = useEditorStore((state) => state.deleteTable);
  const addColumn = useEditorStore((state) => state.addColumn);

  if (!table) {
    return (
      <section className="inspector-panel">
        <h2>{t('inspector')}</h2>
        <p className="empty-copy">{t('noTableSelected')}</p>
      </section>
    );
  }

  const updateIdentity = (patch: Partial<TableIdentity>) => {
    const nextIdentity = { ...table.identity, ...patch };
    const normalizedIdentity: TableIdentity = {};

    if (nextIdentity.namespace) normalizedIdentity.namespace = nextIdentity.namespace;
    if (nextIdentity.keyColumnId) normalizedIdentity.keyColumnId = nextIdentity.keyColumnId;
    if (nextIdentity.valueColumnId) normalizedIdentity.valueColumnId = nextIdentity.valueColumnId;

    updateTable(table.id, {
      identity:
        normalizedIdentity.namespace ||
        normalizedIdentity.keyColumnId ||
        normalizedIdentity.valueColumnId
          ? normalizedIdentity
          : undefined,
    });
  };

  return (
    <section className="inspector-panel">
      <div className="panel-heading">
        <h2>{t('inspector')}</h2>
        {compact ? null : (
          <button
            type="button"
            className="button button--ghost danger"
            title="Delete"
            onClick={() => {
              if (window.confirm(t('confirmDeleteTable', { name: table.name }))) deleteTable(table.id);
            }}
          >
            {t('deleteTable')}
          </button>
        )}
      </div>

      <label className="field-stack">
        <span>{t('tableId')}</span>
        <input value={table.id} readOnly />
      </label>
      <label className="field-stack">
        <span>{t('tableName')}</span>
        <input
          value={table.name}
          onChange={(event) => updateTable(table.id, { name: event.target.value })}
        />
      </label>

      <div className="panel-heading panel-heading--spaced">
        <h3>{t('identityRegistry')}</h3>
      </div>

      <div className="identity-grid">
        <label className="field-stack">
          <span>{t('identityNamespace')}</span>
          <input
            value={table.identity?.namespace ?? table.name}
            onChange={(event) =>
              updateIdentity({ namespace: event.target.value || undefined })
            }
          />
        </label>
        <label className="field-stack">
          <span>{t('identityKeyField')}</span>
          <select
            value={table.identity?.keyColumnId ?? ''}
            onChange={(event) =>
              updateIdentity({ keyColumnId: event.target.value || undefined })
            }
          >
            <option value="">{t('none')}</option>
            {table.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name || column.id}
              </option>
            ))}
          </select>
        </label>
        <label className="field-stack">
          <span>{t('identityValueField')}</span>
          <select
            value={table.identity?.valueColumnId ?? ''}
            onChange={(event) =>
              updateIdentity({ valueColumnId: event.target.value || undefined })
            }
          >
            <option value="">{t('none')}</option>
            {table.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name || column.id}
                {column.primary ? ` (${t('pk')})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-heading panel-heading--spaced">
        <h3>{t('fields')}</h3>
        <button
          type="button"
          className="button button--primary"
          onClick={() => addColumn(table.id)}
          title="F"
        >
          {t('addField')}
        </button>
      </div>

      <div className="column-list">
        {table.columns.map((column) => (
          <ColumnEditor
            key={column.id}
            column={column}
            tableId={table.id}
            project={project}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}
