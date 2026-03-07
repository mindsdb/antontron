export const IPC = {
  // Installer
  INSTALL_CHECK: 'install:check',
  INSTALL_START: 'install:start',
  INSTALL_LOG: 'install:log',
  INSTALL_PROGRESS: 'install:progress',
  INSTALL_DONE: 'install:done',
  INSTALL_ERROR: 'install:error',

  // Anton process
  ANTON_START: 'anton:start',
  ANTON_DATA: 'anton:data',
  ANTON_INPUT: 'anton:input',
  ANTON_RESIZE: 'anton:resize',
  ANTON_EXIT: 'anton:exit',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
} as const;
