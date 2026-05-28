import type { ConfigColumn, ProjectFile } from '../model/types';

export const safeFileName = (value: string) =>
  value.trim().replace(/[^a-z0-9_-]+/gi, '_') || 'table';

export const downloadTextFile = (fileName: string, text: string, mimeType = 'application/json') => {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const exportValue = (column: ConfigColumn, value: unknown) => {
  if (column.type !== 'json' || typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export function exportTableRows(project: ProjectFile, tableId: string): Record<string, unknown>[] {
  const table = project.tables.find((item) => item.id === tableId);
  if (!table) return [];

  return table.rows.map((row) =>
    Object.fromEntries(
      table.columns.map((column) => [
        column.name || column.id,
        exportValue(column, row.values[column.id]),
      ]),
    ),
  );
}

export function tableJson(project: ProjectFile, tableId: string) {
  return JSON.stringify(exportTableRows(project, tableId), null, 2);
}

export function downloadTableJson(project: ProjectFile, tableId: string) {
  const table = project.tables.find((item) => item.id === tableId);
  if (!table) return;
  downloadTextFile(`${safeFileName(table.name)}.json`, tableJson(project, tableId));
}

export function downloadProjectFile(project: ProjectFile) {
  downloadTextFile('game-config.cfggraph.json', JSON.stringify(project, null, 2));
}
