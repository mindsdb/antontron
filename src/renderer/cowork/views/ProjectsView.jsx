// Projects view — two modes:
//   Grid:   no project under view → list of all projects as cards.
//   Detail: a project is selected → composer for new task in that
//           project, list of all tasks/conversations under it (newest
//           first), and a right sidebar with Working folder + Context
//           + Scheduled (filtered to this project).
//
// Local detailProject state is seeded from `selectedProject` so the
// chat-header crumb (which sets selectedProject + routes here) lands
// directly in the detail view. The "← All projects" button clears the
// local state to surface the grid again — without disturbing the app's
// selectedProject (which the home composer reads independently).

import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { WorkingFolderLive } from '../components/rail/WorkingFolderLive';
import { ContextCard } from '../components/rail/ContextCard';

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="page-title">{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function relativeAge(iso) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return `${Math.floor(secs / 604800)}w ago`;
}

function timestampOf(task) {
  // Best-effort sortable timestamp. The /conversations payload exposes
  // updated_at / created_at as ISO strings; older shapes use subtitle
  // ('5m ago') which we can't sort numerically — fall back to 0 so
  // those land at the end.
  const raw = task.updatedAt || task.updated_at || task.createdAt || task.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function ProjectGrid({ projects, selectedProject, onOpenProject, onCreateProject }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      await onCreateProject?.({ name: name.trim() });
      setCreating(false); setName('');
    } catch (err) {
      setError(err?.message || 'Could not create project');
    } finally { setBusy(false); }
  };

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Projects"
        subtitle="Workspaces Anton uses to group conversations, memory, and outputs."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            {Ico.plus(14)} New project
          </button>
        }
      />
      {creating && (
        <form onSubmit={submit} style={{
          margin: '20px 28px 0', padding: 16,
          border: '1px solid var(--line)', borderRadius: 10,
          background: 'var(--surface)',
          display: 'grid', gridTemplateColumns: '1fr auto auto',
          gap: 10, alignItems: 'center',
        }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            style={{ height: 34, border: '1px solid var(--line)', borderRadius: 7, padding: '0 10px', fontSize: 13 }}
          />
          <button className="btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create'}</button>
          <button type="button" className="icon-btn" onClick={() => { setCreating(false); setError(''); }} title="Cancel">{Ico.chevLeft(14)}</button>
          {error && (
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--danger)' }}>{error}</div>
          )}
        </form>
      )}
      <div style={{
        padding: 28,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 14,
      }}>
        {projects.map((p) => {
          const isSelected = selectedProject?.name === p.name;
          return (
            <button
              key={p.name}
              style={{
                textAlign: 'left', background: 'var(--surface)',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 12, padding: 16, cursor: 'pointer',
                transition: 'border-color .15s, box-shadow .15s',
                boxShadow: 'var(--sh-1, 0 1px 0 rgba(0,0,0,0.04))',
                display: 'flex', flexDirection: 'column', gap: 12,
                minHeight: 120,
              }}
              onClick={() => onOpenProject?.(p)}
              onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseOut={(e) => { e.currentTarget.style.borderColor = isSelected ? 'var(--accent)' : 'var(--line)'; }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'var(--surface-2)', color: 'var(--accent)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {Ico.folder(18)}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{p.name}</div>
                </div>
                <div style={{
                  fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4,
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{p.path}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function turnsCount(task) {
  if (Number.isFinite(task.turns)) return task.turns;
  if (Array.isArray(task.messages)) {
    return task.messages.filter((m) => m.role === 'user').length;
  }
  return null;
}

function TaskCard({ task, onClick }) {
  const subtitle = task.subtitle || task.preview || '';
  const updated = relativeAge(task.updatedAt || task.updated_at || task.created_at);
  const turns = turnsCount(task);
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 14, alignItems: 'flex-start',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
        transition: 'border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 6px 18px rgba(15,16,17,0.06)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: 'var(--font-body)', fontWeight: 600,
          fontSize: 14, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.title || 'Untitled'}
        </span>
        {subtitle && (
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {subtitle}
          </span>
        )}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        gap: 4, flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--ink-4)' }}>
          {updated || '—'}
        </span>
        {turns != null && (
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--ink-4)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {turns} {turns === 1 ? 'turn' : 'turns'}
          </span>
        )}
      </div>
    </button>
  );
}

function ScheduledMini({ items }) {
  if (!items.length) {
    return (
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12.5, color: 'var(--ink-4)', padding: '8px 4px 4px',
      }}>
        No scheduled tasks for this project.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
      {items.map((s) => (
        <div key={s.id} title={s.prompt || s.title || s.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'var(--font-body)',
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
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {s.cadence}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function MiniCard({ title, children, slim = false }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{
        padding: '11px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
        color: 'var(--ink)',
      }}>
        <span>{title}</span>
      </div>
      <div style={{
        padding: '4px 14px 14px',
        borderTop: slim ? 'none' : '1px solid var(--line)',
        maxHeight: 320, overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  );
}

function ProjectDetail({
  project, projects, tasks, scheduled, models, onSend, onSelectTask,
  onShowAll, onCreateProject,
}) {
  const projectTasks = (tasks || [])
    .filter((t) => t.projectName === project.name || t.projectPath === project.path)
    .sort((a, b) => timestampOf(b) - timestampOf(a));
  const projectSchedules = (scheduled || [])
    .filter((s) => (s.project || s.projectName) === project.name);

  return (
    <div className="scroll-clean" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header — Back to all projects + project name */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 28px',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}>
        <button
          onClick={onShowAll}
          title="All projects"
          style={{
            all: 'unset', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: 'var(--ink-3)',
            fontFamily: 'var(--font-body)',
            fontSize: 13, padding: '4px 6px', borderRadius: 5,
            transition: 'color 120ms ease, background 120ms ease',
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {Ico.chevLeft(13)} All projects
        </button>
        <span style={{ color: 'var(--ink-4)', display: 'inline-flex' }}>{Ico.chevRight(12)}</span>
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17,
          letterSpacing: '0.01em', color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
        }}>{project.name}</span>
      </div>

      {/* Body — two columns: composer + task list / right rail */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 320px',
        gridTemplateRows: '1fr',
        background: 'transparent',
      }}>
        {/* Left column — composer + task list */}
        <div style={{ overflowY: 'auto', padding: '24px 28px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}>
            <Composer
              onSend={onSend}
              project={project}
              onProjectChange={() => {}}
              model={null}
              onModelChange={() => {}}
              projects={projects || []}
              models={models || []}
              attachments={[]}
              connectors={[]}
              onAttachFiles={() => {}}
              onAttachConnector={() => {}}
              onRemoveAttachment={() => {}}
              hideModel
              metaReadOnly
              placeholder={`Start a new task in ${project.name}…`}
            />
          </div>

          <div style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              marginBottom: 12, paddingLeft: 4,
            }}>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 16,
                fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.005em',
              }}>
                Tasks
              </span>
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13, color: 'var(--ink-4)',
              }}>
                {projectTasks.length}
              </span>
            </div>
            {projectTasks.length === 0 ? (
              <div style={{
                padding: 28, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-3)',
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 12, textAlign: 'center', lineHeight: 1.55,
              }}>
                No tasks in this project yet — type a prompt above to start one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {projectTasks.map((t) => (
                  <TaskCard key={t.id} task={t} onClick={() => onSelectTask?.(t.id)} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — working folder, context, scheduled */}
        <aside style={{
          padding: '14px 14px 22px',
          display: 'flex', flexDirection: 'column', gap: 10,
          overflowY: 'auto',
          minWidth: 0,
          WebkitAppRegion: 'no-drag',
        }}>
          <MiniCard title="Working folder">
            <WorkingFolderLive project={project} isStreaming={false} streamStartedAt={null} />
          </MiniCard>
          <MiniCard title="Context" slim>
            <ContextCard project={project} />
          </MiniCard>
          <MiniCard title="Scheduled">
            <ScheduledMini items={projectSchedules} />
          </MiniCard>
        </aside>
      </div>
    </div>
  );
}

export default function ProjectsView({
  projects = [],
  selectedProject,
  tasks = [],
  scheduled = [],
  models = [],
  onSelectProject,
  onCreateProject,
  onSendInProject,
  onSelectTask,
}) {
  // Detail mode is local — App's selectedProject seeds it but the user
  // can flip back to the grid without losing their global selection.
  const [detailProject, setDetailProject] = useState(selectedProject || null);
  useEffect(() => { setDetailProject(selectedProject || null); }, [selectedProject]);

  if (!detailProject) {
    return (
      <ProjectGrid
        projects={projects}
        selectedProject={selectedProject}
        onCreateProject={onCreateProject}
        onOpenProject={(p) => {
          setDetailProject(p);
          onSelectProject?.(p);
        }}
      />
    );
  }

  return (
    <ProjectDetail
      project={detailProject}
      projects={projects}
      tasks={tasks}
      scheduled={scheduled}
      models={models}
      onSend={onSendInProject}
      onSelectTask={onSelectTask}
      onShowAll={() => setDetailProject(null)}
      onCreateProject={onCreateProject}
    />
  );
}
