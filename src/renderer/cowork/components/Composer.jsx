import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';

function AttachmentChip({ attachment, onRemove }) {
  const label = attachment.kind === 'url' ? 'URL' : attachment.kind === 'snippet' ? 'Snippet' : 'File';
  const status = attachment.extractionStatus && attachment.extractionStatus !== 'ready'
    ? attachment.extractionStatus.replace('_', ' ')
    : null;
  return (
    <div className="attachment-chip" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="attachment-chip-icon">
        {attachment.kind === 'url' ? Ico.globe(13) : attachment.kind === 'snippet' ? Ico.code(13) : Ico.doc(13)}
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

function Dialog({ title, children, onClose }) {
  return (
    <div className="inline-dialog" role="dialog" aria-label={title}>
      <div className="inline-dialog-head">
        <strong>{title}</strong>
        <button className="mini-icon-btn" title="Close" onClick={onClose}>x</button>
      </div>
      {children}
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
  onAttachFiles,
  onAttachUrl,
  onAttachSnippet,
  onAttachProjectFile,
  onBrowseProjectFiles,
  onRemoveAttachment,
  placeholder = 'How can I help you today?',
  disabled = false,
  metaReadOnly = false,
  hideMeta = false,
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [urlValue, setUrlValue] = useState('');
  const [snippetTitle, setSnippetTitle] = useState('');
  const [snippetText, setSnippetText] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectFiles, setProjectFiles] = useState([]);
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
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpenMenu(null);
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

  async function submitUrl() {
    if (!urlValue.trim() || !onAttachUrl) return;
    setBusy(true);
    setError('');
    try {
      await onAttachUrl(urlValue.trim());
      setUrlValue('');
      setDialog(null);
    } catch (err) {
      setError(err.message || 'Could not attach URL.');
    } finally {
      setBusy(false);
    }
  }

  async function submitSnippet() {
    if (!snippetText.trim() || !onAttachSnippet) return;
    setBusy(true);
    setError('');
    try {
      await onAttachSnippet({ title: snippetTitle.trim() || 'Snippet', content: snippetText });
      setSnippetTitle('');
      setSnippetText('');
      setDialog(null);
    } catch (err) {
      setError(err.message || 'Could not attach snippet.');
    } finally {
      setBusy(false);
    }
  }

  async function loadProjectFiles(query = projectQuery) {
    if (!project?.path || !onBrowseProjectFiles) return;
    setBusy(true);
    setError('');
    try {
      const data = await onBrowseProjectFiles(query);
      setProjectFiles(data.files || data || []);
    } catch (err) {
      setError(err.message || 'Could not list project files.');
    } finally {
      setBusy(false);
    }
  }

  async function attachProjectFile(path) {
    if (!onAttachProjectFile) return;
    setBusy(true);
    setError('');
    try {
      await onAttachProjectFile(path);
      setDialog(null);
    } catch (err) {
      setError(err.message || 'Could not attach project file.');
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

  const openProjectDialog = async () => {
    setDialog('project-file');
    setOpenMenu(null);
    setProjectFiles([]);
    if (project?.path) await loadProjectFiles('');
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', position: 'relative' }}>
      <input
        ref={fileRef}
        type="file"
        multiple
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
            title="Attach context"
            disabled={disabled || busy}
            onClick={() => setOpenMenu(openMenu === 'attach' ? null : 'attach')}
          >
            {Ico.plus(15)}
          </button>
          <button
            className="composer-icon"
            title="Add URL context"
            disabled={disabled || busy}
            onClick={() => { setDialog('url'); setOpenMenu(null); setError(''); }}
          >
            {Ico.globe(14)}
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
        <div className="menu" style={{ left: 0, bottom: 'calc(100% + 6px)' }}>
          <button className="menu-item" onClick={() => fileRef.current?.click()}>{Ico.attach(14)} Attach files</button>
          <button className="menu-item" onClick={openProjectDialog}>{Ico.doc(14)} From a project</button>
          <button className="menu-item" onClick={() => { setDialog('snippet'); setOpenMenu(null); setError(''); }}>{Ico.code(14)} Paste code snippet</button>
          <button className="menu-item" onClick={() => { setDialog('url'); setOpenMenu(null); setError(''); }}>{Ico.globe(14)} Add a URL</button>
        </div>
      )}

      {dialog === 'url' && (
        <Dialog title="Add URL Context" onClose={() => setDialog(null)}>
          <input
            className="dialog-input"
            placeholder="https://example.com/page"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitUrl(); }}
          />
          {error && <div className="dialog-error">{error}</div>}
          <div className="dialog-actions">
            <button className="secondary-btn" onClick={() => setDialog(null)}>Cancel</button>
            <button className="primary-btn" disabled={busy || !urlValue.trim()} onClick={submitUrl}>
              {busy ? 'Fetching...' : 'Attach URL'}
            </button>
          </div>
        </Dialog>
      )}

      {dialog === 'snippet' && (
        <Dialog title="Paste Snippet" onClose={() => setDialog(null)}>
          <input
            className="dialog-input"
            placeholder="Snippet title"
            value={snippetTitle}
            onChange={(e) => setSnippetTitle(e.target.value)}
          />
          <textarea
            className="dialog-textarea"
            placeholder="Paste text or code"
            value={snippetText}
            onChange={(e) => setSnippetText(e.target.value)}
          />
          {error && <div className="dialog-error">{error}</div>}
          <div className="dialog-actions">
            <button className="secondary-btn" onClick={() => setDialog(null)}>Cancel</button>
            <button className="primary-btn" disabled={busy || !snippetText.trim()} onClick={submitSnippet}>
              {busy ? 'Saving...' : 'Attach snippet'}
            </button>
          </div>
        </Dialog>
      )}

      {dialog === 'project-file' && (
        <Dialog title="Attach Project File" onClose={() => setDialog(null)}>
          {!project?.path ? (
            <div className="dialog-empty">Choose a project before attaching project files.</div>
          ) : (
            <>
              <div className="dialog-row">
                <input
                  className="dialog-input"
                  placeholder="Filter files"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadProjectFiles(e.currentTarget.value); }}
                />
                <button className="secondary-btn" onClick={() => loadProjectFiles(projectQuery)} disabled={busy}>Search</button>
              </div>
              <div className="project-file-list">
                {projectFiles.map((file) => (
                  <button key={file.path} className="project-file-row" onClick={() => attachProjectFile(file.path)}>
                    <span>{file.path}</span>
                    {!file.supported && <small>metadata only</small>}
                  </button>
                ))}
                {!busy && projectFiles.length === 0 && <div className="dialog-empty">No files found.</div>}
                {busy && <div className="dialog-empty">Loading...</div>}
              </div>
            </>
          )}
          {error && <div className="dialog-error">{error}</div>}
        </Dialog>
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
              key={p.id}
              className={`menu-item${project?.id === p.id ? ' checked' : ''}`}
              onClick={() => { onProjectChange(p); setOpenMenu(null); }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.folder(14)}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              {project?.id === p.id && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
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
