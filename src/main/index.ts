import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { IPC } from '../shared/ipc-channels';
import { checkAntonInstalled, runInstaller } from './installer';
import { startAnton, writeToAnton, resizeAnton, killAnton } from './anton-process';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for node-pty
    },
  });

  // In dev with Vite running, load from dev server; otherwise load built files
  const isDev = !app.isPackaged && process.env.VITE_DEV === '1';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    killAnton();
    mainWindow = null;
  });
}

// IPC handlers
function setupIPC() {
  ipcMain.handle(IPC.INSTALL_CHECK, async () => {
    return checkAntonInstalled();
  });

  ipcMain.handle(IPC.INSTALL_START, async () => {
    if (!mainWindow) return false;
    return runInstaller(mainWindow);
  });

  ipcMain.handle(IPC.ANTON_START, async (_event, cols: number, rows: number) => {
    if (!mainWindow) return;
    startAnton(mainWindow, cols, rows);
  });

  ipcMain.on(IPC.ANTON_INPUT, (_event, data: string) => {
    writeToAnton(data);
  });

  ipcMain.on(IPC.ANTON_RESIZE, (_event, cols: number, rows: number) => {
    resizeAnton(cols, rows);
  });
}

app.whenReady().then(() => {
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAnton();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
