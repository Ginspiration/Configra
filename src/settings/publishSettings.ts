export type PublishSettings = {
  enabled: boolean;
  directory?: string;
};

const PUBLISH_SETTINGS_STORAGE_KEY = 'configra:publish-settings';

const settingsKey = (projectPath?: string) =>
  projectPath
    ? `${PUBLISH_SETTINGS_STORAGE_KEY}:${projectPath.toLowerCase()}`
    : PUBLISH_SETTINGS_STORAGE_KEY;

export const loadPublishSettings = (projectPath?: string): PublishSettings => {
  try {
    const raw = window.localStorage.getItem(settingsKey(projectPath));
    if (!raw) return { enabled: false };

    const parsed = JSON.parse(raw) as Partial<PublishSettings>;
    const directory =
      typeof parsed.directory === 'string' && parsed.directory.trim()
        ? parsed.directory
        : undefined;
    // 目录是发布的前提；存储里出现“开启但无目录”时按关闭处理。
    return { enabled: parsed.enabled === true && Boolean(directory), directory };
  } catch {
    return { enabled: false };
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
