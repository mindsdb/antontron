import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Runtime dependencies needed by the Anton-packaged Cowork FastAPI server.
// Keep this as the single source of truth for install, verification, and
// server startup gating.
export const SERVER_PYTHON_DEPS: Array<{ spec: string; importName: string }> = [
  { spec: 'fastapi>=0.115.0', importName: 'fastapi' },
  { spec: 'uvicorn[standard]>=0.32.0', importName: 'uvicorn' },
  // python-multipart is the package name, the import is `multipart`.
  { spec: 'python-multipart>=0.0.12', importName: 'multipart' },
  { spec: 'pydantic>=2.0.0', importName: 'pydantic' },
];

export const ANTON_COWORK_SERVER_EXTRA = 'cowork-server';
export const ANTON_COWORK_SERVER_PROTOCOL_VERSION = 1;

export function getAntonGitSpec(ref?: string): string {
  const suffix = ref ? `@${ref}` : '';
  return `anton[${ANTON_COWORK_SERVER_EXTRA}] @ git+https://github.com/mindsdb/anton.git${suffix}`;
}

function getServerPythonImports(includeCoworkServer: boolean): string[] {
  return [
    ...SERVER_PYTHON_DEPS.map((d) => d.importName),
    ...(includeCoworkServer ? ['anton.cowork.server.main'] : []),
  ];
}

export function getUvDataHome(): string {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  return path.join(os.homedir(), '.local', 'share');
}

export function getAntonToolPython(): string {
  return path.join(
    getUvDataHome(),
    'uv',
    'tools',
    'anton',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
}

export function getPythonUtf8Env(): NodeJS.ProcessEnv {
  return {
    PYTHONUTF8: process.env.PYTHONUTF8 || '1',
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
  };
}

export function getServerDepsImportScript(includeCoworkServer: boolean = true): string {
  return [
    'import importlib',
    ...getServerPythonImports(includeCoworkServer).map((name) => `importlib.import_module(${JSON.stringify(name)})`),
  ].join('; ');
}

export function getServerDepsVerifyScript(includeCoworkServer: boolean = true): string {
  return [
    'import importlib',
    ...getServerPythonImports(includeCoworkServer).map((name) => (
      `_m = importlib.import_module(${JSON.stringify(name)}); ` +
      `print('ok ${name}', getattr(_m, '__version__', '?'))`
    )),
  ].join(';\n');
}

export function checkPythonImports(
  pythonPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number = 8000,
  includeCoworkServer: boolean = true,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(
      pythonPath,
      ['-c', getServerDepsImportScript(includeCoworkServer)],
      { env: { ...env, ...getPythonUtf8Env() }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      try { proc.kill('SIGTERM'); } catch {}
      finish(false);
    }, timeoutMs);
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    proc.on('close', (code) => finish(code === 0));
    proc.on('error', () => finish(false));
  });
}
