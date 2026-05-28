import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphCanvas from './graph/GraphCanvas';
import TableInspector from './inspector/TableInspector';
import DataEditor from './dataGrid/DataEditor';
import { useEditorStore } from './store/editorStore';
import { validateProject } from './validation/validateProject';
import { downloadProjectFile, downloadTableJson, safeFileName, tableJson } from './export/exportTables';
import { parseProjectFileText } from './file/projectFile';
import {
  isDesktopRuntime,
  loadRecentProjectPath,
  pickProjectFileText,
  pickJsonSavePath,
  pickProjectSavePath,
  readProjectFileText,
  rememberRecentProjectPath,
  writeProjectFileText,
  writeTextFile,
} from './file/desktopProjectFile';
import { languageLabels, translate, type Language } from './i18n';

export default function App() {
  const project = useEditorStore((state) => state.project);
  const selectedTableId = useEditorStore((state) => state.selectedTableId);
  const selectTable = useEditorStore((state) => state.selectTable);
  const addTable = useEditorStore((state) => state.addTable);
  const addColumn = useEditorStore((state) => state.addColumn);
  const addRow = useEditorStore((state) => state.addRow);
  const deleteTable = useEditorStore((state) => state.deleteTable);
  const loadProject = useEditorStore((state) => state.loadProject);
  const resetProject = useEditorStore((state) => state.resetProject);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<Language>('zh');
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [projectPath, setProjectPath] = useState<string>();
  const [status, setStatus] = useState('');
  const t = useMemo(() => translate.bind(null, language), [language]);

  const selectedTable = project.tables.find((table) => table.id === selectedTableId);
  const issues = useMemo(() => validateProject(project, t), [project, t]);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  const loadProjectText = useCallback(
    (text: string, name: string, path?: string) => {
      const result = parseProjectFileText(text, t);
      if (!result.ok) {
        setStatus(result.error);
        return false;
      }

      loadProject(result.project);
      setProjectPath(path);
      setStatus(t('loadedFile', { name }));
      return true;
    },
    [loadProject, t],
  );

  const saveProject = useCallback(async () => {
    if (!isDesktopRuntime()) {
      downloadProjectFile(project);
      return;
    }

    try {
      const nextPath = projectPath ?? (await pickProjectSavePath());
      if (!nextPath) return;

      await writeProjectFileText(nextPath, JSON.stringify(project, null, 2));
      setProjectPath(nextPath);
      setStatus(`Saved ${nextPath.split(/[\\/]/).pop() ?? nextPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [project, projectPath]);

  const openDesktopProjectFile = useCallback(async () => {
    try {
      const selected = await pickProjectFileText();
      if (!selected) return;
      if (loadProjectText(selected.text, selected.name, selected.path)) {
        await rememberRecentProjectPath(selected.path);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [loadProjectText]);

  const triggerLoadProject = useCallback(() => {
    if (isDesktopRuntime()) {
      void openDesktopProjectFile();
      return;
    }

    fileInputRef.current?.click();
  }, [openDesktopProjectFile]);

  const copyCurrentTableJson = useCallback(async () => {
    if (!selectedTable) return;

    try {
      await navigator.clipboard.writeText(tableJson(project, selectedTable.id));
      setStatus(t('copiedTableJson', { name: selectedTable.name }));
    } catch {
      setStatus(t('clipboardDenied'));
    }
  }, [project, selectedTable, t]);

  const downloadCurrentTableJson = useCallback(async () => {
    if (!selectedTable) return;

    if (!isDesktopRuntime()) {
      downloadTableJson(project, selectedTable.id);
      return;
    }

    try {
      const path = await pickJsonSavePath(`${safeFileName(selectedTable.name)}.json`);
      if (!path) return;

      await writeTextFile(path, tableJson(project, selectedTable.id));
      setStatus(`Saved ${path.split(/[\\/]/).pop() ?? path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [project, selectedTable]);

  const addFieldToSelectedTable = useCallback(() => {
    if (selectedTable) addColumn(selectedTable.id);
  }, [addColumn, selectedTable]);

  const addRowToSelectedTable = useCallback(() => {
    if (selectedTable) addRow(selectedTable.id);
  }, [addRow, selectedTable]);

  const deleteSelectedTable = useCallback(() => {
    if (!selectedTable) return;
    if (window.confirm(t('confirmDeleteTable', { name: selectedTable.name }))) {
      deleteTable(selectedTable.id);
    }
  }, [deleteTable, selectedTable, t]);

  const resetSampleProject = useCallback(() => {
    resetProject();
    setProjectPath(undefined);
  }, [resetProject]);

  const loadFile = async (file: File) => {
    loadProjectText(await file.text(), file.name);
  };

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const loadRecentProject = async () => {
      try {
        const recentPath = await loadRecentProjectPath();
        if (!recentPath) return;

        const recentFile = await readProjectFileText(recentPath);
        loadProjectText(recentFile.text, recentFile.name, recentFile.path);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    };

    void loadRecentProject();
  }, [loadProjectText]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && !event.altKey && !event.shiftKey) {
        if (key === 's') {
          event.preventDefault();
          saveProject();
        } else if (key === 'o') {
          event.preventDefault();
          triggerLoadProject();
        } else if (key === 'n') {
          event.preventDefault();
          addTable();
        }
        return;
      }

      if (commandKey || event.altKey || event.shiftKey || isEditableTarget(event.target)) {
        return;
      }

      const actions: Record<string, () => void | Promise<void>> = {
        c: copyCurrentTableJson,
        e: downloadCurrentTableJson,
        f: addFieldToSelectedTable,
        m: () => setShowMiniMap((value) => !value),
        n: addTable,
        o: triggerLoadProject,
        r: addRowToSelectedTable,
        s: saveProject,
        delete: deleteSelectedTable,
      };

      const action = actions[key];
      if (action) {
        event.preventDefault();
        void action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    addFieldToSelectedTable,
    addRowToSelectedTable,
    addTable,
    copyCurrentTableJson,
    deleteSelectedTable,
    downloadCurrentTableJson,
    resetSampleProject,
    saveProject,
    triggerLoadProject,
  ]);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand-block">
          <strong>Game Config Graph Editor</strong>
          <span>{t('errorCount', { count: errorCount })}</span>
          {warningCount > 0 ? <span>{t('warningCount', { count: warningCount })}</span> : null}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="button button--primary" onClick={addTable} title="N / Ctrl+N">
            {t('newTable')}
          </button>
          <button type="button" className="button" onClick={saveProject} title="S / Ctrl+S">
            {t('save')}
          </button>
          <button type="button" className="button" onClick={triggerLoadProject} title="O / Ctrl+O">
            {t('load')}
          </button>
          <button type="button" className="button" onClick={resetSampleProject}>
            {t('resetSample')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!selectedTable}
            onClick={copyCurrentTableJson}
            title="C"
          >
            {t('copyTableJson')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!selectedTable}
            onClick={downloadCurrentTableJson}
            title="E"
          >
            {t('downloadJson')}
          </button>
          <label className="toolbar-toggle" title="M">
            <input
              type="checkbox"
              checked={showMiniMap}
              onChange={(event) => setShowMiniMap(event.target.checked)}
            />
            {t('miniMap')}
          </label>
          <label className="language-select">
            <span>{t('language')}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              {Object.entries(languageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".cfggraph.json,application/json"
          className="hidden-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = '';
          }}
        />
      </header>

      <main className="main-region">
        <aside className="table-list-panel">
          <div className="panel-heading">
            <h2>{t('tables')}</h2>
            <span>{project.tables.length}</span>
          </div>
          <div className="table-list">
            {project.tables.map((table) => (
              <button
                key={table.id}
                type="button"
                className={`table-list-item ${table.id === selectedTableId ? 'is-active' : ''}`}
                onClick={() => selectTable(table.id)}
              >
                <span>{table.name}</span>
                <small>
                  {t('fieldsRows', { fields: table.columns.length, rows: table.rows.length })}
                </small>
              </button>
            ))}
          </div>
          {status ? <div className="status-line">{status}</div> : null}
        </aside>

        <section className="canvas-panel" aria-label="Graph canvas">
          <GraphCanvas showMiniMap={showMiniMap} />
        </section>

        <aside className="right-panel">
          <TableInspector table={selectedTable} project={project} t={t} />
          <section className="issues-panel">
            <div className="panel-heading">
              <h2>{t('issues')}</h2>
              <span>{issues.length}</span>
            </div>
            <div className="issue-list">
              {issues.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  className={`issue-item issue-item--${issue.severity}`}
                  onClick={() => selectTable(issue.tableId)}
                >
                  <span>{issue.severity === 'error' ? t('issueError') : t('issueWarning')}</span>
                  <p>{issue.message}</p>
                </button>
              ))}
              {issues.length === 0 ? <p className="empty-copy">{t('noIssues')}</p> : null}
            </div>
          </section>
        </aside>
      </main>

      <DataEditor table={selectedTable} project={project} issues={issues} t={t} />
    </div>
  );
}
