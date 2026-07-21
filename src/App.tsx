import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import GraphCanvas from './graph/GraphCanvas';
import DataGridModal from './dataGrid/DataGridModal';
import ContextMenu, { type ContextMenuItem } from './contextMenu/ContextMenu';
import McpLogWindow from './mcp/McpLogWindow';
import SettingsPanel from './settings/SettingsPanel';
import { useEditorStore } from './store/editorStore';
import { validateProject } from './validation/validateProject';
import {
  downloadIdRegistry,
  downloadProjectFile,
  downloadTableJson,
  downloadTextFile,
  idRegistryJson,
  projectJsonFiles,
  safeFileName,
  tableJson,
} from './export/exportTables';
import { parseProjectFileText } from './file/projectFile';
import type { GraphPosition } from './model/types';
import {
  fileExists,
  getMcpEvents,
  getMcpLogs,
  getMcpStatus,
  isDesktopRuntime,
  loadRecentProjectPath,
  pickExportDirectoryPath,
  pickIdRegistrySavePath,
  pickProjectFileText,
  pickJsonSavePath,
  pickProjectSavePath,
  readProjectFileText,
  rememberRecentProjectPath,
  setMcpEnabled,
  setMcpFullAccess,
  type McpEvents,
  type McpLogEntry,
  type McpStatus,
  updateMcpContext,
  writeProjectFileText,
  writeTextFile,
} from './file/desktopProjectFile';
import { translate, type Language } from './i18n';

type MenuState =
  | {
      kind: 'table';
      tableId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'canvas';
      x: number;
      y: number;
      graphPosition: GraphPosition;
    };

type BrowserWritableFile = {
  write: (contents: string) => Promise<void>;
  close: () => Promise<void>;
};

type BrowserFileHandle = {
  createWritable: () => Promise<BrowserWritableFile>;
};

type BrowserDirectoryHandle = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
};

const MCP_LOG_VISIBLE_STORAGE_KEY = 'cfggraph:mcp-log-visible';

