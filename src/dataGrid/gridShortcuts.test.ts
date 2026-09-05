import { describe, expect, it } from 'vitest';
import { resolveGridShortcut } from './gridShortcuts';

type KeyState = Parameters<typeof resolveGridShortcut>[0];

const key = (overrides: Partial<KeyState> = {}): KeyState => ({
  key: 'Enter',
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('resolveGridShortcut', () => {
  it('Ctrl+Enter inserts a row below the current row', () => {
    expect(resolveGridShortcut(key())).toBe('insert-row-below');
  });

  it('Ctrl+Shift+Enter inserts a row above the current row', () => {
    expect(resolveGridShortcut(key({ shiftKey: true }))).toBe('insert-row-above');
  });

  it('Cmd works as the command modifier for macOS', () => {
    expect(resolveGridShortcut(key({ ctrlKey: false, metaKey: true }))).toBe('insert-row-below');
    expect(
      resolveGridShortcut(key({ ctrlKey: false, metaKey: true, shiftKey: true })),
    ).toBe('insert-row-above');
  });

  it('Ctrl+F opens search, with either case of the key', () => {
    expect(resolveGridShortcut(key({ key: 'f' }))).toBe('open-search');
    expect(resolveGridShortcut(key({ key: 'F' }))).toBe('open-search');
  });

  it('plain Enter and plain F are left to Glide', () => {
    expect(resolveGridShortcut(key({ ctrlKey: false }))).toBeNull();
    expect(resolveGridShortcut(key({ key: 'f', ctrlKey: false }))).toBeNull();
  });

  it('Alt combos and Ctrl+Shift+F are not shortcuts', () => {
    expect(resolveGridShortcut(key({ altKey: true }))).toBeNull();
    expect(resolveGridShortcut(key({ key: 'f', altKey: true }))).toBeNull();
    expect(resolveGridShortcut(key({ key: 'f', shiftKey: true }))).toBeNull();
  });

  it('unrelated keys return null', () => {
    expect(resolveGridShortcut(key({ key: 'a' }))).toBeNull();
    expect(resolveGridShortcut(key({ key: 'Escape' }))).toBeNull();
    expect(resolveGridShortcut(key({ key: 'Delete', shiftKey: true }))).toBeNull();
  });
});
