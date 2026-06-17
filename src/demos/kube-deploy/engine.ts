// Deterministic rolling-deployment engine. No eval, no Math.random, no clock
// reads. A tick advances pending pods, retires old pods as new ones become
// ready, and creates new-version pods within the surge/unavailable budget. The
// only randomness is a small seeded PRNG used to decide whether a freshly
// created target-version pod fails its readiness check, so a given seed always
// produces the same rollout.

import type {
  Deployment,
  Pod,
  Rollout,
  RolloutEvent,
  SimState,
  Strategy,
} from './types';

// Mulberry32: a compact, fast, deterministic 32-bit PRNG. Given a seed it
// returns the next seed and a float in [0, 1). Pure, so the engine stays
// reproducible for any starting seed.
export function nextRandom(seed: number): { seed: number; value: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  const nextSeed = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { seed: nextSeed, value };
}

export function countByStatus(pods: Pod[]) {
  let running = 0;
  let pending = 0;
  let failed = 0;
  let terminating = 0;
  for (const p of pods) {
    if (p.status === 'running') running++;
    else if (p.status === 'pending') pending++;
    else if (p.status === 'failed') failed++;
    else terminating++;
  }
  return { running, pending, failed, terminating };
}

// Pods that count toward "available" capacity: running pods of any version.
export function availableCount(pods: Pod[]): number {
  return pods.filter((p) => p.status === 'running').length;
}

// Pods already on the target version (running or coming up). Used to show
// rollout progress and to know when the rollout is complete.
export function updatedCount(pods: Pod[], targetVersion: string): number {
  return pods.filter(
    (p) => p.version === targetVersion && p.status === 'running',
  ).length;
}

// Live pods are everything not failed/terminated: they occupy a slot against
// the surge budget.
function liveTotal(pods: Pod[]): number {
  return pods.filter((p) => p.status === 'pending' || p.status === 'running')
    .length;
}

// Build the initial steady-state pods for a deployment: every replica running
// the current version.
export function seedPods(deployment: Deployment, startSeq: number): {
  pods: Pod[];
  seq: number;
} {
  const pods: Pod[] = [];
  let seq = startSeq;
  for (let i = 0; i < deployment.desired; i++) {
    pods.push({
      id: `pod-${seq}`,
      version: deployment.currentVersion,
      status: 'running',
      age: 2,
    });
    seq++;
  }
  return { pods, seq };
}

// Drop pods that have finished terminating so the grid does not grow without
// bound. A terminating pod lives for exactly one tick after it is retired.
function reapTerminated(pods: Pod[]): Pod[] {
  return pods.filter((p) => p.status !== 'terminating');
}

// How many pending pods became running or failed this tick, plus events.
function advancePending(
  pods: Pod[],
  targetVersion: string | null,
  failureRate: number,
  seed: number,
): { pods: Pod[]; seed: number; events: RolloutEvent[]; newFailures: number } {
  const events: RolloutEvent[] = [];
  let s = seed;
  let newFailures = 0;
  const out = pods.map((p) => {
    if (p.status !== 'pending') return p;
    // Pods need one tick of warm-up before their readiness check resolves.
    if (p.age < 1) return { ...p, age: p.age + 1 };
    const isTarget = targetVersion !== null && p.version === targetVersion;
    if (isTarget) {
      const r = nextRandom(s);
      s = r.seed;
      if (r.value < failureRate) {
        newFailures++;
        events.push({ kind: 'pod-failed', podId: p.id, version: p.version });
        return { ...p, status: 'failed' as const };
      }
    }
    events.push({ kind: 'pod-ready', podId: p.id, version: p.version });
    return { ...p, status: 'running' as const, age: p.age + 1 };
  });
  return { pods: out, seed: s, events, newFailures };
}

