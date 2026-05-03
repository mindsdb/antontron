import Ico from '../components/Icons';
import { useState } from 'react';
import { openArtifact, previewArtifact, revealArtifact } from '../api';

function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1 }}>
        <h2 className="page-title">{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--frost-600)', marginTop: 4 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

export default function ArtifactsView({ artifacts }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const handlePreview = async (artifact) => {
    setError('');
    try {
      const data = await previewArtifact(artifact.path);
      setPreview(data);
    } catch (err) {
      setError(err.message || 'Preview unavailable');
      await openArtifact(artifact.path);
    }
  };

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Live artifacts"
        subtitle="Documents, dashboards, and code that update as your tasks progress."
      />

      {artifacts.length === 0 ? (
        <div style={{ padding: '60px 32px', textAlign: 'center', color: 'var(--frost-600)' }}>
          <div style={{ display: 'inline-flex', color: 'var(--stone-300)', marginBottom: 12 }}>{Ico.sparkle(32)}</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6 }}>No artifacts yet</div>
          <div style={{ fontSize: 13 }}>When Anton creates documents, dashboards, or code outputs they'll appear here.</div>
        </div>
      ) : (
        <div style={{
          padding: 28,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {artifacts.map((a) => (
            <div key={a.id} data-artifact-path={a.path} style={{
              background: 'var(--surface-0)', border: '1px solid var(--border-01)',
              borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
              cursor: 'pointer', transition: 'box-shadow .15s',
            }}
              onClick={() => handlePreview(a)}
              onMouseOver={(e) => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)'; }}
              onMouseOut={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
            >
              <div style={{
                height: 96, background: a.bg,
                display: 'flex', alignItems: 'flex-end', padding: 12,
                borderBottom: '1px solid var(--border-0)',
                fontFamily: 'var(--font-mono)', fontSize: 10.5,
                color: 'var(--frost-700)', whiteSpace: 'pre', overflow: 'hidden',
              }}>
                {a.snippet}
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{a.title}</span>
                  {a.live && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--sage-600)', fontWeight: 500 }}>
                      <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage-500)' }} />
                      Live
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--frost-600)', marginTop: 4 }}>{a.kind} · {a.updated}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    className="btn-secondary"
                    data-artifact-action="preview"
                    onClick={(e) => { e.stopPropagation(); handlePreview(a); }}
                  >Preview</button>
                  <button
                    className="btn-secondary"
                    data-artifact-action="open"
                    onClick={(e) => { e.stopPropagation(); openArtifact(a.path); }}
                  >Open</button>
                  <button
                    className="btn-secondary"
                    data-artifact-action="reveal"
                    onClick={(e) => { e.stopPropagation(); revealArtifact(a.path); }}
                  >Reveal</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ margin: '0 28px 16px', color: '#8F321A', fontSize: 12.5 }}>{error}</div>
      )}

      {preview && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(8,11,12,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32,
          }}
          onClick={() => setPreview(null)}
        >
          <div
            style={{
              width: 'min(860px, 92vw)', maxHeight: '82vh',
              background: 'var(--surface-0)',
              borderRadius: 12,
              boxShadow: '0 24px 80px rgba(0,0,0,0.28)',
              border: '1px solid var(--border-01)',
              display: 'flex', flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 16px', borderBottom: '1px solid var(--border-0)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)', flex: 1 }}>{preview.title}</div>
              <button className="btn-secondary" onClick={() => openArtifact(preview.path)}>Open</button>
              <button className="btn-secondary" onClick={() => revealArtifact(preview.path)}>Reveal</button>
              <button className="icon-btn" onClick={() => setPreview(null)} title="Close">{Ico.chevLeft(14)}</button>
            </div>
            <pre style={{
              margin: 0, padding: 16, overflow: 'auto',
              whiteSpace: 'pre-wrap', userSelect: 'text',
              fontFamily: 'var(--font-mono)', fontSize: 12.5,
              lineHeight: 1.55, color: 'var(--text-strong)',
            }}>{preview.content}</pre>
          </div>
        </div>
      )}

      <div style={{
        margin: '0 28px 28px',
        padding: '12px 16px',
        background: 'var(--stone-50)', border: '1px solid var(--border-0)',
        borderRadius: 10, fontSize: 12.5, color: 'var(--frost-700)',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{ display: 'inline-flex', color: 'var(--primary-700)', marginTop: 1 }}>{Ico.sparkle(14)}</span>
        <span>
          <strong style={{ color: 'var(--text-strong)' }}>Anton artifacts</strong> are saved to{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--stone-150)', padding: '1px 5px', borderRadius: 4 }}>.anton/output/</code>{' '}
          in your workspace. Enable <em>Proactive dashboards</em> in Settings to generate HTML reports automatically.
        </span>
      </div>
    </div>
  );
}
