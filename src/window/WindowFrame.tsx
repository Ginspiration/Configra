import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { Translator } from '../i18n';
import { useWindowManager } from './WindowManager';

type WindowFrameProps = {
  /** 任务栏中的窗口唯一 ID；省略时自动生成。同一窗口实例必须传稳定 ID。 */
  windowId?: string;
  /** 标题栏主标题，显示在窗口标题栏与任务栏按钮上。 */
  title: ReactNode;
  /** 标题栏副标题（可省略）。 */
  subtitle?: ReactNode;
  /** 附加在窗口面板上的样式类（保留各弹窗的尺寸/布局样式）。 */
  className?: string;
  /** 标题栏右侧、窗口控制按钮之前的自定义按钮。 */
  actions?: ReactNode;
  /** 是否模态：模态时渲染全屏遮罩，非模态时窗口浮动显示。 */
  modal?: boolean;
  /** 点击遮罩空白处是否关闭窗口。 */
  closeOnBackdropClick?: boolean;
  /** 窗口面板自身的右键菜单处理（非模态窗口使用）。 */
  onContextMenu?(event: ReactMouseEvent): void;
  onClose(): void;
  t: Translator;
  /** 受控最小化状态（配合 onMinimizeChange 使用）。 */
  minimized?: boolean;
  onMinimizeChange?(minimized: boolean): void;
  children: ReactNode;
};

type DragState = {
  startX: number;
  startY: number;
  x: number;
  y: number;
};

