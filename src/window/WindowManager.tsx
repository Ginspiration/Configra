import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ManagedWindow = {
  id: string;
  label: string;
  minimized: boolean;
  /** 层叠顺序：数值越大越靠前；由注册顺序和“提升到前台”操作共同决定。 */
  zIndex: number;
  toggle(): void;
  close(): void;
};

export function rankManagedWindows(
  windows: ManagedWindow[],
  frontWindowId?: string,
): ManagedWindow[] {
  const ordered = [...windows].sort((left, right) => left.zIndex - right.zIndex);
  const frontIndex = frontWindowId
    ? ordered.findIndex((window) => window.id === frontWindowId)
    : -1;

  if (frontIndex >= 0) {
    ordered.push(...ordered.splice(frontIndex, 1));
  }

  const unchanged = ordered.every(
    (window, index) => windows[index] === window && window.zIndex === index + 1,
  );
  if (unchanged) return windows;

  return ordered.map((window, index) =>
    window.zIndex === index + 1 ? window : { ...window, zIndex: index + 1 },
  );
}

type WindowManagerContextValue = {
  register(id: string, window: Omit<ManagedWindow, 'id' | 'zIndex'>): void;
  unregister(id: string): void;
  update(id: string, patch: Partial<Omit<ManagedWindow, 'id' | 'toggle' | 'close' | 'zIndex'>>): void;
  /** 恢复（取消最小化）并提升到前台，供外部（如重新打开同一窗口）调用。 */
  restore(id: string): void;
  /** 把窗口提升到前台（提高其层叠顺序）。 */
  raise(id: string): void;
  /** 判断窗口是否为当前最前面的非最小化窗口（任务栏按钮点击语义使用）。 */
  isFront(id: string): boolean;
  /** 查询窗口的层叠顺序；未注册时返回 undefined。 */
  zIndexOf(id: string): number | undefined;
  /** 当前注册窗口的只读镜像；用于“主界面是否被浮窗遮挡”之类的全局判断。 */
  windows: readonly ManagedWindow[];
};

const WindowManagerContext = createContext<WindowManagerContextValue>({
  register: () => undefined,
  unregister: () => undefined,
  update: () => undefined,
  restore: () => undefined,
  raise: () => undefined,
  isFront: () => false,
  zIndexOf: () => undefined,
  windows: [],
});

export function useWindowManager(): WindowManagerContextValue {
  return useContext(WindowManagerContext);
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<ManagedWindow[]>([]);

  const register = useCallback((id: string, entry: Omit<ManagedWindow, 'id' | 'zIndex'>) => {
    setWindows((prev) => {
      if (prev.some((window) => window.id === id)) return prev;
      return rankManagedWindows([...prev, { id, ...entry, zIndex: 0 }], id);
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setWindows((prev) => rankManagedWindows(prev.filter((window) => window.id !== id)));
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<Omit<ManagedWindow, 'id' | 'toggle' | 'close' | 'zIndex'>>) => {
      setWindows((prev) => {
        const target = prev.find((window) => window.id === id);
        if (!target) return prev;
        const next = { ...target, ...patch };
        if (next.label === target.label && next.minimized === target.minimized) return prev;
        return prev.map((window) => (window.id === id ? next : window));
      });
    },
    [],
  );

  const raise = useCallback((id: string) => {
    setWindows((prev) => {
      if (!prev.some((window) => window.id === id)) return prev;
      return rankManagedWindows(prev, id);
    });
  }, []);

  const isFront = useCallback(
    (id: string) => {
      const visible = windows.filter((window) => !window.minimized);
      if (visible.length === 0) return false;
      const frontZIndex = visible.reduce((max, window) => Math.max(max, window.zIndex), 0);
      return visible.some((window) => window.id === id && window.zIndex === frontZIndex);
    },
    [windows],
  );

  const zIndexOf = useCallback(
    (id: string) => windows.find((window) => window.id === id)?.zIndex,
    [windows],
  );

  // 最小化状态由窗口组件自身持有，这里只按镜像状态决定动作：
  // 最小化时触发组件侧恢复并提升层级，否则直接把窗口提升到前台。
  const restore = useCallback(
    (id: string) => {
      const window = windows.find((entry) => entry.id === id);
      if (!window) return;
      if (window.minimized) {
        window.toggle();
      } else {
        raise(id);
      }
    },
    [raise, windows],
  );

  const value = useMemo(
    () => ({ register, unregister, update, restore, raise, isFront, zIndexOf, windows }),
    [isFront, raise, register, restore, unregister, update, windows, zIndexOf],
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
      <WindowTaskbar windows={windows} />
    </WindowManagerContext.Provider>
  );
}

function WindowTaskbar({ windows }: { windows: ManagedWindow[] }) {
  const itemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.toggle('has-taskbar', windows.length > 0);
    return () => document.body.classList.remove('has-taskbar');
  }, [windows.length]);

  if (windows.length === 0) return null;

  return (
    <div className="window-taskbar">
      <div
        ref={itemsRef}
        className="window-taskbar__items"
        role="toolbar"
        aria-label="Taskbar"
      >
        {windows.map((window) => (
          <button
            key={window.id}
            type="button"
            className={`window-taskbar__item ${window.minimized ? 'is-minimized' : ''}`}
            title={window.label}
            onClick={window.toggle}
          >
            <span className="window-taskbar__label">{window.label || '—'}</span>
            <span
              role="button"
              className="window-taskbar__close"
              aria-label="Close"
              title="Close"
              onClick={(event) => {
                event.stopPropagation();
                window.close();
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
