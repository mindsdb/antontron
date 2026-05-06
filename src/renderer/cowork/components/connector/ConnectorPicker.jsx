// Connector picker — modal panel surfaced when the user clicks
// "Connect". Lists the predefined connectors from the server (each
// .json in server/connectors/) with a search box at the top.
//
// Selection emits the picked connector summary up to the host;
// rendering the form spec is the host's responsibility (next step
// will wire that to DataVaultForm).
//
// Search is client-side fuzzy match for now (label / aliases /
// keywords / category / description). When the registry grows we
// can switch to /connectors/match for the natural-language path.

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchConnectors } from '../../api';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";

// Category → fallback Ico name when a connector doesn't ship its own
// flat icon. Keep this map small and obvious; "other" → generic puzzle.
const CATEGORY_ICON = {
  communication: 'mail',
  data:          'database',
  storage:       'folder',
  webapp:        'globe',
  developer:     'code',
};

function iconFor(connector) {
  const name = connector.logo
    || CATEGORY_ICON[connector.category]
    || 'database';
  return Ico[name] || Ico.database;
}

function ConnectorTile({ connector, onPick }) {
  const Icon = iconFor(connector);
  return (
    <button
      type="button"
      onClick={() => onPick?.(connector)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '14px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit', color: 'inherit',
        transition: 'border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 4px 18px rgba(15,16,17,0.06)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <span style={{
        display: 'inline-grid', placeItems: 'center',
        width: 40, height: 40, borderRadius: 8,
        background: 'var(--surface-2)',
        color: connector.logo_color || 'var(--ink-3)',
        flexShrink: 0,
      }}>
        {Icon(22)}
      </span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: 'var(--ink)',
          letterSpacing: '-0.005em',
        }}>{connector.label || connector.id}</span>
        {connector.description && (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)',
            lineHeight: 1.4,
          }}>{connector.description}</span>
        )}
      </div>
    </button>
  );
}

export default function ConnectorPicker({ open, onPick, onClose }) {
  const [connectors, setConnectors] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  // Load + reset on each open. Cheap call (cached server-side); we
  // refetch in case new JSONs were dropped in during dev.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setQuery('');
    fetchConnectors()
      .then((list) => setConnectors(Array.isArray(list) ? list : []))
      .catch((e) => setError(e?.message || 'Failed to load connectors'))
      .finally(() => setLoading(false));
  }, [open]);

  // Auto-focus the search input when the picker opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Client-side filter. Substring match across the visible metadata
  // — label / description / aliases / category. Once the registry
  // grows past ~30 entries we'll swap to /connectors/match.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter((c) => {
      const hay = [
        c.label,
        c.description,
        c.category,
        ...(c.aliases || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [connectors, query]);

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 92vw)',
          height: 'min(640px, 86vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        {/* Header — search box + close. The whole header reads as
            the search affordance; no extra title since users land
            here by clicking "Connect" and already know the context. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--ink-3)', flexShrink: 0 }}>
            {Ico.search(15)}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors — gmail, postgres, slack…"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            style={{
              flex: 1, minWidth: 0,
              border: 0, outline: 0, background: 'transparent',
              fontFamily: FONT_BODY, fontSize: 14,
              color: 'var(--ink)',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            style={{
              cursor: 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>

        {/* Body — grid of connector tiles, scrollable. surface-2
            background so the tiles (on var(--surface)) read as
            elevated cards against a quiet base.
            `minHeight: 0` is the flexbox gotcha that lets a flex
            child actually shrink below its content size — without
            it, `overflowY: auto` never triggers and the grid
            silently overflows the modal. */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: 16,
          background: 'var(--surface-2)',
        }}>
          {loading && (
            <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 13 }}>
              Loading connectors…
            </div>
          )}
          {error && (
            <div style={{ padding: 12, color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 13 }}>
              {query
                ? <>No connectors match <strong>“{query}”</strong>.</>
                : 'No connectors available yet.'}
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}>
            {filtered.map((c) => (
              <ConnectorTile key={c.id} connector={c} onPick={onPick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
