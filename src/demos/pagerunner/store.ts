// Browser-side state for the PageRunner on-call console. Schedule, escalation
// policy, incidents, and a single settable clock all live in localStorage.
// A minimal external store feeds useSyncExternalStore so every panel reads one
// consistent snapshot. The clock is the only notion of "now": nothing reads
// Date.now during render, which keeps the whole app deterministic and replayable.

import { useSyncExternalStore } from 'react';
import {
  currentTier,
  onCallResponderAt,
  tierStartMinute,
} from './engine';
import {
  MINUTES_PER_WEEK,
  type EscalationPolicy,
  type Incident,
  type IncidentEvent,
  type Responder,
  type Rotation,
} from './types';

const KEY = 'pagerunner.state.v1';

export type State = {
  responders: Responder[];
  rotation: Rotation;
  policy: EscalationPolicy;
  incidents: Incident[];
  // The simulation clock, in absolute minutes since an arbitrary epoch. All
  // on-call and escalation math derives from this single value.
  nowMinute: number;
  seq: number;
};

// ---------- seed ----------

function seedState(): State {
  const responders: Responder[] = [
    { id: 'r1', name: 'Ada Reyes', handle: 'ada' },
    { id: 'r2', name: 'Ben Okafor', handle: 'ben' },
    { id: 'r3', name: 'Chen Wei', handle: 'chen' },
    { id: 'r4', name: 'Dana Holt', handle: 'dana' },
  ];
  const rotation: Rotation = {
    order: ['r1', 'r2', 'r3'],
    shiftMinutes: MINUTES_PER_WEEK,
  };
  const policy: EscalationPolicy = {
    tiers: [
      { target: 'oncall', ackTimeoutMin: 5 },
      { target: 'r4', ackTimeoutMin: 10 },
      { target: 'r3', ackTimeoutMin: 15 },
    ],
  };
  return {
    responders,
    rotation,
    policy,
    incidents: [],
    // Start a few minutes into week one so the on-call panel has context.
    nowMinute: 9 * 60,
    seq: 1,
  };
}

// ---------- persistence ----------

function readState(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<State>;
    const base = seedState();
    return {
      responders: parsed.responders ?? base.responders,
      rotation: parsed.rotation ?? base.rotation,
      policy: parsed.policy ?? base.policy,
      incidents: parsed.incidents ?? base.incidents,
      nowMinute: typeof parsed.nowMinute === 'number' ? parsed.nowMinute : base.nowMinute,
      seq: typeof parsed.seq === 'number' ? parsed.seq : base.seq,
    };
  } catch {
    return seedState();
  }
}

function persist(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode); the app still works in memory.
  }
}

// ---------- minimal external store ----------

