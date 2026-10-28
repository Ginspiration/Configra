export type PublishSettings = {
  enabled: boolean;
  /** 发布方案 id -> 本机发布目录；绝对路径只保存在本机设置，不写进工程文件。 */
  directories: Record<string, string>;
};

const PUBLISH_SETTINGS_STORAGE_KEY = 'configra:publish-settings';

const settingsKey = (projectPath?: string) =>
  projectPath
    ? `${PUBLISH_SETTINGS_STORAGE_KEY}:${projectPath.toLowerCase()}`
    : PUBLISH_SETTINGS_STORAGE_KEY;

const cleanDirectories = (raw: unknown): Record<string, string> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const directories: Record<string, string> = {};
  for (const [profileId, directory] of Object.entries(raw)) {
    if (!profileId || typeof directory !== 'string' || !directory.trim()) continue;
    directories[profileId] = directory;
  }
  return directories;
};

/**
 * 按工程加载发布设置。旧版按工程保存的单一 directory 会迁移到当前方案，
 * 避免升级后所有方案突然失去发布目录。
 */
export const loadPublishSettings = (
  projectPath?: string,
  activeProfileId?: string,
): PublishSettings => {
  try {
    const raw = window.localStorage.getItem(settingsKey(projectPath));
    if (!raw) return { enabled: false, directories: {} };

    const parsed = JSON.parse(raw) as {
      enabled?: unknown;
      directory?: unknown;
      directories?: unknown;
    };
    const directories = cleanDirectories(parsed.directories);
    if (
      Object.keys(directories).length === 0 &&
      typeof parsed.directory === 'string' &&
      parsed.directory.trim() &&
      activeProfileId
    ) {
      directories[activeProfileId] = parsed.directory;
    }

    const hasDirectory = Object.keys(directories).length > 0;
    // 目录是发布的前提；存储里出现“开启但无目录”时按关闭处理。
    return { enabled: parsed.enabled === true && hasDirectory, directories };
  } catch {
    return { enabled: false, directories: {} };
  }
};

export const savePublishSettings = (
  settings: PublishSettings,
  projectPath?: string,
) => {
  try {
    window.localStorage.setItem(
      settingsKey(projectPath),
      JSON.stringify(settings),
    );
  } catch {
    // Local persistence is a convenience; ignore quota/private-mode failures.
  }
};

export const publishDirectoryFor = (
  settings: PublishSettings,
  profileId?: string,
): string | undefined => (profileId ? settings.directories[profileId] : undefined);

export const setPublishDirectory = (
  settings: PublishSettings,
  profileId: string,
  directory: string,
): PublishSettings => ({
  ...settings,
  directories: { ...settings.directories, [profileId]: directory },
});

export const clearPublishDirectory = (
  settings: PublishSettings,
  profileId: string,
): PublishSettings => {
  const directories = { ...settings.directories };
  delete directories[profileId];
  return {
    enabled: Object.keys(directories).length > 0 ? settings.enabled : false,
    directories,
  };
};
