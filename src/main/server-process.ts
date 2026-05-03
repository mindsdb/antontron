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

  serverPort = opts.port ?? (Number(process.env.ANTON_SERVER_PORT) || DEFAULT_PORT);
  const readyTimeoutMs = opts.readyTimeoutMs ?? 15000;

  const pythonCmd = getAntonPython();
  if (!pythonCmd) {
    return {
      ok: false,
      reason: 'Anton Python interpreter not found. Run the installer first.',
    };
  }

  const serverDir = getServerDir();
  if (!fs.existsSync(path.join(serverDir, 'main.py'))) {
    return {
      ok: false,
      reason: `Server source not found at ${serverDir}/main.py`,
    };
  }

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ANTON_SERVER_PORT: String(serverPort),
    ANTON_SERVER_HOST: SERVER_HOST,
  };

  const child = spawn(pythonCmd, ['main.py'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    process.stdout.write(`[anton-server] ${d.toString()}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[anton-server] ${d.toString()}`);
  });
  child.on('exit', (code) => {
    serverStarted = false;
    serverProcess = null;
    if (code !== 0 && code !== null) {
      console.error(`[anton-server] exited with code ${code}`);
    }
  });

  serverProcess = child;

  const ready = await probeHealth(readyTimeoutMs);
  if (!ready) {
    return {
      ok: false,
      reason: `Server did not respond on /health within ${readyTimeoutMs}ms.`,
      port: serverPort,
    };
  }
  serverStarted = true;
  return { ok: true, port: serverPort };
}

export function stopServer() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
    serverProcess = null;
    serverStarted = false;
  }
}

export function isServerRunning(): boolean {
  return serverStarted && serverProcess !== null;
}
