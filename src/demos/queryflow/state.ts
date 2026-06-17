// React binding for the QueryFlow store. useSyncExternalStore gives every
// component a consistent snapshot of the current query and saved queries, and
// re-renders whenever the store changes.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store';

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
