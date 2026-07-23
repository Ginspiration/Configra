import { useEffect } from 'react';
import type { ConfigColumn, ConfigTable } from '../model/types';
import type { Translator } from '../i18n';

type TablePreviewModalProps = {
  table: ConfigTable;
  t: Translator;
  onClose(): void;
  onSelectColumn(columnId: string): void;
};

const fieldName = (column: ConfigColumn) => column.name || column.id;

export default function TablePreviewModal({
  table,
  t,
  onClose,
  onSelectColumn,
}: TablePreviewModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="table-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="table-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="table-preview__header">
          <div>
            <h2 id="table-preview-title">{t('tablePreviewTitle', { name: table.name })}</h2>
            <p>
              {t('fieldsRows', { fields: table.columns.length, rows: table.rows.length })}
              {table.remark?.trim() ? ` · ${table.remark.trim()}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            ×
          </button>
        </header>

        <p className="table-preview__hint">{t('tablePreviewHint')}</p>

        <div className="table-preview__content">
          {table.columns.length > 0 ? (
            <table className="table-preview__table">
              <colgroup>
                <col className="table-preview__col-index" />
                <col className="table-preview__col-name" />
                <col className="table-preview__col-remark" />
                <col className="table-preview__col-type" />
                <col className="table-preview__col-attributes" />
                <col className="table-preview__col-export" />
              </colgroup>
              <thead>
                <tr>
                  <th className="table-preview__index">#</th>
                  <th>{t('fieldName')}</th>
                  <th>{t('fieldRemark')}</th>
                  <th>{t('fieldType')}</th>
                  <th>{t('fieldAttributes')}</th>
                  <th>{t('exportField')}</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((column, index) => {
                  const isIdentityKey = table.identity?.keyColumnId === column.id;
                  const isIdentityValue = table.identity?.valueColumnId === column.id;
                  const hasAttributes =
                    column.primary ||
                    column.required ||
                    column.autoIncrement ||
                    isIdentityKey ||
                    isIdentityValue;

                  return (
                    <tr key={column.id}>
                      <td className="table-preview__index">{index + 1}</td>
                      <td>
                        <div className="table-preview__field">
                          <button
                            type="button"
                            className="table-preview__field-link"
                            onClick={() => onSelectColumn(column.id)}
                            title={t('locateField', { name: fieldName(column) })}
                          >
                            {fieldName(column)}
                          </button>
                          {column.name && column.name !== column.id ? (
                            <code title={t('fieldId')}>{column.id}</code>
                          ) : null}
                        </div>
                      </td>
                      <td className="table-preview__remark">{column.remark?.trim() || '—'}</td>
                      <td>
                        <code className="table-preview__type">{column.type}</code>
                      </td>
                      <td>
                        <div className="table-preview__badges">
                          {column.primary ? (
                            <span className="field-badge field-badge--primary">{t('pk')}</span>
                          ) : null}
                          {column.required ? <span className="field-badge">{t('required')}</span> : null}
                          {column.autoIncrement ? <span className="field-badge">{t('autoIncrement')}</span> : null}
                          {isIdentityKey ? <span className="field-badge">{t('identityKeyField')}</span> : null}
                          {isIdentityValue ? <span className="field-badge">{t('identityValueField')}</span> : null}
                          {!hasAttributes ? '—' : null}
                        </div>
                      </td>
                      <td>
                        <span className={`export-badge ${column.export === false ? 'export-badge--off' : ''}`}>
                          {column.export === false ? t('notExported') : t('exportField')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="table-preview__empty">{t('noFields')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
