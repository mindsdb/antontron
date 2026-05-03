import Ico from '../components/Icons';
import { useState } from 'react';

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1 }}>
        <h2 className="page-title">{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--frost-600)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export default function ProjectsView({ projects, selectedProject, onSelectProject, onCreateProject }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await onCreateProject?.({ name: name.trim(), path: path.trim() || undefined });
    setBusy(false);
    setCreating(false);
    setName('');
    setPath('');
  };

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Projects"
        subtitle="Group related tasks, files, and context. Anton remembers what's in each project."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            {Ico.plus(14)} New project
          </button>
        }
      />
      {creating && (
        <form onSubmit={submit} style={{
          margin: '20px 28px 0',
          padding: 16,
          border: '1px solid var(--border-01)',
          borderRadius: 10,
          background: 'var(--surface-0)',
          display: 'grid',
          gridTemplateColumns: '1fr 1.4fr auto auto',
          gap: 10,
          alignItems: 'center',
        }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            style={{ height: 34, border: '1px solid var(--border-01)', borderRadius: 7, padding: '0 10px', fontSize: 13 }}
          />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Parent folder, default ~/Projects"
            style={{ height: 34, border: '1px solid var(--border-01)', borderRadius: 7, padding: '0 10px', fontSize: 13 }}
          />
          <button className="btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create'}</button>
          <button type="button" className="icon-btn" onClick={() => setCreating(false)} title="Cancel">{Ico.chevLeft(14)}</button>
        </form>
      )}
      <div style={{
        padding: 28,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 14,
      }}>
        {projects.map((p) => (
          <button
            key={p.id}
            style={{
              textAlign: 'left', background: 'var(--surface-0)',
              border: `1px solid ${selectedProject?.path === p.path ? 'var(--primary-400)' : 'var(--border-01)'}`, borderRadius: 12,
              padding: 16, cursor: 'pointer',
              transition: 'border-color .15s, box-shadow .15s',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex', flexDirection: 'column', gap: 12,
              minHeight: 140,
            }}
            onClick={() => onSelectProject?.(p)}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--primary-300)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = selectedProject?.path === p.path ? 'var(--primary-400)' : 'var(--border-01)'; }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: p.tint, color: p.color,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {Ico.folder(18)}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{p.name}</div>
                {selectedProject?.path === p.path && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--frost-600)', marginTop: 2 }}>{p.description}</div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--frost-600)' }}>
              <span>{p.taskCount} tasks</span>
              <span>·</span>
              <span>{p.fileCount} files</span>
              <span style={{ flex: 1 }} />
              <span>{p.updated}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Projects are workspace folders in Anton — show a hint */}
      <div style={{
        margin: '0 28px 28px',
        padding: '12px 16px',
        background: 'var(--stone-50)',
        border: '1px solid var(--border-0)',
        borderRadius: 10,
        fontSize: 12.5,
        color: 'var(--frost-700)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}>
        <span style={{ display: 'inline-flex', color: 'var(--primary-700)', marginTop: 1 }}>{Ico.folder(14)}</span>
        <span>
          <strong style={{ color: 'var(--text-strong)' }}>Anton projects</strong> are workspace folders containing an{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--stone-150)', padding: '1px 5px', borderRadius: 4 }}>.anton/</code>{' '}
          directory. Open a folder with Anton to add it here.
        </span>
      </div>
    </div>
  );
}