export default function WindowFrame({
  windowId: windowIdProp,
  title,
  subtitle,
  className = '',
  actions,
  modal = true,
  closeOnBackdropClick = false,
  onContextMenu,
  onClose,
  t,
  minimized: minimizedProp,
  onMinimizeChange,
  children,
}: WindowFrameProps) {
  const generatedId = useId();
  const windowId = windowIdProp ?? generatedId;
  const { register, unregister, update, raise, isFront, zIndexOf } = useWindowManager();
  // 遮罩层基线 30（与 app.css 的 .window-backdrop 一致），再叠加窗口自身的层叠顺序。
  const stackedZIndex = useMemo(() => {
    const zIndex = zIndexOf(windowId);
    return zIndex !== undefined ? 30 + zIndex : undefined;
  }, [windowId, zIndexOf]);

  const [innerMinimized, setInnerMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState>();

  const minimized = minimizedProp ?? innerMinimized;
  const lastLabelRef = useRef('');
  const setMinimized = useCallback(
    (next: boolean) => {
      if (onMinimizeChange) {
        onMinimizeChange(next);
      } else {
        setInnerMinimized(next);
      }
    },
    [onMinimizeChange],
  );

  const minimizeWindow = useCallback(() => {
    setMinimized(true);
  }, [setMinimized]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((value) => !value);
  }, []);

  // 任务栏回调始终指向最新状态/函数。点击语义与系统任务栏一致：
  // 最小化时恢复并提升到前台；已是最前面的窗口则最小化；被其他窗口遮挡时提升到前台。
  const toggleRef = useRef<() => void>(() => undefined);
  toggleRef.current = () => {
    if (minimized) {
      setMinimized(false);
      raise(windowId);
    } else if (isFront(windowId)) {
      setMinimized(true);
    } else {
      raise(windowId);
    }
  };
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    register(windowId, {
      label: titleRef.current?.textContent?.trim() ?? '',
      minimized,
      toggle: () => toggleRef.current(),
      close: () => closeRef.current(),
    });
    return () => unregister(windowId);
  }, [register, unregister, windowId]);

  // 每次渲染后同步标题与最小化状态到任务栏（值不变时不触发重渲染）。
  // 标题栏卸载（最小化）后保留最后一次非空标题，任务栏按钮不丢失表名。
  useEffect(() => {
    const label = titleRef.current?.textContent?.trim() ?? '';
    if (label) lastLabelRef.current = label;
    update(windowId, {
      label: lastLabelRef.current,
      minimized,
    });
  });

  const startDrag = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0 || isFullscreen) return;
      const target = event.target as HTMLElement;
      if (target.closest('button, select, input, a, [contenteditable="true"]')) return;

      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;

      event.preventDefault();
      dragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        x: rect.left,
        y: rect.top,
      };

      const onMove = (moveEvent: MouseEvent) => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const currentRect = panelRef.current?.getBoundingClientRect();
        const width = currentRect?.width ?? 0;
        const height = currentRect?.height ?? 0;
        const maxX = Math.max(0, window.innerWidth - Math.min(width, window.innerWidth - 60));
        const maxY = Math.max(0, window.innerHeight - Math.min(height, window.innerHeight - 44));
        setPosition({
          x: Math.min(Math.max(0, drag.x + moveEvent.clientX - drag.startX), maxX),
          y: Math.min(Math.max(0, drag.y + moveEvent.clientY - drag.startY), maxY),
        });
      };
      const onUp = () => {
        dragStateRef.current = undefined;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [isFullscreen],
  );

  const onTitleBarDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, select, input, a')) return;
      toggleFullscreen();
    },
    [toggleFullscreen],
  );

  // 点击模态遮罩（窗口面板外）的语义，与桌面窗口管理器一致：
  // 点到其他窗口的面板 → 把该窗口置顶（切换到它）；
  // 点到主界面区域 → 对话框（如设置/预览）关闭，其余窗口最小化以回到主界面。
  const onBackdropMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (event.target !== event.currentTarget) return;
      const point = { x: event.clientX, y: event.clientY };

      let targetId: string | undefined;
      let targetZIndex = -1;
      for (const frame of document.querySelectorAll<HTMLElement>('[data-window-id]')) {
        if (frame.dataset.windowId === windowId) continue;
        const rect = frame.getBoundingClientRect();
        if (
          point.x < rect.left ||
          point.x > rect.right ||
          point.y < rect.top ||
          point.y > rect.bottom
        ) {
          continue;
        }
        const frameZIndex = Number(frame.style.zIndex) || 0;
        if (frameZIndex > targetZIndex) {
          targetZIndex = frameZIndex;
          targetId = frame.dataset.windowId;
        }
      }

      if (targetId) {
        raise(targetId);
        return;
      }

      if (closeOnBackdropClick) {
        onClose();
        return;
      }
      minimizeWindow();
    },
    [closeOnBackdropClick, minimizeWindow, onClose, raise, windowId],
  );

  const panelStyle: CSSProperties | undefined = useMemo(() => {
    const style: CSSProperties = {};
    if (position) Object.assign(style, { left: position.x, top: position.y });
    if (stackedZIndex !== undefined) style.zIndex = stackedZIndex;
    return Object.keys(style).length > 0 ? style : undefined;
  }, [position, stackedZIndex]);

  const panel = (
    <section
      ref={panelRef}
      data-window-id={windowId}
      className={`window-frame ${className} ${isFullscreen ? 'is-fullscreen' : ''} ${position ? 'is-dragged' : ''}`}
      style={panelStyle}
      role="dialog"
      aria-modal={modal}
      onContextMenu={onContextMenu}
    >
      <header
        className="window-frame__titlebar"
        onMouseDown={startDrag}
        onDoubleClick={onTitleBarDoubleClick}
      >
        <div ref={titleRef} className="window-frame__title">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="window-frame__controls">
          {actions}
          <button
            type="button"
            className="icon-button icon-button--compact"
            onClick={minimizeWindow}
            aria-label={t('minimizeWindow')}
            title={t('minimizeWindow')}
          >
            −
          </button>
          <button
            type="button"
            className="icon-button icon-button--compact"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
            title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
          >
            {isFullscreen ? '⇲' : '⛶'}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            ×
          </button>
        </div>
      </header>
      {children}
    </section>
  );

  if (!modal) {
    return minimized ? null : panel;
  }

  return (
    <div
      className={`window-backdrop ${isFullscreen ? 'is-fullscreen' : ''} ${minimized ? 'is-minimized' : ''}`}
      style={stackedZIndex !== undefined ? { zIndex: stackedZIndex } : undefined}
      role="presentation"
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={onBackdropMouseDown}
    >
      {minimized ? null : panel}
    </div>
  );
}
