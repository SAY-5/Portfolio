// Browser-side model of the HealthMonitor fleet. It keeps the current tick,
// alert thresholds, and an incident log in localStorage, seeds six services
// (some already degraded or down), and advances every service's latency series
// deterministically on each tick. Nothing here talks to a server: the seeded
// engine derives status, uptime, p95, sparklines, and alerts from the sample
// windows alone. A framework-agnostic store exposes a consistent snapshot to
// React through useSyncExternalStore.

import {
  advanceSamples,
  computeHealth,
  DEFAULT_THRESHOLDS,
  evaluateFleetAlerts,
  rollup,
  seedSamples,
  WINDOW,
} from './engine';
import type {
  Alert,
  Incident,
  Rollup,
  Service,
  ServiceHealth,
  Status,
  Thresholds,
} from './types';

const TICK_KEY = 'healthmonitor.tick.v1';
const THRESH_KEY = 'healthmonitor.thresholds.v1';
const INCIDENTS_KEY = 'healthmonitor.incidents.v1';

// Maximum incident rows retained in the durable log.
const MAX_INCIDENTS = 12;

// Seed definitions for the fleet. Two ship with a persistent fault so the
// dashboard opens with a degraded and a down service, the rest sit healthy and
// drift with their seed. Sample windows are filled deterministically at load.
const SEED_DEFS: Omit<Service, 'samples'>[] = [
  {
    id: 'gateway',
    name: 'api-gateway',
    region: 'us-east-1',
    kind: 'http',
    seed: 0x1a2b3c,
    baseLatencyMs: 60,
    baseErrorPct: 0.4,
    fault: null,
  },
  {
    id: 'checkout',
    name: 'checkout-svc',
    region: 'us-east-1',
    kind: 'grpc',
    seed: 0x2c4e6a,
    baseLatencyMs: 95,
    baseErrorPct: 0.8,
    fault: null,
  },
  {
    id: 'search',
    name: 'search-svc',
    region: 'eu-west-1',
    kind: 'http',
    seed: 0x3f5d7b,
    baseLatencyMs: 140,
    baseErrorPct: 1.1,
    fault: 'latency',
  },
  {
    id: 'payments',
    name: 'payments-svc',
    region: 'us-west-2',
    kind: 'grpc',
    seed: 0x4a6c8e,
    baseLatencyMs: 80,
    baseErrorPct: 1.0,
    fault: 'outage',
  },
  {
    id: 'inventory',
    name: 'inventory-db',
    region: 'eu-west-1',
    kind: 'tcp',
    seed: 0x5b7d9f,
    baseLatencyMs: 45,
    baseErrorPct: 0.3,
    fault: null,
  },
  {
    id: 'notify',
    name: 'notify-svc',
    region: 'ap-south-1',
    kind: 'http',
    seed: 0x6c8eab,
    baseLatencyMs: 110,
    baseErrorPct: 1.4,
    fault: null,
  },
];

export type State = {
  tick: number;
  thresholds: Thresholds;
  services: Service[];
  incidents: Incident[];
};

// ---------- persistence ----------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

// Replay the deterministic series up to `tick` so a reload reconstructs the
// exact window the user last saw without persisting the samples themselves.
function buildServices(tick: number): Service[] {
  return SEED_DEFS.map((def) => {
    const base: Service = { ...def, samples: [] };
    base.samples = seedSamples(base);
    let s = base;
    for (let t = 0; t < tick; t += 1) {
      // seedSamples covered ticks 0..WINDOW-1; advance #t draws tick WINDOW+t.
      s = { ...s, samples: advanceSamples(s, WINDOW + t) };
    }
    return s;
  });
}

function loadState(): State {
  const tick = readJSON<number>(TICK_KEY, 0);
  const thresholds = readJSON<Thresholds>(THRESH_KEY, DEFAULT_THRESHOLDS);
  const incidents = readJSON<Incident[]>(INCIDENTS_KEY, []);
  return {
    tick,
    thresholds,
    services: buildServices(tick),
    incidents,
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();
let incidentId =
  state.incidents.reduce((max, i) => Math.max(max, i.id), 0) + 1;

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- derived snapshot ----------

export type Snapshot = {
  healths: ServiceHealth[];
  rollup: Rollup;
  alerts: Alert[];
};

// Compute the full derived snapshot from the current services and thresholds.
// Pure over the store state, so components can call it freely on render.
export function snapshot(s: State = state): Snapshot {
  const healths = s.services.map((svc) => computeHealth(svc, s.thresholds));
  return {
    healths,
    rollup: rollup(healths),
    alerts: evaluateFleetAlerts(healths, s.thresholds),
  };
}

export function healthFor(id: string): ServiceHealth | undefined {
  const svc = state.services.find((s) => s.id === id);
  return svc ? computeHealth(svc, state.thresholds) : undefined;
}

// ---------- actions ----------

// Advance the clock one step: append the next deterministic sample to every
// service, log any status transitions, and persist the new tick.
export function tick(): void {
  const before = snapshot();
  const nextTick = state.tick + 1;
  const services = state.services.map((svc) => ({
    ...svc,
    samples: advanceSamples(svc, WINDOW + state.tick),
  }));
  const afterState: State = { ...state, tick: nextTick, services };
  const after = snapshot(afterState);

  const transitions: Incident[] = [];
  for (let i = 0; i < after.healths.length; i += 1) {
    const from = before.healths[i].status;
    const to = after.healths[i].status;
    if (from !== to) {
      transitions.push({
        id: incidentId++,
        serviceName: after.healths[i].name,
        from,
        to,
        tick: nextTick,
      });
    }
  }
  const incidents = [...transitions.reverse(), ...state.incidents].slice(
    0,
    MAX_INCIDENTS,
  );

  writeJSON(TICK_KEY, nextTick);
  writeJSON(INCIDENTS_KEY, incidents);
  set({ tick: nextTick, services, incidents });
}

// Edit one threshold field. Re-derivation happens in snapshot, so changing a
// line can move services across status bands immediately.
export function setThreshold(field: keyof Thresholds, value: number): void {
  const clamped = Math.max(0, Math.round(value));
  const thresholds = { ...state.thresholds, [field]: clamped };
  writeJSON(THRESH_KEY, thresholds);
  set({ thresholds });
}

// Wipe persisted tick, thresholds, and incidents, and rebuild the seed fleet.
export function resetAll(): void {
  try {
    localStorage.removeItem(TICK_KEY);
    localStorage.removeItem(THRESH_KEY);
    localStorage.removeItem(INCIDENTS_KEY);
  } catch {
    // ignore storage errors
  }
  incidentId = 1;
  state = {
    tick: 0,
    thresholds: DEFAULT_THRESHOLDS,
    services: buildServices(0),
    incidents: [],
  };
  emit();
}

export { DEFAULT_THRESHOLDS };
export type { Status, Thresholds, Service, ServiceHealth, Alert, Incident };