let state: State = readState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: State): void {
  state = next;
  persist(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------- lookups ----------

export function responderName(s: State, id: string | null): string {
  if (!id) return 'unassigned';
  return s.responders.find((r) => r.id === id)?.name ?? id;
}

// Resolve a tier target to a concrete responder id at a given clock minute,
// expanding the 'oncall' sentinel through the rotation.
export function resolveTarget(
  s: State,
  target: string,
  atMinute: number,
): string | null {
  if (target === 'oncall') return onCallResponderAt(s.rotation, atMinute);
  return target;
}

// ---------- rotation actions ----------

export function setRotationOrder(order: string[]): void {
  commit({ ...state, rotation: { ...state.rotation, order } });
}

// ---------- policy actions ----------

export function addTier(): void {
  const tiers = [...state.policy.tiers, { target: 'oncall', ackTimeoutMin: 10 }];
  commit({ ...state, policy: { tiers } });
}

export function removeTier(index: number): void {
  const tiers = state.policy.tiers.filter((_, i) => i !== index);
  commit({ ...state, policy: { tiers } });
}

export function setTierTarget(index: number, target: string): void {
  const tiers = state.policy.tiers.map((t, i) =>
    i === index ? { ...t, target } : t,
  );
  commit({ ...state, policy: { tiers } });
}

export function setTierTimeout(index: number, ackTimeoutMin: number): void {
  const clamped = Math.max(1, Math.floor(ackTimeoutMin) || 1);
  const tiers = state.policy.tiers.map((t, i) =>
    i === index ? { ...t, ackTimeoutMin: clamped } : t,
  );
  commit({ ...state, policy: { tiers } });
}

// ---------- clock ----------

export function setNow(minute: number): void {
  const m = Math.max(0, Math.floor(minute));
  commit(withRecomputedTimelines({ ...state, nowMinute: m }));
}

export function advanceClock(deltaMinutes: number): void {
  setNow(state.nowMinute + deltaMinutes);
}

// ---------- incident lifecycle ----------

export function triggerIncident(title: string): void {
  const id = `INC-${String(state.seq).padStart(3, '0')}`;
  const now = state.nowMinute;
  const firstTarget = state.policy.tiers[0]?.target ?? 'oncall';
  const paged = resolveTarget(state, firstTarget, now);
  const timeline: IncidentEvent[] = [
    {
      kind: 'triggered',
      atMinute: now,
      note: `${id} triggered`,
    },
  ];
  if (state.policy.tiers.length > 0) {
    timeline.push({
      kind: 'paged',
      atMinute: now,
      responderId: paged ?? undefined,
      tier: 0,
      note: `Paged ${responderName(state, paged)} (tier 1)`,
    });
  }
  const incident: Incident = {
    id,
    title: title.trim() || `Incident ${id}`,
    status: 'triggered',
    createdAtMinute: now,
    ackedAtMinute: null,
    resolvedAtMinute: null,
    ackedAtTier: null,
    timeline,
  };
  commit({
    ...state,
    incidents: [incident, ...state.incidents],
    seq: state.seq + 1,
  });
}

export function acknowledgeIncident(id: string): void {
  const now = state.nowMinute;
  const incidents = state.incidents.map((inc) => {
    if (inc.id !== id || inc.status !== 'triggered') return inc;
    const tier = currentTier(inc, state.policy, now);
    const target = state.policy.tiers[tier]?.target ?? 'oncall';
    const responder = resolveTarget(state, target, now);
    const event: IncidentEvent = {
      kind: 'acked',
      atMinute: now,
      responderId: responder ?? undefined,
      tier,
      note: `Acknowledged by ${responderName(state, responder)}`,
    };
    return {
      ...inc,
      status: 'acked' as const,
      ackedAtMinute: now,
      ackedAtTier: tier,
      timeline: [...inc.timeline, event],
    };
  });
  commit({ ...state, incidents });
}

export function resolveIncident(id: string): void {
  const now = state.nowMinute;
  const incidents = state.incidents.map((inc) => {
    if (inc.id !== id || inc.status === 'resolved') return inc;
    const event: IncidentEvent = {
      kind: 'resolved',
      atMinute: now,
      note: 'Resolved',
    };
    return {
      ...inc,
      status: 'resolved' as const,
      resolvedAtMinute: now,
      ackedAtTier: inc.ackedAtTier ?? currentTier(inc, state.policy, now),
      timeline: [...inc.timeline, event],
    };
  });
  commit({ ...state, incidents });
}

// ---------- escalation materialization ----------

// Append any escalation events that the clock has now made due for each live
// incident. This keeps the timeline an append-only record: advancing the clock
// past a tier's ack-timeout writes a one-time "escalated" + "paged" pair. Idem-
// potent: re-running for the same clock value adds nothing new.
function withRecomputedTimelines(s: State): State {
  const incidents = s.incidents.map((inc) => {
    if (inc.status !== 'triggered') return inc;
    const reached = currentTier(inc, s.policy, s.nowMinute);
    // Highest tier already recorded as paged in the timeline.
    let recorded = 0;
    for (const ev of inc.timeline) {
      if ((ev.kind === 'paged' || ev.kind === 'escalated') && typeof ev.tier === 'number') {
        recorded = Math.max(recorded, ev.tier);
      }
    }
    if (reached <= recorded) return inc;
    const added: IncidentEvent[] = [];
    for (let tier = recorded + 1; tier <= reached; tier++) {
      const at = tierStartMinute(s.policy, inc.createdAtMinute, tier);
      const target = s.policy.tiers[tier]?.target ?? 'oncall';
      const responder = resolveTarget(s, target, at);
      added.push({
        kind: 'escalated',
        atMinute: at,
        tier,
        note: `No ack within ${s.policy.tiers[tier - 1]?.ackTimeoutMin ?? 0} min, escalating to tier ${tier + 1}`,
      });
      added.push({
        kind: 'paged',
        atMinute: at,
        responderId: responder ?? undefined,
        tier,
        note: `Paged ${responderName(s, responder)} (tier ${tier + 1})`,
      });
    }
    return { ...inc, timeline: [...inc.timeline, ...added] };
  });
  return { ...s, incidents };
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  commit(seedState());
}
