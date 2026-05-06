// Grid/list segmented control. Two states only — opinionated by
// design; views that need a different mode (e.g. a "card vs table"
// distinction) should still treat list = denser-than-grid so the
// mental model stays consistent across pages.
//
// Pass-through `options` lets a view rename the labels (e.g.
// Connect Apps could surface "Cards / Table" if that reads better
// in context) without forking the styling.

import Ico from '../Icons';

const FONT_BODY = 'var(--font-body)';

const DEFAULT_OPTIONS = [
  { id: 'grid', label: 'Grid', icon: (n) => Ico.grid(n) },
  { id: 'list', label: 'List', icon: (n) => Ico.list(n) },
];

export function ViewToggle({ value, onChange, options = DEFAULT_OPTIONS }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 0,
      padding: 2, borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
    }}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange?.(opt.id)}
            title={opt.label}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 5,
              background: active ? 'var(--surface-3)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              border: 0,
              boxShadow: active ? 'inset 0 0 0 1px var(--line-2)' : 'none',
              fontFamily: FONT_BODY, fontSize: 12,
              cursor: 'pointer',
              transition: 'background .15s ease, color .15s ease',
            }}
          >
            {opt.icon ? opt.icon(12) : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
