// React binding for the framework-agnostic board store. useSyncExternalStore
// gives every component the same consistent snapshot and re-renders whenever the
// store commits a change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store';

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
