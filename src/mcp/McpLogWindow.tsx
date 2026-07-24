import { useEffect, useRef } from 'react';
import type { McpLogEntry } from '../file/desktopProjectFile';
import type { Translator } from '../i18n';

type McpLogWindowProps = {
  entries: McpLogEntry[];
  running: boolean;
  onHide(): void;
  onOpenContextMenu(position: { x: number; y: number }): void;
  t: Translator;
};

const formatLogTime = (timestamp: string) => {
  const numericTimestamp = Number(timestamp);
  const value = new Date(Number.isFinite(numericTimestamp) ? numericTimestamp : timestamp);
  return Number.isNaN(value.getTime()) ? timestamp : value.toLocaleTimeString();
};

export default function McpLogWindow({
  entries,
  running,
  onHide,
  onOpenContextMenu,
  t,
}: McpLogWindowProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries]);

  return (
    <section
      className="mcp-log-window"
      aria-label={t('mcpLogTitle')}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <header className="mcp-log-window__header">
        <div className="mcp-log-window__title">
          <span className={`mcp-log-window__status ${running ? 'is-running' : ''}`} />
          <strong>{t('mcpLogTitle')}</strong>
          <span>{running ? t('mcpLogConnected') : t('mcpLogStopped')}</span>
        </div>
        <button
          type="button"
          className="mcp-log-window__hide"
          title={t('mcpLogHide')}
          aria-label={t('mcpLogHide')}
          onClick={onHide}
        >
          ×
        </button>
      </header>

      <div ref={listRef} className="mcp-log-window__entries" aria-live="polite">
        {entries.length === 0 ? (
          <div className="mcp-log-window__empty">{t('mcpLogWaiting')}</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry.sourceId ?? 'game-config-graph-editor'}-${entry.timestamp}-${entry.requestId ?? 'service'}-${index}`}
              className={`mcp-log-entry mcp-log-entry--${entry.level}`}
            >
              <time>{formatLogTime(entry.timestamp)}</time>
              <span>{entry.message}</span>
              {entry.durationMs !== undefined ? <small>{entry.durationMs} ms</small> : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
