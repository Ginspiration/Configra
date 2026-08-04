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
  toggle(): void;
  close(): void;
};

type WindowManagerContextValue = {
  register(id: string, window: Omit<ManagedWindow, 'id'>): void;
  unregister(id: string): void;
  update(id: string, patch: Partial<Omit<ManagedWindow, 'id' | 'toggle' | 'close'>>): void;
  /** 恢复（取消最小化）指定窗口，供外部（如重新打开同一窗口）调用。 */
  restore(id: string): void;
};

const WindowManagerContext = createContext<WindowManagerContextValue>({
  register: () => undefined,
  unregister: () => undefined,
  update: () => undefined,
  restore: () => undefined,
});

export function useWindowManager(): WindowManagerContextValue {
  return useContext(WindowManagerContext);
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<ManagedWindow[]>([]);

  const register = useCallback((id: string, entry: Omit<ManagedWindow, 'id'>) => {
    setWindows((prev) =>
      prev.some((window) => window.id === id) ? prev : [...prev, { id, ...entry }],
    );
  }, []);

  const unregister = useCallback((id: string) => {
    setWindows((prev) => prev.filter((window) => window.id !== id));
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<Omit<ManagedWindow, 'id' | 'toggle' | 'close'>>) => {
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

  const restore = useCallback((id: string) => {
    setWindows((prev) =>
      prev.some((window) => window.id === id && window.minimized)
        ? prev.map((window) => (window.id === id ? { ...window, minimized: false } : window))
        : prev,
    );
  }, []);

  const value = useMemo(
    () => ({ register, unregister, update, restore }),
    [register, restore, unregister, update],
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
