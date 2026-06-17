// React binding for the framework-agnostic whiteboard store. useSyncExternalStore
// gives every component a consistent snapshot and re-renders on any store change.
import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';

export function useCanvasStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
