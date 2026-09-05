export type GridShortcutAction = 'insert-row-below' | 'insert-row-above' | 'open-search';

type GridShortcutKeyState = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** 把网格按键解析为行编辑器快捷键动作；不匹配时返回 null，交给 Glide 默认处理。 */
export function resolveGridShortcut(event: GridShortcutKeyState): GridShortcutAction | null {
  if (event.altKey) return null;

  const command = event.ctrlKey || event.metaKey;
  if (!command) return null;

  if (event.key === 'Enter') {
    return event.shiftKey ? 'insert-row-above' : 'insert-row-below';
  }

  if (!event.shiftKey && (event.key === 'f' || event.key === 'F')) {
    return 'open-search';
  }

  return null;
}
