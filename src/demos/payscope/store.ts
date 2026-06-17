import { useSyncExternalStore } from 'react';
import type { Meter, UsageEvent, Plan, Invoice } from './types';
import { recordEvent, generateInvoice } from './engine';

const STORAGE_KEY = 'payscope.state.v1';

export type State = {
  meters: Meter[];
  plans: Plan[];
  events: UsageEvent[];
  invoices: Invoice[];
};

function emptyState(): State {
  return { meters: [], plans: [], events: [], invoices: [] };
}

function readStorage(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return JSON.parse(raw) as State;
  } catch {
    return emptyState();
  }
}

function writeStorage(s: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable; the app still works in-memory
  }
}

let state: State = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  writeStorage(state);
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): State {
  return state;
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// --- meter CRUD ---

let meterSeq = 0;

export function addMeter(name: string, unit: string, ratePerUnit: number): void {
  meterSeq += 1;
  const meter: Meter = {
    id: `m-${Date.now().toString(36)}-${meterSeq}`,
    name,
    unit,
    ratePerUnit,
  };
  set({ meters: [...state.meters, meter] });
}

export function removeMeter(id: string): void {
  set({ meters: state.meters.filter((m) => m.id !== id) });
}

// --- plan CRUD ---

let planSeq = 0;

export function addPlan(name: string, meters: Plan['meters']): void {
  planSeq += 1;
  const plan: Plan = {
    id: `p-${Date.now().toString(36)}-${planSeq}`,
    name,
    meters,
  };
  set({ plans: [...state.plans, plan] });
}

export function removePlan(id: string): void {
  set({ plans: state.plans.filter((p) => p.id !== id) });
}

// --- events ---

let eventSeq = 0;

export function addEvent(
  meterId: string,
  quantity: number,
  idempotencyKey: string,
): boolean {
  eventSeq += 1;
  const event: UsageEvent = {
    id: `e-${Date.now().toString(36)}-${eventSeq}`,
    meterId,
    quantity,
    timestamp: Date.now(),
    idempotencyKey,
  };
  const result = recordEvent(state.events, event);
  if (!result.added) return false;
  set({ events: result.events });
  return true;
}

// --- invoices ---

export function createInvoice(
  planId: string,
  periodStart: number,
  periodEnd: number,
): Invoice | null {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return null;
  const invoice = generateInvoice(plan, state.meters, state.events, periodStart, periodEnd);
  set({ invoices: [...state.invoices, invoice] });
  return invoice;
}

// --- reset ---

export function resetAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  state = emptyState();
  emit();
}
