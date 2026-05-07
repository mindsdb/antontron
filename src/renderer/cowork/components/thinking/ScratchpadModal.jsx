// Scratchpad viewer — input/output focused, with a toggle to reveal
// the underlying code + stderr per cell. Borrowed visual structure
// from mdb-ai's playground panel: tabs across the top group cells by
// `_scratchpadTabId` (anton's `name`); each cell shows description +
// timing + output prominently, with code/errors hidden behind a
// "Show code" toggle.
//
// Code is syntax-highlighted via prism (CodeBlock component) and uses
// JetBrains Mono for the editor font. Theme follows body[data-theme].

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { CodeBlock } from './CodeBlock';

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function detectLanguage(data) {
  // Anton runs Python in the scratchpad sandbox by default. If the
  // future allows other languages, infer from data.action or similar.
  return 'python';
}

// Synthetic group key for cells that arrived without a
// _scratchpadTabId — usually the LLM emitted the tool call without a
// `name` field (or the JSON was truncated mid-stream and the field
// was lost). Bucketing all of them under one tab keeps the strip
// from fragmenting into a row of one-cell pads, and the per-cell
// `step x/y` counter reflects the position within this single
// group rather than 1/1 over and over.
const UNNAMED_TAB_KEY = '__unnamed__';

export function ScratchpadModal({ open, onClose, steps = [], focusStepId = null }) {
  // Group cells by their canonical tab id (anton's `name` field).
  // Trim + validate so the empty string and whitespace-only strings
  // don't silently land in a "" group. Unnamed cells flow into a
  // single UNNAMED_TAB_KEY bucket so we never split one logical
  // pad across multiple tabs.
  const tabs = useMemo(() => {
    const byTab = new Map();
    for (const s of steps) {
      if (!s._isScratchpad) continue;
      const raw = s._scratchpadTabId;
      const tabId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      const key = tabId || UNNAMED_TAB_KEY;
      const displayName = tabId || 'Untitled';
      if (!byTab.has(key)) {
        byTab.set(key, { id: key, name: displayName, cells: [] });
      }
      byTab.get(key).cells.push(s);
    }
    return [...byTab.values()];
  }, [steps]);

  const focusTabId = useMemo(() => {
    if (!focusStepId) return tabs[0]?.id;
    const focused = steps.find((s) => s.id === focusStepId);
    if (!focused) return tabs[0]?.id;
    const raw = focused._scratchpadTabId;
    const trimmed = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    const key = trimmed || UNNAMED_TAB_KEY;
    return tabs.find((t) => t.id === key)?.id || tabs[0]?.id;
  }, [focusStepId, steps, tabs]);

  const [activeTabId, setActiveTabId] = useState(focusTabId);
  useEffect(() => { if (focusTabId) setActiveTabId(focusTabId); }, [focusTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="flex h-[82vh] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">

        {/* Modal header — title + close. Per-cell `step x/y` already
            says the count, so we don't repeat it here. */}
        <div className="flex flex-none items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex text-ink-3">{Ico.code(15)}</span>
            <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
              Scratchpad
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        {/* Tab strip — only when more than one pad. Bottom-border
            underline indicator instead of pill buttons; matches the
            segmented-control language used elsewhere in the app
            (e.g. the connector picker's filter row). Each tab shows
            the pad name + a small count badge so the user can see
            the cell distribution at a glance. */}
        {tabs.length > 1 && (
          <div className="flex flex-none gap-1 overflow-x-auto border-b border-line bg-surface px-2">
            {tabs.map((t) => {
              const active = t.id === activeTabId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTabId(t.id)}
                  className={clsx(
                    'relative flex flex-none cursor-pointer items-center gap-2 px-3 py-2.5',
                    'font-display text-[12.5px] font-medium tracking-tight',
                    'transition-colors',
                    active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
                  )}
                >
                  <span className="truncate max-w-[180px]" title={t.name}>{t.name}</span>
                  <span className={clsx(
                    'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5',
                    'font-mono text-[10.5px] font-medium tabular-nums',
                    active ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-ink-4'
                  )}>{t.cells.length}</span>
                  {active && (
                    <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Cells — vertical stack inside the active pad */}
        <div className="flex-1 overflow-y-auto" style={{ WebkitAppRegion: 'no-drag' }}>
          {activeTab?.cells.map((cell, i) => (
            <CellView
              key={cell.id}
              cell={cell}
              index={i + 1}
              total={activeTab.cells.length}
              focused={cell.id === focusStepId}
            />
          ))}
          {(!activeTab || activeTab.cells.length === 0) && (
            <p className="p-8 text-body text-ink-4">No steps in this turn.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CellView({ cell, index, total, focused = false }) {
  const [showCode, setShowCode] = useState(false);
  const containerRef = useRef(null);
  const data = cell.data || {};

  // When the modal opens with this cell as the click target,
  // scroll it into view inside the cells column and briefly
  // highlight its left border so the user knows which cell their
  // click landed on. Only fires when `focused` flips true; the
  // highlight auto-clears after ~1.6s.
  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    if (!focused) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;
    const id = requestAnimationFrame(() => {
      try { node.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      catch { node.scrollIntoView(); }
    });
    setHighlight(true);
    const t = setTimeout(() => setHighlight(false), 1600);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, [focused]);
  // The cell's input event (.end) and result event (.result) BOTH
  // carry the source code. Server clips long tool events at 64 KB —
  // for the rare cell that exceeds that, one of the two fields may
  // still hold a parseable copy. Try data.code first (canonical),
  // then result.code (sent with stdout/stderr), then result.input.code.
  const code =
       data.code
    || cell.result?.code
    || cell.result?.input?.code
    || '';
  const stdout = cell.output || cell.result?.stdout || '';
  const stderr = cell.stderr || cell.result?.stderr || '';
  const reasoningMs =
    cell.executionStartedAt && cell.reasoningStartedAt
      ? cell.executionStartedAt - cell.reasoningStartedAt
      : null;
  const executionMs =
    cell.executionCompletedAt && cell.executionStartedAt
      ? cell.executionCompletedAt - cell.executionStartedAt
      : null;
  const language = detectLanguage(data);
  const hasErr = !!stderr;
  // Auto-reveal code for the cell that has an error (likely what the
  // user wants to inspect right away).
  useEffect(() => { if (hasErr) setShowCode(true); }, [hasErr]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        'border-b border-line py-5 last:border-b-0',
        // Inset the card 4px so the highlight bar can sit at the
        // exact left edge of the cell when focused. Padding stays
        // consistent in both states.
        'pl-6 pr-6',
        // Subtle accent left-border that fades out — visible cue for
        // "this is the cell you clicked." Transparent border preserves
        // layout so non-focused cells don't shift.
        'border-l-2',
        highlight ? 'border-l-accent bg-surface-2' : 'border-l-transparent',
        'transition-colors duration-700',
      )}
    >
      {/* Step header — `step x/y` badge on the left, then a stacked
          column with the description + timing meta. The meta strip
          sits in the same column so reason/exec align under the
          description text rather than under the step badge. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-mono text-[10.5px] tracking-wider text-ink-4 flex-none">
            step {index}/{total}
          </span>
          <div className="min-w-0 flex flex-col gap-1">
            <span className="truncate font-display text-[14px] font-semibold tracking-tight text-ink">
              {data.one_line_description || cell.label || 'Untitled'}
            </span>
            {/* Always render reason + exec, even when timing data is
                missing — a "—" placeholder reads as "no data" without
                the meta strip going missing entirely. */}
            <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-4">
              <span>reason: <span className="text-ink-3">{fmtMs(reasoningMs) ?? '—'}</span></span>
              <span>exec: <span className="text-ink-3">{fmtMs(executionMs) ?? '—'}</span></span>
            </div>
          </div>
        </div>
        {code && (
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className={clsx(
              'flex flex-none cursor-pointer items-center gap-1 rounded-md px-2 py-1',
              'font-body text-[11.5px] font-medium',
              'transition-colors',
              showCode
                ? 'bg-surface-2 text-ink hover:bg-surface-3'
                : 'text-ink-3 hover:text-ink hover:bg-surface-2'
            )}
          >
            {showCode ? 'Hide code' : 'Show code'}
          </button>
        )}
      </div>

      {/* Output — render as a bare block without a section label, and
          omit it entirely when the step produced no stdout. Steps that
          only manipulate state (no print) shouldn't surface a "no
          output" placeholder; the absence is the cleanest signal. */}
      {stdout && (
        <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-snug text-ink">
{stdout}
        </pre>
      )}

      {/* Code + stderr — revealed by the toggle (or auto-revealed
          when there's an error). The Code section only renders when
          we actually have code; otherwise we'd print "No code
          captured" above the stderr block, which adds nothing. */}
      {showCode && (
        <>
          {code && (
            <Section
              label="Code"
              right={Array.isArray(data.packages) && data.packages.length > 0 ? (
                <span
                  className="font-mono text-[10.5px] text-ink-4 truncate max-w-[60%]"
                  title={data.packages.join(', ')}
                >
                  pkgs: <span className="text-ink-3">{data.packages.join(', ')}</span>
                </span>
              ) : null}
            >
              <div className="overflow-hidden rounded-md border border-line">
                <CodeBlock code={code} language={language} />
              </div>
            </Section>
          )}

          {hasErr && (
            <Section label="Stderr">
              <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-[12px] leading-snug text-red-700">
{stderr}
              </pre>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ label, muted = false, right, children }) {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={clsx(
          'font-display text-[10.5px] font-semibold uppercase tracking-widest',
          muted ? 'text-ink-4 opacity-60' : 'text-ink-4'
        )}>
          {label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}
