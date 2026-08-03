import { useEffect, useMemo, useState } from 'react';
import type { Translator } from '../i18n';
import type { ProjectFile } from '../model/types';
import {
  computeMergeReport,
  defaultResolutions,
  findConflicts,
  type MergeConflict,
  type MergeResolution,
} from './mergeProject';

type ImportReportDialogProps = {
  open: boolean;
  currentProject: ProjectFile;
  incomingProject: ProjectFile | undefined;
  incomingName: string;
  t: Translator;
  onCancel: () => void;
  onConfirm: (candidate: ProjectFile) => void;
};

const emptyResolutions: Record<string, MergeResolution> = {};
const emptyRenameSuggestions: Record<string, { newTableId: string; newTableName: string }> = {};

export default function ImportReportDialog({
  open,
  currentProject,
  incomingProject,
  incomingName,
  t,
  onCancel,
  onConfirm,
}: ImportReportDialogProps) {
  const conflicts = useMemo(
    () => (incomingProject ? findConflicts(currentProject, incomingProject) : []),
    [currentProject, incomingProject],
  );

  const resolutionPlan = useMemo(
    () =>
      incomingProject
        ? defaultResolutions(conflicts, currentProject, incomingProject)
        : { defaults: emptyResolutions, renameSuggestions: emptyRenameSuggestions },
    [conflicts, currentProject, incomingProject],
  );

  const [resolutions, setResolutions] = useState<Record<string, MergeResolution>>({});

  useEffect(() => {
    if (open && incomingProject) setResolutions(resolutionPlan.defaults);
  }, [open, incomingProject, resolutionPlan.defaults]);

  const report = useMemo(
    () =>
      incomingProject
        ? computeMergeReport(currentProject, incomingProject, resolutions, t)
        : undefined,
    [currentProject, incomingProject, resolutions, t],
  );

  const existingIssueIds = useMemo(
    () => (report ? new Set(report.existingIssues.map((issue) => issue.id)) : new Set<string>()),
    [report],
  );

  if (!open || !incomingProject || !report) return null;

  const emptyFile = incomingProject.tables.length === 0;
  const blocked = report.newErrorCount > 0 || emptyFile;
  const confirmLabel = report.newWarningCount > 0 ? t('importStillImport') : t('importConfirm');

  const resolutionFor = (conflict: MergeConflict): MergeResolution =>
    resolutions[conflict.incomingTableId] ?? resolutionPlan.defaults[conflict.incomingTableId] ?? { kind: 'skip' };

  const changeResolution = (incomingTableId: string, kind: 'overwrite' | 'skip' | 'rename') => {
    setResolutions((prev) => {
      if (kind === 'rename') {
        const suggestion = resolutionPlan.renameSuggestions[incomingTableId];
        if (!suggestion) return prev;
        return { ...prev, [incomingTableId]: { kind: 'rename', ...suggestion } };
      }
      return { ...prev, [incomingTableId]: { kind } };
    });
  };

  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity === 'warning');

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onContextMenu={(event) => event.preventDefault()}
    >
      <section
        className="data-modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('importReportTitle')}
      >
        <div className="data-modal__header">
          <div>
            <h2>{t('importReportTitle')}</h2>
            <span>{incomingName}</span>
          </div>
          <div className="data-modal__actions">
            <button
              type="button"
              className="icon-button"
              onClick={onCancel}
              aria-label={t('close')}
              title={t('close')}
            >
              ×
            </button>
          </div>
        </div>

        <div className="import-modal__body">
          {emptyFile ? (
            <p className="empty-copy import-modal__empty">{t('importEmptyFile')}</p>
          ) : (
            <>
              <div className="import-modal__summary">
                {t('importSummary', {
                  added: report.counts.added,
                  overwritten: report.counts.overwritten,
                  renamed: report.counts.renamed,
                  skipped: report.counts.skipped,
                })}
              </div>

              {conflicts.length > 0 ? (
                <section className="import-modal__section">
                  <div className="panel-heading">
                    <h3>{t('importConflictList')}</h3>
                    <span>{conflicts.length}</span>
                  </div>
                  <div className="import-conflict-list">
                    {conflicts.map((conflict) => {
                      const current = resolutionFor(conflict);
                      return (
                        <div
                          key={`${conflict.kind}:${conflict.incomingTableId}:${conflict.existingTableId}`}
                          className="import-conflict"
                        >
                          <div className="import-conflict__tables">
                            <span className="import-conflict__side">
                              <span className="import-conflict__label">{t('importIncoming')}</span>
                              <span className="import-conflict__name">{conflict.incomingTableName}</span>
                              <span className="import-conflict__meta">{conflict.incomingTableId}</span>
                            </span>
                            <span className="import-conflict__arrow">→</span>
                            <span className="import-conflict__side">
                              <span className="import-conflict__label">{t('importCurrent')}</span>
                              <span className="import-conflict__name">{conflict.existingTableName}</span>
                              <span className="import-conflict__meta">{conflict.existingTableId}</span>
                            </span>
                          </div>
                          <div className="import-conflict__actions">
                            <select
                              value={current.kind}
                              onChange={(event) =>
                                changeResolution(
                                  conflict.incomingTableId,
                                  event.target.value as 'overwrite' | 'skip' | 'rename',
                                )
                              }
                            >
                              {conflict.kind === 'id' ? (
                                <option value="overwrite">{t('importOverwrite')}</option>
                              ) : null}
                              <option value="skip">{t('importSkip')}</option>
                              <option value="rename">{t('importRename')}</option>
                            </select>
                            {current.kind === 'rename' ? (
                              <span className="import-conflict__rename">
                                {t('importRenameTo', { name: current.newTableName })}
                                {current.newTableId !== conflict.incomingTableId
                                  ? ` / ${t('importRenameId', { id: current.newTableId })}`
                                  : null}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <p className="empty-copy">{t('importNoConflicts')}</p>
              )}

              <section className="import-modal__section">
                <div className="panel-heading">
                  <h3>{t('issues')}</h3>
                  <span>{report.issues.length}</span>
                </div>
                <div className="issue-list import-modal__issues">
                  {errors.length === 0 && warnings.length === 0 ? (
                    <p className="empty-copy">{t('noIssues')}</p>
                  ) : null}
                  {errors.map((issue) => (
                    <div key={issue.id} className="issue-item issue-item--error import-issue">
                      <span>{t('issueError')}</span>
                      <p>{issue.message}</p>
                      <span
                        className={`import-issue__badge ${
                          existingIssueIds.has(issue.id) ? 'is-existing' : 'is-new'
                        }`}
                      >
                        {existingIssueIds.has(issue.id)
                          ? t('importExistingIssueBadge')
                          : t('importNewIssueBadge')}
                      </span>
                    </div>
                  ))}
                  {warnings.map((issue) => (
                    <div key={issue.id} className="issue-item issue-item--warning import-issue">
                      <span>{t('issueWarning')}</span>
                      <p>{issue.message}</p>
                      <span
                        className={`import-issue__badge ${
                          existingIssueIds.has(issue.id) ? 'is-existing' : 'is-new'
                        }`}
                      >
                        {existingIssueIds.has(issue.id)
                          ? t('importExistingIssueBadge')
                          : t('importNewIssueBadge')}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="import-modal__footer">
          {report.newErrorCount > 0 ? (
            <span className="import-modal__hint">{t('importBlockedHint')}</span>
          ) : null}
          <div className="data-modal__actions">
            <button type="button" className="button" onClick={onCancel}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={blocked}
              onClick={() => onConfirm(report.candidate)}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
