import type { ProjectFile } from './types';

export function createEmptyProject(): ProjectFile {
  return {
    version: 2,
    exportPolicy: 'explicit',
    tables: [],
  };
}
