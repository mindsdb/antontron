// Streaming — message helpers + send handlers + stop + data vault submission.
//
// Owns: activeStreamCtrlRef, activeScratchpadRef, all streaming state
// machine transitions, persistTurnState on completion, two-phase home
// send, connector-picked flow, data vault form submission.

import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  streamNewSession, streamMessage, streamDataVaultSubmission,
  createProject, fetchProjects, fetchDatasources,
  fetchConnector, cancelScratchpad,
} from '../api';
import { initialStreamState, reduceStream } from '../lib/responseStreamAdapter';
import { setForm as setDataVaultForm, getFormState as getDataVaultFormState } from '../components/datavault/formStore';
import { persistTurnState } from './useConversationTurns';
import { THINKING_PLACEHOLDER } from '../constants';


// ── Message helpers ─────────────────────────────────────────────────────

export function stripStreaming(messages) {
  return messages.filter((m) => m.role !== '_streaming');
}

export function removeThinkingPlaceholder(messages) {
  return messages.filter((m) => !(m.role === 'activity' && m.placeholder));
}

export function withThinkingPlaceholder(messages) {
  return [
    ...removeThinkingPlaceholder(stripStreaming(messages)),
    {
      role: 'activity',
      content: THINKING_PLACEHOLDER,
      kind: 'placeholder',
      phase: 'reasoning',
      state: 'running',
      placeholder: true,
    },
  ];
}

export function markActivityDone(messages) {
  return messages.map((m) => (
    m.role === 'activity' && m.state === 'running'
      ? { ...m, state: 'done' }
      : m
  ));
}

const STOP_MESSAGES = [
  'Task stopped \u2014 let me know what to try next.',
  'Got it, I stepped back. Want to take another angle?',
  'Stopped here. What would you like me to do instead?',
  'Paused as requested. Ready when you are.',
  'All halted. Tell me how to proceed.',
  'Done \u2014 execution stopped on your call.',
  'Standing by. Send another prompt when you\u2019re ready.',
  'Task halted gracefully. What\u2019s next?',
];

const CONNECT_FOLLOWUPS = [
  "Have a question about any of the fields? I'm happy to explain.",
  "Need help finding your credentials? Just ask.",
  "If anything's unclear, let me know \u2014 I can walk you through it.",
  "Curious what a specific field expects? I can clarify.",
  "Want more detail on any of the steps? Just ask.",
  "Have questions before you submit? I'm here.",
  "Want me to explain any of the fields more deeply? Let me know.",
  "Happy to clarify anything before you fill it out.",
  "If you'd like more context on a field, just ask.",
  "Any questions about the setup? I'm here to help.",
];

function describeConnectFormState(state) {
  if (!state) return '';
  const lines = [];
  if (state.title) lines.push(`Connector: ${state.title}`);
  if (state.methodLabel || state.method) {
    lines.push(`Selected method: ${state.methodLabel || state.method}`);
  } else {
    lines.push('Selected method: (none yet)');
  }
  const entries = Object.entries(state.fields || {});
  if (entries.length === 0) {
    lines.push('Filled fields: (none yet)');
  } else {
    const parts = entries.map(([k, v]) =>
      v === '__REDACTED__' ? `${k}: (filled, redacted)` : `${k}: ${v}`
    );
    lines.push(`Filled fields: ${parts.join('; ')}`);
  }
  return [
    '[connect form state \u2014 Anton-only context, do not echo back]',
    ...lines,
  ].join('\n');
}


// ── Hook ────────────────────────────────────────────────────────────────

