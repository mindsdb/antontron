interface AntonTronAPI {
  checkInstall: () => Promise<boolean>;
  startInstall: () => Promise<boolean>;
  onInstallLog: (cb: (msg: string) => void) => () => void;
  onInstallProgress: (cb: (steps: any[]) => void) => () => void;
  onInstallDone: (cb: () => void) => () => void;
  onInstallError: (cb: (err: string) => void) => () => void;

  startAnton: (cols: number, rows: number) => Promise<void>;
  sendInput: (data: string) => void;
  resizeTerminal: (cols: number, rows: number) => void;
  onAntonData: (cb: (data: string) => void) => () => void;
  onAntonExit: (cb: (code: number) => void) => () => void;

  getPlatform: () => string;
}

declare global {
  interface Window {
    antontron: AntonTronAPI;
  }
}

export {};
