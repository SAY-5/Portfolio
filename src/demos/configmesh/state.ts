// React binding for the framework-agnostic config store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on any mutation.
import { useSyncExternalStore } from 'react';
import { getDoc, subscribe } from './store';
import type { ConfigDoc } from './types';

export function useConfigDoc(): ConfigDoc {
  return useSyncExternalStore(subscribe, getDoc, getDoc);
}
