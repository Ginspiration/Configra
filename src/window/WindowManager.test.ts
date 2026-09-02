import { describe, expect, it, vi } from 'vitest';
import { rankManagedWindows, type ManagedWindow } from './WindowManager';

const managedWindow = (id: string, zIndex: number): ManagedWindow => ({
  id,
  label: id,
  minimized: false,
  zIndex,
  toggle: vi.fn(),
  close: vi.fn(),
});

describe('rankManagedWindows', () => {
  it('moves the raised window to the front and compacts every rank', () => {
    const ranked = rankManagedWindows(
      [managedWindow('middle', 20), managedWindow('back', 4), managedWindow('front', 99)],
      'back',
    );

    expect(ranked.map((window) => [window.id, window.zIndex])).toEqual([
      ['middle', 1],
      ['front', 2],
      ['back', 3],
    ]);
  });

  it('puts a newly registered window at the front without growing the rank range', () => {
    const existing = [managedWindow('back', 1), managedWindow('front', 2)];
    const ranked = rankManagedWindows([...existing, managedWindow('new', 0)], 'new');

    expect(ranked.map((window) => [window.id, window.zIndex])).toEqual([
      ['back', 1],
      ['front', 2],
      ['new', 3],
    ]);
  });

  it('keeps ranks bounded after repeated raises', () => {
    let ranked = [managedWindow('one', 1), managedWindow('two', 2), managedWindow('three', 3)];

    for (let index = 0; index < 100; index += 1) {
      ranked = rankManagedWindows(ranked, index % 2 === 0 ? 'one' : 'two');
    }

    expect(ranked.map((window) => window.zIndex)).toEqual([1, 2, 3]);
    expect(Math.max(...ranked.map((window) => window.zIndex))).toBe(ranked.length);
  });
});
