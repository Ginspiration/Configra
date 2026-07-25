import type { ProjectFile } from './types';

export function createEmptyProject(): ProjectFile {
  return {
    version: 1,
    tables: [],
  };
}
