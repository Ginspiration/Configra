import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ContextMenuItem } from '../contextMenu/ContextMenu';

type AppMenuProps = {
  open: boolean;
  items: ContextMenuItem[];
  label: string;
  onOpenChange(open: boolean): void;
};

export default function AppMenu({ open, items, label, onOpenChange }: AppMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const focusMenuButton = (position: 'first' | 'last') => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    const button = position === 'first' ? buttons[0] : buttons[buttons.length - 1];
    button?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => focusMenuButton('first'));
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onOpenChange]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    if (buttons.length === 0) return;

    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | undefined;

    if (event.key === 'ArrowDown') nextIndex = (activeIndex + 1) % buttons.length;
    if (event.key === 'ArrowUp') nextIndex = (activeIndex - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;

    if (nextIndex === undefined) return;
    event.preventDefault();
    buttons[nextIndex].focus();
  };

  return (
    <div ref={rootRef} className="app-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`button app-menu__trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          if (!open) onOpenChange(true);
          window.requestAnimationFrame(() => focusMenuButton('first'));
        }}
      >
        <span className="app-menu__icon" aria-hidden="true">☰</span>
        <span>{label}</span>
      </button>

      {open ? (
        <div ref={menuRef} className="app-menu__popup" role="menu" onKeyDown={handleMenuKeyDown}>
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
                  onOpenChange(false);
                  void item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
