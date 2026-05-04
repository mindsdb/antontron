// Shared markdown helpers. Currently just chart-intent parsing.
// Ported from mdb-ai/src/components/Message/utils.js.

export const CHART_TYPES = ['bar', 'line', 'pie', 'scatter'];

/**
 * Parse a chart intent JSON from a code block body.
 * Returns the parsed intent, or { error } if parsing fails.
 */
export function parseChartIntent(text) {
  try {
    const intent = JSON.parse(text);
    if (!intent.type) return { error: 'Missing chart type' };
    if (!CHART_TYPES.includes(intent.type)) {
      return { error: `Unsupported chart type: "${intent.type}". Supported: ${CHART_TYPES.join(', ')}.` };
    }
    return intent;
  } catch (e) {
    return { error: 'Invalid JSON in chart specification' };
  }
}
