import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm as confirmDialog, message } from '@tauri-apps/plugin-dialog';
import AppMenu from './appMenu/AppMenu';
import GraphCanvas from './graph/GraphCanvas';
import DataGridModal, { type DataGridFocusRequest } from './dataGrid/DataGridModal';
import ContextMenu, { type ContextMenuItem } from './contextMenu/ContextMenu';
import ImportReportDialog from './import/ImportReportDialog';
import TableImportDialog from './import/TableImportDialog';
import McpLogWindow from './mcp/McpLogWindow';
import SettingsPanel from './settings/SettingsPanel';
import ShortcutCheatSheet from './help/ShortcutCheatSheet';
import StartupScreen from './startup/StartupScreen';
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
import {
  DesktopExportFileError,
  exportDesktopFiles,
} from './export/desktopExport';
import { publishProjectFiles, type PublishResult } from './export/publishProject';
import { parseProjectFileText } from './file/projectFile';
import type { GraphPosition, ProjectFile } from './model/types';
import {
  clearMcpLogs,
  claimProjectWindow,
  fileExists,
  getAssignedProjectPath,
  getMcpEvents,
  getMcpLogs,
  getMcpStatus,
  isDesktopRuntime,
  loadRecentProjectPath,
  openProjectWindow,
  pickExportDirectoryPath,
  pickIdRegistrySavePath,
  pickProjectFileText,
  pickJsonSavePath,
  pickProjectSavePath,
  readTextFile,
  readProjectFileText,
  releaseProjectWindow,
  rememberRecentProjectPath,
  resetMcpPort,
  restartMcp,
  setMcpEnabled,
  setMcpFullAccess,
  setMcpPort,
  type McpEvents,
  type McpLogEntry,
  type McpStatus,
  updateMcpContext,
  writeProjectFileText,
  writeTextFile,
} from './file/desktopProjectFile';
import { translate, type Language, type Translator } from './i18n';
import {
  loadPublishSettings,
  savePublishSettings,
  type PublishSettings,
} from './settings/publishSettings';
import { useWindowManager } from './window/WindowManager';
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

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
    }
  | {
      kind: 'mcp-log';
      x: number;
      y: number;
    };

type OpenGridWindow = {
  tableId: string;
  focus?: DataGridFocusRequest;
};