const initialMcpLogVisible = () => {
  try {
    return window.localStorage.getItem(MCP_LOG_VISIBLE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

const joinFilePath = (directory: string, fileName: string) => {
  const trimmedDirectory = directory.replace(/[\\/]+$/, '');
  return `${trimmedDirectory || '/'}${trimmedDirectory ? '/' : ''}${fileName}`;
};

const writeBrowserDirectoryFile = async (
  directory: BrowserDirectoryHandle,
  fileName: string,
  text: string,
) => {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
};

const browserDirectoryFileExists = async (directory: BrowserDirectoryHandle, fileName: string) => {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
};

export default function App() {
  const project = useEditorStore((state) => state.project);
  const selectedTableId = useEditorStore((state) => state.selectedTableId);
  const selectTable = useEditorStore((state) => state.selectTable);
  const addTable = useEditorStore((state) => state.addTable);
  const addColumn = useEditorStore((state) => state.addColumn);
  const deleteTable = useEditorStore((state) => state.deleteTable);
  const isDirty = useEditorStore((state) => state.isDirty);
  const dirtyScope = useEditorStore((state) => state.dirtyScope);
  const loadProject = useEditorStore((state) => state.loadProject);
  const reloadProject = useEditorStore((state) => state.reloadProject);
  const markClean = useEditorStore((state) => state.markClean);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<Language>('zh');
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDataGrid, setShowDataGrid] = useState(false);
  const [editingTableId, setEditingTableId] = useState<string>();
  const [projectPath, setProjectPath] = useState<string>();
  const [status, setStatus] = useState('');
  const [menu, setMenu] = useState<MenuState>();
  const [mcpStatus, setMcpStatus] = useState<McpStatus>();
  const [mcpLogs, setMcpLogs] = useState<McpLogEntry[]>([]);
  const [mcpLogVisible, setMcpLogVisible] = useState(initialMcpLogVisible);
  const [mcpBusy, setMcpBusy] = useState(false);
  const t = useMemo(() => translate.bind(null, language), [language]);
  const isDirtyRef = useRef(false);
  const dirtyScopeRef = useRef(dirtyScope);
  const mcpFullAccessRef = useRef(false);
  const allowCloseRef = useRef(false);
  const closePromptOpenRef = useRef(false);
  const recentProjectLoadedRef = useRef(false);
  const mcpContextRevisionRef = useRef(0);
  const lastMcpEventRevisionRef = useRef<number>();
  const mcpEventPollActiveRef = useRef(false);
  const saveProjectRef = useRef<() => Promise<boolean>>(async () => false);
  const tRef = useRef(t);
  isDirtyRef.current = isDirty;
  dirtyScopeRef.current = dirtyScope;
  mcpFullAccessRef.current = mcpStatus?.fullAccess ?? false;
  tRef.current = t;

  const selectedTable = project.tables.find((table) => table.id === selectedTableId);
  const editingTable = project.tables.find((table) => table.id === editingTableId) ?? selectedTable;
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
      markClean();
      return true;
    }

    try {
      const nextPath = projectPath ?? (await pickProjectSavePath());
      if (!nextPath) return false;

      await writeProjectFileText(nextPath, JSON.stringify(project, null, 2));
      setProjectPath(nextPath);
      markClean();
      setStatus(`Saved ${nextPath.split(/[\\/]/).pop() ?? nextPath}`);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [markClean, project, projectPath]);

  useEffect(() => {
    saveProjectRef.current = saveProject;
  }, [saveProject]);

  const confirmReplaceProject = useCallback(async () => {
    if (!isDirtyRef.current) return true;

    if (!isDesktopRuntime()) {
      if (!window.confirm(t('unsavedChangesLoadMessage'))) return false;
      return saveProject();
    }

    const saveLabel = t('saveAndContinue');
    const discardLabel = t('discardAndContinue');
    const result = await message(t('unsavedChangesLoadMessage'), {
      title: t('unsavedChangesTitle'),
      kind: 'warning',
      buttons: {
        yes: saveLabel,
        no: discardLabel,
        cancel: t('cancel'),
      },
    });

    if (result === saveLabel || result === 'Yes') {
      return saveProject();
    }

    return result === discardLabel || result === 'No';
  }, [saveProject, t]);

  const openDesktopProjectFile = useCallback(async () => {
    try {
      if (!(await confirmReplaceProject())) return;

      const selected = await pickProjectFileText();
      if (!selected) return;
      if (loadProjectText(selected.text, selected.name, selected.path)) {
        await rememberRecentProjectPath(selected.path);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [confirmReplaceProject, loadProjectText]);

  const triggerLoadProject = useCallback(() => {
    if (isDesktopRuntime()) {
      void openDesktopProjectFile();
      return;
    }

    void (async () => {
      if (await confirmReplaceProject()) {
        fileInputRef.current?.click();
      }
    })();
  }, [confirmReplaceProject, openDesktopProjectFile]);

  const copyTableJsonToClipboard = useCallback(async (tableId = selectedTable?.id) => {
    if (!tableId) return;

    const table = project.tables.find((item) => item.id === tableId);
    if (!table) return;

    try {
      await navigator.clipboard.writeText(tableJson(project, table.id));
      setStatus(t('copiedTableJson', { name: table.name }));
    } catch {
      setStatus(t('clipboardDenied'));
    }
  }, [project, selectedTable?.id, t]);

  const copyIdRegistryToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(idRegistryJson(project));
      setStatus(t('copiedIdRegistry'));
    } catch {
      setStatus(t('clipboardDenied'));
    }
  }, [project, t]);

  const downloadTableJsonFile = useCallback(async (tableId = selectedTable?.id) => {
    if (!tableId) return;

    const table = project.tables.find((item) => item.id === tableId);
    if (!table) return;

    if (!isDesktopRuntime()) {
      downloadTableJson(project, table.id);
      return;
    }

    try {
      const path = await pickJsonSavePath(`${safeFileName(table.name)}.json`);
      if (!path) return;

      await writeTextFile(path, tableJson(project, table.id));
      setStatus(`Saved ${path.split(/[\\/]/).pop() ?? path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [project, selectedTable?.id]);

  const downloadIdRegistryFile = useCallback(async () => {
    if (!isDesktopRuntime()) {
      downloadIdRegistry(project);
      return;
    }

    try {
      const path = await pickIdRegistrySavePath();
      if (!path) return;

      await writeTextFile(path, idRegistryJson(project));
      setStatus(`Saved ${path.split(/[\\/]/).pop() ?? path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [project]);

  const confirmOverwriteExport = useCallback(
    async (count: number) => {
      if (count <= 0) return true;

      if (!isDesktopRuntime()) {
        return window.confirm(t('confirmOverwriteExport', { count }));
      }

      const overwriteLabel = t('overwriteAndExport');
      const result = await message(t('confirmOverwriteExport', { count }), {
        title: t('overwriteExportTitle'),
        kind: 'warning',
        buttons: {
          ok: overwriteLabel,
          cancel: t('cancel'),
        },
      });

      return result === overwriteLabel || result === 'Ok';
    },
    [t],
  );

  const exportAllJsonFiles = useCallback(async () => {
    const files = projectJsonFiles(project);

    if (isDesktopRuntime()) {
      try {
        const directory = await pickExportDirectoryPath();
        if (!directory) return;

        const filesWithPaths = files.map((file) => ({
          ...file,
          path: joinFilePath(directory, file.fileName),
        }));
        const existingFiles = await Promise.all(
          filesWithPaths.map(async (file) => ((await fileExists(file.path)) ? file.fileName : '')),
        );
        const overwriteCount = existingFiles.filter(Boolean).length;
        if (!(await confirmOverwriteExport(overwriteCount))) return;

        await Promise.all(filesWithPaths.map((file) => writeTextFile(file.path, file.text)));
        setStatus(t('exportedJsonFiles', { count: files.length }));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (directoryPicker) {
      try {
        const directory = await directoryPicker.call(window);
        const existingFiles: string[] = [];
        for (const file of files) {
          if (await browserDirectoryFileExists(directory, file.fileName)) {
            existingFiles.push(file.fileName);
          }
        }
        if (!(await confirmOverwriteExport(existingFiles.length))) return;

        for (const file of files) {
          await writeBrowserDirectoryFile(directory, file.fileName, file.text);
        }
        setStatus(t('exportedJsonFiles', { count: files.length }));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatus(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    for (const file of files) {
      downloadTextFile(file.fileName, file.text);
    }
    setStatus(t('exportedJsonFiles', { count: files.length }));
  }, [confirmOverwriteExport, project, t]);

  const addFieldToSelectedTable = useCallback(() => {
    if (selectedTable) addColumn(selectedTable.id);
  }, [addColumn, selectedTable]);

  const openRowsModal = useCallback(
    (tableId = selectedTable?.id) => {
      if (!tableId) return;
      setEditingTableId(tableId);
      selectTable(tableId);
      setShowDataGrid(true);
    },
    [selectTable, selectedTable?.id],
  );

  const deleteTableById = useCallback((tableId = selectedTable?.id) => {
    if (!tableId) return;

    const table = project.tables.find((item) => item.id === tableId);
    if (!table) return;

    if (window.confirm(t('confirmDeleteTable', { name: table.name }))) {
      deleteTable(table.id);
    }
  }, [deleteTable, project.tables, selectedTable?.id, t]);

  const openTableContextMenu = useCallback((tableId: string, position: { x: number; y: number }) => {
    selectTable(tableId);
    setMenu({ kind: 'table', tableId, x: position.x, y: position.y });
  }, [selectTable]);

  const openCanvasContextMenu = useCallback(
    (position: { x: number; y: number }, graphPosition: GraphPosition) => {
      setMenu({ kind: 'canvas', x: position.x, y: position.y, graphPosition });
    },
    [],
  );

  const loadFile = async (file: File) => {
    loadProjectText(await file.text(), file.name);
  };

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];

    if (menu.kind === 'table') {
      const table = project.tables.find((item) => item.id === menu.tableId);
      if (!table) return [];

      return [
        { id: 'table-label', type: 'label', label: table.name || table.id },
        {
          id: 'edit-rows',
          label: t('edit'),
          shortcut: 'R',
          onSelect: () => openRowsModal(table.id),
        },
        { id: 'table-separator-export', type: 'separator' },
        {
          id: 'copy-json',
          label: t('copyTableJson'),
          shortcut: 'C',
          onSelect: () => copyTableJsonToClipboard(table.id),
        },
        {
          id: 'download-json',
          label: t('downloadJson'),
          shortcut: 'E',
          onSelect: () => downloadTableJsonFile(table.id),
        },
        { id: 'table-separator-danger', type: 'separator' },
        {
          id: 'delete-table',
          label: t('deleteTable'),
          shortcut: 'Del',
          danger: true,
          onSelect: () => deleteTableById(table.id),
        },
      ];
    }

    return [
      { id: 'canvas-label', type: 'label', label: t('canvas') },
      {
        id: 'new-table-here',
        label: t('newTableHere'),
        shortcut: 'N',
        onSelect: () => {
          addTable(menu.graphPosition);
        },
      },
      { id: 'canvas-separator-project', type: 'separator' },
      {
        id: 'save-project',
        label: t('save'),
        shortcut: 'Ctrl+S',
        onSelect: () => {
          void saveProject();
        },
      },
      {
        id: 'load-project',
        label: t('load'),
        shortcut: 'Ctrl+O',
        onSelect: triggerLoadProject,
      },
      { id: 'canvas-separator-id-registry', type: 'separator' },
      {
        id: 'copy-id-registry',
        label: t('copyIdRegistry'),
        onSelect: () => {
          void copyIdRegistryToClipboard();
        },
      },
      {
        id: 'download-id-registry',
        label: t('downloadIdRegistry'),
        onSelect: () => {
          void downloadIdRegistryFile();
        },
      },
      { id: 'canvas-separator-view', type: 'separator' },
      {
        id: 'toggle-minimap',
        label: showMiniMap ? t('hideMiniMap') : t('miniMap'),
        shortcut: 'M',
        onSelect: () => setShowMiniMap((value) => !value),
      },
    ];
  }, [
    addTable,
    copyIdRegistryToClipboard,
    copyTableJsonToClipboard,
    deleteTableById,
    downloadIdRegistryFile,
    downloadTableJsonFile,
    menu,
    openRowsModal,
    project.tables,
    saveProject,
    showMiniMap,
    t,
    triggerLoadProject,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current || allowCloseRef.current) return;

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (!isDirty) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const appWindow = getCurrentWindow();

    void appWindow
      .onCloseRequested((event) => {
        if (allowCloseRef.current) return;
        if (!isDirtyRef.current) return;

        event.preventDefault();
        if (closePromptOpenRef.current) return;

        closePromptOpenRef.current = true;

        void (async () => {
          const translateNow = tRef.current;
          const saveLabel = translateNow('saveAndQuit');
          const discardLabel = translateNow('discardAndQuit');

          try {
            const result = await message(translateNow('unsavedChangesCloseMessage'), {
              title: translateNow('unsavedChangesTitle'),
              kind: 'warning',
              buttons: {
                yes: saveLabel,
                no: discardLabel,
                cancel: translateNow('cancel'),
              },
            });

            if (result === saveLabel || result === 'Yes') {
              const saved = await saveProjectRef.current();
              if (!saved) return;
            } else if (result !== discardLabel && result !== 'No') {
              return;
            }

            allowCloseRef.current = true;
            await appWindow.destroy();
          } catch (error) {
            allowCloseRef.current = false;
            setStatus(error instanceof Error ? error.message : String(error));
          } finally {
            closePromptOpenRef.current = false;
          }
        })();
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDirty]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (recentProjectLoadedRef.current) return;
    recentProjectLoadedRef.current = true;

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
    if (!isDesktopRuntime()) return;
    if (!mcpStatus) return;
    const revision = mcpContextRevisionRef.current + 1;
    mcpContextRevisionRef.current = revision;
    void updateMcpContext(
      projectPath,
      isDirty,
      dirtyScope,
      mcpStatus?.fullAccess ?? false,
      revision,
    ).catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }, [dirtyScope, isDirty, mcpStatus?.fullAccess, projectPath]);

  const reloadProjectFromMcp = useCallback(
    async (event: McpEvents) => {
      if (!event.projectPath || event.projectPath !== projectPath) return;
      if (dirtyScopeRef.current === 'content' && !mcpFullAccessRef.current) {
        setStatus(t('mcpExternalConflict'));
        return;
      }

      try {
        const file = await readProjectFileText(event.projectPath);
        const parsed = parseProjectFileText(file.text, t);
        if (!parsed.ok) {
          setStatus(parsed.error);
          return;
        }
        const preserveLayout = dirtyScopeRef.current === 'layout';
        const replacedUnsavedContent =
          dirtyScopeRef.current === 'content' && mcpFullAccessRef.current;
        reloadProject(parsed.project, preserveLayout);
        if (editingTableId && !parsed.project.tables.some((table) => table.id === editingTableId)) {
          setEditingTableId(undefined);
          setShowDataGrid(false);
        }
        setStatus(
          preserveLayout
            ? t('mcpLayoutPreserved')
            : replacedUnsavedContent
              ? t('mcpProjectReloadedFullAccess')
              : t('mcpProjectReloaded'),
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [editingTableId, projectPath, reloadProject, t],
  );

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;

    const poll = async () => {
      if (mcpEventPollActiveRef.current) return;
      mcpEventPollActiveRef.current = true;
      try {
        const [nextStatus, event, logs] = await Promise.all([
          getMcpStatus(),
          getMcpEvents(),
          getMcpLogs(),
        ]);
        if (disposed) return;
        setMcpStatus(nextStatus);
        setMcpLogs(logs);

        const previousRevision = lastMcpEventRevisionRef.current;
        lastMcpEventRevisionRef.current = event.changeRevision;
        if (previousRevision !== undefined && event.changeRevision > previousRevision) {
          await reloadProjectFromMcp(event);
        }
      } catch (error) {
        if (!disposed) setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        mcpEventPollActiveRef.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [reloadProjectFromMcp]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MCP_LOG_VISIBLE_STORAGE_KEY, String(mcpLogVisible));
    } catch {
      // UI preferences may be unavailable in restricted browser contexts.
    }
  }, [mcpLogVisible]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (showSettings) return;

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && !event.altKey && !event.shiftKey) {
        if (key === 's') {
          event.preventDefault();
          void saveProject();
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

      const actions: Record<string, () => void | Promise<unknown>> = {
        c: copyTableJsonToClipboard,
        e: downloadTableJsonFile,
        f: addFieldToSelectedTable,
        m: () => setShowMiniMap((value) => !value),
        n: () => {
          addTable();
        },
        o: triggerLoadProject,
        r: () => openRowsModal(),
        s: saveProject,
        delete: deleteTableById,
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
    addTable,
    copyTableJsonToClipboard,
    deleteTableById,
    downloadTableJsonFile,
    openRowsModal,
    saveProject,
    showSettings,
    triggerLoadProject,
  ]);

  const preventNativeContextMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }

    event.preventDefault();
  }, []);

  const closeSettings = useCallback(() => setShowSettings(false), []);

  const changeMcpEnabled = useCallback((enabled: boolean) => {
    setMcpBusy(true);
    void setMcpEnabled(enabled)
      .then((nextStatus) => {
        setMcpStatus(nextStatus);
        if (nextStatus.error) setStatus(nextStatus.error);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setMcpBusy(false));
  }, []);

  const changeMcpFullAccess = useCallback(
    (fullAccess: boolean) => {
      setMcpBusy(true);
      void setMcpFullAccess(fullAccess)
        .then((nextStatus) => {
          setMcpStatus(nextStatus);
          if (fullAccess) setStatus(t('mcpFullAccessEnabled'));
        })
        .catch((error) => {
          setStatus(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setMcpBusy(false));
    },
    [t],
  );

  const copyMcpAddress = useCallback(() => {
    if (!mcpStatus?.connectionUrl) return;
    void navigator.clipboard.writeText(mcpStatus.connectionUrl).then(
      () => setStatus(t('mcpAddressCopied')),
      () => setStatus(t('clipboardDenied')),
    );
  }, [mcpStatus?.connectionUrl, t]);

  return (
    <div className="app-shell" onContextMenu={preventNativeContextMenu}>
      <header className="toolbar">
        <div className="brand-block">
          <strong>Game Config Graph Editor</strong>
          <span>{t('errorCount', { count: errorCount })}</span>
          {warningCount > 0 ? <span>{t('warningCount', { count: warningCount })}</span> : null}
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              void saveProject();
            }}
            title="S / Ctrl+S"
          >
            {t('save')}
          </button>
          <button type="button" className="button" onClick={triggerLoadProject} title="O / Ctrl+O">
            {t('load')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              void exportAllJsonFiles();
            }}
          >
            {t('exportAll')}
          </button>
          <button
            type="button"
            className="button settings-button"
            onClick={() => setShowSettings(true)}
          >
            <span aria-hidden="true">⚙</span>
            {t('settings')}
          </button>
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
                title={table.remark?.trim() || undefined}
                onClick={() => selectTable(table.id)}
                onDoubleClick={() => openRowsModal(table.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openTableContextMenu(table.id, { x: event.clientX, y: event.clientY });
                }}
              >
                <span>
                  {table.name}
                  {table.remark?.trim() ? ` — ${table.remark.trim()}` : ''}
                </span>
                <small>
                  {t('fieldsRows', { fields: table.columns.length, rows: table.rows.length })}
                </small>
              </button>
            ))}
          </div>
          {status ? <div className="status-line">{status}</div> : null}
        </aside>

        <section className="canvas-panel" aria-label="Graph canvas">
          <GraphCanvas
            showMiniMap={showMiniMap}
            onOpenTableData={openRowsModal}
            onOpenTableContext={openTableContextMenu}
            onOpenCanvasContext={openCanvasContextMenu}
          />
        </section>
      </main>

      <DataGridModal
        open={showDataGrid}
        table={editingTable}
        project={project}
        issues={issues}
        t={t}
        onOpenTable={openRowsModal}
        onClose={() => setShowDataGrid(false)}
      />

      <SettingsPanel
        open={showSettings}
        language={language}
        showMiniMap={showMiniMap}
        desktopAvailable={isDesktopRuntime()}
        mcpBusy={mcpBusy}
        mcpStatus={mcpStatus}
        showMcpLog={mcpLogVisible}
        onClose={closeSettings}
        onLanguageChange={setLanguage}
        onMiniMapChange={setShowMiniMap}
        onMcpEnabledChange={changeMcpEnabled}
        onMcpFullAccessChange={changeMcpFullAccess}
        onMcpLogVisibilityChange={setMcpLogVisible}
        onCopyMcpAddress={copyMcpAddress}
        t={t}
      />

      {mcpStatus?.enabled && mcpLogVisible ? (
        <McpLogWindow
          entries={mcpLogs}
          running={mcpStatus.running}
          onHide={() => setMcpLogVisible(false)}
          t={t}
        />
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={contextMenuItems}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
