import { isTauri } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { save } from '@tauri-apps/plugin-dialog';

export function isDesktopRuntime() {
  return isTauri();
}

export type McpStatus = {
  enabled: boolean;
  running: boolean;
  fullAccess: boolean;
  port: number;
  connectionUrl: string;
  error?: string;
};

export type McpLogEntry = {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | string;
  message: string;
  requestId?: string;
  toolName?: string;
  durationMs?: number;
};

export type McpEvents = {
  version: number;
  changeRevision: number;
  projectPath?: string;
  projectHash?: string;
  changedAt?: string;
};

const projectFilters = [
  {
    name: 'Config Graph Project',
    extensions: ['cfggraph.json', 'json'],
  },
];

const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() ?? path;

export async function readProjectFileText(path: string) {
  const text = await invoke<string>('read_project_file', { path });
  return { path, name: fileNameFromPath(path), text };
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

export async function getMcpStatus() {
  return invoke<McpStatus>('get_mcp_status');
}

export async function setMcpEnabled(enabled: boolean) {
  return invoke<McpStatus>('set_mcp_enabled', { enabled });
}

export async function setMcpFullAccess(fullAccess: boolean) {
  return invoke<McpStatus>('set_mcp_full_access', { fullAccess });
}

export async function updateMcpContext(
  projectPath: string | undefined,
  uiDirty: boolean,
  dirtyScope: 'none' | 'layout' | 'content',
  fullAccess: boolean,
  revision: number,
) {
  await invoke('update_mcp_context', {
    projectPath: projectPath ?? null,
    uiDirty,
    dirtyScope,
    fullAccess,
    revision,
    updatedAt: new Date().toISOString(),
  });
}

export async function getMcpEvents() {
  return invoke<McpEvents>('get_mcp_events');
}

export async function getMcpLogs() {
  return invoke<McpLogEntry[]>('get_mcp_logs');
}

export async function clearMcpLogs() {
  await invoke('clear_mcp_logs');
}

export async function pickProjectFileText() {
  const selected = await open({
    title: 'Open project',
    multiple: false,
    filters: projectFilters,
  });

  if (!selected || Array.isArray(selected)) return undefined;

  return readProjectFileText(selected);
}

export async function pickProjectSavePath() {
  return save({
    title: 'Save project',
    defaultPath: 'game-config.cfggraph.json',
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
