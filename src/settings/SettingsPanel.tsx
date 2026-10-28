import { useEffect, useRef, useState } from 'react';
import type { McpStatus } from '../file/desktopProjectFile';
import type { PublishSettings } from './publishSettings';
import type { ReleaseProfilesSummary } from '../release/releaseProfiles';
import WindowFrame from '../window/WindowFrame';
import {
  languageLabels,
  type Language,
  type Translator,
} from '../i18n';
import type { ThemePreference } from '../theme';

export type SettingsCategory = 'interface' | 'publish' | 'mcp';

type SettingsPanelProps = {
  open: boolean;
  initialCategory?: SettingsCategory;
  language: Language;
  themePreference: ThemePreference;
  showMiniMap: boolean;
  desktopAvailable: boolean;
  releaseProfiles: ReleaseProfilesSummary;
  publishSettings: PublishSettings;
  mcpBusy: boolean;
  mcpStatus?: McpStatus;
  showMcpLog: boolean;
  onClose(): void;
  onLanguageChange(language: Language): void;
  onThemePreferenceChange(themePreference: ThemePreference): void;
  onMiniMapChange(show: boolean): void;
  onReleaseProfileSelect(profileId: string): void;
  onReleaseProfileCreate(): void;
  onReleaseProfileDuplicate(profileId: string): void;
  onReleaseProfileRename(profileId: string, name: string): void;
  onReleaseProfileModeChange(profileId: string, mode: 'all' | 'selected'): void;
  onReleaseProfileDelete(profileId: string): void;
  onPublishEnabledChange(enabled: boolean): void | Promise<void>;
  onPublishDirectoryPick(profileId: string): void | Promise<void>;
  onPublishDirectoryClear(profileId: string): void;
  onPublishNow(profileId: string): void | Promise<void>;
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
  initialCategory,
  language,
  themePreference,
  showMiniMap,
  desktopAvailable,
  releaseProfiles,
  publishSettings,
  mcpBusy,
  mcpStatus,
  showMcpLog,
  onClose,
  onLanguageChange,
  onThemePreferenceChange,
  onMiniMapChange,
  onReleaseProfileSelect,
  onReleaseProfileCreate,
  onReleaseProfileDuplicate,
  onReleaseProfileRename,
  onReleaseProfileModeChange,
  onReleaseProfileDelete,
  onPublishEnabledChange,
  onPublishDirectoryPick,
  onPublishDirectoryClear,
  onPublishNow,
  onMcpEnabledChange,
  onMcpRestart,
  onMcpPortChange,
  onMcpPortReset,
  onMcpFullAccessChange,
  onMcpLogVisibilityChange,
  onCopyMcpAddress,
  t,
}: SettingsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('interface');
  const [mcpPortInput, setMcpPortInput] = useState('');
  const [mcpPortDirty, setMcpPortDirty] = useState(false);
  const [renamingProfileId, setRenamingProfileId] = useState<string>();
  const [renameDraft, setRenameDraft] = useState('');
  const renameDoneRef = useRef(false);

  useEffect(() => {
    if (open && initialCategory) setActiveCategory(initialCategory);
  }, [initialCategory, open]);

  const startRename = (profileId: string, name: string) => {
    renameDoneRef.current = false;
    setRenamingProfileId(profileId);
    setRenameDraft(name);
  };

  // Enter/blur 提交、Esc 取消；ref 防止 Enter 后卸载触发的 blur 重复提交。
  const finishRename = (commit: boolean) => {
    if (renameDoneRef.current) return;
    renameDoneRef.current = true;
    const profileId = renamingProfileId;
    const name = renameDraft.trim();
    setRenamingProfileId(undefined);
    if (commit && profileId && name) onReleaseProfileRename(profileId, name);
  };

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
    <WindowFrame
      className="settings-panel"
      title={t('settings')}
      subtitle={t('settingsDescription')}
      closeOnBackdropClick
      onClose={onClose}
      t={t}
    >
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
              className={activeCategory === 'publish' ? 'is-active' : ''}
              onClick={() => setActiveCategory('publish')}
            >
              <strong>{t('settingsPublish')}</strong>
              <span>{t('settingsPublishNavDescription')}</span>
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
            ) : activeCategory === 'publish' ? (
              <section className="settings-section">
                <div className="settings-section__heading">
                  <h3>{t('settingsPublish')}</h3>
                  <p>{t('settingsReleaseProfilesDescription')}</p>
                </div>

                {!desktopAvailable ? (
                  <div className="settings-notice">{t('publishDesktopOnly')}</div>
                ) : null}

                <div className="settings-release-profiles">
                  <div className="settings-release-profiles__heading">
                    <div>
                      <strong>{t('releaseProfiles')}</strong>
                      <span>{t('releaseProfileSwitchHint')}</span>
                    </div>
                    <button type="button" className="button" onClick={onReleaseProfileCreate}>
                      {t('releaseProfileCreate')}
                    </button>
                  </div>

                  {releaseProfiles.profiles.map((profile) => {
                    const active = profile.id === releaseProfiles.activeProfileId;
                    const directory = publishSettings.directories[profile.id];
                    return (
                      <div
                        key={profile.id}
                        className={`settings-release-profile ${active ? 'is-active' : ''}`}
                      >
                        <div className="settings-release-profile__header">
                          <button
                            type="button"
                            className="settings-release-profile__select"
                            title={t('releaseProfileActiveHint')}
                            onClick={() => onReleaseProfileSelect(profile.id)}
                          >
                            <span
                              className={`settings-release-profile__dot ${active ? 'is-active' : ''}`}
                              aria-hidden="true"
                            />
                            <strong>{profile.name}</strong>
                            <span
                              className={`settings-release-profile__mode ${
                                profile.mode === 'all' ? 'is-all' : ''
                              }`}
                            >
                              {profile.mode === 'all'
                                ? t('releaseProfileAll')
                                : t('releaseProfileSelected')}
                            </span>
                            {active ? (
                              <span className="settings-release-profile__active">
                                {t('releaseProfileActive')}
                              </span>
                            ) : null}
                          </button>
                          <div className="settings-release-profile__header-actions">
                            <button
                              type="button"
                              className="button"
                              onClick={() => onReleaseProfileDuplicate(profile.id)}
                            >
                              {t('releaseProfileDuplicate')}
                            </button>
                            <button
                              type="button"
                              className="button"
                              onClick={() => startRename(profile.id, profile.name)}
                            >
                              {t('releaseProfileRename')}
                            </button>
                            <button
                              type="button"
                              className="button"
                              disabled={releaseProfiles.profiles.length <= 1}
                              onClick={() => onReleaseProfileDelete(profile.id)}
                            >
                              {t('releaseProfileDelete')}
                            </button>
                          </div>
                        </div>

                        {renamingProfileId === profile.id ? (
                          <input
                            className="settings-release-profile__rename-input"
                            autoFocus
                            value={renameDraft}
                            aria-label={t('releaseProfileName')}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                finishRename(true);
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                finishRename(false);
                              }
                            }}
                            onBlur={() => finishRename(true)}
                          />
                        ) : null}

                        <div className="settings-release-profile__row">
                          <span className="settings-release-profile__label">
                            {t('releaseProfileMode')}
                          </span>
                          <select
                            className="settings-release-profile__mode-select"
                            value={profile.mode}
                            aria-label={t('releaseProfileMode')}
                            onChange={(event) =>
                              onReleaseProfileModeChange(
                                profile.id,
                                event.target.value as 'all' | 'selected',
                              )
                            }
                          >
                            <option value="all">{t('releaseProfileAll')}</option>
                            <option value="selected">{t('releaseProfileSelected')}</option>
                          </select>
                          <span className="settings-release-profile__summary">
                            {t('releaseProfileSummary', {
                              tables: profile.tableCount,
                              rows: profile.rowCount,
                            })}
                          </span>
                        </div>

                        <div className="settings-release-profile__row">
                          <span className="settings-release-profile__label">
                            {t('publishDirectory')}
                          </span>
                          <span
                            className={`settings-release-profile__directory ${
                              directory ? '' : 'is-empty'
                            }`}
                            title={directory ?? undefined}
                          >
                            {directory || t('publishDirectoryNotSet')}
                          </span>
                          <div className="settings-release-profile__directory-actions">
                            <button
                              type="button"
                              className="button"
                              disabled={!desktopAvailable}
                              title={t('releaseProfilePublishHintNoDirectory')}
                              onClick={() => void onPublishDirectoryPick(profile.id)}
                            >
                              {t('publishDirectoryChoose')}
                            </button>
                            <button
                              type="button"
                              className="button"
                              disabled={!desktopAvailable || !directory}
                              onClick={() => onPublishDirectoryClear(profile.id)}
                            >
                              {t('publishDirectoryClear')}
                            </button>
                          </div>
                        </div>

                        <div className="settings-release-profile__publish-row">
                          <span className="settings-release-profile__publish-hint">
                            {directory
                              ? t('releaseProfilePublishHintSet')
                              : t('releaseProfilePublishHintNoDirectory')}
                          </span>
                          <button
                            type="button"
                            className="button button--primary"
                            disabled={!desktopAvailable || !directory}
                            title={
                              directory
                                ? t('releaseProfilePublishDescription')
                                : t('releaseProfilePublishHintNoDirectory')
                            }
                            onClick={() => void onPublishNow(profile.id)}
                          >
                            {t('releaseProfilePublish')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="settings-row">
                  <div className="settings-row__copy">
                    <strong>{t('autoPublish')}</strong>
                    <span>{t('autoPublishDescription')}</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={publishSettings.enabled}
                      disabled={!desktopAvailable}
                      onChange={(event) => {
                        void onPublishEnabledChange(event.target.checked);
                      }}
                    />
                    <span aria-hidden="true" />
                  </label>
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
    </WindowFrame>
  );
}
