import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';

function AttachmentChip({ attachment, onRemove }) {
  const label = attachment.kind === 'connector'
    ? 'Connector'
    : attachment.kind === 'url'
      ? 'URL'
      : attachment.kind === 'snippet'
        ? 'Snippet'
        : 'File';
  const status = attachment.extractionStatus && attachment.extractionStatus !== 'ready'
    ? attachment.extractionStatus.replace('_', ' ')
    : null;
  return (
    <div className="attachment-chip" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="attachment-chip-icon">
        {attachment.kind === 'connector' ? Ico.link(13)
          : attachment.kind === 'url' ? Ico.globe(13)
            : attachment.kind === 'snippet' ? Ico.code(13)
              : Ico.doc(13)}
      </span>
      <span className="attachment-chip-body">
        <span className="attachment-chip-name">{attachment.name || label}</span>
        <span className="attachment-chip-meta">{status || label}</span>
      </span>
      {onRemove && (
        <button className="attachment-chip-remove" title="Remove attachment" onClick={() => onRemove(attachment.id)}>
          x
        </button>
      )}
    </div>
  );
}

export default function Composer({
  onSend,
  project,
  onProjectChange,
  model,
  onModelChange,
  projects,
  models,
  attachments = [],
  connectors = [],
  onAttachFiles,
  onAttachConnector,
  onRemoveAttachment,
  placeholder = 'How can I help you today?',
  disabled = false,
  metaReadOnly = false,
  hideMeta = false,
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = Math.min(220, taRef.current.scrollHeight) + 'px';
  }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpenMenu(null);
        setConnectorsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleAttachFiles(files) {
    if (!files?.length || !onAttachFiles) return;
    setError('');
    setBusy(true);
    try {
      await onAttachFiles(files);
      setOpenMenu(null);
    } catch (err) {
      setError(err.message || 'Could not attach files.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function pickConnector(connector) {
    if (!onAttachConnector) {
      setOpenMenu(null);
      setConnectorsOpen(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onAttachConnector(connector);
      setOpenMenu(null);
      setConnectorsOpen(false);
    } catch (err) {
      setError(err.message || 'Could not attach connector.');
    } finally {
      setBusy(false);
    }
  }

  const handleSend = () => {
    if (disabled || !value.trim()) return;
    onSend(value.trim());
    setValue('');
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', position: 'relative' }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="*/*,image/*"
        hidden
        onChange={(event) => handleAttachFiles(event.target.files)}
      />

      <div className={`composer-wrap${focused ? ' focused' : ''}`}>
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemoveAttachment} />
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          className="composer-textarea"
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (!disabled && e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
        />

        <div className="composer-toolbar">
          <button
            className="composer-icon"
            title="Add context"
            disabled={disabled || busy}
            onClick={() => setOpenMenu(openMenu === 'attach' ? null : 'attach')}
          >
            {Ico.plus(15)}
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="composer-mic"
            title="Voice is disabled for this pass"
            data-coming-soon=""
            style={{ opacity: 0.6, cursor: 'default' }}
          >
            {Ico.mic(16)}
          </button>
          <button
            className="send-btn"
            disabled={disabled || !value.trim() || busy}
            onClick={handleSend}
            title="Send"
          >
            {Ico.send(15)}
          </button>
        </div>
      </div>

      {openMenu === 'attach' && (
        <div className="menu" style={{ left: 0, bottom: 'calc(100% + 6px)', minWidth: 240 }}>
          <button className="menu-item" onClick={() => fileRef.current?.click()}>
            {Ico.attach(14)} Attach files or photos
          </button>
          <button
            className="menu-item"
            onClick={() => setConnectorsOpen((o) => !o)}
            aria-expanded={connectorsOpen}
          >
            {Ico.link(14)}
            <span style={{ flex: 1 }}>Connectors</span>
            <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>
              {connectorsOpen ? Ico.chevDown(12) : Ico.chevRight(12)}
            </span>
          </button>
          {connectorsOpen && (
            <div style={{
              borderTop: '1px solid var(--border-0)',
              marginTop: 4, paddingTop: 4,
              maxHeight: 220, overflowY: 'auto',
            }}>
              {connectors.length === 0 ? (
                <div style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--frost-600)' }}>
                  No connectors yet. Add one in Utilities → Datasources.
                </div>
              ) : (
                connectors.map((c) => (
                  <button
                    key={`${c.engine}:${c.name}`}
                    className="menu-item"
                    style={{ paddingLeft: 26 }}
                    disabled={busy}
                    onClick={() => pickConnector(c)}
                  >
                    <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.doc(13)}</span>
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--frost-600)' }}>{c.displayName || c.engine}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {error && (
            <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--danger-600, #b3261e)' }}>{error}</div>
          )}
        </div>
      )}

      {!hideMeta && (
        <div className="meta-row">
          {metaReadOnly ? (
            <>
              <span className="meta-pill" title="Project is fixed for this task">
                {Ico.folder(14)}
                <span>{project ? project.name : 'No project'}</span>
              </span>
              <span className="meta-pill" title="Model is fixed for this task">
                <span>{model?.name ?? 'Model'}</span>
              </span>
            </>
          ) : (
            <>
              <button
                className="meta-pill"
                onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
                title="Choose project"
              >
                {Ico.folder(14)}
                <span>{project ? project.name : 'Work in a project'}</span>
                <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>{Ico.chevDown(13)}</span>
              </button>
              <button
                className="meta-pill"
                onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
                title="Choose model"
              >
                <span>{model?.name ?? 'Select model'}</span>
                <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>{Ico.chevDown(13)}</span>
              </button>
            </>
          )}
        </div>
      )}

      {openMenu === 'project' && !metaReadOnly && (
        <div className="menu" style={{ left: 8, top: 'calc(100% + 6px)', minWidth: 240 }}>
          <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Projects</div>
          {projects.map((p) => (
            <button
              key={p.name}
              className={`menu-item${project?.name === p.name ? ' checked' : ''}`}
              onClick={() => { onProjectChange(p); setOpenMenu(null); }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.folder(14)}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              {project?.name === p.name && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border-0)', margin: '4px 0' }} />
          <button className="menu-item" onClick={() => { onProjectChange(null); setOpenMenu(null); }}>
            <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.plus(14)}</span>
            <span>No project</span>
          </button>
        </div>
      )}

      {openMenu === 'model' && !metaReadOnly && (
        <div className="menu" style={{ right: 8, top: 'calc(100% + 6px)', minWidth: 260 }}>
          <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model</div>
          {models.map((m) => (
            <button
              key={m.id}
              className={`menu-item${model?.id === m.id ? ' checked' : ''}`}
              onClick={() => { onModelChange(m); setOpenMenu(null); }}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span>
                {model?.id === m.id && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{m.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
