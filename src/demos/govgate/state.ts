// React binding for the framework-agnostic GovGate store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on store changes.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store';

export function useGovStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
