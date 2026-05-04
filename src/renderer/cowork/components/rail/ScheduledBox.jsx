// Scheduled card — list of scheduled tasks for the current scope.
// Caller filters items (e.g. by project name) before passing in.

import Ico from '../Icons';
import { RailCard } from './RailCard';

const FONT_BODY = "'Inter', system-ui, sans-serif";

function ScheduledList({ items }) {
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
      {items.map((s) => (
        <div key={s.id} title={s.prompt || s.title || s.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT_BODY,
          fontSize: 12.5, color: 'var(--ink-2)',
        }}>
          <span style={{ color: 'var(--ink-3)', display: 'inline-flex', flexShrink: 0 }}>
            {Ico.clock(13)}
          </span>
          <span style={{
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {s.title || s.prompt || s.id}
          </span>
          {s.cadence && (
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{s.cadence}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ScheduledBox({
  items = [],
  defaultOpen = true,
  maxBodyHeight = 320,
}) {
  return (
    <RailCard title="Scheduled" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <ScheduledList items={items} />
    </RailCard>
  );
}
