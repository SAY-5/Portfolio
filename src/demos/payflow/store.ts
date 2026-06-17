// Browser-side store for PayFlow. It owns persistence (intents + an immutable
// event log in localStorage), the idempotency-key index, and the React binding
// through useSyncExternalStore. All state-machine logic lives in engine.ts; the
// store only sequences actions, records events, and replays idempotent results.

import { useSyncExternalStore } from 'react';
import {
  apply,
  createIntent,
  type ApplyOptions,
} from './engine';
import type {
  Action,
  Currency,
  IntentEvent,
  PaymentIntent,
  ProcessorMode,
} from './types';

const INTENTS_KEY = 'payflow.intents.v1';
const EVENTS_KEY = 'payflow.events.v1';
const IDEMP_KEY = 'payflow.idemp.v1';

// A record of a prior idempotent action so a replay returns the same outcome
// without re-running the transition.
type IdempRecord = {
  ok: boolean;
  intentId: string;
  eventId: string;
};

export type State = {
  intents: PaymentIntent[];
  events: IntentEvent[];
  idemp: Record<string, IdempRecord>;
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

// The store owns the wall clock so components never read it during render. The
// engine itself stays pure and receives this value as a plain argument.
function clock(): number {
  return Date.now();
}

function loadState(): State {
  return {
    intents: readJSON<PaymentIntent[]>(INTENTS_KEY, []),
    events: readJSON<IntentEvent[]>(EVENTS_KEY, []),
    idemp: readJSON<Record<string, IdempRecord>>(IDEMP_KEY, {}),
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function persist(): void {
  writeJSON(INTENTS_KEY, state.intents);
  writeJSON(EVENTS_KEY, state.events);
  writeJSON(IDEMP_KEY, state.idemp);
}

function commit(next: State): void {
  state = next;
  persist();
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- lookups ----------

export function getIntent(id: string): PaymentIntent | undefined {
  return state.intents.find((i) => i.id === id);
}

export function eventsFor(id: string): IntentEvent[] {
  return state.events.filter((e) => e.intentId === id);
}

// ---------- create ----------

export function createPayment(
  amount: number,
  currency: Currency,
  now: number = clock(),
): PaymentIntent | null {
  if (!Number.isInteger(amount) || amount <= 0) return null;
  const intent = createIntent(amount, currency, now);
  const ev: IntentEvent = {
    id: `EV-${intent.id}-create`,
    intentId: intent.id,
    at: now,
    action: 'create',
    ok: true,
    amount,
  };
  commit({
    ...state,
    intents: [intent, ...state.intents],
    events: [...state.events, ev],
  });
  return intent;
}

// ---------- act ----------

export type ActOptions = {
  now?: number;
  amount?: number;
  processorMode?: ProcessorMode;
  maxRetries?: number;
  idempotencyKey?: string;
};

// Run one action against an intent. If an idempotency key was supplied and seen
// before, the prior event is replayed and no transition runs. Otherwise the
// engine applies the action, the resulting intent and event are persisted, and
// the key is recorded for future replays.
export function act(
  intentId: string,
  action: Action,
  opts: ActOptions,
): IntentEvent | null {
  const intent = getIntent(intentId);
  if (!intent) return null;

  const now = opts.now ?? clock();
  const key = opts.idempotencyKey;
  if (key) {
    const prior = state.idemp[key];
    if (prior) {
      const original = state.events.find((e) => e.id === prior.eventId);
      const replay: IntentEvent = {
        ...(original ?? {
          id: `EV-replay-${key}`,
          intentId,
          at: now,
          action,
          ok: prior.ok,
        }),
        id: `EV-replay-${key}-${state.events.length}`,
        at: now,
        replayed: true,
      };
      commit({ ...state, events: [...state.events, replay] });
      return replay;
    }
  }

  const applyOpts: ApplyOptions = {
    now,
    amount: opts.amount,
    processorMode: opts.processorMode,
    maxRetries: opts.maxRetries,
    idempotencyKey: key,
  };
  const result = apply(intent, action, applyOpts);

  const intents = state.intents.map((i) =>
    i.id === intentId ? result.intent : i,
  );
  const events = [...state.events, result.event];
  const idemp = key
    ? {
        ...state.idemp,
        [key]: {
          ok: result.ok,
          intentId,
          eventId: result.event.id,
        },
      }
    : state.idemp;

  commit({ intents, events, idemp });
  return result.event;
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(INTENTS_KEY);
    localStorage.removeItem(EVENTS_KEY);
    localStorage.removeItem(IDEMP_KEY);
  } catch {
    // ignore storage errors
  }
  commit({ intents: [], events: [], idemp: {} });
}

// ---------- React binding ----------

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
