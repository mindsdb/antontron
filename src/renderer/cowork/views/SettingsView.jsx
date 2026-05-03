import { useState } from 'react';
import Ico from '../components/Icons';
import { validateSettings } from '../api';

// Provider preset → underlying canonical fields. The backend only knows
// three providers (anthropic / openai / openai-compatible). Gemini and
// Minds Cloud are presets that translate to openai-compatible + a known
// base URL on save, and are recognized back from those values on load.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const MINDS_API_PATH_SUFFIX = '/api/v1';

const PROVIDER_PRESETS = [
  { value: 'anthropic',         label: 'Anthropic' },
  { value: 'openai',            label: 'OpenAI' },
  { value: 'gemini',            label: 'Gemini' },
  { value: 'openai-compatible', label: 'Compatible' },
  { value: 'minds-cloud',       label: 'Minds Cloud' },
];

function inferProviderPreset(s) {
  const provider = s.planningProvider || 'anthropic';
  const baseUrl = (s.openaiBaseUrl || '').trim();
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  if (provider === 'openai-compatible') {
    if (baseUrl.startsWith('https://generativelanguage.googleapis.com')) return 'gemini';
    if (baseUrl.includes('mdb.ai') || baseUrl.endsWith(MINDS_API_PATH_SUFFIX) && (s.mindsApiKey || s.mindsUrl)) {
      return 'minds-cloud';
    }
    return 'openai-compatible';
  }
  return 'anthropic';
}

