import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';

function TypingDots() {
  return (
    <div className="streaming-indicator">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--frost-500)' }} />
      ))}
    </div>
  );
}

function ArtifactCard({ artifact }) {
  return (
    <div className="artifact-card">
      <div className="artifact-head">
        <span style={{
          width: 28, height: 28, borderRadius: 7,
          background: 'var(--primary-50)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--primary-700)',
        }}>
          {artifact.icon === 'doc' ? Ico.doc(15) : Ico.sparkle(15)}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{artifact.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{artifact.kind} · live artifact</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--sage-600)', fontWeight: 500 }}>
          <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage-500)' }} />
          Live
        </span>
        <button className="icon-btn" style={{ width: 26, height: 26 }}>{Ico.more(14)}</button>
      </div>
      <div style={{ padding: 14, fontSize: 13, color: 'var(--frost-700)', lineHeight: 1.6 }}>
        {artifact.preview?.map((line, i) => (
          <div key={i} style={{ marginBottom: i === artifact.preview.length - 1 ? 0 : 6 }}>
            {line.heading && <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{line.heading}</div>}
            {line.text && <div>{line.text}</div>}
          </div>
        ))}
      </div>
      {artifact.progress != null && (
        <div style={{ padding: '0 14px 12px' }}>
          <div className="bar"><span style={{ width: artifact.progress + '%' }} /></div>
          <div style={{ fontSize: 11, color: 'var(--frost-600)', marginTop: 6 }}>{artifact.progress}% drafted</div>
        </div>
      )}
    </div>
  );
}

function AssistantAvatar() {
  return (
    <span style={{
      width: 28, height: 28, borderRadius: 8,
      background: 'var(--primary-50)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--primary-700)', flexShrink: 0,
    }}>
      {Ico.sparkle(15)}
    </span>
  );
}

function ActivityRow({ item }) {
  const isRunning = item.state === 'running';

  return (
    <div className={`activity-row ${isRunning ? 'running' : ''}`}>
      <span className="activity-mark" aria-hidden="true">
        {isRunning ? <span className="activity-spinner" /> : Ico.check(12)}
      </span>
      <span className="activity-text">{item.content}</span>
      <span className="activity-chevron" aria-hidden="true">{Ico.chevRight(12)}</span>
    </div>
  );
}

function AttachmentMini({ attachment }) {
  const label = attachment.kind === 'url' ? 'URL' : attachment.kind === 'snippet' ? 'Snippet' : 'File';
  return (
    <div className="context-item" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="context-icon">
        {attachment.kind === 'url' ? Ico.globe(13) : attachment.kind === 'snippet' ? Ico.code(13) : Ico.doc(13)}
      </span>
      <span className="context-body">
        <span>{attachment.name || label}</span>
        <small>{attachment.extractionStatus || label}</small>
      </span>
    </div>
  );
}

function TaskRail({ task, project, visibleMessages, open, onClose }) {
  const activity = visibleMessages.filter((m) => m.role === 'activity').slice(-8);
  const attachments = task.attachments || visibleMessages.flatMap((m) => m.attachments || []);
  const stateLabel = task.status === 'active' ? 'Anton is working' : task.status === 'error' ? 'Needs attention' : 'Idle';

  return (
    <aside className={`task-rail${open ? ' open' : ''}`}>
      <button className="icon-btn task-rail-close" title="Close task details" onClick={onClose}>
        {Ico.chevRight(14)}
      </button>
      <section className="rail-panel">
        <div className="rail-title">Progress</div>
        <div className="rail-state">
          <span className={task.status === 'active' ? 'activity-spinner' : ''}>{task.status === 'active' ? '' : Ico.check(12)}</span>
          <strong>{stateLabel}</strong>
        </div>
        {activity.length ? (
          <div className="rail-list">
            {activity.map((item, index) => <ActivityRow key={index} item={item} />)}
          </div>
        ) : (
          <p className="rail-empty">Activity appears here while Anton works.</p>
        )}
      </section>

      <section className="rail-panel">
        <div className="rail-title">Working Folder</div>
        {project || task.projectPath ? (
          <div className="rail-folder">
            <strong>{project?.name || task.projectName || 'Project'}</strong>
            <span>{task.projectPath || project?.path}</span>
          </div>
        ) : (
          <p className="rail-empty">No project selected for this task.</p>
        )}
      </section>

      <section className="rail-panel">
        <div className="rail-title">Context</div>
        {attachments.length ? (
          <div className="rail-list">
            {attachments.map((attachment) => <AttachmentMini key={attachment.id} attachment={attachment} />)}
          </div>
        ) : (
          <p className="rail-empty">Attached files, URLs, and snippets appear here.</p>
        )}
      </section>
    </aside>
  );
}