// Retire old-version running pods down toward the unavailable floor as new
// pods come up. Returns pods with some marked terminating, plus events.
function retireOld(
  pods: Pod[],
  desired: number,
  targetVersion: string,
  strategy: Strategy,
): { pods: Pod[]; events: RolloutEvent[] } {
  const events: RolloutEvent[] = [];
  const minAvailable = Math.max(0, desired - strategy.maxUnavailable);
  const available = availableCount(pods);
  const updatedRunning = updatedCount(pods, targetVersion);
  // We may retire old pods only while staying at or above the available floor.
  // Retire at most as many old pods as we have new running pods ready to take
  // their place, so we never dip below the floor.
  let budget = Math.max(0, available - minAvailable);
  budget = Math.min(budget, updatedRunning);
  const out = pods.map((p) => {
    if (budget <= 0) return p;
    if (p.status === 'running' && p.version !== targetVersion) {
      budget--;
      events.push({
        kind: 'pod-terminating',
        podId: p.id,
        version: p.version,
      });
      return { ...p, status: 'terminating' as const };
    }
    return p;
  });
  return { pods: out, events };
}

// Create new target-version pods up to the surge ceiling. We keep total live
// pods at or below desired + maxSurge, and only create while old pods still
// need replacing.
function createNew(
  pods: Pod[],
  desired: number,
  targetVersion: string,
  strategy: Strategy,
  startSeq: number,
): { pods: Pod[]; events: RolloutEvent[]; seq: number } {
  const events: RolloutEvent[] = [];
  const ceiling = desired + strategy.maxSurge;
  let live = liveTotal(pods);
  const updated = pods.filter(
    (p) =>
      p.version === targetVersion &&
      (p.status === 'running' || p.status === 'pending'),
  ).length;
  let seq = startSeq;
  const created: Pod[] = [];
  // We need `desired` pods on the target version eventually. Create only the
  // shortfall, and only while under the surge ceiling.
  let needed = desired - updated;
  while (needed > 0 && live < ceiling) {
    const pod: Pod = {
      id: `pod-${seq}`,
      version: targetVersion,
      status: 'pending',
      age: 0,
    };
    created.push(pod);
    events.push({ kind: 'pod-created', podId: pod.id, version: targetVersion });
    seq++;
    live++;
    needed--;
  }
  return { pods: [...pods, ...created], events, seq };
}

// Replace failed pods that are blocking progress: a failed pod frees its slot,
// so the next createNew can mint a replacement. We simply drop failed pods here
// after they have been counted as failures.
function reapFailed(pods: Pod[]): Pod[] {
  return pods.filter((p) => p.status !== 'failed');
}

// Advance the whole simulation by one tick. Pure: returns a new SimState.
export function tick(state: SimState): SimState {
  const { deployment, rollout } = state;
  const events: RolloutEvent[] = [];
  let pods = state.pods;
  let seed = state.seed;
  let seq = state.seq;
  let nextRollout: Rollout = rollout;

  // Clear out pods that finished terminating last tick before doing anything.
  pods = reapTerminated(pods);

  const rolling =
    rollout.status === 'progressing' && rollout.targetVersion !== null;

  if (rolling) {
    const target = rollout.targetVersion as string;
    // 1. Resolve pending pods (some target pods may fail their probe).
    const adv = advancePending(
      pods,
      target,
      deployment.newVersionFailureRate,
      seed,
    );
    pods = adv.pods;
    seed = adv.seed;
    events.push(...adv.events);

    // 2. Update the failure streak and pause if it crosses the threshold.
    const failureCount = rollout.failureCount + adv.newFailures;
    if (failureCount >= rollout.failureThreshold) {
      events.push({ kind: 'paused', failures: failureCount });
      // Drop the failed pods so resuming starts from a clean slate.
      pods = reapFailed(pods);
      nextRollout = { ...rollout, status: 'paused', failureCount };
      return commit(state, deployment, nextRollout, pods, events, seed, seq);
    }

    // 3. Retire old pods that new running pods can now replace.
    const retired = retireOld(pods, deployment.desired, target, deployment.strategy);
    pods = retired.pods;
    events.push(...retired.events);

    // 4. Clear failed pods so their slots free up for fresh attempts.
    pods = reapFailed(pods);

    // 5. Create new target-version pods within the surge budget.
    const created = createNew(
      pods,
      deployment.desired,
      target,
      deployment.strategy,
      seq,
    );
    pods = created.pods;
    seq = created.seq;
    events.push(...created.events);

    // 6. Completion: every desired pod is running the target version and no
    // old-version or pending pods remain.
    const updated = updatedCount(pods, target);
    const stragglers = pods.some(
      (p) =>
        (p.status === 'running' || p.status === 'pending') &&
        p.version !== target,
    );
    const pendingTarget = pods.some(
      (p) => p.status === 'pending' && p.version === target,
    );
    if (updated >= deployment.desired && !stragglers && !pendingTarget) {
      events.push({ kind: 'complete', version: target });
      nextRollout = {
        ...rollout,
        status: 'complete',
        failureCount,
      };
      const nextDeployment = { ...deployment, currentVersion: target };
      return commit(
        { ...state, deployment: nextDeployment },
        nextDeployment,
        nextRollout,
        pods,
        events,
        seed,
        seq,
      );
    }

    nextRollout = { ...rollout, failureCount };
    return commit(state, deployment, nextRollout, pods, events, seed, seq);
  }

  // Not progressing: steady-state pods may still have pending warm-up (e.g.
  // right after a reset), so resolve them without failure injection.
  const adv = advancePending(pods, null, 0, seed);
  pods = adv.pods;
  seed = adv.seed;
  events.push(...adv.events);
  return commit(state, deployment, nextRollout, pods, events, seed, seq);
}

