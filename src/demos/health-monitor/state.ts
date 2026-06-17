// React binding for the framework-agnostic HealthMonitor store.
// useSyncExternalStore gives every component a consistent snapshot of the
// fleet and re-renders them on any tick or threshold change.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, type State } from './store';

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
