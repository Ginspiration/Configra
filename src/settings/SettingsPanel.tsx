import { useEffect, useState } from 'react';
import type { McpStatus } from '../file/desktopProjectFile';
import {
  languageLabels,
  type Language,
  type Translator,
} from '../i18n';
import type { ThemePreference } from '../theme';

type SettingsPanelProps = {
  open: boolean;
  language: Language;
  themePreference: ThemePreference;
  showMiniMap: boolean;
  desktopAvailable: boolean;
  mcpBusy: boolean;
  mcpStatus?: McpStatus;
  showMcpLog: boolean;
  onClose(): void;
  onLanguageChange(language: Language): void;
  onThemePreferenceChange(themePreference: ThemePreference): void;
  onMiniMapChange(show: boolean): void;
  onMcpEnabledChange(enabled: boolean): void;
  onMcpRestart(): void;
  onMcpPortChange(port: number): Promise<boolean>;
  onMcpPortReset(): Promise<boolean>;
  onMcpFullAccessChange(fullAccess: boolean): void;
  onMcpLogVisibilityChange(show: boolean): void;
  onCopyMcpAddress(): void;
  t: Translator;
};

export default function SettingsPanel({
  open,
  language,
  themePreference,
  showMiniMap,
  desktopAvailable,
  mcpBusy,
  mcpStatus,
  showMcpLog,
  onClose,
  onLanguageChange,
  onThemePreferenceChange,
  onMiniMapChange,
  onMcpEnabledChange,
  onMcpRestart,
  onMcpPortChange,
  onMcpPortReset,
  onMcpFullAccessChange,
  onMcpLogVisibilityChange,
  onCopyMcpAddress,
  t,
}: SettingsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<'interface' | 'mcp'>('interface');
  const [mcpPortInput, setMcpPortInput] = useState('');
  const [mcpPortDirty, setMcpPortDirty] = useState(false);

  useEffect(() => {
    if (!open) {
      setMcpPortDirty(false);
      return;
    }
    if (!mcpPortDirty && mcpStatus) {
      setMcpPortInput(String(mcpStatus.port));
    }
  }, [mcpPortDirty, mcpStatus, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const mcpRunning = mcpStatus?.running ?? false;
  const parsedMcpPort = Number(mcpPortInput);
  const mcpPortValid =
    /^\d+$/.test(mcpPortInput.trim()) &&
    Number.isInteger(parsedMcpPort) &&
    parsedMcpPort >= 1 &&
    parsedMcpPort <= 65535;
  const mcpPortChanged = mcpPortValid && parsedMcpPort !== mcpStatus?.port;
  const mcpDefaultPort = mcpStatus?.defaultPort;
  const applyMcpPort = async () => {
    if (!mcpPortChanged) return;
    if (await onMcpPortChange(parsedMcpPort)) setMcpPortDirty(false);
  };
  const restoreDefaultMcpPort = async () => {
    if (mcpDefaultPort === undefined) return;
    if (await onMcpPortReset()) {
      setMcpPortInput(String(mcpDefaultPort));
      setMcpPortDirty(false);
    }
  };

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-panel__header">
          <div>
            <h2 id="settings-title">{t('settings')}</h2>
            <p>{t('settingsDescription')}</p>
          </div>
          <button
            type="button"
            className="settings-panel__close"
            aria-label={t('closeSettings')}
            title={t('closeSettings')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-panel__body">
          <nav className="settings-categories" aria-label={t('settingsCategories')}>
            <span className="settings-categories__label">{t('settingsCategories')}</span>
            <button
              type="button"
              className={activeCategory === 'interface' ? 'is-active' : ''}
              onClick={() => setActiveCategory('interface')}
            >
              <strong>{t('settingsInterface')}</strong>
              <span>{t('settingsInterfaceNavDescription')}</span>
            </button>
            <button
              type="button"
              className={activeCategory === 'mcp' ? 'is-active' : ''}
              onClick={() => setActiveCategory('mcp')}
            >
              <strong>{t('settingsMcp')}</strong>
              <span>{t('settingsMcpNavDescription')}</span>
            </button>
          </nav>

          <div className="settings-content">
            {activeCategory === 'interface' ? (
              <section className="settings-section">
                <div className="settings-section__heading">
                  <h3>{t('settingsInterface')}</h3>
                  <p>{t('settingsInterfaceDescription')}</p>
                </div>

                <div className="settings-row">
                  <div className="settings-row__copy">
                    <strong>{t('theme')}</strong>
                    <span>{t('settingsThemeDescription')}</span>
                  </div>
                  <select
                    className="settings-theme-select"
                    value={themePreference}
                    aria-label={t('theme')}
                    onChange={(event) => onThemePreferenceChange(event.target.value as ThemePreference)}
                  >
                    <option value="system">{t('themeSystem')}</option>
                    <option value="light">{t('themeLight')}</option>
                    <option value="dark">{t('themeDark')}</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row__copy">
                    <strong>{t('miniMap')}</strong>
                    <span>{t('settingsMiniMapDescription')}</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={showMiniMap}
                      onChange={(event) => onMiniMapChange(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <div className="settings-row">
                  <div className="settings-row__copy">
                    <strong>{t('language')}</strong>
                    <span>{t('settingsLanguageDescription')}</span>
                  </div>
                  <select
                    className="settings-language-select"
                    value={language}
                    aria-label={t('language')}
                    onChange={(event) => onLanguageChange(event.target.value as Language)}
                  >
                    {Object.entries(languageLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            ) : (
              <section className="settings-section">
                <div className="settings-section__heading settings-section__heading--status">
                  <div>
                    <h3>{t('settingsMcp')}</h3>
                    <p>{t('settingsMcpDescription')}</p>
                  </div>
                  <span className={`settings-status ${mcpRunning ? 'is-running' : ''}`}>
                    <i aria-hidden="true" />
                    {mcpRunning ? t('settingsMcpRunning') : t('settingsMcpStopped')}
                  </span>
                </div>

                {!desktopAvailable ? (
                  <div className="settings-notice">{t('mcpDesktopOnly')}</div>
                ) : null}
                {mcpStatus?.error ? (
                  <div className="settings-notice settings-notice--error">{mcpStatus.error}</div>
                ) : null}

                <div className="settings-row">
                  <div className="settings-row__copy">
                    <strong>{t('settingsMcpService')}</strong>
                    <span>{t('settingsMcpServiceDescription')}</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={mcpStatus?.enabled ?? false}
                      disabled={!desktopAvailable || mcpBusy}
                      onChange={(event) => onMcpEnabledChange(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <div className="settings-row settings-row--port">
                  <div className="settings-row__copy">
                    <strong>{t('settingsMcpPort')}</strong>
                    <span>
                      {t('settingsMcpPortDescription', { port: mcpDefaultPort ?? '—' })}
                    </span>
                  </div>
                  <div className="settings-port-control">
                    <div className="settings-port-control__input-row">
                      <input
                        type="number"
                        className="settings-port-input"
                        min={1}
                        max={65535}
                        step={1}
                        inputMode="numeric"
                        value={mcpPortInput}
                        disabled={!desktopAvailable || mcpBusy || !mcpStatus}
                        aria-label={t('settingsMcpPort')}
                        aria-invalid={mcpPortDirty && !mcpPortValid}
                        onChange={(event) => {
                          setMcpPortInput(event.target.value);
                          setMcpPortDirty(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && mcpPortChanged && !mcpBusy) {
                            event.preventDefault();
                            void applyMcpPort();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="button settings-port-reset"
                        disabled={
                          !desktopAvailable ||
                          mcpBusy ||
                          mcpDefaultPort === undefined ||
                          (!mcpPortDirty && mcpStatus?.port === mcpDefaultPort)
                        }
                        title={t('settingsMcpPortResetTitle', {
                          port: mcpDefaultPort ?? '—',
                        })}
                        onClick={() => void restoreDefaultMcpPort()}
                      >
                        {t('settingsMcpPortReset')}
                      </button>
                      <button
                        type="button"
                        className="button button--primary settings-port-apply"
                        disabled={!desktopAvailable || mcpBusy || !mcpPortChanged}
                        onClick={() => void applyMcpPort()}
                      >
                        {t('settingsMcpPortApply')}
                      </button>
                    </div>
                    {mcpPortDirty && !mcpPortValid ? (
                      <span className="settings-port-error">{t('settingsMcpPortInvalid')}</span>
                    ) : null}
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row__copy">
                    <strong>{t('settingsMcpLog')}</strong>
                    <span>{t('settingsMcpLogDescription')}</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={showMcpLog}
                      disabled={!mcpStatus?.enabled}
                      onChange={(event) => onMcpLogVisibilityChange(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <div className={`settings-row ${mcpStatus?.fullAccess ? 'is-warning' : ''}`}>
                  <div className="settings-row__copy">
                    <strong>{t('mcpFullAccess')}</strong>
                    <span>{t('mcpFullAccessTitle')}</span>
                  </div>
                  <label className="settings-switch settings-switch--warning">
                    <input
                      type="checkbox"
                      checked={mcpStatus?.fullAccess ?? false}
                      disabled={!desktopAvailable || mcpBusy || !mcpStatus}
                      onChange={(event) => onMcpFullAccessChange(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <div className="settings-connection">
                  <div>
                    <strong>{t('settingsMcpConnection')}</strong>
                    <span>
                      {mcpStatus ? `127.0.0.1:${mcpStatus.port}` : t('settingsMcpUnavailable')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button"
                    disabled={!mcpStatus?.enabled || mcpBusy}
                    onClick={onMcpRestart}
                  >
                    {t('settingsMcpRestart')}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!mcpRunning || mcpBusy}
                    onClick={onCopyMcpAddress}
                  >
                    {t('copyMcpAddress')}
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
