// React binding for the framework-agnostic gateway store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on any change.
import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';
import type { GatewayState } from './store';

export function useGateway(): GatewayState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
