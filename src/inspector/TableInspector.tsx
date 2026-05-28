import type { ConfigTable, ProjectFile } from '../model/types';
import type { Translator } from '../i18n';
import { useEditorStore } from '../store/editorStore';
import ColumnEditor from './ColumnEditor';

type TableInspectorProps = {
  table?: ConfigTable;
  project: ProjectFile;
  t: Translator;
};

export default function TableInspector({ table, project, t }: TableInspectorProps) {
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

  return (
    <section className="inspector-panel">
      <div className="panel-heading">
        <h2>{t('inspector')}</h2>
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
