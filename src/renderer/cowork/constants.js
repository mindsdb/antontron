// Shared constants for the Anton CoWork frontend.

export const ROUTES = {
  HOME: 'home',
  TASK: 'task',
  PROJECTS: 'projects',
  SCHEDULED: 'scheduled',
  ARTIFACTS: 'artifacts',
  DISPATCH: 'dispatch',
  CUSTOMIZE: 'customize',
  SETTINGS: 'settings',
  MEMORY: 'memory',
  SKILLS: 'skills',
  CONNECT: 'connect',
  PUBLISH: 'publish',
};

// 'connect' removed — connector management moved to the 'customize' route.
export const UTILITY_ROUTES = [ROUTES.MEMORY, ROUTES.SKILLS, ROUTES.PUBLISH];

export const ACCENT_VARS = {
  aqua:  {},
  ocean: { '--primary-700': '#276F86', '--primary-600': '#3796B3', '--primary-500': '#53AECA', '--primary-400': '#48BEE3', '--primary-300': '#71CDE9', '--primary-50': '#E2F5FD' },
  sage:  { '--primary-700': '#3D6159', '--primary-600': '#4D7A70', '--primary-500': '#5D9287', '--primary-400': '#78BAAC', '--primary-300': '#84CCBD', '--primary-50': '#D3F9F0' },
  stone: { '--primary-700': '#3A464B', '--primary-600': '#55666D', '--primary-500': '#64777E', '--primary-400': '#7D95A1', '--primary-300': '#A0BECA', '--primary-50': '#EBF2F5' },
};

export const THINKING_PLACEHOLDER = 'Thinking...';
