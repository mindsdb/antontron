// Web-mode entry point.
//
// Mounts the cowork app directly — bypassing the Electron-only desktop
// shell (terms / install / onboarding / Setup / Terminal). Those flows
// don't apply to a browser-served deployment: the FastAPI is already
// running in a server (Lightsail / anton-local-environment), the user
// authenticates via mdb.ai (handled by the reverse proxy), and there's
// no anton CLI to install client-side.
//
// The Electron entry (`main.tsx`) keeps the desktop shell.
//
// Both entries share the same `cowork/` tree. Anything cowork needs from
// the host environment (server lifecycle, openPath, openExternal,
// platform detection) goes through `cowork/lib/host.ts`, which has
// browser-friendly fallbacks when `window.antontron` isn't present.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Same style stack the Electron entry pulls in — keeps the cowork
// renderer visually identical across shells.
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './styles.css';

// Theme bootstrap: apply the persisted preference before React mounts
// so the gravity-field canvas + page bg don't flash the wrong palette.
(() => {
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = window.localStorage.getItem('anton.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.body.dataset.theme = theme;
  document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
})();

import CoworkApp from './cowork/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CoworkApp />
  </StrictMode>,
);
