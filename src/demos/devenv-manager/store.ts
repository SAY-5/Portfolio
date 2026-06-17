// Browser-side model of a local dev-services manager. Services live in
// localStorage; the store seeds a realistic six-service graph (db <- cache,
// db <- api, cache <- api, api <- web, plus a worker and a mailhog) on first
// run. Starting a service brings its dependencies up first in topological
// order; stopping one is blocked while a running dependent still needs it
// unless the caller opts into a cascade that stops the dependents first.
// Adding a dependency that would close a loop is rejected by the engine. All
// graph logic lives in engine.ts; this file owns persistence and transitions.

import {
  conflictedServiceIds,
  findCycle,
  portConflicts,
  runningDependents,
  startChain,
  topoOrder,
} from './engine';
import type { CycleError, PortConflict, Service } from './types';

const KEY = 'devenv-manager.services.v1';

export type State = {
  services: Service[];
  // The most recent rejected dependency edge, surfaced in the conflicts panel.
  lastCycle: CycleError | null;
  // Whether a stop should cascade to running dependents instead of being
  // blocked. Defaults off so the blocking behaviour is visible first.
  cascadeStop: boolean;
};

// ---------- seed ----------

function seedServices(): Service[] {
  return [
    {
      id: 'db',
      name: 'postgres',
      port: 5432,
      command: 'postgres -D ./data',
      dependsOn: [],
      status: 'stopped',
    },
    {
      id: 'cache',
      name: 'redis',
      port: 6379,
      command: 'redis-server',
      dependsOn: [],
      status: 'stopped',
    },
    {
      id: 'mail',
      name: 'mailhog',
      port: 8025,
      command: 'mailhog',
      dependsOn: [],
      status: 'stopped',
    },
    {
      id: 'api',
      name: 'api',
      port: 4000,
      command: 'node server.js',
      dependsOn: ['db', 'cache'],
      status: 'stopped',
    },
    {
      id: 'worker',
      name: 'worker',
      port: 4100,
      command: 'node worker.js',
      dependsOn: ['db', 'cache'],
      status: 'stopped',
    },
    {
      id: 'web',
      name: 'web',
      port: 3000,
      command: 'vite',
      dependsOn: ['api'],
      status: 'stopped',
    },
  ];
}

// ---------- persistence ----------

function readServices(): Service[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedServices();
    const parsed = JSON.parse(raw) as Service[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedServices();
    // Reset volatile status on load: nothing is actually running in a fresh
    // page, so persisted services come back stopped.
    return parsed.map((s) => ({ ...s, status: 'stopped' as const }));
  } catch {
    return seedServices();
  }
}

function writeServices(services: Service[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(services));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

// ---------- minimal external store ----------

let state: State = {
  services: readServices(),
  lastCycle: null,
  cascadeStop: false,
};
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setServices(services: Service[], extra: Partial<State> = {}): void {
  writeServices(services);
  state = { ...state, services, ...extra };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- id helper ----------

function slugId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = base || 'svc';
  const taken = new Set(state.services.map((s) => s.id));
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

// ---------- service CRUD ----------

export type ServiceInput = {
  name: string;
  port: number;
  command: string;
  dependsOn?: string[];
};

export function addService(input: ServiceInput): string {
  const id = slugId(input.name);
  const svc: Service = {
    id,
    name: input.name.trim() || id,
    port: Math.max(0, Math.floor(input.port)) || 0,
    command: input.command.trim(),
    dependsOn: (input.dependsOn ?? []).filter((d) =>
      state.services.some((s) => s.id === d),
    ),
    status: 'stopped',
  };
  setServices([...state.services, svc], { lastCycle: null });
  return id;
}

export function editService(
  id: string,
  patch: Partial<Pick<Service, 'name' | 'port' | 'command'>>,
): void {
  const services = state.services.map((s) =>
    s.id === id
      ? {
          ...s,
          ...(patch.name !== undefined ? { name: patch.name.trim() || s.name } : {}),
          ...(patch.port !== undefined
            ? { port: Math.max(0, Math.floor(patch.port)) }
            : {}),
          ...(patch.command !== undefined ? { command: patch.command } : {}),
        }
      : s,
  );
  setServices(services);
}

export function deleteService(id: string): void {
  const services = state.services
    .filter((s) => s.id !== id)
    .map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) }));
  setServices(services, { lastCycle: null });
}