export default function ChatView({
  task,
  onSend,
  onBack,
  project,
  model,
  attachments,
  onAttachFiles,
  onAttachUrl,
  onAttachSnippet,
  onAttachProjectFile,
  onBrowseProjectFiles,
  onRemoveAttachment,
  onPinTask,
  onUnpinTask,
}) {
  const scrollRef = useRef(null);
  const [railOpen, setRailOpen] = useState(false);

  const isStreaming = task.messages.some((m) => m.role === '_streaming');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task.messages.length, isStreaming]);

  useEffect(() => {
    setRailOpen(false);
  }, [task.id]);

  const visibleMessages = task.messages.filter((m) => m.role !== '_streaming');
  const dialogMessageCount = visibleMessages.filter((m) => ['user', 'assistant', 'error'].includes(m.role)).length;
  const streamingMsg = task.messages.find((m) => m.role === '_streaming');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-0)',
        flexShrink: 0,
      }}>
        <button className="icon-btn" onClick={onBack} title="Back to home">
          {Ico.chevLeft(14)}
        </button>
        <span
          className={task.status === 'active' ? 'pulse-dot' : ''}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: task.status === 'active'
              ? 'var(--primary-400)'
              : task.status === 'done'
              ? 'var(--sage-500)'
              : 'var(--stone-400)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.title}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>
            {task.subtitle} · {dialogMessageCount} messages
          </div>
        </div>
        <span className="meta-pill" style={{ height: 26, fontSize: 12 }} aria-label="Task project">
          {Ico.folder(13)} {project ? project.name : 'No project'}
        </span>
        <span className="meta-pill" style={{ height: 26, fontSize: 12 }} aria-label="Task model">
          {model?.name ?? task.model ?? 'Model'}
        </span>
        <button
          className={`icon-btn${task.pinned ? ' active' : ''}`}
          title={task.pinned ? 'Unpin task' : 'Pin task'}
          onClick={() => task.pinned ? onUnpinTask?.(task.id) : onPinTask?.(task)}
        >
          {Ico.pin(15)}
        </button>
        <button
          className={`icon-btn task-rail-toggle${railOpen ? ' active' : ''}`}
          title="Task details"
          aria-label="Task details"
          onClick={() => setRailOpen((open) => !open)}
        >
          {Ico.list(15)}
        </button>
        <button className="icon-btn">{Ico.more(15)}</button>
      </div>

      <div className="task-body">
        <main className="task-main">
          <div ref={scrollRef} className="scroll-clean task-messages">
            <div className="chat-column">
              {visibleMessages.map((m, i) => {
                if (m.role === 'user') {
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                      <div className="msg-user">{m.content}</div>
                      {m.attachments?.length > 0 && (
                        <div className="message-attachments">
                          {m.attachments.map((attachment) => <AttachmentMini key={attachment.id} attachment={attachment} />)}
                        </div>
                      )}
                    </div>
                  );
                }
                if (m.role === 'activity') {
                  return <ActivityRow key={i} item={m} />;
                }
                if (m.role === 'error') {
                  return (
                    <div key={i} className="msg-assistant">
                      <AssistantAvatar />
                      <div style={{
                        flex: 1, minWidth: 0,
                        border: '1px solid #F0C2B5',
                        background: '#FFF7F4',
                        color: '#8F321A',
                        borderRadius: 10,
                        padding: '10px 12px',
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        userSelect: 'text',
                      }}>{m.content}</div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="msg-assistant">
                    <AssistantAvatar />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="body">{m.content}</div>
                      {m.artifact && <ArtifactCard artifact={m.artifact} />}
                    </div>
                  </div>
                );
              })}

              {streamingMsg ? (
                <div className="msg-assistant">
                  <AssistantAvatar />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="body">{streamingMsg.content}<span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--primary-500)', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'pulse-dot 0.8s ease-in-out infinite' }} /></div>
                  </div>
                </div>
              ) : isStreaming && (
                <div className="msg-assistant">
                  <AssistantAvatar />
                  <div style={{ flex: 1 }}><TypingDots /></div>
                </div>
              )}
            </div>
          </div>

          <div className="chat-composer-dock">
            <Composer
              onSend={onSend}
              project={project}
              onProjectChange={() => {}}
              model={model}
              onModelChange={() => {}}
              projects={[]}
              models={model ? [model] : []}
              attachments={attachments}
              onAttachFiles={onAttachFiles}
              onAttachUrl={onAttachUrl}
              onAttachSnippet={onAttachSnippet}
              onAttachProjectFile={onAttachProjectFile}
              onBrowseProjectFiles={onBrowseProjectFiles}
              onRemoveAttachment={onRemoveAttachment}
              placeholder="Reply…"
              metaReadOnly
              hideMeta
            />
          </div>
        </main>

        <TaskRail
          task={task}
          project={project}
          visibleMessages={visibleMessages}
          open={railOpen}
          onClose={() => setRailOpen(false)}
        />
      </div>
    </div>
  );
}
