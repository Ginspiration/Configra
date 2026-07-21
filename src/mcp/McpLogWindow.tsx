import { useEffect, useRef } from 'react';
import type { McpLogEntry } from '../file/desktopProjectFile';
import type { Translator } from '../i18n';

type McpLogWindowProps = {
  entries: McpLogEntry[];
  minimized: boolean;
  running: boolean;
  onToggleMinimized(): void;
  t: Translator;
};

const formatLogTime = (timestamp: string) => {
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? timestamp : value.toLocaleTimeString();
};

export default function McpLogWindow({
  entries,
  minimized,
  running,
  onToggleMinimized,
  t,
}: McpLogWindowProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!minimized) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, minimized]);

  const latestEntry = entries[entries.length - 1];

  return (
    <section
      className={`mcp-log-window ${minimized ? 'is-minimized' : ''}`}
      aria-label={t('mcpLogTitle')}
    >
      <header className="mcp-log-window__header">
        <div className="mcp-log-window__title">
          <span className={`mcp-log-window__status ${running ? 'is-running' : ''}`} />
          <strong>{t('mcpLogTitle')}</strong>
          <span>{running ? t('mcpLogConnected') : t('mcpLogStopped')}</span>
        </div>
        <button
          type="button"
          className="mcp-log-window__minimize"
          title={minimized ? t('mcpLogRestore') : t('mcpLogMinimize')}
          aria-label={minimized ? t('mcpLogRestore') : t('mcpLogMinimize')}
          onClick={onToggleMinimized}
        >
          {minimized ? '▢' : '—'}
        </button>
      </header>

      {minimized ? (
        <div className="mcp-log-window__latest">
          {latestEntry?.message ?? t('mcpLogWaiting')}
        </div>
      ) : (
        <div ref={listRef} className="mcp-log-window__entries" aria-live="polite">
          {entries.length === 0 ? (
            <div className="mcp-log-window__empty">{t('mcpLogWaiting')}</div>
          ) : (
            entries.map((entry, index) => (
              <div
                key={`${entry.timestamp}-${entry.requestId ?? 'service'}-${index}`}
                className={`mcp-log-entry mcp-log-entry--${entry.level}`}
              >
                <time>{formatLogTime(entry.timestamp)}</time>
                <span>{entry.message}</span>
                {entry.durationMs !== undefined ? <small>{entry.durationMs} ms</small> : null}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
