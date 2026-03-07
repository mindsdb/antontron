import { useState, useEffect } from 'react';
import Setup from './pages/Setup';
import Terminal from './pages/Terminal';

type Page = 'loading' | 'setup' | 'terminal';

export default function App() {
  const [page, setPage] = useState<Page>('loading');

  useEffect(() => {
    window.antontron.checkInstall().then((installed) => {
      setPage(installed ? 'terminal' : 'setup');
    });
  }, []);

  const handleInstallComplete = () => {
    setPage('terminal');
  };

  const isMac = window.antontron.getPlatform() === 'darwin';

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
      {page === 'setup' && <Setup onComplete={handleInstallComplete} />}
      {page === 'terminal' && <Terminal />}
    </>
  );
}
