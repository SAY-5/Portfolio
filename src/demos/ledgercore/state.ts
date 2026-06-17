// React binding for the framework-agnostic ledger store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on any change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store';

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
