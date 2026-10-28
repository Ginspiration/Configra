import type { ProjectFile } from './types';

export function createEmptyProject(): ProjectFile {
  return {
    version: 3,
    releaseProfiles: {
      version: 1,
      activeProfileId: 'profile_default',
      profiles: [
        {
          id: 'profile_default',
          name: 'Default',
          mode: 'selected',
          tables: [],
        },
      ],
    },
    tables: [],
  };
}
