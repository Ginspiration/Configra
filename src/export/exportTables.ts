import { identityNamespace } from '../model/schemaUtils';
import type { ConfigColumn, ProjectFile } from '../model/types';

export type ExportJsonFile = {
  fileName: string;
  text: string;
};

export const safeFileName = (value: string) =>
  value.trim().replace(/[^a-z0-9_-]+/gi, '_') || 'table';

const uniqueJsonFileName = (baseName: string, usedFileNames: Set<string>) => {
  let suffix = 1;
  let fileName = `${baseName}.json`;

  while (usedFileNames.has(fileName.toLowerCase())) {
    suffix += 1;
    fileName = `${baseName}_${suffix}.json`;
  }

  usedFileNames.add(fileName.toLowerCase());
  return fileName;
};

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
      table.columns
        .filter((column) => column.export !== false)
        .map((column) => [
          column.name || column.id,
          exportValue(column, row.values[column.id]),
        ]),
    ),
  );
}

export function tableJson(project: ProjectFile, tableId: string) {
  return JSON.stringify(exportTableRows(project, tableId), null, 2);
}

export function exportIdRegistry(project: ProjectFile): Record<string, unknown> {
  return Object.fromEntries(
    project.tables.flatMap((table) => {
      const keyColumn = table.columns.find((column) => column.id === table.identity?.keyColumnId);
      const valueColumn = table.columns.find((column) => column.id === table.identity?.valueColumnId);
      if (!keyColumn || !valueColumn) return [];

      const namespace = identityNamespace(table);

      return table.rows.flatMap((row) => {
        const key = row.values[keyColumn.id];
        const value = row.values[valueColumn.id];
        if (key === null || key === undefined || key === '' || value === null || value === undefined || value === '') {
          return [];
        }

        return [[`${namespace}.${String(key)}`, value] as const];
      });
    }),
  );
}

export function idRegistryJson(project: ProjectFile) {
  return JSON.stringify(exportIdRegistry(project), null, 2);
}

export function projectJsonFiles(project: ProjectFile): ExportJsonFile[] {
  const usedFileNames = new Set<string>();
  const files: ExportJsonFile[] = [
    {
      fileName: uniqueJsonFileName('config_ids', usedFileNames),
      text: idRegistryJson(project),
    },
  ];

  for (const table of project.tables) {
    files.push({
      fileName: uniqueJsonFileName(safeFileName(table.name), usedFileNames),
      text: tableJson(project, table.id),
    });
  }

  return files;
}

export function downloadTableJson(project: ProjectFile, tableId: string) {
  const table = project.tables.find((item) => item.id === tableId);
  if (!table) return;
  downloadTextFile(`${safeFileName(table.name)}.json`, tableJson(project, tableId));
}

export function downloadProjectFile(project: ProjectFile) {
  downloadTextFile('game-config.cfggraph.json', JSON.stringify(project, null, 2));
}

export function downloadIdRegistry(project: ProjectFile) {
  downloadTextFile('config_ids.json', idRegistryJson(project));
}
