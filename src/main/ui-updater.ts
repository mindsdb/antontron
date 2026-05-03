import { app } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';

// Where we read latest.json from — GitHub Pages, no API rate limits
const MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

interface UIManifest {
  version: string;
  url: string;       // GitHub Release asset download URL
  sha256: string;
}

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'ui-cache');
}

function getCurrentDir(): string {
  return path.join(getCacheDir(), 'current');
}

function getStagingDir(): string {
  return path.join(getCacheDir(), 'staging');
}

function getPreviousDir(): string {
  return path.join(getCacheDir(), 'previous');
}

function getVersionFile(): string {
  return path.join(getCacheDir(), 'version.json');
}

function getBundledRendererPath(): string {
  // In packaged app: process.resourcesPath/app/dist/renderer/index.html
  // In dev: dist/renderer/index.html relative to main
  return path.join(__dirname, '..', '..', 'renderer', 'index.html');
}

/** Returns the index.html path to load — bundled only.
 *  UI auto-updater is disabled while we iterate on the cowork-derived
 *  renderer; previously this returned a cached download from
 *  mindsdb.github.io which would mask local builds.
 */
export function getRendererPath(): string {
  return getBundledRendererPath();
}

/** Read the currently cached UI version, or null if none. */
export function getCachedVersion(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(getVersionFile(), 'utf-8'));
    return data.version || null;
  } catch {
    return null;
  }
}

function httpsGet(url: string): Promise<{ statusCode: number; headers: Record<string, any>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const doGet = (reqUrl: string, redirects: number) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      https.get(reqUrl, { headers: { 'User-Agent': 'antontron-updater' } }, (res) => {
        // Follow redirects (GitHub releases use 302)
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          doGet(res.headers.location, redirects + 1);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, any>,
            body: Buffer.concat(chunks),
          });
        });
      }).on('error', reject);
    };
    doGet(url, 0);
  });
}

async function fetchManifest(): Promise<UIManifest | null> {
  try {
    const res = await httpsGet(MANIFEST_URL);
    if (res.statusCode !== 200) return null;
    const data = JSON.parse(res.body.toString('utf-8'));
    if (!data.version || !data.url || !data.sha256) return null;
    return data as UIManifest;
  } catch {
    return null;
  }
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function rmDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Extracts a .tar.gz buffer into a target directory. */
async function extractTarGz(buf: Buffer, targetDir: string): Promise<void> {
  // Use tar from Node — we decompress with zlib, then parse the tar manually
  // For simplicity and zero deps, shell out to tar
  fs.mkdirSync(targetDir, { recursive: true });
  const tmpFile = path.join(getCacheDir(), 'download.tar.gz');
  fs.writeFileSync(tmpFile, buf);
  const { execFileSync } = require('child_process');
  execFileSync('tar', ['xzf', tmpFile, '-C', targetDir]);
  fs.unlinkSync(tmpFile);
}

/**
 * Check for UI updates in the background. Downloads and stages the new UI
 * so it's ready on next launch. Returns true if a new version was downloaded.
 */
export async function checkForUIUpdate(): Promise<boolean> {
  // UI auto-updater is disabled while we iterate on the cowork-derived
  // renderer. Previously this fetched a manifest from
  // https://mindsdb.github.io/antontron-releases/latest.json and downloaded
  // a tarball that masked locally-bundled changes. Re-enable when the
  // renderer ships and we want hot UI updates again. See getRendererPath()
  // above — it now always returns the bundled UI.
  return false;
}

/** Roll back to previous cached version or bundled UI. */
export function rollbackUI(): void {
  const current = getCurrentDir();
  const previous = getPreviousDir();

  rmDir(current);
  if (fs.existsSync(previous)) {
    fs.renameSync(previous, current);
    // Clear version so next boot re-checks
    try { fs.unlinkSync(getVersionFile()); } catch {}
  }
}