function applyProviderPreset(preset, settings, setSetting) {
  if (preset === 'anthropic') {
    setSetting('planningProvider', 'anthropic');
    setSetting('codingProvider', 'anthropic');
  } else if (preset === 'openai') {
    setSetting('planningProvider', 'openai');
    setSetting('codingProvider', 'openai');
    setSetting('openaiBaseUrl', '');
  } else if (preset === 'gemini') {
    setSetting('planningProvider', 'openai-compatible');
    setSetting('codingProvider', 'openai-compatible');
    setSetting('openaiBaseUrl', GEMINI_BASE_URL);
  } else if (preset === 'openai-compatible') {
    setSetting('planningProvider', 'openai-compatible');
    setSetting('codingProvider', 'openai-compatible');
    if ((settings.openaiBaseUrl || '').startsWith('https://generativelanguage.googleapis.com')) {
      setSetting('openaiBaseUrl', '');
    }
  } else if (preset === 'minds-cloud') {
    setSetting('planningProvider', 'openai-compatible');
    setSetting('codingProvider', 'openai-compatible');
    const mindsUrl = (settings.mindsUrl || 'https://mdb.ai').replace(/\/+$/, '');
    setSetting('mindsUrl', mindsUrl);
    setSetting('openaiBaseUrl', `${mindsUrl}${MINDS_API_PATH_SUFFIX}`);
    if (settings.mindsApiKey && !settings.openaiApiKey) {
      setSetting('openaiApiKey', settings.mindsApiKey);
    }
  }
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24,
      padding: '16px 0', borderBottom: '1px solid var(--border-0)',
      alignItems: 'flex-start',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--frost-600)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      className={`toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', height: 36, padding: '0 12px',
        border: '1px solid var(--border-01)', borderRadius: 8,
        fontSize: 14, color: 'var(--text-strong)',
        background: 'var(--surface-0)', outline: 'none',
        fontFamily: 'var(--font-sans)',
      }}
      onFocus={(e) => { e.target.style.borderColor = 'var(--primary-300)'; e.target.style.boxShadow = '0 0 0 3px rgba(31,156,176,0.15)'; }}
      onBlur={(e) => { e.target.style.borderColor = 'var(--border-01)'; e.target.style.boxShadow = 'none'; }}
    />
  );
}

function ApiKeyInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || '********************'}
        style={{
          width: '100%', height: 36, padding: '0 40px 0 12px',
          border: '1px solid var(--border-01)', borderRadius: 8,
          fontSize: 13, color: 'var(--text-strong)',
          background: 'var(--surface-0)', outline: 'none',
          fontFamily: 'var(--font-mono)',
        }}
        onFocus={(e) => { e.target.style.borderColor = 'var(--primary-300)'; }}
        onBlur={(e) => { e.target.style.borderColor = 'var(--border-01)'; }}
      />
      <button
        onClick={() => setShow(!show)}
        style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          border: 0, background: 'transparent', cursor: 'pointer',
          fontSize: 11, color: 'var(--frost-600)', padding: '0 4px',
        }}
      >
        {show ? 'hide' : 'show'}
      </button>
    </div>
  );
}

export default function SettingsView({ settings, setSetting, onSave, theme, onThemeChange }) {
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState(null);
  const configReady = validation?.configReady ?? settings.configReady;
  const configError = validation?.configError || settings.configError;

  const save = async () => {
    try {
      const result = await onSave(settings);
      setValidation(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be saved.',
      });
      setSaved(false);
    }
  };

  const validate = async () => {
    try {
      const result = await validateSettings();
      setValidation(result);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be validated.',
      });
    }
  };

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <div className="page-header">
        <div style={{ flex: 1 }}>
          <h2 className="page-title">Settings</h2>
          <div style={{ fontSize: 13, color: 'var(--frost-600)', marginTop: 4 }}>
            Anton configuration and local desktop preferences live here now.
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={save}
          style={{ background: saved ? 'var(--sage-700)' : undefined }}
        >
          {saved ? <>{Ico.check(14)} Saved</> : 'Save settings'}
        </button>
      </div>

      <div style={{ padding: 28, maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{
          padding: 14,
          marginBottom: 18,
          border: `1px solid ${configReady ? 'rgba(93,146,135,0.35)' : '#F0C2B5'}`,
          background: configReady ? 'rgba(211,249,240,0.45)' : '#FFF7F4',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: configReady ? 'var(--sage-700)' : '#8F321A',
            background: configReady ? 'rgba(93,146,135,0.12)' : '#FFE7DF',
          }}>{configReady ? Ico.check(15) : Ico.key(15)}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text-strong)' }}>
              {configReady ? 'Anton is configured' : 'Anton needs configuration'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--frost-700)', marginTop: 2 }}>
              {configError || 'Provider, model, and credentials are ready.'}
            </div>
          </div>
          <button className="btn-secondary" onClick={validate}>Test</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: 12, paddingTop: 4 }}>Desktop</div>

        <Section title="Theme" subtitle="Light or dark — also drives the animated background.">
          <Segmented
            value={theme || 'dark'}
            onChange={(v) => onThemeChange?.(v)}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark',  label: 'Dark' },
            ]}
          />
        </Section>

        <Section title="Greeting" subtitle="The line shown when you start a new task.">
          <TextInput value={settings.greeting} onChange={(v) => setSetting('greeting', v)} />
        </Section>

        <Section title="Dot grid" subtitle="Decorative dot pattern on the home screen.">
          <Toggle value={settings.showDots} onChange={(v) => setSetting('showDots', v)} />
        </Section>

        <Section title="Tone" subtitle="How Anton phrases its responses.">
          <Segmented
            value={settings.tone}
            onChange={(v) => setSetting('tone', v)}
            options={[
              { value: 'concise', label: 'Concise' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />
        </Section>

        <Section title="Auto-pin recents" subtitle="Pin tasks you visit more than 3 times.">
          <Toggle value={settings.autoPin} onChange={(v) => setSetting('autoPin', v)} />
        </Section>

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: 12, paddingTop: 24 }}>Models</div>

        <Section title="Provider" subtitle="Picks both the planning + coding provider. Gemini and Minds Cloud are presets that map to OpenAI-compatible with the right base URL.">
          <Segmented
            value={inferProviderPreset(settings)}
            onChange={(v) => applyProviderPreset(v, settings, setSetting)}
            options={PROVIDER_PRESETS}
          />
        </Section>

        <Section title="Planning model" subtitle="Used for reasoning, orchestration, and responses.">
          <TextInput
            value={settings.planningModel ?? settings.defaultModel ?? ''}
            onChange={(v) => {
              setSetting('planningModel', v);
              setSetting('defaultModel', v);
            }}
            placeholder="claude-sonnet-4-6"
          />
        </Section>

        <Section title="Coding model" subtitle="Used for scratchpad code generation.">
          <TextInput
            value={settings.codingModel ?? 'claude-haiku-4-5-20251001'}
            onChange={(v) => setSetting('codingModel', v)}
            placeholder="claude-haiku-4-5-20251001"
          />
        </Section>

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: 12, paddingTop: 24 }}>Memory</div>

        <Section title="Memory mode" subtitle="How Anton updates its long-term memory.">
          <Segmented
            value={settings.memoryMode ?? 'autopilot'}
            onChange={(v) => setSetting('memoryMode', v)}
            options={[
              { value: 'autopilot', label: 'Autopilot' },
              { value: 'copilot', label: 'Copilot' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Section>

        <Section title="Episodic memory" subtitle="Save conversation history for future recall.">
          <Toggle value={settings.episodicMemory ?? true} onChange={(v) => setSetting('episodicMemory', v)} />
        </Section>

        <Section title="Proactive dashboards" subtitle="Auto-generate HTML reports from scratchpad output.">
          <Toggle value={settings.proactiveDashboards ?? false} onChange={(v) => setSetting('proactiveDashboards', v)} />
        </Section>

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: 12, paddingTop: 24 }}>Credentials</div>

        <Section title="Anthropic API key" subtitle="Required for Claude models.">
          <ApiKeyInput
            value={settings.anthropicApiKey ?? ''}
            onChange={(v) => setSetting('anthropicApiKey', v)}
            placeholder="sk-ant-********"
          />
        </Section>

        <Section title="OpenAI API key" subtitle="Required for GPT models when you use OpenAI directly.">
          <ApiKeyInput
            value={settings.openaiApiKey ?? ''}
            onChange={(v) => setSetting('openaiApiKey', v)}
            placeholder="sk-********"
          />
        </Section>

        <Section title="OpenAI-compatible base URL" subtitle="Required for OpenAI-compatible providers unless Minds credentials derive it.">
          <TextInput
            value={settings.openaiBaseUrl ?? ''}
            onChange={(v) => setSetting('openaiBaseUrl', v)}
            placeholder="https://example.com/v1"
          />
        </Section>

        <Section title="Minds API key" subtitle="Used for Minds-backed routing and publishing.">
          <ApiKeyInput
            value={settings.mindsApiKey ?? ''}
            onChange={(v) => setSetting('mindsApiKey', v)}
            placeholder="mdb_********"
          />
        </Section>

        <Section title="Minds URL" subtitle="Base URL for Minds-backed Anton features.">
          <TextInput
            value={settings.mindsUrl ?? 'https://mdb.ai'}
            onChange={(v) => setSetting('mindsUrl', v)}
            placeholder="https://mdb.ai"
          />
        </Section>

        <Section title="Minds mind" subtitle="Optional Mind name to use for data-aware tasks.">
          <TextInput
            value={settings.mindsMindName ?? ''}
            onChange={(v) => setSetting('mindsMindName', v)}
            placeholder="sales_data_expert"
          />
        </Section>

        <Section title="Minds datasource" subtitle="Optional datasource name and engine.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <TextInput
              value={settings.mindsDatasource ?? ''}
              onChange={(v) => setSetting('mindsDatasource', v)}
              placeholder="datasource name"
            />
            <TextInput
              value={settings.mindsDatasourceEngine ?? ''}
              onChange={(v) => setSetting('mindsDatasourceEngine', v)}
              placeholder="postgres"
            />
          </div>
        </Section>

        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
