import { spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_HERMES_URL = 'http://127.0.0.1:8642';
const DEFAULT_NANOCLAW_URL = 'http://127.0.0.1:8643';

let hermesProcess: ChildProcess | null = null;
let managedHermesUrl: string | null = null;
let managedHermesKey: string | null = null;

let nanoclawProcess: ChildProcess | null = null;
let managedNanoclawUrl: string | null = null;
let managedNanoclawKey: string | null = null;

function getAntonEnvPath(): string {
  return path.join(os.homedir(), '.anton', '.env');
}

function readEnvFile(): Record<string, string> {
  const envPath = getAntonEnvPath();
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return vars;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return vars;
}

function envPath(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  return [localBin, cargoBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
}

export type HarnessId = 'anton' | 'hermes' | 'nanoclaw';

function normalizeHarness(value?: string): HarnessId {
  const raw = (value || 'anton').trim().toLowerCase();
  if (raw === 'hermes' || raw === 'hermes-agent' || raw === 'hermes_agent') return 'hermes';
  if (raw === 'nanoclaw' || raw === 'nano-claw' || raw === 'nano_claw') return 'nanoclaw';
  return 'anton';
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function getSelectedHarness(): HarnessId {
  const vars = readEnvFile();
  return normalizeHarness(process.env.COWORK_HARNESS_PROVIDER || vars.COWORK_HARNESS_PROVIDER);
}

function getHermesCommand(): string | null {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'hermes'),
    path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const dir of envPath().split(path.delimiter)) {
    const candidate = path.join(dir, 'hermes');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function hermesSettings() {
  const vars = readEnvFile();
  const baseUrl = (
    process.env.COWORK_HERMES_API_BASE_URL ||
    vars.COWORK_HERMES_API_BASE_URL ||
    process.env.HERMES_API_BASE_URL ||
    DEFAULT_HERMES_URL
  ).replace(/\/+$/, '');
  const apiKey =
    process.env.COWORK_HERMES_API_KEY ||
    vars.COWORK_HERMES_API_KEY ||
    process.env.API_SERVER_KEY ||
    '';
  const autoStart = boolValue(process.env.COWORK_HERMES_AUTO_START || vars.COWORK_HERMES_AUTO_START, true);
  return { baseUrl, apiKey, autoStart };
}

function nanoclawSettings() {
  const vars = readEnvFile();
  const baseUrl = (
    process.env.COWORK_NANOCLAW_GATEWAY_URL ||
    vars.COWORK_NANOCLAW_GATEWAY_URL ||
    DEFAULT_NANOCLAW_URL
  ).replace(/\/+$/, '');
  const apiKey =
    process.env.COWORK_NANOCLAW_GATEWAY_KEY ||
    vars.COWORK_NANOCLAW_GATEWAY_KEY ||
    '';
  const autoStart = boolValue(
    process.env.COWORK_NANOCLAW_AUTO_START || vars.COWORK_NANOCLAW_AUTO_START,
    true,
  );
  return { baseUrl, apiKey, autoStart };
}

function getNanoclawEntry(): string | null {
  // Allow override via env, then check standard install locations. We need
  // the path to dist/index.js, not a binary — NanoClaw runs as `node
  // dist/index.js` (see openclaw/nanoclaw/package.json `"start"`).
  const override =
    process.env.COWORK_NANOCLAW_HOME ||
    readEnvFile().COWORK_NANOCLAW_HOME ||
    '';
  const candidateRoots = [
    override,
    path.join(os.homedir(), '.nanoclaw'),
    path.join(os.homedir(), 'nanoclaw'),
  ].filter(Boolean);
  for (const root of candidateRoots) {
    const entry = path.join(root, 'dist', 'index.js');
    if (fs.existsSync(entry)) return entry;
  }
  return null;
}

function httpGetOk(baseUrl: string, apiKey: string, route: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(route, baseUrl);
    } catch {
      resolve(false);
      return;
    }
    const req = http.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function probeHermes(baseUrl: string, apiKey: string): Promise<boolean> {
  const health = await httpGetOk(baseUrl, apiKey, '/health');
  if (!health) return false;
  return httpGetOk(baseUrl, apiKey, '/v1/models');
}

async function probeNanoclaw(baseUrl: string, apiKey: string): Promise<boolean> {
  const health = await httpGetOk(baseUrl, apiKey, '/health');
  if (!health) return false;
  return httpGetOk(baseUrl, apiKey, '/v1/agent_groups');
}

async function waitForHermes(baseUrl: string, apiKey: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeHermes(baseUrl, apiKey)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function waitForNanoclaw(baseUrl: string, apiKey: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeNanoclaw(baseUrl, apiKey)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function getHostPort(baseUrl: string, fallbackPort: number): { host: string; port: number } {
  const parsed = new URL(baseUrl);
  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port || fallbackPort),
  };
}

async function prepareHermesEnvironment(env: NodeJS.ProcessEnv): Promise<void> {
  const settings = hermesSettings();
  let baseUrl = managedHermesUrl || settings.baseUrl;
  let apiKey = managedHermesKey || settings.apiKey;

  if (await probeHermes(baseUrl, apiKey)) {
    env.COWORK_HERMES_API_BASE_URL = baseUrl;
    if (apiKey) env.COWORK_HERMES_API_KEY = apiKey;
    return;
  }

  if (!settings.autoStart) {
    env.COWORK_HERMES_API_BASE_URL = baseUrl;
    if (apiKey) env.COWORK_HERMES_API_KEY = apiKey;
    return;
  }

  if (!apiKey) {
    apiKey = `cowork-${crypto.randomBytes(24).toString('hex')}`;
  }
  const command = getHermesCommand();
  if (!command) {
    env.COWORK_HERMES_API_BASE_URL = baseUrl;
    env.COWORK_HERMES_API_KEY = apiKey;
    env.COWORK_HERMES_START_ERROR = 'Hermes command not found.';
    return;
  }

  if (!hermesProcess) {
    const { host, port } = getHostPort(baseUrl, 8642);
    const childEnv = {
      ...process.env,
      PATH: envPath(),
      API_SERVER_ENABLED: 'true',
      API_SERVER_HOST: host,
      API_SERVER_PORT: String(port),
      API_SERVER_KEY: apiKey,
    };
    const child = spawn(command, ['gateway', 'run'], {
      cwd: os.homedir(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    hermesProcess = child;
    managedHermesUrl = baseUrl;
    managedHermesKey = apiKey;
    child.stdout.on('data', (d) => process.stdout.write(`[hermes-agent] ${d.toString()}`));
    child.stderr.on('data', (d) => process.stderr.write(`[hermes-agent] ${d.toString()}`));
    child.on('error', (err) => {
      console.error(`[hermes-agent] failed to start: ${err.message}`);
      if (hermesProcess === child) {
        hermesProcess = null;
        managedHermesUrl = null;
        managedHermesKey = null;
      }
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[hermes-agent] exited with code ${code}`);
      }
      if (hermesProcess === child) {
        hermesProcess = null;
        managedHermesUrl = null;
        managedHermesKey = null;
      }
    });
  }

  const ready = await waitForHermes(baseUrl, apiKey, 45_000);
  env.COWORK_HERMES_API_BASE_URL = baseUrl;
  env.COWORK_HERMES_API_KEY = apiKey;
  if (!ready) {
    env.COWORK_HERMES_START_ERROR = 'Hermes gateway did not become ready.';
  }
}

async function prepareNanoclawEnvironment(env: NodeJS.ProcessEnv): Promise<void> {
  const settings = nanoclawSettings();
  let baseUrl = managedNanoclawUrl || settings.baseUrl;
  let apiKey = managedNanoclawKey || settings.apiKey;

  if (await probeNanoclaw(baseUrl, apiKey)) {
    env.COWORK_NANOCLAW_GATEWAY_URL = baseUrl;
    if (apiKey) env.COWORK_NANOCLAW_GATEWAY_KEY = apiKey;
    return;
  }

  if (!settings.autoStart) {
    env.COWORK_NANOCLAW_GATEWAY_URL = baseUrl;
    if (apiKey) env.COWORK_NANOCLAW_GATEWAY_KEY = apiKey;
    return;
  }

  if (!apiKey) {
    apiKey = `cowork-${crypto.randomBytes(24).toString('hex')}`;
  }
  const entry = getNanoclawEntry();
  if (!entry) {
    env.COWORK_NANOCLAW_GATEWAY_URL = baseUrl;
    env.COWORK_NANOCLAW_GATEWAY_KEY = apiKey;
    env.COWORK_NANOCLAW_START_ERROR =
      'NanoClaw install not found. Set COWORK_NANOCLAW_HOME or install to ~/.nanoclaw.';
    return;
  }

  if (!nanoclawProcess) {
    const { host, port } = getHostPort(baseUrl, 8643);
    const childEnv = {
      ...process.env,
      PATH: envPath(),
      NANOCLAW_COWORK_GATEWAY_ENABLED: '1',
      NANOCLAW_COWORK_GATEWAY_HOST: host,
      NANOCLAW_COWORK_GATEWAY_PORT: String(port),
      NANOCLAW_COWORK_GATEWAY_KEY: apiKey,
    };
    const child = spawn(process.execPath, [entry], {
      cwd: path.dirname(path.dirname(entry)),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    nanoclawProcess = child;
    managedNanoclawUrl = baseUrl;
    managedNanoclawKey = apiKey;
    child.stdout.on('data', (d) => process.stdout.write(`[nanoclaw] ${d.toString()}`));
    child.stderr.on('data', (d) => process.stderr.write(`[nanoclaw] ${d.toString()}`));
    child.on('error', (err) => {
      console.error(`[nanoclaw] failed to start: ${err.message}`);
      if (nanoclawProcess === child) {
        nanoclawProcess = null;
        managedNanoclawUrl = null;
        managedNanoclawKey = null;
      }
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[nanoclaw] exited with code ${code}`);
      }
      if (nanoclawProcess === child) {
        nanoclawProcess = null;
        managedNanoclawUrl = null;
        managedNanoclawKey = null;
      }
    });
  }

  const ready = await waitForNanoclaw(baseUrl, apiKey, 60_000);
  env.COWORK_NANOCLAW_GATEWAY_URL = baseUrl;
  env.COWORK_NANOCLAW_GATEWAY_KEY = apiKey;
  if (!ready) {
    env.COWORK_NANOCLAW_START_ERROR = 'NanoClaw gateway did not become ready.';
  }
}

export async function prepareHarnessEnvironment(baseEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const selected = getSelectedHarness();
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    COWORK_HARNESS_PROVIDER: selected,
  };
  if (selected === 'hermes') {
    await prepareHermesEnvironment(env);
  } else if (selected === 'nanoclaw') {
    await prepareNanoclawEnvironment(env);
  }
  return env;
}

async function stopManagedChild(
  current: ChildProcess | null,
  clear: () => void,
): Promise<void> {
  if (!current) return;
  clear();
  const exited = new Promise<void>((resolve) => current.once('exit', () => resolve()));
  try { current.kill('SIGTERM'); } catch {}
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
  if (current.exitCode === null && !current.killed) {
    try { current.kill('SIGKILL'); } catch {}
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
  }
}

export async function stopManagedHermes(): Promise<void> {
  const proc = hermesProcess;
  await stopManagedChild(proc, () => {
    hermesProcess = null;
    managedHermesUrl = null;
    managedHermesKey = null;
  });
}

export async function stopManagedNanoclaw(): Promise<void> {
  const proc = nanoclawProcess;
  await stopManagedChild(proc, () => {
    nanoclawProcess = null;
    managedNanoclawUrl = null;
    managedNanoclawKey = null;
  });
}

/**
 * Stop any managed harness child process. Called by the server-process
 * lifecycle when the python backend stops or the app shuts down.
 */
export async function stopAllManagedHarnesses(): Promise<void> {
  await Promise.all([stopManagedHermes(), stopManagedNanoclaw()]);
}
