import { useState, useEffect, useRef } from 'react';

interface Step {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
}

const STEP_ICONS: Record<string, string> = {
  pending: '',
  running: '',
  done: '\u2713',
  error: '\u2717',
  skipped: '-',
};

export default function Setup({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'installing' | 'done' | 'error'>('ready');
  const [steps, setSteps] = useState<Step[]>([]);
  const [logs, setLogs] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      window.antontron.onInstallProgress((newSteps) => {
        setSteps(newSteps);
      })
    );

    unsubs.push(
      window.antontron.onInstallLog((msg) => {
        setLogs((prev) => prev + msg);
      })
    );

    unsubs.push(
      window.antontron.onInstallDone(() => {
        setPhase('done');
      })
    );

    unsubs.push(
      window.antontron.onInstallError((err) => {
        setPhase('error');
        setErrorMsg(err);
      })
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const handleInstall = async () => {
    setPhase('installing');
    setLogs('');
    setErrorMsg('');
    await window.antontron.startInstall();
  };

  return (
    <div className="setup-container">
      <div className="logo-section">
        <pre className="logo-ascii">{`  ▄▀█ █▄ █ ▀█▀ █▀█ █▄ █
  █▀█ █ ▀█  █  █▄█ █ ▀█`}</pre>
        <div className="logo-title">AntonTron</div>
        <div className="logo-subtitle">autonomous coworker</div>
      </div>

      {phase === 'ready' && (
        <button className="btn-primary" onClick={handleInstall}>
          INSTALL ANTON
        </button>
      )}

      {(phase === 'installing' || phase === 'error') && (
        <>
          <div className="steps-panel">
            {steps.map((step) => (
              <div className="step-row" key={step.id} data-status={step.status}>
                <div className="step-icon">
                  {step.status === 'running' ? (
                    <div className="spinner" />
                  ) : (
                    STEP_ICONS[step.status]
                  )}
                </div>
                <div className="step-label">{step.label}</div>
              </div>
            ))}
          </div>
          <div className="log-panel" ref={logRef}>
            <pre>{logs}</pre>
          </div>
          {phase === 'error' && (
            <>
              <div className="error-message">{errorMsg}</div>
              <button className="btn-secondary" onClick={handleInstall}>
                Retry
              </button>
            </>
          )}
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="success-section">
            <div className="success-check">{'\u2713'}</div>
            <div className="success-text">Anton is installed</div>
            <div className="success-subtext">Ready to go</div>
          </div>
          <button className="btn-primary" onClick={onComplete}>
            LAUNCH ANTON
          </button>
        </>
      )}
    </div>
  );
}
