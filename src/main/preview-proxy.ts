// Local HTTP proxy for backend+frontend artifact previews.
//
// Anton's scratchpad starts a backend (e.g. Flask) for the artifact and
// records the listen port in `<artifact-dir>/metadata.json`. The iframe
// can't point at that port directly: we want a stable URL the renderer
// owns, plus a place to enforce auth in the future. This module hosts a
// loopback HTTP listener that forwards every request to the current
// artifact's backend port.
//
// Design notes:
//   - One listener for the whole Electron session — only one preview
//     runs at a time, so we just swap which artifact dir the listener
//     forwards to. The listen port is stable, which keeps browser
//     caching/state coherent across opens.
//   - The backend port is read lazily from metadata.json on every
//     request. If the scratchpad restarts the backend on a new port,
//     the next request picks it up — no watchers, no stale state.
//   - The proxy lives on the *root* of its own port (not under a
//     prefix on the FastAPI server). Absolute paths in the backend's
//     HTML / CSS / JS resolve naturally.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';

let server: http.Server | null = null;
let listenPort: number | null = null;
let currentArtifactDir: string | null = null;

// Hop-by-hop headers (RFC 7230 §6.1) — must not be forwarded.
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHopHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function readBackendPort(artifactDir: string): number | null {
  try {
    const metaPath = path.join(artifactDir, 'metadata.json');
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(raw);
    const port = meta?.port;
    if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) {
      return port;
    }
    return null;
  } catch {
    return null;
  }
}

// Auth guard placeholder. Returns true today so previews work; the seam
// is here for the future check (e.g. cookie or header signed by the
// main process / session token).
function checkAuth(_req: http.IncomingMessage): boolean {
  return true;
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!checkAuth(req)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }
  const dir = currentArtifactDir;
  if (!dir) {
    sendError(res, 503, 'No active artifact preview');
    return;
  }
  const port = readBackendPort(dir);
  if (port == null) {
    sendError(res, 503, 'Artifact backend is not running yet');
    return;
  }

  const headers = stripHopHeaders(req.headers);
  // Rewrite Host so the backend sees the address it actually bound to
  // (matters for Flask host_matching, redirects that echo Host, etc.).
  headers['host'] = `127.0.0.1:${port}`;

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      const respHeaders = stripHopHeaders(proxyRes.headers);
      res.writeHead(proxyRes.statusCode ?? 502, respHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    // ECONNREFUSED is the common case — backend is starting / dead.
    sendError(res, 502, `Proxy error: ${err.message}`);
  });

  req.on('aborted', () => {
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
}

function ensureServer(): Promise<number> {
  if (server && listenPort != null) {
    return Promise.resolve(listenPort);
  }
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handleRequest);
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      server = srv;
      listenPort = addr.port;
      resolve(addr.port);
    });
  });
}

export async function startProxy(artifactDir: string): Promise<{ url: string }> {
  if (!artifactDir || typeof artifactDir !== 'string') {
    throw new Error('artifactDir is required');
  }
  const port = await ensureServer();
  currentArtifactDir = artifactDir;
  // Cache-buster keyed to the artifact dir so the iframe sees a fresh
  // URL when the user switches between two backend artifacts (same
  // proxy port, different upstream — without `?v=` the browser may
  // serve cached HTML from the previous one).
  const tag = Buffer.from(artifactDir).toString('base64url').slice(0, 12);
  return { url: `http://127.0.0.1:${port}/?v=${tag}` };
}

export function stopProxy(): void {
  currentArtifactDir = null;
}

export function shutdownProxy(): void {
  currentArtifactDir = null;
  if (server) {
    server.close();
    server = null;
    listenPort = null;
  }
}
