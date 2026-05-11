import { useSyncExternalStore } from 'react';

const MOBILE = 640;
const NARROW = 900;

function getSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth : 1200;
}

function subscribe(callback) {
  window.addEventListener('resize', callback, { passive: true });
  return () => window.removeEventListener('resize', callback);
}

export function useBreakpoint() {
  const width = useSyncExternalStore(subscribe, getSnapshot, () => 1200);
  return { isMobile: width < MOBILE, isNarrow: width < NARROW };
}
