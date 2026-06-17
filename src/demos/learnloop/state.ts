// React binding for the framework-agnostic session store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on any change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type Session } from './store';

export function useSession(): Session {
  return useSyncExternalStore(subscribe, getState, getState);
}
