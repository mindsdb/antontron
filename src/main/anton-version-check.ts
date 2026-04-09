import { execFile } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { REQUIRED_ANTON_VERSION } from '../shared/anton-version';

export interface VersionStatus {
  installed: string | null;
  required: string;
  updateAvailable: boolean;
}

function getLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

function getAntonBinary(): string {
  const localBin = getLocalBin();
  const bin = process.platform === 'win32' ? 'anton.exe' : 'anton';
  const fullPath = path.join(localBin, bin);
  if (fs.existsSync(fullPath)) return fullPath;
  return 'anton';
}

function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  return [localBin, cargoBin, currentPath].join(path.delimiter);
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Run `anton --version` and extract a semver string from the output.
 * Handles formats like "anton 0.1.0", "0.1.0", "Anton CLI v0.1.0", etc.
 */
export function getInstalledAntonVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const antonBin = getAntonBinary();
    const env = { ...process.env, PATH: getEnvPath() };
    execFile(antonBin, ['--version'], { env, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        resolve(null);
        return;
      }
      const output = (stdout || '') + (stderr || '');
      const match = output.match(/(\d+\.\d+\.\d+)/);
      resolve(match ? match[1] : null);
    });
  });
}

export async function checkAntonVersion(): Promise<VersionStatus> {
  const installed = await getInstalledAntonVersion();
  const required = REQUIRED_ANTON_VERSION;
  const updateAvailable = installed === null || compareSemver(installed, required) < 0;
  return { installed, required, updateAvailable };
}
