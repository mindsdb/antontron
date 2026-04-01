import { useState, useEffect } from 'react';
import TermsConsent from './pages/TermsConsent';
import Setup from './pages/Setup';
import Onboarding from './pages/Onboarding';
import Terminal from './pages/Terminal';
import './styles.css';

type Page = 'loading' | 'terms' | 'setup' | 'onboarding' | 'launching' | 'terminal';

const LOGO = `  \u2584\u2580\u2588 \u2588\u2584 \u2588 \u2580\u2588\u2580 \u2588\u2580\u2588 \u2588\u2584 \u2588
  \u2588\u2580\u2588 \u2588 \u2580\u2588  \u2588  \u2588\u2584\u2588 \u2588 \u2580\u2588`;

const LOGO_PAGES = new Set<Page>(['terms', 'setup', 'onboarding']);

export default function App() {
  const [page, setPage] = useState<Page>('loading');

  useEffect(() => {
    async function init() {
      const settings = await window.antontron.readSettings();
      if (settings.ANTON_TERMS_CONSENT !== 'true') {
        setPage('terms');
        return;
      }

      const installed = await window.antontron.checkInstall();
      if (!installed) {
        setPage('setup');
        return;
      }
      const { configured } = await window.antontron.checkConfigured();
      if (!configured) {
        setPage('onboarding');
        return;
      }
      setPage('terminal');
    }
    init();
  }, []);

  const handleTermsAccepted = () => setPage('setup');
  const handleInstallComplete = () => setPage('onboarding');
  const handleOnboardingComplete = () => {
    setPage('launching');
    setTimeout(() => setPage('terminal'), 1200);
  };

  const isMac = window.antontron.getPlatform() === 'darwin';
  const showLogo = LOGO_PAGES.has(page);
  const isTopPinned = page === 'onboarding';

  return (
    <>
      {isMac && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div className="setup-container">
          <div className="logo-section">
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        </div>
      )}

      {showLogo && (
        <div className={`onboard-shell ${isTopPinned ? 'top-pinned' : ''}`}>
          <div className={`onboard-spacer ${isTopPinned ? 'collapsed' : ''}`} />
          <div className="logo-section shared-logo">
            <pre className="logo-ascii">{LOGO}</pre>
            <div className="logo-subtitle">autonomous coworker</div>
          </div>

          <div className="onboard-content" key={page}>
            {page === 'terms' && <TermsConsent onAccept={handleTermsAccepted} />}
            {page === 'setup' && <Setup onComplete={handleInstallComplete} />}
            {page === 'onboarding' && <Onboarding onComplete={handleOnboardingComplete} />}
          </div>
          <div className={`onboard-spacer ${isTopPinned ? 'collapsed' : ''}`} />
        </div>
      )}

      {page === 'launching' && (
        <div className="launch-screen">
          <pre className="logo-ascii">{LOGO}</pre>
          <div className="launch-text">Starting Anton...</div>
          <div className="launch-bar">
            <div className="launch-bar-fill" />
          </div>
        </div>
      )}

      {page === 'terminal' && <Terminal />}
    </>
  );
}
