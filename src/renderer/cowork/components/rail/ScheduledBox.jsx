// Scheduled card — list of scheduled tasks for the current scope.
// Caller filters items (e.g. by project name) before passing in.

import Ico from '../Icons';
import { RailCard } from './RailCard';

const FONT_BODY = "'Inter', system-ui, sans-serif";

function ScheduledList({ items, onSelect }) {
  if (!items.length) {
    return (
      <p style={{
        fontFamily: FONT_BODY,
        fontSize: 12.5, color: 'var(--ink-4)', padding: '8px 4px 4px',
      }}>
        Nothing scheduled here yet.
      </p>
    );
  }
  const clickable = typeof onSelect === 'function';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
      {items.map((s) => {
        const label = s.title || s.prompt || s.id;
        // When `onSelect` is wired, render each row as a button that
        // routes the user to the schedule detail page. Otherwise a
        // plain non-interactive row keeps the card informational —
        // back-compat for any caller that didn't pass the handler.
        const Tag = clickable ? 'button' : 'div';
        return (
          <Tag
            key={s.id}
            type={clickable ? 'button' : undefined}
            title={s.prompt || s.title || s.id}
            onClick={clickable ? () => onSelect(s) : undefined}
            style={{
              all: clickable ? 'unset' : undefined,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: clickable ? '6px 8px' : 0,
              borderRadius: 6,
              fontFamily: FONT_BODY,
              fontSize: 12.5, color: 'var(--ink-2)',
              cursor: clickable ? 'pointer' : 'default',
              transition: clickable
                ? 'background 120ms ease, color 120ms ease'
                : undefined,
            }}
            onMouseOver={clickable ? (e) => {
              e.currentTarget.style.background = 'var(--surface-2)';
              e.currentTarget.style.color = 'var(--ink)';
            } : undefined}
            onMouseOut={clickable ? (e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--ink-2)';
            } : undefined}
          >
            <span style={{ color: 'var(--ink-3)', display: 'inline-flex', flexShrink: 0 }}>
              {Ico.clock(13)}
            </span>
            <span style={{
              flex: 1, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
            {s.cadence && (
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{s.cadence}</span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

export function ScheduledBox({
  items = [],
  defaultOpen = true,
  maxBodyHeight = 320,
  onSelect,
}) {
  return (
    <RailCard title="Scheduled Tasks" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <ScheduledList items={items} onSelect={onSelect} />
    </RailCard>
  );
}
