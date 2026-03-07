import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { IPC } from '../shared/ipc-channels';

let ptyProcess: any = null;

function getEnvPath(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  return [localBin, cargoBin, currentPath].join(path.delimiter);
}

function getAntonBinary(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const bin = process.platform === 'win32' ? 'anton.exe' : 'anton';
  const fullPath = path.join(localBin, bin);
  if (fs.existsSync(fullPath)) return fullPath;
  return 'anton';
}

function getShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function startAnton(win: BrowserWindow, cols: number, rows: number) {
  // node-pty must be required at runtime (native module)
  const pty = require('node-pty');

  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }

  const antonBin = getAntonBinary();
  const env = { ...process.env, PATH: getEnvPath(), TERM: 'xterm-256color' };

  ptyProcess = pty.spawn(antonBin, [], {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 40,
    cwd: os.homedir(),
    env,
  });

  ptyProcess.onData((data: string) => {
    win.webContents.send(IPC.ANTON_DATA, data);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    win.webContents.send(IPC.ANTON_EXIT, exitCode);
    ptyProcess = null;
  });
}

export function writeToAnton(data: string) {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

export function resizeAnton(cols: number, rows: number) {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
}

export function killAnton() {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
}
