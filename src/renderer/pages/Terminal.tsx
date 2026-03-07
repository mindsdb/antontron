import { useEffect, useRef, useState } from 'react';

export default function Terminal() {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;

    async function initTerminal() {
      // Dynamic imports for xterm (ESM modules)
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');

      // Import xterm CSS
      await import('@xterm/xterm/css/xterm.css');

      if (disposed || !termRef.current) return;

      const term = new Terminal({
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
        fontSize: 14,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'bar',
        theme: {
          background: '#0a0a0f',
          foreground: '#e0e0f0',
          cursor: '#00e5ff',
          cursorAccent: '#0a0a0f',
          selectionBackground: 'rgba(0, 229, 255, 0.2)',
          black: '#1a1a2e',
          red: '#ff5252',
          green: '#69f0ae',
          yellow: '#ffd740',
          blue: '#448aff',
          magenta: '#b388ff',
          cyan: '#00e5ff',
          white: '#e0e0f0',
          brightBlack: '#555577',
          brightRed: '#ff8a80',
          brightGreen: '#b9f6ca',
          brightYellow: '#ffe57f',
          brightBlue: '#82b1ff',
          brightMagenta: '#ea80fc',
          brightCyan: '#84ffff',
          brightWhite: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(termRef.current);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Fit to container
      setTimeout(() => {
        fitAddon.fit();
      }, 50);

      // Start Anton process
      const { cols, rows } = term;
      await window.antontron.startAnton(cols, rows);
      setConnected(true);

      // Terminal input -> Anton
      term.onData((data) => {
        window.antontron.sendInput(data);
      });

      // Anton output -> Terminal
      const removeData = window.antontron.onAntonData((data) => {
        term.write(data);
      });

      // Anton exit
      const removeExit = window.antontron.onAntonExit((code) => {
        setConnected(false);
        term.write(`\r\n\x1b[33m--- Anton exited (code ${code}) ---\x1b[0m\r\n`);
        term.write('\x1b[36mPress any key to restart...\x1b[0m\r\n');
        const restartHandler = term.onKey(async () => {
          restartHandler.dispose();
          term.clear();
          const { cols, rows } = term;
          await window.antontron.startAnton(cols, rows);
          setConnected(true);
        });
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        window.antontron.resizeTerminal(term.cols, term.rows);
      });
      resizeObserver.observe(termRef.current);

      return () => {
        removeData();
        removeExit();
        resizeObserver.disconnect();
        term.dispose();
      };
    }

    const cleanup = initTerminal();

    return () => {
      disposed = true;
      cleanup.then((fn) => fn?.());
    };
  }, []);

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-header-title">
          <div className={`status-dot ${connected ? '' : 'disconnected'}`} />
          {connected ? 'Anton' : 'Disconnected'}
        </div>
      </div>
      <div className="terminal-body" ref={termRef} />
    </div>
  );
}
