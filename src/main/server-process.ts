// Spawns the bundled Python FastAPI server (server/main.py) and waits for
// /health to come up. Uses the python interpreter that the antontron
// installer puts at ~/.local/share/uv/tools/anton/bin/python — same env
// `uv tool install --with fastapi --with uvicorn` populated.

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';

const DEFAULT_PORT = 26866; // ANTON on T9 keypad
const SERVER_HOST = '127.0.0.1';

let serverProcess: ChildProcess | null = null;
let serverPort: number = DEFAULT_PORT;
let serverStarted = false;
// Tracks an in-flight startServer() call so concurrent invocations
// share the same promise instead of spawning duplicate python processes
// (which would race for the same port and the second would fail).
let pendingStart: Promise<StartServerResult> | null = null;

// Diagnostics — captured so the renderer can surface them in a help
// modal when the user wonders why the backend is offline. We keep
// the most recent start failure reason and a rolling tail of stderr
// (latest ~32 KB) since the python crash trace usually lives in the
// last few lines. Flushed on a successful start.
const STDERR_BUFFER_BYTES = 32 * 1024;
let recentStderr = '';
let lastStartError: string | null = null;
let lastStartAt: number | null = null;
let lastExitCode: number | null = null;

function appendStderr(chunk: string) {
  recentStderr = (recentStderr + chunk).slice(-STDERR_BUFFER_BYTES);
}

export function getServerPort(): number {
  return serverPort;
}

export function getServerOrigin(): string {
  return `http://${SERVER_HOST}:${serverPort}`;
}

function getAntonPython(): string | null {
  const dataHome = process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming' : '.local/share');
  const candidate = path.join(
    dataHome, 'uv', 'tools', 'anton',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return fs.existsSync(candidate) ? candidate : null;
}

// Build a PATH with ~/.local/bin and ~/.cargo/bin prepended. Critical
// for macOS (and to a lesser extent Linux) GUI launches: when Anton.app
// starts from Finder/Dock, process.env.PATH is the minimal launchd PATH
// (`/usr/bin:/bin:/usr/sbin:/sbin`) — shell init files aren't read,
// so `~/.local/bin` (where the installer puts `uv`) is missing.
//
// The Python server we spawn inherits this PATH; anton's scratchpad
// runtime uses `shutil.which("uv")` to pick the fast venv path. Without
// uv on PATH it falls back to stdlib `venv.create(... with_pip=False)`,
// which is the failure mode users see as "Python venv creation is failing"
// — the venv has no pip, so subsequent `pip install` calls inside the
// scratchpad fail. With uv on PATH the runtime gets a proper, seeded
// venv and everything works.
function getEnvPath(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  const parts = [localBin, cargoBin, currentPath].filter(Boolean);
  return parts.join(path.delimiter);
}

function getServerDir(): string {
  // Packaged: server/ shipped via electron-builder extraResources at
  // process.resourcesPath/server. Dev: server/ at repo root.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(__dirname, '..', '..', '..', 'server');
}

async function probeHealth(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { hostname: SERVER_HOST, port: serverPort, path: '/health', timeout: 1000 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export interface StartServerResult {
  ok: boolean;
  reason?: string;
  port?: number;
}

export async function startServer(opts: { port?: number; readyTimeoutMs?: number } = {}): Promise<StartServerResult> {
  if (serverStarted) return { ok: true, port: serverPort };
  // If a start is already in progress (e.g. from app boot), reuse it
  // instead of spawning a second python that would clash on the port.
  if (pendingStart) return pendingStart;

  serverPort = opts.port ?? (Number(process.env.ANTON_SERVER_PORT) || DEFAULT_PORT);
  const readyTimeoutMs = opts.readyTimeoutMs ?? 15000;

  lastStartAt = Date.now();
  const pythonCmd = getAntonPython();
  if (!pythonCmd) {
    lastStartError = 'Anton Python interpreter not found. Run the installer first.';
    return {
      ok: false,
      reason: lastStartError,
    };
  }

  const serverDir = getServerDir();
  if (!fs.existsSync(path.join(serverDir, 'main.py'))) {
    lastStartError = `Server source not found at ${serverDir}/main.py`;
    return {
      ok: false,
      reason: lastStartError,
    };
  }

  pendingStart = (async (): Promise<StartServerResult> => {
    const env = {
      ...process.env,
      PATH: getEnvPath(),
      PYTHONUNBUFFERED: '1',
      ANTON_SERVER_PORT: String(serverPort),
      ANTON_SERVER_HOST: SERVER_HOST,
      ANTON_PROJECTS_DIR: path.join(app.getPath('userData'), 'projects'),
    };

    const child = spawn(pythonCmd, ['main.py'], {
      cwd: serverDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d) => {
      const text = d.toString();
      // Server logs go to stdout via uvicorn — the python crash trace
      // we want to surface lives on stderr, but errors propagated
      // through logging.error often land on stdout too. Buffer both
      // so the help modal has the complete picture.
      appendStderr(text);
      process.stdout.write(`[anton-server] ${text}`);
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      appendStderr(text);
      process.stderr.write(`[anton-server] ${text}`);
    });
    child.on('exit', (code) => {
      serverStarted = false;
      serverProcess = null;
      lastExitCode = code;
      if (code !== 0 && code !== null) {
        console.error(`[anton-server] exited with code ${code}`);
      }
    });

    serverProcess = child;

    const ready = await probeHealth(readyTimeoutMs);
    if (!ready) {
      lastStartError = `Server did not respond on /health within ${readyTimeoutMs}ms.`;
      return {
        ok: false,
        reason: lastStartError,
        port: serverPort,
      };
    }
    serverStarted = true;
    // Successful start — clear the previous failure note but keep
    // the rolling stderr in case downstream code wants to inspect.
    lastStartError = null;
    return { ok: true, port: serverPort };
  })();

  try {
    return await pendingStart;
  } finally {
    pendingStart = null;
  }
}

export function stopServer() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
    serverProcess = null;
    serverStarted = false;
  }
}

// True once /health has confirmed the python is responsive.
export function isServerRunning(): boolean {
  return serverStarted && serverProcess !== null;
}

// True between spawn() and the first successful /health probe — i.e.
// the python child exists but isn't proven ready yet. The renderer
// uses this to show "starting…" without firing a duplicate start.
export function isServerStarting(): boolean {
  return pendingStart !== null;
}

export interface ServerDiagnostics {
  running: boolean;
  starting: boolean;
  port: number;
  /** Last failure reason from startServer(); null after a successful start. */
  lastError: string | null;
  /** Last exit code if the process has died. */
  lastExitCode: number | null;
  /** Wall-clock ms of the last start attempt; null until first attempt. */
  lastStartAt: number | null;
  /** Tail of stdout+stderr since this run of the main process. */
  recentLog: string;
}

export function getServerDiagnostics(): ServerDiagnostics {
  return {
    running: isServerRunning(),
    starting: isServerStarting(),
    port: serverPort,
    lastError: lastStartError,
    lastExitCode,
    lastStartAt,
    recentLog: recentStderr,
  };
}
