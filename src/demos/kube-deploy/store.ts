// Browser-side store for the rolling-deployment simulator. It holds a single
// SimState (deployment, pods, rollout target, history, events) and persists it
// to localStorage so a reload resumes mid-rollout. All mutations go through the
// pure engine; nothing here reads the clock or calls Math.random, which keeps
// the rollout reproducible for a given seed.

import {
  resumeRollout,
  rollback as engineRollback,
  seedPods,
  startRollout as engineStart,
  tick as engineTick,
} from './engine';
import type { Deployment, SimState, Strategy } from './types';

const KEY = 'kube-deploy.sim.v1';

// A steady deployment to start from: four replicas of v1, a conservative
// rolling strategy, and a moderate failure rate on the new version so a rollout
// usually succeeds but can be pushed to pause by raising the rate.
const SEED_SEED = 1337;

function seedDeployment(): Deployment {
  return {
    name: 'web',
    desired: 4,
    currentVersion: 'v1',
    strategy: { maxSurge: 1, maxUnavailable: 1 },
    newVersionFailureRate: 0.15,
  };
}

function freshState(): SimState {
  const deployment = seedDeployment();
  const { pods, seq } = seedPods(deployment, 0);
  return {
    deployment,
    pods,
    rollout: {
      targetVersion: null,
      previousVersion: deployment.currentVersion,
      status: 'idle',
      failureCount: 0,
      failureThreshold: 3,
    },
    history: [
      {
        tick: 0,
        available: pods.length,
        updated: 0,
        desired: deployment.desired,
        status: 'idle',
      },
    ],
    events: [],
    tick: 0,
    seq,
    seed: SEED_SEED,
  };
}

// ---------- persistence ----------

function load(): SimState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as SimState;
    // Guard against a malformed or old-shape payload.
    if (!parsed || !parsed.deployment || !Array.isArray(parsed.pods)) {
      return freshState();
    }
    return parsed;
  } catch {
    return freshState();
  }
}

function persist(s: SimState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode); the sim still runs in-memory.
  }
}

// ---------- external store ----------

let state: SimState = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: SimState): void {
  state = next;
  persist(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): SimState {
  return state;
}

// ---------- configuration actions ----------

export function setDesired(desired: number): void {
  const clamped = Math.max(1, Math.min(12, Math.floor(desired)));
  if (state.rollout.status === 'progressing') return;
  const deployment = { ...state.deployment, desired: clamped };
  // Reconcile the steady-state pod set to the new replica count.
  const running = state.pods.filter(
    (p) => p.status === 'running' && p.version === deployment.currentVersion,
  );
  let pods = running.slice(0, clamped);
  let seq = state.seq;
  while (pods.length < clamped) {
    pods = [
      ...pods,
      {
        id: `pod-${seq}`,
        version: deployment.currentVersion,
        status: 'running',
        age: 2,
      },
    ];
    seq++;
  }
  commit({ ...state, deployment, pods, seq });
}

export function setStrategy(patch: Partial<Strategy>): void {
  if (state.rollout.status === 'progressing') return;
  const strategy = { ...state.deployment.strategy, ...patch };
  strategy.maxSurge = Math.max(0, Math.min(6, Math.floor(strategy.maxSurge)));
  strategy.maxUnavailable = Math.max(
    0,
    Math.min(state.deployment.desired, Math.floor(strategy.maxUnavailable)),
  );
  commit({ ...state, deployment: { ...state.deployment, strategy } });
}

export function setFailureRate(rate: number): void {
  if (state.rollout.status === 'progressing') return;
  const clamped = Math.max(0, Math.min(1, rate));
  commit({
    ...state,
    deployment: { ...state.deployment, newVersionFailureRate: clamped },
  });
}

// ---------- rollout actions ----------

export function startRollout(targetVersion: string): void {
  const v = targetVersion.trim();
  if (!v || v === state.deployment.currentVersion) return;
  commit(engineStart(state, v));
}

export function tick(): void {
  commit(engineTick(state));
}

export function pause(): void {
  if (state.rollout.status !== 'progressing') return;
  commit({ ...state, rollout: { ...state.rollout, status: 'paused' } });
}

export function resume(): void {
  commit(resumeRollout(state));
}

export function rollback(): void {
  commit(engineRollback(state));
}

export function reset(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  commit(freshState());
}
