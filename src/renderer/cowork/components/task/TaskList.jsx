// Vertical column of TaskCards. Used by the project view today;
// drop-in for any other "list of conversations" surface.

import { TaskCard } from './TaskCard';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Josefin Sans', sans-serif";

export function TaskList({
  tasks = [],
  // Optional title — when present, renders a Josefin "Tasks · N"
  // header above the list. Pass null to render just the list.
  title = 'Tasks',
  emptyMessage = 'No tasks yet — start one above.',
  projects = [],
  onSelectTask,
  onPinTask,
  onUnpinTask,
  onDeleteTask,
}) {
  return (
    <div>
      {title != null && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          marginBottom: 12, paddingLeft: 4,
        }}>
          <span style={{
            fontFamily: FONT_DISPLAY, fontSize: 16,
            fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.005em',
          }}>
            {title}
          </span>
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-4)',
          }}>
            {tasks.length}
          </span>
        </div>
      )}
      {tasks.length === 0 ? (
        <div style={{
          padding: 28,
          fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-3)',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 12, textAlign: 'center', lineHeight: 1.55,
        }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              projects={projects}
              onClick={() => onSelectTask?.(t.id)}
              onPin={onPinTask}
              onUnpin={onUnpinTask}
              onDelete={onDeleteTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
