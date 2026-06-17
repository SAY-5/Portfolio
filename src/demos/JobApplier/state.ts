// React binding for the framework-agnostic store. useSyncExternalStore gives
// every component a consistent snapshot and re-renders on any store change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe } from './store';
import type { Persisted } from './types';

export function useJobStore(): Persisted {
  return useSyncExternalStore(subscribe, getState, getState);
}
