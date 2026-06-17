// React binding for the framework-agnostic store. useSyncExternalStore gives
// every component a consistent snapshot and re-renders on any store change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store';

export function useQuizStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
