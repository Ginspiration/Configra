import { useEffect, useRef, useState } from 'react';
import type { ConfigTable, ProjectFile, TableIdentity } from '../model/types';
import type { Translator } from '../i18n';
import { useEditorStore } from '../store/editorStore';
import ColumnEditor from './ColumnEditor';

type TableInspectorProps = {
  table?: ConfigTable;
  project: ProjectFile;
  t: Translator;
  compact?: boolean;
};

type ColumnDragState = {
  tableId: string;
  columnId: string;
  pointerId: number;
};

type ColumnDropMarker = {
  index: number;
  top: number;
};

export default function TableInspector({ table, project, t, compact = false }: TableInspectorProps) {
  const updateTable = useEditorStore((state) => state.updateTable);
  const deleteTable = useEditorStore((state) => state.deleteTable);
  const addColumn = useEditorStore((state) => state.addColumn);
  const moveColumn = useEditorStore((state) => state.moveColumn);
  const [draggedColumnId, setDraggedColumnId] = useState<string>();
  const [dropMarker, setDropMarker] = useState<ColumnDropMarker>();
  const draggedColumnRef = useRef<ColumnDragState>();
  const dropIndexRef = useRef<number>();
  const columnListRef = useRef<HTMLDivElement>(null);

  const clearColumnDrag = () => {
    draggedColumnRef.current = undefined;
    dropIndexRef.current = undefined;
    setDraggedColumnId(undefined);
    setDropMarker(undefined);
  };

  useEffect(() => {
    clearColumnDrag();
  }, [table?.id]);

  const getDropMarker = (clientY: number): ColumnDropMarker => {
    const list = columnListRef.current;
    const columnCount = table?.columns.length ?? 0;
    if (!list) return { index: columnCount, top: 0 };

    const items = Array.from(
      list.querySelectorAll<HTMLElement>('[data-column-index]'),
    );

    for (const item of items) {
      const index = Number(item.dataset.columnIndex);
      if (!Number.isFinite(index)) continue;

      const bounds = item.getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) {
        return { index, top: item.offsetTop };
      }
    }

    const lastItem = items[items.length - 1];
    return {
      index: columnCount,
      top: lastItem ? lastItem.offsetTop + lastItem.offsetHeight : 8,
    };
  };

  const updateDropMarker = (marker: ColumnDropMarker) => {
    dropIndexRef.current = marker.index;
    setDropMarker(marker);
  };

  const startColumnDrag = (
    tableId: string,
    columnId: string,
    pointerId: number,
    clientY: number,
  ) => {
    draggedColumnRef.current = { tableId, columnId, pointerId };
    setDraggedColumnId(columnId);
    updateDropMarker(getDropMarker(clientY));
  };

  const updateColumnDrag = (pointerId: number, clientY: number) => {
    const drag = draggedColumnRef.current;
    if (!drag || drag.pointerId !== pointerId) return;

    updateDropMarker(getDropMarker(clientY));
  };

  const finishActiveColumnDrag = (clientY?: number) => {
    const drag = draggedColumnRef.current;
    if (!drag) return;

    const targetIndex =
      clientY === undefined ? dropIndexRef.current : getDropMarker(clientY).index;

    if (targetIndex !== undefined) {
      moveColumn(drag.tableId, drag.columnId, targetIndex);
    }

    clearColumnDrag();
  };

  const finishColumnDrag = (pointerId: number, clientY?: number) => {
    const drag = draggedColumnRef.current;
    if (!drag || drag.pointerId !== pointerId) return;

    finishActiveColumnDrag(clientY);
  };

  useEffect(() => {
    if (!draggedColumnId) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      updateColumnDrag(event.pointerId, event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      event.preventDefault();
      finishColumnDrag(event.pointerId, event.clientY);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const drag = draggedColumnRef.current;
      if (drag?.pointerId === event.pointerId) clearColumnDrag();
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (draggedColumnRef.current) updateDropMarker(getDropMarker(event.clientY));
    };
    const handleMouseUp = (event: MouseEvent) => {
      finishActiveColumnDrag(event.clientY);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggedColumnId]);

  if (!table) {
    return (
      <section className="inspector-panel">
        <h2>{t('inspector')}</h2>
        <p className="empty-copy">{t('noTableSelected')}</p>
      </section>
    );
  }

  const updateIdentity = (patch: Partial<TableIdentity>) => {
    const nextIdentity = { ...table.identity, ...patch };
    const normalizedIdentity: TableIdentity = {};

    if (nextIdentity.namespace) normalizedIdentity.namespace = nextIdentity.namespace;
    if (nextIdentity.keyColumnId) normalizedIdentity.keyColumnId = nextIdentity.keyColumnId;
    if (nextIdentity.valueColumnId) normalizedIdentity.valueColumnId = nextIdentity.valueColumnId;

    updateTable(table.id, {
      identity:
        normalizedIdentity.namespace ||
        normalizedIdentity.keyColumnId ||
        normalizedIdentity.valueColumnId
          ? normalizedIdentity
          : undefined,
    });
  };

  return (
    <section className="inspector-panel">
      <div className="panel-heading">
        <h2>{t('inspector')}</h2>
        {compact ? null : (
          <button
            type="button"
            className="button button--ghost danger"
            title="Delete"
            onClick={() => {
              if (window.confirm(t('confirmDeleteTable', { name: table.name }))) deleteTable(table.id);
            }}
          >
            {t('deleteTable')}
          </button>
        )}
      </div>

      <label className="field-stack">
        <span>{t('tableId')}</span>
        <input value={table.id} readOnly />
      </label>
      <label className="field-stack">
        <span>{t('tableName')}</span>
        <input
          value={table.name}
          onChange={(event) => updateTable(table.id, { name: event.target.value })}
        />
      </label>

      <div className="panel-heading panel-heading--spaced">
        <h3>{t('identityRegistry')}</h3>
      </div>

      <div className="identity-grid">
        <label className="field-stack">
          <span>{t('identityNamespace')}</span>
          <input
            value={table.identity?.namespace ?? table.name}
            onChange={(event) =>
              updateIdentity({ namespace: event.target.value || undefined })
            }
          />
        </label>
        <label className="field-stack">
          <span>{t('identityKeyField')}</span>
          <select
            value={table.identity?.keyColumnId ?? ''}
            onChange={(event) =>
              updateIdentity({ keyColumnId: event.target.value || undefined })
            }
          >
            <option value="">{t('none')}</option>
            {table.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name || column.id}
              </option>
            ))}
          </select>
        </label>
        <label className="field-stack">
          <span>{t('identityValueField')}</span>
          <select
            value={table.identity?.valueColumnId ?? ''}
            onChange={(event) =>
              updateIdentity({ valueColumnId: event.target.value || undefined })
            }
          >
            <option value="">{t('none')}</option>
            {table.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name || column.id}
                {column.primary ? ` (${t('pk')})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-heading panel-heading--spaced">
        <h3>{t('fields')}</h3>
        <button
          type="button"
          className="button button--primary"
          onClick={() => addColumn(table.id)}
          title="F"
        >
          {t('addField')}
        </button>
      </div>

      <div
        ref={columnListRef}
        className={`column-list ${draggedColumnId ? 'is-reordering' : ''}`}
      >
        {dropMarker ? (
          <div
            className="column-list__insert-line"
            style={{ top: dropMarker.top }}
          />
        ) : null}
        {table.columns.map((column, index) => (
          <div
            key={column.id}
            data-column-index={index}
            className={`column-list__item ${draggedColumnId === column.id ? 'is-dragging' : ''}`}
          >
            <button
              type="button"
              className="column-drag-handle"
              aria-label={t('dragField')}
              title={t('dragField')}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                startColumnDrag(table.id, column.id, event.pointerId, event.clientY);
              }}
              onPointerMove={(event) => updateColumnDrag(event.pointerId, event.clientY)}
              onPointerUp={(event) => {
                updateColumnDrag(event.pointerId, event.clientY);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                finishColumnDrag(event.pointerId, event.clientY);
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                clearColumnDrag();
              }}
            >
              ::
            </button>
            <ColumnEditor
              column={column}
              tableId={table.id}
              project={project}
              t={t}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
