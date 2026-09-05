export type PublishSettings = {
  enabled: boolean;
  directory?: string;
};

const PUBLISH_SETTINGS_STORAGE_KEY = 'configra:publish-settings';

export const loadPublishSettings = (): PublishSettings => {
  try {
    const raw = window.localStorage.getItem(PUBLISH_SETTINGS_STORAGE_KEY);
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

export const savePublishSettings = (settings: PublishSettings) => {
  try {
    window.localStorage.setItem(PUBLISH_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Local persistence is a convenience; ignore quota/private-mode failures.
  }
};
