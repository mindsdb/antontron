import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('antontron', {
  // Installer
  checkInstall: () => ipcRenderer.invoke(IPC.INSTALL_CHECK),
  startInstall: () => ipcRenderer.invoke(IPC.INSTALL_START),
  onInstallLog: (cb: (msg: string) => void) => {
    const listener = (_: any, msg: string) => cb(msg);
    ipcRenderer.on(IPC.INSTALL_LOG, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_LOG, listener);
  },
  onInstallProgress: (cb: (steps: any[]) => void) => {
    const listener = (_: any, steps: any[]) => cb(steps);
    ipcRenderer.on(IPC.INSTALL_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_PROGRESS, listener);
  },
  onInstallDone: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.INSTALL_DONE, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_DONE, listener);
  },
  onInstallError: (cb: (err: string) => void) => {
    const listener = (_: any, err: string) => cb(err);
    ipcRenderer.on(IPC.INSTALL_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_ERROR, listener);
  },

  // Anton process
  startAnton: (cols: number, rows: number) =>
    ipcRenderer.invoke(IPC.ANTON_START, cols, rows),
  sendInput: (data: string) => ipcRenderer.send(IPC.ANTON_INPUT, data),
  resizeTerminal: (cols: number, rows: number) =>
    ipcRenderer.send(IPC.ANTON_RESIZE, cols, rows),
  onAntonData: (cb: (data: string) => void) => {
    const listener = (_: any, data: string) => cb(data);
    ipcRenderer.on(IPC.ANTON_DATA, listener);
    return () => ipcRenderer.removeListener(IPC.ANTON_DATA, listener);
  },
  onAntonExit: (cb: (code: number) => void) => {
    const listener = (_: any, code: number) => cb(code);
    ipcRenderer.on(IPC.ANTON_EXIT, listener);
    return () => ipcRenderer.removeListener(IPC.ANTON_EXIT, listener);
  },

  // App
  getPlatform: () => process.platform,
});
