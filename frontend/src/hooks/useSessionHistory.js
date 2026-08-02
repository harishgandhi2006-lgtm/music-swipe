import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot } from '../sessionHistory.js';

// Subscribes to the session swipe log. Any mounted consumer re-renders when a
// swipe is recorded, so the History view stays live while it is open rather
// than only refreshing when it is navigated to.
export function useSessionHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