export default function useStreaming({
  setTasks, setActiveTaskId, setRoute,
  setProjects, setConnectors,
  refreshArtifacts, refreshHealth,
}) {
  const activeStreamCtrlRef = useRef(null);
  const activeScratchpadRef = useRef(null);

  // ── Stop ──────────────────────────────────────────────────────────────

  const handleStopStream = useCallback(async () => {
    const padName = activeScratchpadRef.current;
    if (padName) {
      try { await cancelScratchpad(padName); } catch {}
    }
    const ctrl = activeStreamCtrlRef.current;
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      activeStreamCtrlRef.current = null;
    }
    activeScratchpadRef.current = null;

    const stoppedMsg = STOP_MESSAGES[Math.floor(Math.random() * STOP_MESSAGES.length)];
    setTasks((prev) => prev.map((t) => {
      const streaming = (t.messages || []).find((m) => m.role === '_streaming');
      if (!streaming) return t;
      const others = t.messages
        .filter((m) => m.role !== '_streaming')
        .filter((m) => m.role !== 'activity');
      return {
        ...t,
        status: 'idle',
        messages: [...others, {
          role: 'assistant',
          content: stoppedMsg,
          steps: [],
          startedAt: streaming.startedAt,
        }],
      };
    }));
  }, [setTasks]);

  // ── Send from home ────────────────────────────────────────────────────

  const handleSendFromHome = useCallback(async (text, {
    composerAttachments,
    selectedProject,
    selectedModel,
    projects,
    clearAttachments,
  }) => {
    const tempId = 'tmp-' + Date.now();
    const sendingAttachments = composerAttachments;
    const attachmentIds = sendingAttachments.map((a) => a.id);

    let generalProject = projects.find((p) => p.name === 'general');
    if (!selectedProject && !generalProject) {
      try {
        await createProject('general');
        const fresh = await fetchProjects();
        if (Array.isArray(fresh)) setProjects(fresh);
        generalProject = (fresh || []).find((p) => p.name === 'general');
      } catch (e) {
        console.warn('[handleSendFromHome] could not bootstrap general project', e);
      }
    }
    const effectiveProjectName = selectedProject?.name || 'general';
    const effectiveProjectPath = selectedProject?.path || generalProject?.path || null;

    const newT = {
      id: tempId,
      title: text.length > 60 ? text.slice(0, 57) + '\u2026' : text,
      subtitle: 'just now',
      status: 'active',
      messages: [],
      projectPath: effectiveProjectPath,
      projectName: effectiveProjectName,
      model: selectedModel?.id ?? null,
      attachments: sendingAttachments,
    };
    setTasks((prev) => [newT, ...prev]);
    setActiveTaskId(tempId);
    setRoute('task');
    clearAttachments();

    let assistantContent = '';
    let resolvedId = tempId;
    let streamState = initialStreamState();

    const flushStreamingMessage = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== resolvedId && t.id !== tempId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    const resolveId = (sid) => {
      if (!sid || sid === resolvedId) return;
      const previousId = resolvedId;
      resolvedId = sid;
      setTasks((prev) => prev.map((t) =>
        t.id === previousId || t.id === tempId ? { ...t, id: sid } : t,
      ));
      setActiveTaskId(sid);
    };

    const startConversation = () => {
      setTasks((prev) => prev.map((t) =>
        t.id === tempId
          ? { ...t, messages: withThinkingPlaceholder([{ role: 'user', content: text, attachments: sendingAttachments }]) }
          : t,
      ));
      activeStreamCtrlRef.current = streamNewSession(text, {
        projectName: effectiveProjectName,
        projectPath: effectiveProjectPath,
        model: selectedModel?.id,
        attachmentIds,
        onEvent(ev) {
          streamState = reduceStream(streamState, ev);
          const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
          if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
          flushSync(() => flushStreamingMessage());
        },
        onChunk(chunk, sid) { resolveId(sid); assistantContent += chunk; },
        onProgress(_event, sid) { resolveId(sid); },
        onToolResult(_event, sid) { resolveId(sid); },
        onDone(sid) {
          activeStreamCtrlRef.current = null;
          activeScratchpadRef.current = null;
          const finalId = sid || resolvedId;
          const finalContent = streamState.bodyText || assistantContent;
          const finalSteps = streamState.steps;
          const finalStartedAt = streamState.startedAt;
          let assistantTurnIndex = 0;
          setTasks((prev) => prev.map((t) => {
            if (t.id !== finalId && t.id !== resolvedId && t.id !== tempId) return t;
            const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
            assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
            return finalContent
              ? { ...t, id: finalId, status: 'idle', messages: [...msgs, { role: 'assistant', content: finalContent, steps: finalSteps, startedAt: finalStartedAt }] }
              : { ...t, id: finalId, status: 'idle', messages: msgs };
          }));
          setActiveTaskId(finalId);
          if (finalContent) persistTurnState(finalId, assistantTurnIndex, finalSteps, finalStartedAt);
          refreshArtifacts();
        },
        onError(message, event) {
          setTasks((prev) => prev.map((t) => {
            if (t.id !== resolvedId && t.id !== tempId) return t;
            const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
            return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
          }));
          refreshHealth();
        },
      });
    };

    requestAnimationFrame(() => requestAnimationFrame(startConversation));
  }, [setTasks, setActiveTaskId, setRoute, setProjects, refreshArtifacts, refreshHealth]);

  // ── Send in existing task ─────────────────────────────────────────────

  const handleSendInTask = useCallback((text, {
    currentTask,
    currentTaskProject,
    composerAttachments,
    selectedModel,
    clearAttachments,
  }) => {
    if (!currentTask) return;
    const id = currentTask.id;
    const sendingAttachments = composerAttachments;
    const attachmentIds = sendingAttachments.map((a) => a.id);

    setTasks((prev) => prev.map((t) =>
      t.id === id
        ? {
            ...t,
            status: 'active',
            attachments: [...(t.attachments || []), ...sendingAttachments],
            messages: withThinkingPlaceholder([...t.messages, { role: 'user', content: text, attachments: sendingAttachments }]),
          }
        : t,
    ));
    clearAttachments();

    let assistantContent = '';
    let streamState = initialStreamState();

    const taskProjectName = currentTask.projectName || currentTaskProject?.name || null;
    const taskProjectPath = currentTask.projectPath || currentTaskProject?.path || null;
    const taskModel = currentTask.model || selectedModel?.id || null;

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    // Append connect form context if active for this conversation.
    const connectFormState = getDataVaultFormState(id);
    const connectContext = describeConnectFormState(connectFormState);
    const sendText = connectContext ? `${text}\n\n${connectContext}` : text;

    activeStreamCtrlRef.current = streamMessage(id, sendText, {
      projectName: taskProjectName,
      projectPath: taskProjectPath,
      model: taskModel,
      attachmentIds,
      onEvent(ev) {
        streamState = reduceStream(streamState, ev);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onChunk(chunk) { assistantContent += chunk; },
      onDone() {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, { role: 'assistant', content: finalContent, steps: finalSteps, startedAt: finalStartedAt }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent) persistTurnState(id, assistantTurnIndex, finalSteps, finalStartedAt);
        refreshArtifacts();
      },
      onError(message, event) {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
        }));
        refreshHealth();
      },
    });
  }, [setTasks, refreshArtifacts, refreshHealth]);

  // ── Data vault form submission ────────────────────────────────────────

  const handleSubmitDataVaultForm = useCallback(({ formId, formSpec, values, skipped }, { currentTask }) => {
    if (!currentTask) return;
    const id = currentTask.id;

    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: 'active' } : t));

    let assistantContent = '';
    let streamState = initialStreamState();

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    activeStreamCtrlRef.current = streamDataVaultSubmission({
      formId,
      conversationId: id,
      formSpec,
      values,
      skipped,
      onEvent(ev) {
        streamState = reduceStream(streamState, ev);
        flushSync(() => flushStreaming());
      },
      onChunk(chunk) { assistantContent += chunk; },
      onDone() {
        activeStreamCtrlRef.current = null;
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, { role: 'assistant', content: finalContent, steps: finalSteps, startedAt: finalStartedAt }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent) persistTurnState(id, assistantTurnIndex, finalSteps, finalStartedAt);
        fetchDatasources()
          .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
          .catch(() => {});
      },
      onError(message) {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Form submission failed.' }] };
        }));
      },
    });
  }, [setTasks, setConnectors]);

  // ── Connector picked (from ConnectorPicker modal) ─────────────────────

  const handleConnectorPicked = useCallback(async (connector, {
    selectedProject, selectedModel, projects, clearAttachments,
  }) => {
    if (!connector?.id) return;

    let full = null;
    try {
      full = await fetchConnector(connector.id);
    } catch (e) {
      console.warn('[connectors] failed to load full spec, falling back to chat', e);
    }

    const label = full?.label || connector.label || connector.id;
    const tempId = 'tmp-connect-' + Date.now();
    const hasLiteralForm = !!(full && full.form);

    setTasks((prev) => [{
      id: tempId,
      title: `Connect ${label}`,
      subtitle: 'just now',
      status: hasLiteralForm ? 'idle' : 'active',
      messages: hasLiteralForm
        ? [
            {
              role: 'assistant',
              _kind: 'connect_intro',
              connector: {
                id: full.id,
                label,
                logo: full.form?.logo || full.logo,
                logo_color: full.form?.logo_color || full.logo_color,
              },
              content: `Connect ${label}`,
              _client_only: true,
            },
            {
              role: 'assistant',
              content: CONNECT_FOLLOWUPS[Math.floor(Math.random() * CONNECT_FOLLOWUPS.length)],
              _client_only: true,
            },
          ]
        : [
            {
              role: 'assistant',
              content: `Let's connect ${label}.`,
              _client_only: true,
            },
          ],
      projectName: selectedProject?.name || 'general',
      projectPath: selectedProject?.path || null,
      model: selectedModel?.id || null,
      attachments: [],
    }, ...prev]);
    setActiveTaskId(tempId);
    clearAttachments();
    setRoute('task');

    if (hasLiteralForm) {
      setDataVaultForm(tempId, {
        ...full.form,
        engine: full.form.engine || full.id,
        _connector_id: full.id,
        logo: full.form.logo || full.logo,
        logo_color: full.form.logo_color || full.logo_color,
      });
    } else {
      // No registry entry — fall back to chat-agent flow.
      // Use setTimeout to avoid calling handleSendFromHome during render.
      setTimeout(() => {
        handleSendFromHome(`Connect ${label}`, {
          composerAttachments: [],
          selectedProject,
          selectedModel,
          projects,
          clearAttachments: () => {},
        });
      }, 0);
    }
  }, [setTasks, setActiveTaskId, setRoute, handleSendFromHome]);

  return {
    handleSendFromHome,
    handleSendInTask,
    handleStopStream,
    handleSubmitDataVaultForm,
    handleConnectorPicked,
  };
}
