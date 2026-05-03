import { useEffect, useState } from 'react';

// Braille-dot spinner — the same look as terminal CLIs (e.g. ora, npm).
// Frames cycle on a fixed interval; the component is purely presentational
// and unmounts cleanly so its timer doesn't leak.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export default function Spinner({ intervalMs = 80, className, style }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--font-mono)',
        display: 'inline-block',
        width: '1ch',
        textAlign: 'center',
        ...style,
      }}
      aria-hidden="true"
    >
      {FRAMES[i]}
    </span>
  );
}
