import { useEffect, useMemo, useRef } from 'react';

export type ContextMenuItem =
  | {
      type?: 'item';
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect(): void | Promise<void>;
    }
  | {
      id: string;
      type: 'label' | 'separator';
      label?: string;
    };

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose(): void;
};

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useMemo(() => {
    const menuWidth = 230;
    const rowHeight = 30;
    const estimatedHeight = Math.max(40, items.length * rowHeight + 12);

    return {
      left: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8)),
    };
  }, [items.length, x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const menuElement = menuRef.current;
      if (event.target instanceof Node && menuElement?.contains(event.target)) return;
      onClose();
    };
    const close = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={position}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.id} className="context-menu__separator" role="separator" />;
        }

        if (item.type === 'label') {
          return (
            <div key={item.id} className="context-menu__label">
              {item.label}
            </div>
          );
        }

        if (!('onSelect' in item)) return null;

        return (
          <button
            key={item.id}
            type="button"
            className={`context-menu__item ${item.danger ? 'is-danger' : ''}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              onClose();
              void item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
