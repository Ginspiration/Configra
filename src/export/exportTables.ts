import type { ProjectFile } from '../model/types';
import {
  buildExportPlan,
  exportRowObject,
  safeFileName,
  type BuildExportPlanOptions,
  type ExportJsonFile,
} from './exportScope';

export { safeFileName };
export type { ExportJsonFile };

export type ExportOptions = BuildExportPlanOptions;

export function exportTableRows(
  project: ProjectFile,
  tableId: string,
  options?: ExportOptions,
): Record<string, unknown>[] {
  const plan = buildExportPlan(project, { ...options, onlyTableId: tableId });
  const table = plan.tables.find((candidate) => candidate.tableId === tableId);
  return table ? table.rows.map((row) => exportRowObject(table.columns, row)) : [];
}

// 导出的 JSON 文本统一以单个换行符结尾：对 git diff 和文本工具友好，
// 并保证复制、下载、导出、自动发布与 CLI 导出的文件字节一致。
export function tableJson(project: ProjectFile, tableId: string, options?: ExportOptions) {
  const plan = buildExportPlan(project, { ...options, onlyTableId: tableId });
  const table = plan.tables.find((candidate) => candidate.tableId === tableId);
  return table?.file.text ?? '[]\n';
}

export function exportIdRegistry(project: ProjectFile, options?: ExportOptions) {
  return buildExportPlan(project, options).idRegistry;
}

export function idRegistryJson(project: ProjectFile, options?: ExportOptions) {
  return `${JSON.stringify(exportIdRegistry(project, options), null, 2)}\n`;
}

export function projectJsonFiles(
  project: ProjectFile,
  options?: ExportOptions,
): ExportJsonFile[] {
  return buildExportPlan(project, options).files;
}

export const downloadTextFile = (
  fileName: string,
  text: string,
  mimeType = 'application/json',
) => {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export function downloadTableJson(
  project: ProjectFile,
  tableId: string,
  options?: ExportOptions,
) {
  const table = project.tables.find((item) => item.id === tableId);
  if (!table) return;
  downloadTextFile(`${safeFileName(table.name)}.json`, tableJson(project, tableId, options));
}

export function downloadProjectFile(project: ProjectFile) {
  downloadTextFile('project.configra.json', JSON.stringify(project, null, 2));
}

export function downloadIdRegistry(project: ProjectFile, options?: ExportOptions) {
  downloadTextFile('config_ids.json', idRegistryJson(project, options));
}
