// Shared dropdown menu for collection cards (projects, artifacts, …).
//
// Why a shared component:
//   • Same hover-then-kebab pattern across collection pages → users
//     learn the affordance once.
//   • Anchored positioning needs the flip-up-when-no-room-below trick
//     and click-outside / Escape handling — duplicating that in every
//     view leads to drift (tested in Projects → broken in Artifacts).
//   • CRITICAL: must render at the page level, NOT inside the card.
//     Card hovers commonly apply `transform: translateY(-1px)`; once
//     a parent has any `transform != none`, it becomes the containing
//     block for `position: fixed` descendants — so a menu rendered
//     inside the card would be positioned relative to the card, not
//     the viewport, and read as "stuck behind the card" or in a
//     strange place.
//
// Usage (parent owns the menu state, cards just request it):
//
//   const [menuFor, setMenuFor] = useState(null); // { item, rect }
//   <Card onMenuOpen={(item, rect) => setMenuFor({ item, rect })} />
//   <HoverMenu
//     open={!!menuFor}
//     anchorRect={menuFor?.rect}
//     onClose={() => setMenuFor(null)}
//     items={[
//       { id: 'publish',  label: 'Publish',  icon: <…/>, onClick: () => … },
//       { separator: true },
//       { id: 'delete',   label: 'Delete',   icon: <…/>, danger: true,
//         onClick: () => … },
//     ]}
//   />

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const FONT_BODY = 'var(--font-body)';

export function HoverMenu({ open, anchorRect, onClose, items = [], width = 200 }) {
  const ref = useRef(null);
  // Layout state — `measured` gates the visibility flag so the menu
  // doesn't flash at the wrong Y while we figure out whether to flip
  // it above or below the anchor.
  const [layout, setLayout] = useState({ top: 0, measured: false });

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) onClose?.(); };
    const onKey   = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown',   onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown',   onKey);
    };
  }, [open, onClose]);

  // Reset measurement on every (re)open so a hidden→visible cycle
  // re-runs the layout pass.
  useLayoutEffect(() => {
    if (open) setLayout((l) => ({ ...l, measured: false }));
  }, [open, anchorRect, items?.length]);

  const VISIBLE_GAP = 4;
  const VIEWPORT_PAD = 8;

  useLayoutEffect(() => {
    if (!open || !ref.current || !anchorRect) return;
    const h = ref.current.offsetHeight;
    const VH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const spaceBelow = VH - VIEWPORT_PAD - anchorRect.bottom;
    const flip = h + VISIBLE_GAP > spaceBelow;
    const top = flip
      ? Math.max(VIEWPORT_PAD, anchorRect.top - VISIBLE_GAP - h)
      : anchorRect.bottom + VISIBLE_GAP;
    setLayout({ top, measured: true });
  }, [open, anchorRect, items?.length]);

  if (!open || !anchorRect) return null;

  const left = Math.min(
    window.innerWidth - width - VIEWPORT_PAD,
    Math.max(VIEWPORT_PAD, anchorRect.right - width),
  );

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top: layout.top, left, zIndex: 60,
        width,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
        padding: '4px 0',
        WebkitAppRegion: 'no-drag',
        visibility: layout.measured ? 'visible' : 'hidden',
        fontFamily: FONT_BODY,
      }}
    >
      {items.map((it, idx) => {
        if (it.separator) {
          return (
            <div
              key={`sep-${idx}`}
              style={{ height: 1, background: 'var(--line)', margin: '4px 0' }}
            />
          );
        }
        const danger   = !!it.danger;
        const disabled = !!it.disabled;
        return (
          <button
            key={it.id || `it-${idx}`}
            type="button"
            disabled={disabled}
            title={it.title}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              it.onClick?.();
              onClose?.();
            }}
            style={{
              width: 'calc(100% - 8px)', margin: '0 4px',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 5,
              background: 'transparent', border: 0,
              fontFamily: FONT_BODY, fontSize: 13,
              color: danger ? 'var(--danger)' : 'var(--ink-2)',
              textAlign: 'left',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
            onMouseOver={(e) => {
              if (disabled) return;
              e.currentTarget.style.background = danger
                ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                : 'var(--surface-2)';
            }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {it.icon && (
              <span style={{
                display: 'inline-flex', flexShrink: 0,
                color: danger ? 'var(--danger)' : 'var(--ink-3)',
              }}>{it.icon}</span>
            )}
            <span style={{ flex: 1 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