type ImportPending = {
  project: ProjectFile;
  name: string;
  path?: string;
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

const MCP_LOG_VISIBLE_STORAGE_KEY = 'configra:mcp-log-visible';
const TABLE_LIST_WIDTH_STORAGE_KEY = 'configra:table-list-width';
const DEFAULT_TABLE_LIST_WIDTH = 205;
const MIN_TABLE_LIST_WIDTH = 160;
const MAX_TABLE_LIST_WIDTH = 420;

const clampTableListWidth = (width: number) =>
  Math.min(MAX_TABLE_LIST_WIDTH, Math.max(MIN_TABLE_LIST_WIDTH, width));

const initialTableListWidth = () => {
  try {
    const savedWidth = Number(window.localStorage.getItem(TABLE_LIST_WIDTH_STORAGE_KEY));
    return Number.isFinite(savedWidth) && savedWidth > 0
      ? clampTableListWidth(savedWidth)
      : DEFAULT_TABLE_LIST_WIDTH;
  } catch {
    return DEFAULT_TABLE_LIST_WIDTH;
  }
};

const initialMcpLogVisible = () => {
  try {
    return window.localStorage.getItem(MCP_LOG_VISIBLE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
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

const publishResultStatus = (t: Translator, result: PublishResult, directory: string) => {
  switch (result.status) {
    case 'published':
      return t('publishedFiles', { count: result.count, directory });
    case 'write-failed':
      return t('exportFileFailed', { name: result.fileName, error: result.error });
    case 'verify-failed':
      return t('exportVerificationFailed', { name: result.fileName });
    default:
      return t('publishFailed', { error: result.error });
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
  const dirtyTableIds = useEditorStore((state) => state.dirtyTableIds);
  const loadProject = useEditorStore((state) => state.loadProject);
  const reloadProject = useEditorStore((state) => state.reloadProject);
  const appendRows = useEditorStore((state) => state.appendRows);
  const markClean = useEditorStore((state) => state.markClean);
  const newProject = useEditorStore((state) => state.newProject);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 隐藏文件输入框复用于导入与打开项目；click 前设置本次用途。
  const fileInputModeRef = useRef<'import' | 'open'>('import');
  const [language, setLanguage] = useState<Language>('zh');
  const [themePreference, setThemePreference] = useState<ThemePreference>(getThemePreference);
  const { restore: restoreWindow, windows: managedWindows } = useWindowManager();
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getThemePreference()));
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [publishSettings, setPublishSettings] = useState<PublishSettings>(loadPublishSettings);
  const [publishToastVisible, setPublishToastVisible] = useState(false);
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [importPending, setImportPending] = useState<ImportPending>();
  const [tableImportTableId, setTableImportTableId] = useState<string>();
  const [openGridWindows, setOpenGridWindows] = useState<OpenGridWindow[]>([]);
  const openGridWindowsRef = useRef<OpenGridWindow[]>([]);
  openGridWindowsRef.current = openGridWindows;
  const dataGridFocusSequenceRef = useRef(0);
  const [projectPath, setProjectPath] = useState<string>();
  const [status, setStatus] = useState('');
  const [menu, setMenu] = useState<MenuState>();
  const [mcpStatus, setMcpStatus] = useState<McpStatus>();
  const [mcpLogs, setMcpLogs] = useState<McpLogEntry[]>([]);
  const [mcpLogVisible, setMcpLogVisible] = useState(initialMcpLogVisible);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isStarting, setIsStarting] = useState(isDesktopRuntime);
  const [tableListWidth, setTableListWidth] = useState(initialTableListWidth);
  const [isResizingTableList, setIsResizingTableList] = useState(false);
  const [tableFocusRequest, setTableFocusRequest] = useState<{
    tableId: string;
    sequence: number;
  }>();
  const windowLabelRef = useRef(isDesktopRuntime() ? getCurrentWindow().label : 'browser');
  const tableFocusSequenceRef = useRef(0);
  const tableListResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  }>();
  const projectSessionId = windowLabelRef.current;
  const t = useMemo(() => translate.bind(null, language), [language]);
  const isDirtyRef = useRef(false);
  const dirtyScopeRef = useRef(dirtyScope);
  const publishSettingsRef = useRef(publishSettings);
  const publishToastTimerRef = useRef<number>();
  const mcpFullAccessRef = useRef(false);
  const allowCloseRef = useRef(false);
  const closePromptOpenRef = useRef(false);
  const recentProjectLoadedRef = useRef(false);
  const mcpContextRevisionRef = useRef(0);
  const lastMcpEventRevisionRef = useRef<number>();
  const mcpEventPollActiveRef = useRef(false);
  const mcpLogsRevisionRef = useRef(0);
  const saveProjectRef = useRef<() => Promise<boolean>>(async () => false);
  const exportingRef = useRef(false);
  const tRef = useRef(t);
  isDirtyRef.current = isDirty;
  dirtyScopeRef.current = dirtyScope;
  mcpFullAccessRef.current = mcpStatus?.fullAccess ?? false;
  tRef.current = t;

  useEffect(() => {
    try {
      window.localStorage.setItem(TABLE_LIST_WIDTH_STORAGE_KEY, String(tableListWidth));
    } catch {
      // Keep resizing available even if localStorage is unavailable.
    }
  }, [tableListWidth]);

  useEffect(() => () => window.clearTimeout(publishToastTimerRef.current), []);

  const handleTableListResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      tableListResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: tableListWidth,
      };
      setIsResizingTableList(true);
    },
    [tableListWidth],
  );

  const handleTableListResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = tableListResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setTableListWidth(clampTableListWidth(resize.startWidth + event.clientX - resize.startX));
  }, []);

  const handleTableListResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = tableListResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    tableListResizeRef.current = undefined;
    setIsResizingTableList(false);
  }, []);

  const handleTableListResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (direction === 0) return;
      event.preventDefault();
      setTableListWidth((width) => clampTableListWidth(width + direction * 10));
    },
    [],
  );

  useEffect(() => {
    const syncTheme = () => setResolvedTheme(applyTheme(themePreference));
    syncTheme();
    saveThemePreference(themePreference);

    if (themePreference !== 'system') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', syncTheme);
    return () => mediaQuery.removeEventListener('change', syncTheme);
  }, [themePreference]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const name = projectPath?.split(/[\\/]/).pop();
    void getCurrentWindow().setTitle(name ? `${name} — Configra` : 'Configra');
  }, [projectPath]);

  const selectedTable = project.tables.find((table) => table.id === selectedTableId);
  const issues = useMemo(() => validateProject(project, t), [project, t]);
  const dirtyTableNames = useMemo(
    () =>
      dirtyTableIds
        .map((tableId) => project.tables.find((table) => table.id === tableId)?.name)
        .filter((name): name is string => Boolean(name)),
    [dirtyTableIds, project.tables],
  );
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
      setOpenGridWindows([]);
      setStatus(t('importedFile', { name }));
      return true;
    },
    [loadProject, t],
  );

  const showPublishToast = useCallback(() => {
    setPublishToastVisible(true);
    window.clearTimeout(publishToastTimerRef.current);
    publishToastTimerRef.current = window.setTimeout(() => setPublishToastVisible(false), 2600);
  }, []);

  // 保存成功后按设置静默发布到固定目录；返回要展示的状态文案，未启用时返回 undefined。
  const publishAfterSave = useCallback(
    async (savedProject: ProjectFile) => {
      const { enabled, directory } = publishSettingsRef.current;
      if (!enabled || !directory) return undefined;

      const result = await publishProjectFiles(directory, savedProject, {
        fileExists,
        writeTextFile,
        readTextFile,
      });
      if (result.status === 'published') showPublishToast();
      return publishResultStatus(t, result, directory);
    },
    [showPublishToast, t],
  );

  const saveProject = useCallback(async () => {
    if (!isDesktopRuntime()) {
      downloadProjectFile(project);
      markClean();
      return true;
    }

    let claimedFirstSavePath = false;
    try {
      const nextPath = projectPath ?? (await pickProjectSavePath());
      if (!nextPath) return false;

      if (!(await claimProjectWindow(windowLabelRef.current, nextPath))) {
        setStatus(t('projectAlreadyOpen'));
        return false;
      }
      claimedFirstSavePath = projectPath === undefined;

      await writeProjectFileText(nextPath, JSON.stringify(project, null, 2));
      setProjectPath(nextPath);
      markClean();
      const savedLabel = `Saved ${nextPath.split(/[\\/]/).pop() ?? nextPath}`;
      const publishLabel = await publishAfterSave(project);
      setStatus(publishLabel ? `${savedLabel} · ${publishLabel}` : savedLabel);
      return true;
    } catch (error) {
      if (claimedFirstSavePath) {
        await releaseProjectWindow(windowLabelRef.current, projectSessionId).catch(() => undefined);
      }
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [markClean, project, projectPath, projectSessionId, publishAfterSave, t]);

  useEffect(() => {
    saveProjectRef.current = saveProject;
  }, [saveProject]);

  const confirmReplaceProject = useCallback(
    async (prompt: string, labels?: { save: string; discard: string }) => {
      if (!isDirtyRef.current) return true;

      if (!isDesktopRuntime()) {
        if (!window.confirm(prompt)) return false;
        return saveProject();
      }

      const saveLabel = labels?.save ?? t('saveAndContinue');
      const discardLabel = labels?.discard ?? t('discardAndContinue');
      const result = await message(prompt, {
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
    },
    [saveProject, t],
  );

  const createNewProject = useCallback(async () => {
    if (!(await confirmReplaceProject(t('unsavedChangesNewMessage')))) return;

    if (isDesktopRuntime()) {
      try {
        await releaseProjectWindow(windowLabelRef.current, projectSessionId);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    newProject();
    setProjectPath(undefined);
    setOpenGridWindows([]);
    setMenu(undefined);
    setShowAppMenu(false);
    setStatus(t('newProjectCreated'));
  }, [confirmReplaceProject, newProject, projectSessionId, t]);

  const importDesktopProjectFile = useCallback(async () => {
    try {
      if (!(await confirmReplaceProject(t('unsavedChangesImportMessage')))) return;

      const selected = await pickProjectFileText(t('importProject'));
      if (!selected) return;
      const parsed = parseProjectFileText(selected.text, t);
      if (!parsed.ok) {
        setStatus(parsed.error);
        return;
      }
      if (!(await claimProjectWindow(windowLabelRef.current, selected.path))) {
        setStatus(t('projectAlreadyOpen'));
        return;
      }
      setImportPending({ project: parsed.project, name: selected.name, path: selected.path });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [confirmReplaceProject, t]);

  // 打开项目：选中的工程文件直接作为当前工程在本窗口打开，不经过导入报告。
  const openDesktopProjectFile = useCallback(async () => {
    try {
      if (!(await confirmReplaceProject(t('unsavedChangesOpenMessage')))) return;

      const selected = await pickProjectFileText(t('openProject'));
      if (!selected) return;
      const parsed = parseProjectFileText(selected.text, t);
      if (!parsed.ok) {
        setStatus(parsed.error);
        return;
      }
      if (!(await claimProjectWindow(windowLabelRef.current, selected.path))) {
        setStatus(t('projectAlreadyOpen'));
        return;
      }
      loadProject(parsed.project);
      setProjectPath(selected.path);
      setOpenGridWindows([]);
      setShowAppMenu(false);
      setStatus(t('openedProject', { name: selected.name }));
      void rememberRecentProjectPath(selected.path);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [confirmReplaceProject, loadProject, t]);

  const confirmImport = useCallback(
    (candidate: ProjectFile) => {
      if (!importPending) return;
      loadProject(candidate);
      setProjectPath(importPending.path);
      setOpenGridWindows([]);
      setStatus(t('importedFile', { name: importPending.name }));
      setImportPending(undefined);
      if (isDesktopRuntime() && importPending.path) {
        void rememberRecentProjectPath(importPending.path);
      }
    },
    [importPending, loadProject, t],
  );

  const cancelImport = useCallback(async () => {
    setImportPending(undefined);
    if (isDesktopRuntime() && projectPath) {
      await claimProjectWindow(windowLabelRef.current, projectPath).catch(() => undefined);
    }
  }, [projectPath]);

  // 刷新配置：重新读取磁盘上的工程文件并覆盖内存状态。
  // 有未保存修改时先提示保存或放弃；仅布局脏时保留当前画布布局（与 MCP 重载语义一致）。
  const refreshProjectFromDisk = useCallback(async () => {
    if (!isDesktopRuntime() || !projectPath) return;

    if (
      !(await confirmReplaceProject(t('unsavedChangesRefreshMessage'), {
        save: t('saveAndRefresh'),
        discard: t('discardAndRefresh'),
      }))
    ) {
      return;
    }

    try {
      const file = await readProjectFileText(projectPath);
      const parsed = parseProjectFileText(file.text, t);
      if (!parsed.ok) {
        setStatus(parsed.error);
        return;
      }

      const preserveLayout = dirtyScopeRef.current === 'layout';
      reloadProject(parsed.project, preserveLayout);
      setOpenGridWindows((prev) =>
        prev.filter((window) =>
          parsed.project.tables.some((table) => table.id === window.tableId),
        ),
      );
      setMenu(undefined);
      setShowAppMenu(false);
      setStatus(t('projectRefreshed'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [confirmReplaceProject, projectPath, reloadProject, t]);

  const openDesktopProjectInNewWindow = useCallback(async () => {
    try {
      const selected = await pickProjectFileText(t('openProjectInNewWindow'));
      if (!selected) return;
      const parsed = parseProjectFileText(selected.text, t);
      if (!parsed.ok) {
        setStatus(parsed.error);
        return;
      }
      const result = await openProjectWindow(selected.path);
      await rememberRecentProjectPath(selected.path);
      setShowAppMenu(false);
      setStatus(result.created ? t('projectOpenedInNewWindow') : t('projectAlreadyOpen'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const triggerImportProject = useCallback(() => {
    if (isDesktopRuntime()) {
      void importDesktopProjectFile();
      return;
    }

    void (async () => {
      if (await confirmReplaceProject(t('unsavedChangesImportMessage'))) {
        fileInputModeRef.current = 'import';
        fileInputRef.current?.click();
      }
    })();
  }, [confirmReplaceProject, importDesktopProjectFile, t]);

  const triggerOpenProject = useCallback(() => {
    if (isDesktopRuntime()) {
      void openDesktopProjectFile();
      return;
    }

    void (async () => {
      if (await confirmReplaceProject(t('unsavedChangesOpenMessage'))) {
        fileInputModeRef.current = 'open';
        fileInputRef.current?.click();
      }
    })();
  }, [confirmReplaceProject, openDesktopProjectFile, t]);

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

      return confirmDialog(t('confirmOverwriteExport', { count }), {
        title: t('overwriteExportTitle'),
        kind: 'warning',
        okLabel: t('overwriteAndExport'),
        cancelLabel: t('cancel'),
      });
    },
    [t],
  );

  const exportAllJsonFiles = useCallback(async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setIsExporting(true);

    try {
      const currentProject = useEditorStore.getState().project;
      const files = projectJsonFiles(structuredClone(currentProject));

      if (isDesktopRuntime()) {
        const directory = await pickExportDirectoryPath();
        if (!directory) return;

        const result = await exportDesktopFiles(directory, files, {
          fileExists,
          confirmOverwrite: confirmOverwriteExport,
          writeTextFile,
          readTextFile,
        });
        if (result.status === 'exported') {
          setStatus(t('exportedJsonFiles', { count: result.count }));
        }
        return;
      }

      const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
      if (directoryPicker) {
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
        return;
      }

      for (const file of files) {
        downloadTextFile(file.fileName, file.text);
      }
      setStatus(t('exportedJsonFiles', { count: files.length }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof DesktopExportFileError) {
        setStatus(
          error.reason === 'verify'
            ? t('exportVerificationFailed', { name: error.fileName })
            : t('exportFileFailed', {
                name: error.fileName,
                error:
                  error.originalError instanceof Error
                    ? error.originalError.message
                    : String(error.originalError),
              }),
        );
        return;
      }
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      exportingRef.current = false;
      setIsExporting(false);
    }
  }, [confirmOverwriteExport, t]);

  const updatePublishSettings = useCallback((next: PublishSettings) => {
    publishSettingsRef.current = next;
    savePublishSettings(next);
    setPublishSettings(next);
  }, []);

  const changePublishEnabled = useCallback(
    async (enabled: boolean) => {
      const current = publishSettingsRef.current;
      if (!enabled) {
        updatePublishSettings({ enabled: false, directory: current.directory });
        return;
      }
      if (current.directory) {
        updatePublishSettings({ enabled: true, directory: current.directory });
        return;
      }
      // 开启自动发布但还没有目录时先选择目录；取消选择则保持关闭。
      const directory = await pickExportDirectoryPath();
      if (!directory) return;
      updatePublishSettings({ enabled: true, directory });
    },
    [updatePublishSettings],
  );

  const choosePublishDirectory = useCallback(async () => {
    const directory = await pickExportDirectoryPath();
    if (!directory) return;
    updatePublishSettings({ ...publishSettingsRef.current, directory });
    setStatus(t('publishDirectoryUpdated', { directory }));
  }, [t, updatePublishSettings]);

  const clearPublishDirectory = useCallback(() => {
    updatePublishSettings({ enabled: false });
    setStatus(t('publishDirectoryCleared'));
  }, [t, updatePublishSettings]);

  const publishCurrentProject = useCallback(async () => {
    const { directory } = publishSettingsRef.current;
    if (!directory || exportingRef.current) return;
    exportingRef.current = true;
    setIsExporting(true);
    try {
      const result = await publishProjectFiles(
        directory,
        useEditorStore.getState().project,
        { fileExists, writeTextFile, readTextFile },
      );
      setStatus(publishResultStatus(t, result, directory));
    } finally {
      exportingRef.current = false;
      setIsExporting(false);
    }
  }, [t]);

  const addFieldToSelectedTable = useCallback(() => {
    if (selectedTable) addColumn(selectedTable.id);
  }, [addColumn, selectedTable]);

  const focusTableOnCanvas = useCallback(
    (tableId: string) => {
      selectTable(tableId);
      tableFocusSequenceRef.current += 1;
      setTableFocusRequest({ tableId, sequence: tableFocusSequenceRef.current });
    },
    [selectTable],
  );

  const openRowsModal = useCallback(
    (tableId = selectedTable?.id, focus?: { rowId: string; columnId: string }) => {
      if (!tableId) return;

      let nextFocus: DataGridFocusRequest | undefined;
      if (focus) {
        dataGridFocusSequenceRef.current += 1;
        nextFocus = {
          tableId,
          rowId: focus.rowId,
          columnId: focus.columnId,
          sequence: dataGridFocusSequenceRef.current,
        };
      }

      const alreadyOpen = openGridWindowsRef.current.some(
        (window) => window.tableId === tableId,
      );
      if (alreadyOpen) {
        if (nextFocus) {
          setOpenGridWindows((prev) =>
            prev.map((window) =>
              window.tableId === tableId ? { ...window, focus: nextFocus } : window,
            ),
          );
        }
        restoreWindow(`data-grid-${tableId}`);
      } else {
        setOpenGridWindows((prev) => [...prev, { tableId, focus: nextFocus }]);
      }
      selectTable(tableId);
    },
    [restoreWindow, selectTable, selectedTable?.id],
  );

  const closeGridWindow = useCallback((tableId: string) => {
    setOpenGridWindows((prev) => prev.filter((window) => window.tableId !== tableId));
  }, []);

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

  const openMcpLogContextMenu = useCallback((position: { x: number; y: number }) => {
    setMenu({ kind: 'mcp-log', x: position.x, y: position.y });
  }, []);

  const clearMcpLogEntries = useCallback(async () => {
    mcpLogsRevisionRef.current += 1;
    try {
      await clearMcpLogs();
      setMcpLogs([]);
      setStatus(t('mcpLogsCleared'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const importFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseProjectFileText(text, t);
    if (!parsed.ok) {
      setStatus(parsed.error);
      return;
    }
    if (fileInputModeRef.current === 'open') {
      loadProject(parsed.project);
      setProjectPath(undefined);
      setOpenGridWindows([]);
      setStatus(t('openedProject', { name: file.name }));
      return;
    }
    setImportPending({ project: parsed.project, name: file.name });
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
        {
          id: 'import-json',
          label: t('importJson'),
          onSelect: () => setTableImportTableId(table.id),
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

    if (menu.kind === 'mcp-log') {
      return [
        { id: 'mcp-log-label', type: 'label', label: t('mcpLogTitle') },
        {
          id: 'clear-mcp-log',
          label: t('mcpLogClear'),
          danger: true,
          onSelect: clearMcpLogEntries,
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
    clearMcpLogEntries,
    copyIdRegistryToClipboard,
    copyTableJsonToClipboard,
    deleteTableById,
    downloadIdRegistryFile,
    downloadTableJsonFile,
    menu,
    openRowsModal,
    project.tables,
    showMiniMap,
    t,
  ]);

  const appMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: 'new-project',
        label: t('newProject'),
        shortcut: 'Ctrl+Shift+N',
        onSelect: createNewProject,
      },
      {
        id: 'open-project',
        label: t('openProject'),
        shortcut: 'Ctrl+Shift+O',
        onSelect: triggerOpenProject,
      },
      { id: 'app-menu-separator-file', type: 'separator' },
      {
        id: 'save-project',
        label: t('save'),
        shortcut: 'Ctrl+S',
        onSelect: saveProject,
      },
      {
        id: 'import-project',
        label: t('importProject'),
        shortcut: 'Ctrl+O',
        onSelect: triggerImportProject,
      },
      ...(isDesktopRuntime()
        ? [
            {
              id: 'refresh-project',
              label: t('refreshProject'),
              disabled: projectPath === undefined,
              onSelect: () => {
                void refreshProjectFromDisk();
              },
            } satisfies ContextMenuItem,
          ]
        : []),
      ...(isDesktopRuntime()
        ? [
            {
              id: 'open-project-new-window',
              label: t('openProjectInNewWindow'),
              shortcut: 'Ctrl+Alt+O',
              onSelect: openDesktopProjectInNewWindow,
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        id: 'export-project',
        label: isExporting ? t('exporting') : t('exportAll'),
        disabled: isExporting,
        onSelect: exportAllJsonFiles,
      },
      { id: 'app-menu-separator-settings', type: 'separator' },
      {
        id: 'shortcut-help',
        label: t('shortcutHelp'),
        shortcut: '?',
        onSelect: () => setShowShortcuts(true),
      },
      {
        id: 'open-settings',
        label: t('settings'),
        onSelect: () => setShowSettings(true),
      },
    ],
    [
      createNewProject,
      exportAllJsonFiles,
      isExporting,
      openDesktopProjectInNewWindow,
      projectPath,
      refreshProjectFromDisk,
      saveProject,
      t,
      triggerImportProject,
      triggerOpenProject,
    ],
  );

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

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const appWindow = getCurrentWindow();

    void appWindow
      .onCloseRequested((event) => {
        if (allowCloseRef.current) return;

        event.preventDefault();
        if (closePromptOpenRef.current) return;

        closePromptOpenRef.current = true;

        void (async () => {
          const translateNow = tRef.current;
          const saveLabel = translateNow('saveAndQuit');
          const discardLabel = translateNow('discardAndQuit');

          try {
            if (isDirtyRef.current) {
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
            }

            await releaseProjectWindow(windowLabelRef.current, projectSessionId);
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
  }, [projectSessionId]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (recentProjectLoadedRef.current) return;
    recentProjectLoadedRef.current = true;

    const loadRecentProject = async () => {
      try {
        const assignedPath = await getAssignedProjectPath(windowLabelRef.current);
        const recentPath = assignedPath ??
          (windowLabelRef.current === 'main' ? await loadRecentProjectPath() : undefined);
        if (!recentPath) return;
        if (!(await claimProjectWindow(windowLabelRef.current, recentPath))) {
          setStatus(t('projectAlreadyOpen'));
          return;
        }

        const recentFile = await readProjectFileText(recentPath);
        loadProjectText(recentFile.text, recentFile.name, recentFile.path);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setIsStarting(false);
      }
    };

    void loadRecentProject();
  }, [loadProjectText, t]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const revision = mcpContextRevisionRef.current + 1;
    mcpContextRevisionRef.current = revision;
    void updateMcpContext(
      projectSessionId,
      windowLabelRef.current,
      projectPath,
      isDirty,
      dirtyScope,
      revision,
    ).catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }, [dirtyScope, isDirty, projectPath, projectSessionId]);

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
        setOpenGridWindows((prev) =>
          prev.filter((window) =>
            parsed.project.tables.some((table) => table.id === window.tableId),
          ),
        );
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
    [projectPath, reloadProject, t],
  );

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;

    const poll = async () => {
      if (mcpEventPollActiveRef.current) return;
      mcpEventPollActiveRef.current = true;
      const logsRevision = mcpLogsRevisionRef.current;
      try {
        const [nextStatus, event, logs] = await Promise.all([
          getMcpStatus(projectSessionId),
          getMcpEvents(projectSessionId),
          getMcpLogs(),
        ]);
        if (disposed) return;
        setMcpStatus(nextStatus);
        if (logsRevision === mcpLogsRevisionRef.current) setMcpLogs(logs);

        const previousRevision = lastMcpEventRevisionRef.current;
        lastMcpEventRevisionRef.current = event.changeRevision;
        if (
          event.changeRevision > 0 &&
          (previousRevision === undefined || event.changeRevision > previousRevision)
        ) {
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
  }, [projectSessionId, reloadProjectFromMcp]);

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
      if (showShortcuts) return;

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;
      // 主界面被未最小化的浮窗（行编辑、设置、对话框等）遮挡时，单键快捷键让位，
      // 避免焦点不在网格时误触删除表、打开行编辑器等动作；组合键不受影响。
      const mainWindowBlocked = managedWindows.some((window) => !window.minimized);

      if (commandKey && event.altKey && !event.shiftKey && key === 'o' && isDesktopRuntime()) {
        event.preventDefault();
        setShowAppMenu(false);
        void openDesktopProjectInNewWindow();
        return;
      }

      if (commandKey && !event.altKey) {
        if (key === 'n' && event.shiftKey) {
          event.preventDefault();
          setShowAppMenu(false);
          void createNewProject();
          return;
        }

        if (key === 'o' && event.shiftKey) {
          event.preventDefault();
          setShowAppMenu(false);
          triggerOpenProject();
          return;
        }

        if (event.shiftKey) return;

        if (key === 's') {
          event.preventDefault();
          setShowAppMenu(false);
          void saveProject();
        } else if (key === 'o') {
          event.preventDefault();
          setShowAppMenu(false);
          triggerImportProject();
        } else if (key === 'n') {
          event.preventDefault();
          addTable();
        }
        return;
      }

      if (key === '?' && !commandKey && !event.altKey) {
        if (isEditableTarget(event.target) || mainWindowBlocked) return;
        event.preventDefault();
        setShowShortcuts(true);
        return;
      }

      if (commandKey || event.altKey || event.shiftKey || isEditableTarget(event.target) || mainWindowBlocked) {
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
        o: triggerImportProject,
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
    createNewProject,
    deleteTableById,
    downloadTableJsonFile,
    managedWindows,
    openDesktopProjectInNewWindow,
    openRowsModal,
    saveProject,
    showSettings,
    showShortcuts,
    triggerImportProject,
    triggerOpenProject,
  ]);

  // 桌面模式下拦截浏览器快捷键（F5/Ctrl+R 刷新、Ctrl+P 打印、Ctrl+U 查看源码、
  // Alt+左右方向键历史导航），避免误操作刷新 WebView 丢失编辑状态。
  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const isBrowserShortcut =
        key === 'f5' ||
        (event.ctrlKey && key === 'r') ||
        (event.ctrlKey && key === 'p') ||
        (event.ctrlKey && key === 'u') ||
        (event.altKey && (key === 'arrowleft' || key === 'arrowright'));
      if (isBrowserShortcut) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

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
    void setMcpEnabled(enabled, projectSessionId)
      .then((nextStatus) => {
        setMcpStatus(nextStatus);
        if (nextStatus.error) setStatus(nextStatus.error);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setMcpBusy(false));
  }, [projectSessionId]);

  const restartMcpService = useCallback(() => {
    setMcpBusy(true);
    void restartMcp(projectSessionId)
      .then((nextStatus) => {
        setMcpStatus(nextStatus);
        setStatus(nextStatus.error ?? (nextStatus.running ? t('mcpRestarted') : ''));
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setMcpBusy(false));
  }, [projectSessionId, t]);

  const changeMcpPort = useCallback(
    async (port: number) => {
      setMcpBusy(true);
      try {
        const nextStatus = await setMcpPort(port, projectSessionId);
        setMcpStatus(nextStatus);
        setStatus(nextStatus.error ?? t('mcpPortUpdated', { port: nextStatus.port }));
        return true;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setMcpBusy(false);
      }
    },
    [projectSessionId, t],
  );

  const restoreDefaultMcpPort = useCallback(async () => {
    setMcpBusy(true);
    try {
      const nextStatus = await resetMcpPort(projectSessionId);
      setMcpStatus(nextStatus);
      setStatus(nextStatus.error ?? t('mcpPortReset', { port: nextStatus.port }));
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setMcpBusy(false);
    }
  }, [projectSessionId, t]);

  const changeMcpFullAccess = useCallback(
    (fullAccess: boolean) => {
      setMcpBusy(true);
      void setMcpFullAccess(projectSessionId, fullAccess)
        .then((nextStatus) => {
          setMcpStatus(nextStatus);
          if (fullAccess) setStatus(t('mcpFullAccessEnabled'));
        })
        .catch((error) => {
          setStatus(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setMcpBusy(false));
    },
    [projectSessionId, t],
  );

  const copyMcpAddress = useCallback(() => {
    if (!mcpStatus?.connectionUrl) return;
    void navigator.clipboard.writeText(mcpStatus.connectionUrl).then(
      () => setStatus(t('mcpAddressCopied')),
      () => setStatus(t('clipboardDenied')),
    );
  }, [mcpStatus?.connectionUrl, t]);

  if (isStarting) return <StartupScreen t={t} />;

  return (
    <div className="app-shell" onContextMenu={preventNativeContextMenu}>
      <header className="toolbar">
        <AppMenu
          open={showAppMenu}
          items={appMenuItems}
          label={t('appMenu')}
          onOpenChange={setShowAppMenu}
        />
        <div className="brand-block">
          <strong>Configra</strong>
          <span className="brand-block__project" title={projectPath}>
            {projectPath?.split(/[\\/]/).pop() ?? t('unsavedProject')}
          </span>
        </div>
        <div className="toolbar__validation" aria-label={t('issues')}>
          {dirtyTableIds.length > 0 ? (
            <span
              className="toolbar__validation-item is-dirty"
              title={dirtyTableNames.join('、')}
            >
              * {t('unsavedTablesCount', { count: dirtyTableIds.length })}
            </span>
          ) : null}
          <span className={`toolbar__validation-item ${errorCount > 0 ? 'is-error' : 'is-clear'}`}>
            {t('errorCount', { count: errorCount })}
          </span>
          {warningCount > 0 ? (
            <span className="toolbar__validation-item is-warning">
              {t('warningCount', { count: warningCount })}
            </span>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".configra.json,application/json"
          className="hidden-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = '';
          }}
        />
      </header>

      <main
        className={`main-region ${isResizingTableList ? 'is-resizing' : ''}`}
        style={{ '--table-list-width': `${tableListWidth}px` } as CSSProperties}
      >
        <aside className="table-list-panel">
          <div className="panel-heading">
            <div className="panel-heading__title">
              <h2>{t('tables')}</h2>
              <span className="panel-heading__count">{project.tables.length}</span>
            </div>
            <button
              type="button"
              className="panel-heading__action"
              title={t('newTable')}
              aria-label={t('newTable')}
              onClick={() => addTable()}
            >
              +
            </button>
          </div>
          <div className="table-list">
            {project.tables.map((table) => (
              <button
                key={table.id}
                type="button"
                className={`table-list-item ${table.id === selectedTableId ? 'is-active' : ''}`}
                title={table.remark?.trim() || undefined}
                onClick={() => focusTableOnCanvas(table.id)}
                onDoubleClick={() => openRowsModal(table.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openTableContextMenu(table.id, { x: event.clientX, y: event.clientY });
                }}
              >
                <span className="table-list-item__name">
                  {dirtyTableIds.includes(table.id) ? (
                    <span
                      className="table-list-item__dirty"
                      title={t('unsavedTable')}
                      aria-label={t('unsavedTable')}
                    >
                      *
                    </span>
                  ) : null}
                  {table.name}
                </span>
                <span className="table-list-item__meta">
                  {table.remark?.trim() ? (
                    <small className="table-list-item__remark">{table.remark.trim()}</small>
                  ) : null}
                  <small className="table-list-item__stats">
                    {t('fieldsRows', { fields: table.columns.length, rows: table.rows.length })}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {status ? <div className="status-line">{status}</div> : null}
        </aside>

        <div
          className="sidebar-resizer"
          role="separator"
          aria-label={t('resizeTableList')}
          aria-orientation="vertical"
          aria-valuemin={MIN_TABLE_LIST_WIDTH}
          aria-valuemax={MAX_TABLE_LIST_WIDTH}
          aria-valuenow={tableListWidth}
          tabIndex={0}
          title={t('resizeTableList')}
          onPointerDown={handleTableListResizeStart}
          onPointerMove={handleTableListResizeMove}
          onPointerUp={handleTableListResizeEnd}
          onPointerCancel={handleTableListResizeEnd}
          onDoubleClick={() => setTableListWidth(DEFAULT_TABLE_LIST_WIDTH)}
          onKeyDown={handleTableListResizeKeyDown}
        />

        <section className="canvas-panel" aria-label="Graph canvas">
          <GraphCanvas
            showMiniMap={showMiniMap}
            theme={resolvedTheme}
            focusRequest={tableFocusRequest}
            onOpenTableData={openRowsModal}
            onOpenTableContext={openTableContextMenu}
            onOpenCanvasContext={openCanvasContextMenu}
          />
          {project.tables.length === 0 ? (
            <div className="empty-project" role="status">
              <p>{t('emptyProject')}</p>
              <button type="button" className="button button--primary" onClick={() => addTable()}>
                {t('createFirstTable')}
              </button>
            </div>
          ) : null}
        </section>
      </main>

      {openGridWindows.map((window) => {
        const table = project.tables.find((item) => item.id === window.tableId);
        if (!table) return null;
        return (
          <DataGridModal
            key={window.tableId}
            windowId={`data-grid-${window.tableId}`}
            open
            table={table}
            project={project}
            issues={issues}
            theme={resolvedTheme}
            t={t}
            focusRequest={window.focus}
            onOpenTable={openRowsModal}
            onClose={() => closeGridWindow(window.tableId)}
          />
        );
      })}

      <SettingsPanel
        open={showSettings}
        language={language}
        themePreference={themePreference}
        showMiniMap={showMiniMap}
        desktopAvailable={isDesktopRuntime()}
        publishSettings={publishSettings}
        mcpBusy={mcpBusy}
        mcpStatus={mcpStatus}
        showMcpLog={mcpLogVisible}
        onClose={closeSettings}
        onLanguageChange={setLanguage}
        onThemePreferenceChange={setThemePreference}
        onMiniMapChange={setShowMiniMap}
        onPublishEnabledChange={changePublishEnabled}
        onPublishDirectoryPick={choosePublishDirectory}
        onPublishDirectoryClear={clearPublishDirectory}
        onPublishNow={publishCurrentProject}
        onMcpEnabledChange={changeMcpEnabled}
        onMcpRestart={restartMcpService}
        onMcpPortChange={changeMcpPort}
        onMcpPortReset={restoreDefaultMcpPort}
        onMcpFullAccessChange={changeMcpFullAccess}
        onMcpLogVisibilityChange={setMcpLogVisible}
        onCopyMcpAddress={copyMcpAddress}
        t={t}
      />

      <ShortcutCheatSheet
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        t={t}
      />

      <ImportReportDialog
        open={importPending !== undefined}
        currentProject={project}
        incomingProject={importPending?.project}
        incomingName={importPending?.name ?? ''}
        t={t}
        onCancel={cancelImport}
        onConfirm={confirmImport}
      />

      {tableImportTableId ? (
        <TableImportDialog
          project={project}
          tableId={tableImportTableId}
          t={t}
          onCancel={() => setTableImportTableId(undefined)}
          onConfirm={(rows, mode) => {
            appendRows(tableImportTableId, rows, mode === 'overwrite-id');
            const importTableName =
              project.tables.find((item) => item.id === tableImportTableId)?.name ?? '';
            setStatus(t('importedRows', { count: rows.length, name: importTableName }));
            setTableImportTableId(undefined);
            setMenu(undefined);
          }}
        />
      ) : null}

      {mcpStatus?.enabled ? (
        <McpLogWindow
          entries={mcpLogs}
          expanded={mcpLogVisible}
          running={mcpStatus.running}
          onMinimize={() => setMcpLogVisible(false)}
          onRestore={() => setMcpLogVisible(true)}
          onOpenContextMenu={openMcpLogContextMenu}
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

      <div className={`publish-toast ${publishToastVisible ? 'is-visible' : ''}`} role="status">
        {t('autoPublishToast')}
      </div>
    </div>
  );
}
