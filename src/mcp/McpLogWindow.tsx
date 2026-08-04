import { useEffect, useRef } from 'react';
import WindowFrame from '../window/WindowFrame';
import type { McpLogEntry } from '../file/desktopProjectFile';
import type { Translator } from '../i18n';

type McpLogWindowProps = {
  entries: McpLogEntry[];
  expanded: boolean;
  running: boolean;
  onMinimize(): void;
  onRestore(): void;
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
  expanded,
  running,
  onMinimize,
  onRestore,
  onOpenContextMenu,
  t,
}: McpLogWindowProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries]);

  return (
    <WindowFrame
      windowId="mcp-log"
      className="mcp-log-window"
      modal={false}
      title={
        <span className="mcp-log-window__title">
          <span className={`mcp-log-window__status ${running ? 'is-running' : ''}`} />
          <strong>{t('mcpLogTitle')}</strong>
          <span>{running ? t('mcpLogConnected') : t('mcpLogStopped')}</span>
        </span>
      }
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onClose={onMinimize}
      t={t}
      minimized={!expanded}
      onMinimizeChange={(minimized) => {
        if (minimized) onMinimize();
        else onRestore();
      }}
    >
      <div ref={listRef} className="mcp-log-window__entries" aria-live="polite">
        {entries.length === 0 ? (
          <div className="mcp-log-window__empty">{t('mcpLogWaiting')}</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry.sourceId ?? 'configra'}-${entry.timestamp}-${entry.requestId ?? 'service'}-${index}`}
              className={`mcp-log-entry mcp-log-entry--${entry.level}`}
            >
              <time>{formatLogTime(entry.timestamp)}</time>
              <span>{entry.message}</span>
              {entry.projectId ? <small>{entry.projectId}</small> : null}
              {entry.durationMs !== undefined ? <small>{entry.durationMs} ms</small> : null}
            </div>
          ))
        )}
      </div>
    </WindowFrame>
  );
}