// ---------- dependency edges ----------

// Add `to` as a dependency of `from`. Rejected (and recorded) when it would
// create a cycle. Returns the CycleError on rejection, or null on success.
export function addDependency(from: string, to: string): CycleError | null {
  if (from === to) {
    const err = findCycle(state.services, from, to);
    setServices(state.services, { lastCycle: err });
    return err;
  }
  const fromSvc = state.services.find((s) => s.id === from);
  if (!fromSvc || !state.services.some((s) => s.id === to)) return null;
  if (fromSvc.dependsOn.includes(to)) return null;

  const cycle = findCycle(state.services, from, to);
  if (cycle) {
    setServices(state.services, { lastCycle: cycle });
    return cycle;
  }

  const services = state.services.map((s) =>
    s.id === from ? { ...s, dependsOn: [...s.dependsOn, to] } : s,
  );
  setServices(services, { lastCycle: null });
  return null;
}

export function removeDependency(from: string, to: string): void {
  const services = state.services.map((s) =>
    s.id === from ? { ...s, dependsOn: s.dependsOn.filter((d) => d !== to) } : s,
  );
  setServices(services, { lastCycle: null });
}

export function clearLastCycle(): void {
  setServices(state.services, { lastCycle: null });
}

export function setCascadeStop(on: boolean): void {
  state = { ...state, cascadeStop: on };
  emit();
}

// ---------- lifecycle ----------

function markRunning(services: Service[], ids: string[]): Service[] {
  const set = new Set(ids);
  return services.map((s) => (set.has(s.id) ? { ...s, status: 'running' as const } : s));
}

function markStopped(services: Service[], ids: string[]): Service[] {
  const set = new Set(ids);
  return services.map((s) => (set.has(s.id) ? { ...s, status: 'stopped' as const } : s));
}

// Start a service and its dependencies, in topological order. Returns the
// ordered chain of ids that were brought up (skipping any already running) so
// the UI can animate them coming online one at a time.
export function startService(id: string): string[] {
  const chain = startChain(state.services, id);
  const toStart = chain.filter((sid) => {
    const svc = state.services.find((s) => s.id === sid);
    return svc && svc.status !== 'running';
  });
  setServices(markRunning(state.services, toStart));
  return toStart;
}

// Start every service in one pass, respecting topological order.
export function startAll(): string[] {
  const order = topoOrder(state.services);
  const toStart = order.filter((sid) => {
    const svc = state.services.find((s) => s.id === sid);
    return svc && svc.status !== 'running';
  });
  setServices(markRunning(state.services, toStart));
  return toStart;
}

export type StopResult =
  | { ok: true; stopped: string[] }
  | { ok: false; blockedBy: string[] };

// Stop a service. If running dependents need it and cascadeStop is off, the
// stop is blocked and the blocking dependents are returned. With cascadeStop
// on, the dependents are stopped first (reverse topological order) and then
// the service itself.
export function stopService(id: string): StopResult {
  const dependents = runningDependents(state.services, id);
  if (dependents.length > 0 && !state.cascadeStop) {
    return { ok: false, blockedBy: dependents };
  }
  const stopped = [...dependents, id];
  setServices(markStopped(state.services, stopped));
  return { ok: true, stopped };
}

export function stopAll(): void {
  const ids = state.services.map((s) => s.id);
  setServices(markStopped(state.services, ids));
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  state = { services: seedServices(), lastCycle: null, cascadeStop: false };
  writeServices(state.services);
  emit();
}

// ---------- derived (re-exported for the UI) ----------

export function conflicts(s: State = state): PortConflict[] {
  return portConflicts(s.services);
}

export function conflictIds(s: State = state): Set<string> {
  return conflictedServiceIds(s.services);
}

export { startChain, topoOrder };
export type { CycleError, PortConflict, Service };