// Assemble the next SimState, append history and events, and bump the tick.
function commit(
  state: SimState,
  deployment: Deployment,
  rollout: Rollout,
  pods: Pod[],
  events: RolloutEvent[],
  seed: number,
  seq: number,
): SimState {
  const target = rollout.targetVersion ?? deployment.currentVersion;
  const nextTick = state.tick + 1;
  const point = {
    tick: nextTick,
    available: availableCount(pods),
    updated: updatedCount(pods, target),
    desired: deployment.desired,
    status: rollout.status,
  };
  return {
    ...state,
    deployment,
    pods,
    rollout,
    seed,
    seq,
    tick: nextTick,
    history: [...state.history, point].slice(-60),
    events: [...state.events, ...events].slice(-120),
  };
}

// Roll the deployment back to the previous version. The current target pods are
// marked terminating and the rollout retargets the previous version.
export function rollback(state: SimState): SimState {
  const { rollout, deployment } = state;
  if (rollout.targetVersion === null) return state;
  const to = rollout.previousVersion;
  const events: RolloutEvent[] = [{ kind: 'rolled-back', to }];
  // Terminate any target-version pods; keep/recreate previous-version pods.
  let pods = state.pods.map((p) => {
    if (p.version === rollout.targetVersion && p.status !== 'terminating') {
      events.push({ kind: 'pod-terminating', podId: p.id, version: p.version });
      return { ...p, status: 'terminating' as const };
    }
    return p;
  });
  pods = reapFailed(pods);
  const nextRollout: Rollout = {
    ...rollout,
    targetVersion: to,
    status: 'progressing',
    failureCount: 0,
  };
  const nextDeployment = { ...deployment, currentVersion: to };
  return commit(
    { ...state, deployment: nextDeployment },
    nextDeployment,
    nextRollout,
    pods,
    events,
    state.seed,
    state.seq,
  );
}

// Begin a rollout to a new version. Records the previous version for rollback
// and flips the rollout to progressing.
export function startRollout(state: SimState, targetVersion: string): SimState {
  const previousVersion = state.deployment.currentVersion;
  if (targetVersion === previousVersion) return state;
  const events: RolloutEvent[] = [
    { kind: 'started', from: previousVersion, to: targetVersion },
  ];
  const nextRollout: Rollout = {
    targetVersion,
    previousVersion,
    status: 'progressing',
    failureCount: 0,
    failureThreshold: state.rollout.failureThreshold,
  };
  return commit(
    state,
    state.deployment,
    nextRollout,
    state.pods,
    events,
    state.seed,
    state.seq,
  );
}

// Resume a paused rollout. The failure streak is cleared so progress can
// continue from where it stalled.
export function resumeRollout(state: SimState): SimState {
  if (state.rollout.status !== 'paused') return state;
  const nextRollout: Rollout = {
    ...state.rollout,
    status: 'progressing',
    failureCount: 0,
  };
  return commit(
    state,
    state.deployment,
    nextRollout,
    state.pods,
    [{ kind: 'resumed' }],
    state.seed,
    state.seq,
  );
}
