// React binding for the equipfleet store. useSyncExternalStore gives every
// component a consistent snapshot and re-renders on any store change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store.ts';

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
