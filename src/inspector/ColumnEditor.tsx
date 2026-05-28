import { COLUMN_TYPES, type ColumnType, type ConfigColumn, type ProjectFile } from '../model/types';
import type { Translator } from '../i18n';
import { useEditorStore } from '../store/editorStore';
import { getPrimaryColumn } from '../model/schemaUtils';

type ColumnEditorProps = {
  column: ConfigColumn;
  tableId: string;
  project: ProjectFile;
  t: Translator;
};

export default function ColumnEditor({ column, tableId, project, t }: ColumnEditorProps) {
  const updateColumn = useEditorStore((state) => state.updateColumn);
  const deleteColumn = useEditorStore((state) => state.deleteColumn);
  const targetTable = project.tables.find((table) => table.id === column.ref?.tableId);
  const targetFields = targetTable?.columns ?? [];

  const setType = (type: ColumnType) => {
    if (type === 'ref') {
      const fallbackTable = project.tables.find((table) => table.id !== tableId) ?? project.tables[0];
      const fallbackColumn = getPrimaryColumn(fallbackTable);
      updateColumn(tableId, column.id, {
        type,
        ref: fallbackTable && fallbackColumn ? { tableId: fallbackTable.id, columnId: fallbackColumn.id } : undefined,
        enumValues: undefined,
      });
      return;
    }

    if (type === 'enum') {
      updateColumn(tableId, column.id, {
        type,
        enumValues: column.enumValues?.length ? column.enumValues : ['value_a', 'value_b'],
        ref: undefined,
      });
      return;
    }

    updateColumn(tableId, column.id, { type, ref: undefined, enumValues: undefined });
  };

  return (
    <div className="column-editor">
      <div className="column-editor__main">
        <input
          aria-label={t('fieldName')}
          value={column.name}
          onChange={(event) => updateColumn(tableId, column.id, { name: event.target.value })}
        />
        <select
          aria-label={t('fieldType')}
          value={column.type}
          onChange={(event) => setType(event.target.value as ColumnType)}
        >
          {COLUMN_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button--ghost danger column-editor__delete"
          onClick={() => deleteColumn(tableId, column.id)}
        >
          {t('delete')}
        </button>
      </div>

      <div className="column-editor__flags">
        <label className="check-label">
          <input
            type="checkbox"
            checked={Boolean(column.primary)}
            onChange={(event) =>
              updateColumn(tableId, column.id, { primary: event.target.checked })
            }
          />
          {t('pk')}
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={Boolean(column.required)}
            disabled={Boolean(column.primary)}
            onChange={(event) =>
              updateColumn(tableId, column.id, { required: event.target.checked })
            }
          />
          {t('required')}
        </label>
      </div>

      {column.type === 'enum' ? (
        <label className="field-stack">
          <span>{t('enumValues')}</span>
          <input
            value={(column.enumValues ?? []).join(', ')}
            onChange={(event) =>
              updateColumn(tableId, column.id, {
                enumValues: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      ) : null}

      {column.type === 'ref' ? (
        <div className="ref-target-grid">
          <label className="field-stack">
            <span>{t('targetTable')}</span>
            <select
              value={column.ref?.tableId ?? ''}
              onChange={(event) => {
                const nextTable = project.tables.find((table) => table.id === event.target.value);
                const nextColumn = getPrimaryColumn(nextTable);
                updateColumn(tableId, column.id, {
                  ref: {
                    tableId: event.target.value,
                    columnId: nextColumn?.id ?? '',
                  },
                });
              }}
            >
              <option value="">{t('none')}</option>
              {project.tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span>{t('targetField')}</span>
            <select
              value={column.ref?.columnId ?? ''}
              onChange={(event) =>
                updateColumn(tableId, column.id, {
                  ref: { tableId: column.ref?.tableId ?? '', columnId: event.target.value },
                })
              }
            >
              <option value="">{t('none')}</option>
              {targetFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                  {field.primary ? ` (${t('pk')})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
