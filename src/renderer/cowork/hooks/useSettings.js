// Settings, health, theme, and model state.
//
// Ported from anton-cowork's useSettings hook, extended with antontron's
// theme persistence (localStorage + gravity-field) and server-online state.

import { useState, useCallback, useEffect } from 'react';
import { fetchSettings, fetchHealth, updateSettings, MOCK_DATA } from '../api';

const DEFAULT_SETTINGS = {
  greeting: "Let's knock something off your list",
  tone: 'balanced',
  defaultModel: 'claude-sonnet-4-6',
  autoPin: true,
  showDots: true,
  accentVariant: 'aqua',
};

export default function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [health, setHealth] = useState({ status: 'offline', anton_available: false, config_ready: false });
  const [serverOnline, setServerOnline] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MOCK_DATA.models[0]);
  const [models] = useState(MOCK_DATA.models);

  // Theme — persisted in localStorage so the choice survives reloads.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch { return 'dark'; }
  });

  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = theme;
    if (window.gravityField && typeof window.gravityField.setTheme === 'function') {
      window.gravityField.setTheme(theme);
    }
  }, [theme]);

  const applySettingsSnapshot = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    setSettings((prev) => ({ ...prev, ...data }));
    const modelId = data.defaultModel || data.planningModel;
    const m = MOCK_DATA.models.find((x) => x.id === modelId);
    setSelectedModel(m || {
      id: modelId,
      name: modelId || 'Anton model',
      desc: data.providerLabel ? `${data.providerLabel} planning model` : 'Configured Anton planning model',
    });
  }, []);

  const refreshHealth = useCallback(async () => {
    const h = await fetchHealth();
    setHealth(h);
    setServerOnline(h.status === 'ok');
    return h;
  }, []);

  const loadSettings = useCallback(() => {
    // Fire both in parallel to match the original refreshData behavior —
    // health and settings should not block each other.
    refreshHealth();
    fetchSettings().then(applySettingsSnapshot);
  }, [refreshHealth, applySettingsSnapshot]);

  const saveSettings = useCallback(async (patch = settings) => {
    const result = await updateSettings(patch);
    setSettings((prev) => ({
      ...prev,
      configReady: result.configReady ?? prev.configReady,
      configError: result.configError ?? prev.configError,
    }));
    await refreshHealth();
    const latest = await fetchSettings();
    applySettingsSnapshot(latest);
    return result;
  }, [settings, refreshHealth, applySettingsSnapshot]);

  const setSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const modelOptions = selectedModel && !models.some((m) => m.id === selectedModel.id)
    ? [selectedModel, ...models]
    : models;

  return {
    settings, health, serverOnline, setServerOnline,
    selectedModel, setSelectedModel,
    models, modelOptions,
    theme, setTheme,
    loadSettings, saveSettings, setSetting, refreshHealth,
  };
}
