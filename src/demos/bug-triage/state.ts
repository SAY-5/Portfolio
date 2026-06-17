// React binding for the framework-agnostic bug store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on any change.
import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';
import type { Bug } from './types';

export function useBugs(): Bug[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
