import { useMemo, useState } from 'react';
import Ico from '../components/Icons';

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

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function defaultNextRun() {
  return toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
}

export default function ScheduledView({
  scheduled,
  projects,
  models,
  selectedProject,
  selectedModel,
  onCreate,
  onUpdate,
  onDelete,
  onPause,
  onResume,
  onRunNow,
}) {
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    prompt: '',
    cadence: 'once',
    nextRunAt: defaultNextRun(),
    projectPath: selectedProject?.path || '',
    model: selectedModel?.id || '',
  });

  const pendingCatchup = useMemo(() => scheduled.filter((item) => item.catchupPending), [scheduled]);

  function resetForm() {
    setEditing(null);
    setForm({
      title: '',
      prompt: '',
      cadence: 'once',
      nextRunAt: defaultNextRun(),
      projectPath: selectedProject?.path || '',
      model: selectedModel?.id || '',
    });
    setError('');
  }

  async function submitForm() {
    if (!form.prompt.trim()) {
      setError('A prompt is required.');
      return;
    }
    setError('');
    const payload = {
      title: form.title.trim() || form.prompt.trim().slice(0, 80),
      prompt: form.prompt,
      cadence: form.cadence,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      next_run_at: new Date(form.nextRunAt).toISOString(),
      project_path: form.projectPath || null,
      model: form.model || null,
      enabled: true,
    };
    try {
      if (editing) {
        await onUpdate(editing.id, payload);
      } else {
        await onCreate(payload);
      }
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err.message || 'Could not save schedule.');
    }
  }

  function startEdit(item) {
    setEditing(item);
    setShowForm(true);
    setForm({
      title: item.title || '',
      prompt: item.prompt || '',
      cadence: item.cadence || 'once',
      nextRunAt: toLocalInput(item.nextRunAt) || defaultNextRun(),
      projectPath: item.projectPath || '',
      model: item.model || '',
    });
  }

  async function runAction(id, action) {
    setBusyId(id);
    setError('');
    try {
      await action(id);
    } catch (err) {
      setError(err.message || 'Schedule action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Scheduled"
        subtitle="Local scheduled Anton tasks run while Anton CoWork is open. Missed runs wait for approval."
        action={
          <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            {Ico.plus(14)} Schedule task
          </button>
        }
      />

      {pendingCatchup.length > 0 && (
        <div className="catchup-banner">
          <span>{Ico.clock(16)}</span>
          <div>
            <strong>{pendingCatchup.length} missed scheduled run{pendingCatchup.length === 1 ? '' : 's'} need approval</strong>
            <p>Run each one manually from the list when you are ready.</p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="schedule-form">
          <div className="schedule-grid">
            <label>
              <span>Title</span>
              <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Weekly metrics summary" />
            </label>
            <label>
              <span>Cadence</span>
              <select value={form.cadence} onChange={(event) => setForm((prev) => ({ ...prev, cadence: event.target.value }))}>
                <option value="once">Once</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              <span>Next run</span>
              <input type="datetime-local" value={form.nextRunAt} onChange={(event) => setForm((prev) => ({ ...prev, nextRunAt: event.target.value }))} />
            </label>
            <label>
              <span>Project</span>
              <select value={form.projectPath} onChange={(event) => setForm((prev) => ({ ...prev, projectPath: event.target.value }))}>
                <option value="">No project</option>
                {projects.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}
              </select>
            </label>
            <label>
              <span>Model</span>
              <select value={form.model} onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}>
                <option value="">Configured default</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>
          </div>
          <label className="schedule-prompt">
            <span>Prompt</span>
            <textarea value={form.prompt} onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))} placeholder="Ask Anton to..." />
          </label>
          {error && <div className="dialog-error">{error}</div>}
          <div className="dialog-actions">
            <button className="secondary-btn" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</button>
            <button className="primary-btn" onClick={submitForm}>{editing ? 'Save changes' : 'Create schedule'}</button>
          </div>
        </div>
      )}

      <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {scheduled.map((item) => (
          <div key={item.id} className="schedule-row">
            <span className="schedule-icon">{Ico.clock(15)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--frost-600)', marginTop: 2 }}>
                {item.cadence} · next {toLocalInput(item.nextRunAt) || 'not set'}
                {item.lastResultSessionId ? ` · last task ${item.lastResultSessionId}` : ''}
              </div>
              {item.lastError && <div style={{ fontSize: 12, color: '#9B3B24', marginTop: 4 }}>{item.lastError}</div>}
            </div>
            {item.catchupPending && <span className="status-pill warn">Catch up</span>}
            <span className={`status-pill ${item.enabled ? 'on' : ''}`}>{item.enabled ? 'On' : 'Paused'}</span>
            <button className="secondary-btn" disabled={busyId === item.id} onClick={() => runAction(item.id, onRunNow)}>Run now</button>
            <button className="secondary-btn" onClick={() => startEdit(item)}>Edit</button>
            {item.enabled ? (
              <button className="secondary-btn" onClick={() => runAction(item.id, onPause)}>Pause</button>
            ) : (
              <button className="secondary-btn" onClick={() => runAction(item.id, onResume)}>Resume</button>
            )}
            <button className="icon-btn" title="Delete schedule" onClick={() => runAction(item.id, onDelete)}>{Ico.more(15)}</button>
          </div>
        ))}
        {!scheduled.length && (
          <div className="empty-state">
            <span>{Ico.clock(18)}</span>
            <strong>No scheduled tasks yet</strong>
            <p>Create a local schedule to run an Anton prompt while the desktop app is open.</p>
          </div>
        )}
      </div>
    </div>
  );
}
