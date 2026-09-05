import { useEffect, useMemo } from 'react';
import WindowFrame from '../window/WindowFrame';
import { isDesktopRuntime } from '../file/desktopProjectFile';
import { type TranslationKey, type Translator } from '../i18n';

type ShortcutEntry = {
  keys: string;
  labelKey: TranslationKey;
  /** 仅桌面模式可用的键位（如新窗口打开工程）。 */
  desktopOnly?: boolean;
};

type ShortcutGroup = {
  titleKey: TranslationKey;
  entries: ShortcutEntry[];
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcutsGroupGlobal',
    entries: [
      { keys: 'Ctrl+S / S', labelKey: 'save' },
      { keys: 'Ctrl+O / O', labelKey: 'importProject' },
      { keys: 'Ctrl+Shift+O', labelKey: 'openProject' },
      { keys: 'Ctrl+Shift+N', labelKey: 'newProject' },
      { keys: 'Ctrl+N / N', labelKey: 'newTable' },
      { keys: 'Ctrl+Alt+O', labelKey: 'openProjectInNewWindow', desktopOnly: true },
      { keys: 'F', labelKey: 'addField' },
      { keys: 'R', labelKey: 'edit' },
      { keys: 'C', labelKey: 'copyTableJson' },
      { keys: 'E', labelKey: 'downloadJson' },
      { keys: 'M', labelKey: 'miniMap' },
      { keys: 'Delete', labelKey: 'deleteTable' },
      { keys: '?', labelKey: 'shortcutHelp' },
    ],
  },
  {
    titleKey: 'shortcutsGroupCanvas',
    entries: [
      { keys: '↑ ↓ ← →', labelKey: 'shortcutCanvasPan' },
    ],
  },
  {
    titleKey: 'shortcutsGroupGrid',
    entries: [
      { keys: 'Ctrl+Z', labelKey: 'undo' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', labelKey: 'redo' },
      { keys: 'Ctrl+F', labelKey: 'search' },
      { keys: 'Ctrl+Enter', labelKey: 'insertRowBelow' },
      { keys: 'Ctrl+Shift+Enter', labelKey: 'insertRowAbove' },
      { keys: 'Enter', labelKey: 'shortcutGridEditCell' },
      { keys: 'A-Z 0-9', labelKey: 'shortcutGridEditOnType' },
      { keys: 'Del / ⌫', labelKey: 'shortcutGridDelete' },
      { keys: 'Esc', labelKey: 'shortcutGridCloseWindow' },
    ],
  },
];

type ShortcutCheatSheetProps = {
  open: boolean;
  onClose(): void;
  t: Translator;
};

export default function ShortcutCheatSheet({ open, onClose, t }: ShortcutCheatSheetProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const groups = useMemo(
    () =>
      isDesktopRuntime()
        ? SHORTCUT_GROUPS
        : SHORTCUT_GROUPS.map((group) => ({
            ...group,
            entries: group.entries.filter((entry) => !entry.desktopOnly),
          })),
    [],
  );

  if (!open) return null;

  return (
    <WindowFrame
      className="shortcut-sheet"
      title={t('shortcutHelp')}
      subtitle={t('shortcutHelpDescription')}
      closeOnBackdropClick
      onClose={onClose}
      t={t}
    >
      <div className="shortcut-sheet__body">
        {groups.map((group) => (
          <section key={group.titleKey} className="shortcut-sheet__group">
            <h3>{t(group.titleKey)}</h3>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.keys}>
                  <span>{t(entry.labelKey)}</span>
                  <kbd>{entry.keys}</kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="shortcut-sheet__hint">{t('shortcutSingleKeyHint')}</p>
      </div>
    </WindowFrame>
  );
}
