import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPublishDirectory,
  loadPublishSettings,
  publishDirectoryFor,
  savePublishSettings,
  setPublishDirectory,
} from './publishSettings';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('per-profile publish settings', () => {
  it('stores one publish directory per release profile', () => {
    const initial = { enabled: true, directories: {} };
    const withA = setPublishDirectory(initial, 'profile_a', 'D:/release-a');
    const withB = setPublishDirectory(withA, 'profile_b', 'D:/release-b');

    expect(publishDirectoryFor(withB, 'profile_a')).toBe('D:/release-a');
    expect(publishDirectoryFor(withB, 'profile_b')).toBe('D:/release-b');
    expect(publishDirectoryFor(withB, 'profile_missing')).toBeUndefined();

    savePublishSettings(withB, 'D:/game/project.configra.json');
    expect(loadPublishSettings('D:/game/project.configra.json', 'profile_a')).toEqual({
      enabled: true,
      directories: {
        profile_a: 'D:/release-a',
        profile_b: 'D:/release-b',
      },
    });
  });

  it('migrates the legacy single directory to the active profile', () => {
    storage.set(
      'configra:publish-settings:d:/game/project.configra.json',
      JSON.stringify({ enabled: true, directory: 'D:/legacy-release' }),
    );

    expect(loadPublishSettings('D:/game/project.configra.json', 'profile_a')).toEqual({
      enabled: true,
      directories: { profile_a: 'D:/legacy-release' },
    });

    // 没有当前方案时旧目录无法归属，按未配置处理。
    expect(loadPublishSettings('D:/game/project.configra.json')).toEqual({
      enabled: false,
      directories: {},
    });
  });

  it('clears only one profile directory and turns off auto publish when none remain', () => {
    const settings = {
      enabled: true,
      directories: { profile_a: 'D:/release-a', profile_b: 'D:/release-b' },
    };

    const withoutA = clearPublishDirectory(settings, 'profile_a');
    expect(withoutA).toEqual({
      enabled: true,
      directories: { profile_b: 'D:/release-b' },
    });

    const empty = clearPublishDirectory(withoutA, 'profile_b');
    expect(empty).toEqual({ enabled: false, directories: {} });
  });

  it('ignores malformed stored settings', () => {
    storage.set('configra:publish-settings', '{not json');
    expect(loadPublishSettings()).toEqual({ enabled: false, directories: {} });
  });
});
