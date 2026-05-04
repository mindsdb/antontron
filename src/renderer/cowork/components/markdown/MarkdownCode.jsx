// react-markdown `code` slot replacement. Adapted from mdb-ai/MarkdownCode.
// Three behaviours:
//   - ```chartjs <full Chart.js config> → render the chart inline
//   - ```chart  <intent JSON>          → not supported yet (no compile
//                                        endpoint in our backend),
//                                        shows error placeholder.
//   - everything else                  → plain <code> with our token style

import { useMemo } from 'react';
import { ChartLoadingState, ChartErrorState } from './ChartStates';
import { MessageChart } from './MessageChart';
import { parseChartIntent } from './utils';

export function MarkdownCode(props) {
  const lang = props?.className?.replace('language-', '') || '';
  const text = String(props?.children ?? '');
  const id = props?.id;
  const complete = props?.complete !== false; // assume complete unless told otherwise

  const chartIntent = useMemo(() => {
    if (lang === 'chart' && text) return parseChartIntent(text);
    return null;
  }, [lang, text]);

  // Intent format — needs a server endpoint to compile JSON into a real
  // Chart.js config. We don't have that yet, so surface a clear message.
  if (lang === 'chart') {
    if (!complete) return <ChartLoadingState />;
    if (!chartIntent || chartIntent.error) {
      return <ChartErrorState error={chartIntent?.error || 'Invalid chart specification'} />;
    }
    return (
      <ChartErrorState error="`chart` intent format requires a backend compile endpoint (not wired yet). Use `chartjs` for full configs." />
    );
  }

  // Legacy / direct chartjs format — full Chart.js config in the block.
  if (lang === 'chartjs') {
    return complete ? <MessageChart id={id || 'chart'} text={text} /> : <ChartLoadingState />;
  }

  // Default — fall through to a styled <code>. react-markdown distinguishes
  // inline code (no className) from fenced code (className="language-xxx").
  // We render both with the same monospace token styling; the surrounding
  // <pre> from remark-gfm handles block-level wrapping for fenced blocks.
  return (
    <code
      className={
        'font-mono text-[12.5px] text-ink ' +
        (lang ? 'block whitespace-pre overflow-x-auto rounded-md border border-line bg-surface-2 p-3 my-2' : 'rounded bg-surface-2 px-1 py-0.5')
      }
    >
      {props.children}
    </code>
  );
}
