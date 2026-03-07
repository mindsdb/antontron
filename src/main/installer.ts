import { spawn, execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC } from '../shared/ipc-channels';

interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
}

const STEPS: InstallStep[] = [
  { id: 'git', label: 'Check for git', status: 'pending' },
  { id: 'uv', label: 'Install uv (Python package manager)', status: 'pending' },
  { id: 'anton', label: 'Install Anton', status: 'pending' },
  { id: 'verify', label: 'Verify installation', status: 'pending' },
];

function getLocalBin(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.local', 'bin');
  }
  return path.join(os.homedir(), '.local', 'bin');
}

function getAntonBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'anton.exe');
  }
  return path.join(localBin, 'anton');
}

function getUvBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'uv.exe');
  }
  return path.join(localBin, 'uv');
}

function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  const parts = [localBin, cargoBin, currentPath];
  return parts.join(path.delimiter);
}

function sendLog(win: BrowserWindow, message: string) {
  win.webContents.send(IPC.INSTALL_LOG, message);
}

function sendProgress(win: BrowserWindow, steps: InstallStep[]) {
  win.webContents.send(IPC.INSTALL_PROGRESS, JSON.parse(JSON.stringify(steps)));
}

function runCommand(
  command: string,
  args: string[],
  win: BrowserWindow,
  opts?: { shell?: boolean }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getEnvPath() };
    const proc = spawn(command, args, {
      env,
      shell: opts?.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      sendLog(win, text);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      sendLog(win, text);
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on('error', (err) => {
      sendLog(win, `Error: ${err.message}\n`);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getEnvPath() };
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(whichCmd, [cmd], { env }, (err) => {
      resolve(!err);
    });
  });
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export async function checkAntonInstalled(): Promise<boolean> {
  if (fileExists(getAntonBinary())) return true;
  return commandExists('anton');
}

export async function runInstaller(win: BrowserWindow): Promise<boolean> {
  const steps = STEPS.map((s) => ({ ...s }));

  const setStep = (id: string, status: InstallStep['status']) => {
    const step = steps.find((s) => s.id === id);
    if (step) step.status = status;
    sendProgress(win, steps);
  };

  try {
    // Step 1: Check git
    setStep('git', 'running');
    sendLog(win, '--- Checking for git ---\n');
    const hasGit = await commandExists('git');
    if (!hasGit) {
      setStep('git', 'error');
      sendLog(win, '\nERROR: git is not installed.\n');
      if (process.platform === 'darwin') {
        sendLog(win, 'Install it with: xcode-select --install\n');
      } else {
        sendLog(win, 'Install it from: https://git-scm.com/downloads/win\n');
      }
      win.webContents.send(IPC.INSTALL_ERROR, 'git is required but not found');
      return false;
    }
    sendLog(win, 'git found.\n');
    setStep('git', 'done');

    // Step 2: Check/install uv
    setStep('uv', 'running');
    sendLog(win, '\n--- Checking for uv ---\n');
    let hasUv = await commandExists('uv') || fileExists(getUvBinary());

    if (!hasUv) {
      sendLog(win, 'uv not found. Installing...\n');
      if (process.platform === 'win32') {
        const result = await runCommand(
          'powershell',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
           "& ([scriptblock]::Create((Invoke-RestMethod https://astral.sh/uv/install.ps1)))"],
          win
        );
        if (result.code !== 0) {
          setStep('uv', 'error');
          win.webContents.send(IPC.INSTALL_ERROR, 'Failed to install uv');
          return false;
        }
      } else {
        const result = await runCommand(
          'sh',
          ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
          win,
          { shell: false }
        );
        if (result.code !== 0) {
          setStep('uv', 'error');
          win.webContents.send(IPC.INSTALL_ERROR, 'Failed to install uv');
          return false;
        }
      }
      // Verify uv installed
      hasUv = await commandExists('uv') || fileExists(getUvBinary());
      if (!hasUv) {
        setStep('uv', 'error');
        sendLog(win, 'ERROR: uv installation completed but binary not found.\n');
        win.webContents.send(IPC.INSTALL_ERROR, 'uv installation failed');
        return false;
      }
      sendLog(win, 'uv installed successfully.\n');
    } else {
      sendLog(win, 'uv found.\n');
    }
    setStep('uv', 'done');

    // Step 3: Install Anton
    setStep('anton', 'running');
    sendLog(win, '\n--- Installing Anton ---\n');

    const uvBin = fileExists(getUvBinary()) ? getUvBinary() : 'uv';
    const installResult = await runCommand(
      uvBin,
      ['tool', 'install', 'git+https://github.com/mindsdb/anton.git', '--force'],
      win
    );

    if (installResult.code !== 0) {
      setStep('anton', 'error');
      sendLog(win, '\nERROR: Failed to install Anton.\n');
      win.webContents.send(IPC.INSTALL_ERROR, 'Anton installation failed');
      return false;
    }
    sendLog(win, 'Anton installed.\n');
    setStep('anton', 'done');

    // Step 4: Verify
    setStep('verify', 'running');
    sendLog(win, '\n--- Verifying installation ---\n');
    const antonInstalled = await checkAntonInstalled();
    if (!antonInstalled) {
      setStep('verify', 'error');
      sendLog(win, 'ERROR: Anton binary not found after installation.\n');
      win.webContents.send(IPC.INSTALL_ERROR, 'Verification failed');
      return false;
    }
    sendLog(win, 'Anton is ready!\n');
    setStep('verify', 'done');

    win.webContents.send(IPC.INSTALL_DONE);
    return true;
  } catch (err: any) {
    sendLog(win, `\nUnexpected error: ${err.message}\n`);
    win.webContents.send(IPC.INSTALL_ERROR, err.message);
    return false;
  }
}
