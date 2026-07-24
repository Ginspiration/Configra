export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_PREFERENCE_STORAGE_KEY = 'configra:theme-preference';

export const getThemePreference = (): ThemePreference => {
  try {
    const value = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Local persistence is a convenience; follow the system when it is unavailable.
  }

  return 'system';
};

export const resolveTheme = (preference: ThemePreference): ResolvedTheme => {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyTheme = (preference: ThemePreference): ResolvedTheme => {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
};

export const saveThemePreference = (preference: ThemePreference) => {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Local persistence is a convenience; ignore quota/private-mode failures.
  }
};
