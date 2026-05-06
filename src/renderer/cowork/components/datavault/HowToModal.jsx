// Markdown "How to" modal — surfaces when a connector method's
// `how_to` field is set in its JSON spec. Renders the markdown
// through the same MarkdownContent we use in chat, so links open
// externally (the renderer's <a target="_blank"> path is already
// routed through main's setWindowOpenHandler → shell.openExternal).
//
// Falls back to the external `help_url` path at the call site when
// only the URL is provided — we never reach this modal without
// markdown content.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownContent } from '../markdown/MarkdownContent';
import Ico from '../Icons';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";

export default function HowToModal({ open, title, content, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body> so the fixed-positioned overlay can't be
  // contained by a parent stacking context (the form panel sits
  // inside RailCard / right-rail wrappers; without the portal the
  // modal renders aligned to the form column instead of the
  // window). z-index 1200 lifts it above the macOS .titlebar-drag
  // (1000) and the legal viewer (1100) too.
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
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
          width: 'min(640px, 92vw)',
          maxHeight: 'min(720px, 88vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <span style={{
            display: 'inline-flex', color: 'var(--accent)', flexShrink: 0,
          }}>{Ico.book ? Ico.book(15) : Ico.doc(15)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: 'var(--ink)',
            }}>{title || 'How to'}</div>
          </div>
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

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '16px 22px 22px',
          background: 'var(--surface)',
        }}>
          <MarkdownContent text={content || ''} id="howto" complete />
        </div>
      </div>
    </div>,
    document.body,
  );
}
