import { isTauri } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { save } from '@tauri-apps/plugin-dialog';

export function isDesktopRuntime() {
  return isTauri();
}

export type McpStatus = {
  serverId: string;
  sourceId: string;
  displayName: string;
  supportedCapabilities: string[];
  enabled: boolean;
  running: boolean;
  fullAccess: boolean;
  port: number;
  defaultPort: number;
  connectionUrl: string;
  error?: string;
};

export type McpLogEntry = {
  timestamp: string;
  sourceId?: string;
  projectId?: string;
  level: 'info' | 'warning' | 'error' | string;
  message: string;
  requestId?: string;
  toolName?: string;
  durationMs?: number;
};

export type McpEvents = {
  version: number;
  changeRevision: number;
  projectId?: string;
  projectPath?: string;
  projectHash?: string;
  changedAt?: string;
  serverId?: string;
  transactionId?: string;
};

export type OpenProjectWindowResult = {
  windowLabel: string;
  created: boolean;
};

const projectFilters = [
  {
    name: 'Configra Project',
    extensions: ['configra.json', 'json'],
  },
];

const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() ?? path;

export async function readProjectFileText(path: string) {
  const text = await readTextFile(path);
  return { path, name: fileNameFromPath(path), text };
}

export async function readTextFile(path: string) {
  return invoke<string>('read_project_file', { path });
}

export async function writeTextFile(path: string, text: string) {
  await invoke('write_project_file', { path, text });
}

export async function fileExists(path: string) {
  return invoke<boolean>('path_exists', { path });
}

export async function writeProjectFileText(path: string, text: string) {
  await writeTextFile(path, text);
  await invoke('save_recent_project_path', { path });
}

export async function loadRecentProjectPath() {
  return invoke<string | null>('load_recent_project_path');
}

export async function rememberRecentProjectPath(path: string) {
  await invoke('save_recent_project_path', { path });
}

export async function getMcpStatus(projectId?: string) {
  return invoke<McpStatus>('get_mcp_status', { projectId: projectId ?? null });
}

export async function setMcpEnabled(enabled: boolean, projectId?: string) {
  return invoke<McpStatus>('set_mcp_enabled', { enabled, projectId: projectId ?? null });
}

export async function restartMcp(projectId?: string) {
  return invoke<McpStatus>('restart_mcp', { projectId: projectId ?? null });
}

export async function setMcpPort(port: number, projectId?: string) {
  return invoke<McpStatus>('set_mcp_port', { port, projectId: projectId ?? null });
}

export async function resetMcpPort(projectId?: string) {
  return invoke<McpStatus>('reset_mcp_port', { projectId: projectId ?? null });
}

export async function setMcpFullAccess(projectId: string, fullAccess: boolean) {
  return invoke<McpStatus>('set_mcp_full_access', { projectId, fullAccess });
}

export async function updateMcpContext(
  projectId: string,
  windowLabel: string,
  projectPath: string | undefined,
  uiDirty: boolean,
  dirtyScope: 'none' | 'layout' | 'content',
  revision: number,
) {
  await invoke('update_mcp_context', {
    projectId,
    windowLabel,
    projectPath: projectPath ?? null,
    uiDirty,
    dirtyScope,
    revision,
    updatedAt: new Date().toISOString(),
  });
}

export async function getMcpEvents(projectId: string) {
  return invoke<McpEvents>('get_mcp_events', { projectId });
}

export async function getMcpLogs() {
  return invoke<McpLogEntry[]>('get_mcp_logs');
}

export async function clearMcpLogs() {
  await invoke('clear_mcp_logs');
}

export async function claimProjectWindow(windowLabel: string, path: string) {
  return invoke<boolean>('claim_project_window', { windowLabel, path });
}

export async function openProjectWindow(path: string) {
  return invoke<OpenProjectWindowResult>('open_project_window', { path });
}

export async function getAssignedProjectPath(windowLabel: string) {
  return invoke<string | null>('get_assigned_project_path', { windowLabel });
}

export async function releaseProjectWindow(windowLabel: string, projectId: string) {
  await invoke('release_project_window', { windowLabel, projectId });
}

export async function pickProjectFileText(title: string) {
  const selected = await open({
    title,
    multiple: false,
    filters: projectFilters,
  });

  if (!selected || Array.isArray(selected)) return undefined;

  return readProjectFileText(selected);
}

export async function pickProjectSavePath() {
  return save({
    title: 'Save project',
    defaultPath: 'project.configra.json',
    filters: projectFilters,
  });
}

export async function pickJsonSavePath(defaultPath: string) {
  return save({
    title: 'Save JSON',
    defaultPath,
    filters: [
      {
        name: 'JSON',
        extensions: ['json'],
      },
    ],
  });
}

export async function pickIdRegistrySavePath() {
  return pickJsonSavePath('config_ids.json');
}

export async function pickExportDirectoryPath() {
  const selected = await open({
    title: 'Export JSON',
    directory: true,
    multiple: false,
  });

  if (!selected || Array.isArray(selected)) return undefined;

  return selected;
}
