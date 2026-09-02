import { useMemo, useRef, useState } from 'react';
import { isDesktopRuntime, pickJsonFileText } from '../file/desktopProjectFile';
import WindowFrame from '../window/WindowFrame';
import type { Translator } from '../i18n';
import type { ConfigRow, ProjectFile } from '../model/types';
import {
  buildTableImportReport,
  parseTableJsonImport,
  type TableImportIssue,
  type TableImportMode,
} from './tableRowImport';

type TableImportDialogProps = {
  project: ProjectFile;
  tableId: string;
  t: Translator;
  onCancel: () => void;
  onConfirm: (rows: ConfigRow[], mode: TableImportMode) => void;
};

type ImportSource = 'file' | 'paste';

export default function TableImportDialog({
  project,
  tableId,
  t,
  onCancel,
  onConfirm,
}: TableImportDialogProps) {
  const table = project.tables.find((item) => item.id === tableId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>('paste');
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [mode, setMode] = useState<TableImportMode>('strict');

  const text = source === 'file' ? fileText : pasteText;
  const hasText = text.trim().length > 0;
  const hasAutoIncrement = (table?.columns.some((column) => column.autoIncrement) ?? false);
  const hasPrimaryKey = table?.columns.some((column) => column.primary) ?? false;

  const parseResult = useMemo(
    () => (table && hasText ? parseTableJsonImport(text, table, t, mode) : undefined),
    [hasText, mode, table, text, t],
  );

  const report = useMemo(() => {
    if (!table || !parseResult?.ok) return undefined;
    return buildTableImportReport(
      project,
      tableId,
      parseResult.rows,
      mode,
      t,
      parseResult.issues,
    );
  }, [mode, parseResult, project, t, table, tableId]);

  const parseIssues: TableImportIssue[] =
    parseResult?.ok === false ? parseResult.issues : [];
  const issues = report ? report.issues : parseIssues;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  const blocked =
    !table ||
    !hasText ||
    !parseResult?.ok ||
    !report ||
    report.blocked ||
    ((mode === 'auto-increment' || mode === 'partial') && !hasAutoIncrement) ||
    (mode === 'overwrite-id' && !hasPrimaryKey);

  const pickFile = async () => {
    if (isDesktopRuntime()) {
      const selected = await pickJsonFileText(t('importJson'));
      if (!selected) return;
      setFileName(selected.name);
      setFileText(selected.text);
      setSource('file');
      return;
    }
    fileInputRef.current?.click();
  };

  const readBrowserFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setFileText(text);
    setSource('file');
  };

  if (!table) return null;

  const confirm = () => {
    if (!report || report.blocked) return;
    onConfirm(report.rows, mode);
  };

  return (
    <WindowFrame
      className="data-modal import-modal"
      title={t('importJson')}
      subtitle={table.name}
      onClose={onCancel}
      t={t}
    >
        <div className="import-modal__body">
          <div className="import-source-tabs" role="tablist">
            <button
              type="button"
              className={`button ${source === 'file' ? 'button--primary' : ''}`}
              onClick={() => setSource('file')}
            >
              {t('chooseFile')}
            </button>
            <button
              type="button"
              className={`button ${source === 'paste' ? 'button--primary' : ''}`}
              onClick={() => setSource('paste')}
            >
              {t('pasteJson')}
            </button>
          </div>

          {source === 'file' ? (
            <div className="import-file-row">
              <button type="button" className="button" onClick={() => void pickFile()}>
                {t('chooseFile')}
              </button>
              <span className="import-file-name">{fileName || t('importNoFile')}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => void readBrowserFile(event.target.files?.[0])}
              />
            </div>
          ) : (
            <textarea
              className="import-paste-area"
              placeholder='[{"id": 1, "name": "..."}]'
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              spellCheck={false}
            />
          )}

          <section className="import-modal__section">
            <div className="panel-heading">
              <h3>{t('importMode')}</h3>
            </div>
            <div className="import-mode-list">
              <label
                className={`import-mode-option ${
                  mode === 'strict' ? 'is-selected' : ''
                }`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'strict'}
                  onChange={() => setMode('strict')}
                />
                <span className="import-mode-option__body">
                  <strong>{t('importModeStrict')}</strong>
                  <small>{t('importModeStrictDescription')}</small>
                </span>
              </label>
              <label
                className={`import-mode-option ${
                  !hasPrimaryKey ? 'is-disabled' : ''
                } ${mode === 'overwrite-id' ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'overwrite-id'}
                  disabled={!hasPrimaryKey}
                  onChange={() => setMode('overwrite-id')}
                />
                <span className="import-mode-option__body">
                  <strong>{t('importModeOverwriteId')}</strong>
                  <small>
                    {hasPrimaryKey
                      ? t('importModeOverwriteIdDescription')
                      : t('importModeOverwriteIdUnavailable')}
                  </small>
                </span>
              </label>
              <label
                className={`import-mode-option ${
                  !hasAutoIncrement ? 'is-disabled' : ''
                } ${mode === 'auto-increment' ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'auto-increment'}
                  disabled={!hasAutoIncrement}
                  onChange={() => setMode('auto-increment')}
                />
                <span className="import-mode-option__body">
                  <strong>{t('importModeAuto')}</strong>
                  <small>
                    {hasAutoIncrement
                      ? t('importModeAutoDescription')
                      : t('importModeAutoUnavailable')}
                  </small>
                </span>
              </label>
              <label
                className={`import-mode-option ${
                  !hasAutoIncrement ? 'is-disabled' : ''
                } ${mode === 'partial' ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'partial'}
                  disabled={!hasAutoIncrement}
                  onChange={() => setMode('partial')}
                />
                <span className="import-mode-option__body">
                  <strong>{t('importModePartial')}</strong>
                  <small>
                    {hasAutoIncrement
                      ? t('importModePartialDescription')
                      : t('importModeAutoUnavailable')}
                  </small>
                </span>
              </label>
            </div>
          </section>

          <section className="import-modal__section">
            <div className="panel-heading">
              <h3>{t('issues')}</h3>
              <span>{issues.length}</span>
            </div>
            {!hasText ? (
              <p className="empty-copy">{t('importPasteHint')}</p>
            ) : !parseResult?.ok ? (
              <div className="issue-list import-modal__issues">
                {parseIssues.map((issue, index) => (
                  <div
                    key={`parse:${index}`}
                    className="issue-item issue-item--error import-issue"
                  >
                    <span>{t('issueError')}</span>
                    <p>
                      {issue.rowIndex !== undefined ? (
                        <span className="import-issue__row">
                          {t('rowLabel', { index: issue.rowIndex + 1 })} /{' '}
                        </span>
                      ) : null}
                      {issue.message}
                    </p>
                  </div>
                ))}
              </div>
            ) : report && report.rows.length === 0 ? (
              <p className="empty-copy">{t('importNoRows')}</p>
            ) : report ? (
              <>
                <div className="import-modal__summary">
                  {mode === 'overwrite-id'
                    ? t('importOverwriteRowsSummary', {
                        replaced: report.overwrittenCount,
                        added: report.rows.length - report.overwrittenCount,
                        name: table.name,
                      })
                    : t('importRowsSummary', { count: report.rows.length, name: table.name })}
                </div>
                {report.issues.length === 0 ? (
                  <p className="empty-copy">{t('noIssues')}</p>
                ) : (
                  <div className="issue-list import-modal__issues">
                    {report.issues.map((issue, index) => (
                      <div
                        key={`report:${index}`}
                        className={`issue-item ${
                          issue.severity === 'error'
                            ? 'issue-item--error'
                            : 'issue-item--warning'
                        } import-issue`}
                      >
                        <span>
                          {issue.severity === 'error'
                            ? t('issueError')
                            : t('issueWarning')}
                        </span>
                        <p>
                          {issue.rowIndex !== undefined ? (
                            <span className="import-issue__row">
                              {t('rowLabel', { index: issue.rowIndex + 1 })}
                              {issue.columnName ? ` / ${issue.columnName}` : ''} /{' '}
                            </span>
                          ) : null}
                          {issue.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </section>
        </div>

        <div className="import-modal__footer">
          {errors > 0 ? (
            <span className="import-modal__hint">
              {mode === 'partial' ? t('importPartialHint') : t('importBlockedHint')}
            </span>
          ) : null}
          <div className="import-modal__actions">
            <button type="button" className="button" onClick={onCancel}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={blocked}
              onClick={confirm}
            >
              {warnings > 0 || (mode === 'partial' && errors > 0)
                ? t('importStillImport')
                : t('importConfirm')}
            </button>
          </div>
        </div>
    </WindowFrame>
  );
}
