// Browser-side store for FlowDeck. It holds the workflow definition, the items
// moving through it, and an audit trail, all persisted to localStorage. Actions
// delegate every workflow decision to the pure engine and only handle identity,
// timestamps, history, and persistence here. A minimal external store with
// subscribe/getState lets the React binding use useSyncExternalStore.

import {
  approve as engineApprove,
  reject as engineReject,
  canDecide,
  currentStep,
  startIndex,
} from './engine';
import type {
  HistoryEntry,
  HistoryKind,
  Item,
  ItemFields,
  Role,
  Workflow,
} from './types';

const ITEMS_KEY = 'flowdeck.items.v1';
const AUDIT_KEY = 'flowdeck.audit.v1';

// A fixed expense-approval workflow. Amounts over a threshold pick up a finance
// step; access-affecting requests pick up a security review. Steps whose
// condition is false are skipped, so a small non-access request goes straight
// from manager review to done.
export const WORKFLOW: Workflow = {
  id: 'expense-approval',
  name: 'Expense approval',
  steps: [
    {
      id: 'manager',
      name: 'Manager review',
      approver: 'manager',
      description: 'A line manager checks the request is reasonable.',
      onReject: 'start',
    },
    {
      id: 'finance',
      name: 'Finance sign-off',
      approver: 'finance',
      condition: { field: 'amount', op: 'gte', value: 1000 },
      description: 'Finance signs off any request of 1000 or more.',
      onReject: 'previous',
    },
    {
      id: 'security',
      name: 'Security review',
      approver: 'security',
      condition: { field: 'accessChange', op: 'eq', value: true },
      description: 'Security reviews anything that changes access.',
      onReject: 'previous',
    },
  ],
};

export const ROLES: { id: Role; label: string }[] = [
  { id: 'requester', label: 'requester' },
  { id: 'manager', label: 'manager' },
  { id: 'finance', label: 'finance' },
  { id: 'security', label: 'security' },
];

export type State = {
  workflow: Workflow;
  items: Item[];
  audit: HistoryEntry[];
  // The role the viewer is acting as, gating which decisions they can take.
  actingAs: Role;
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
    // storage may be unavailable (private mode); the app runs in-memory.
  }
}

const SEED_ITEMS: Item[] = seedItems();

function loadState(): State {
  return {
    workflow: WORKFLOW,
    items: readJSON<Item[]>(ITEMS_KEY, SEED_ITEMS),
    audit: readJSON<HistoryEntry[]>(AUDIT_KEY, seedAudit(SEED_ITEMS)),
    actingAs: 'manager',
  };
}

// ---------- external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

function persist(items: Item[], audit: HistoryEntry[]): void {
  writeJSON(ITEMS_KEY, items);
  writeJSON(AUDIT_KEY, audit);
}

function commit(next: Partial<State>): void {
  state = { ...state, ...next };
  if (next.items || next.audit) persist(state.items, state.audit);
  emit();
}

// ---------- ids ----------

let counter = 0;
function makeId(prefix: string): string {
  counter += 1;
  const n = (Date.now() % 100000) * 100 + (counter % 100);
  return `${prefix}-${n.toString(36).toUpperCase()}`;
}

function entry(
  item: Item,
  kind: HistoryKind,
  actor: Role | 'engine',
  note: string,
  stepId: string,
  stepName: string,
): HistoryEntry {
  return {
    id: makeId('H'),
    itemId: item.id,
    stepId,
    stepName,
    kind,
    actor,
    note,
    at: Date.now(),
  };
}

// ---------- actions ----------

export function setActingAs(role: Role): void {
  commit({ actingAs: role });
}

// Submit a new item: place it at the first applicable step and record a
// submitted history entry both on the item and in the global audit trail.
export function submitItem(title: string, fields: ItemFields): Item | null {
  const clean = title.trim();
  if (!clean) return null;
  const at = Date.now();
  const index = startIndex(state.workflow, fields);
  const completed = index >= state.workflow.steps.length;
  const base: Item = {
    id: makeId('REQ'),
    title: clean,
    fields,
    stepIndex: index,
    stage: completed ? 'approved' : 'active',
    submittedAt: at,
    history: [],
  };
  const submitEntry = entry(base, 'submitted', 'requester', 'request submitted', '', '');
  const item: Item = { ...base, history: [submitEntry] };
  commit({
    items: [item, ...state.items],
    audit: [submitEntry, ...state.audit].slice(0, 200),
  });
  return item;
}

// Approve the current step of an item as the acting role. No-op when the role
// is not the step's approver or the item has already completed.
export function approveItem(itemId: string, note: string): void {
  decide(itemId, note, 'approve');
}

// Reject the current step of an item as the acting role.
export function rejectItem(itemId: string, note: string): void {
  decide(itemId, note, 'reject');
}

function decide(itemId: string, note: string, action: 'approve' | 'reject'): void {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;
  const step = currentStep(state.workflow, item);
  if (!step) return;
  if (!canDecide(state.workflow, item, state.actingAs)) return;

  const trimmed = note.trim();
  const newAudit: HistoryEntry[] = [];

  let updated: Item;
  if (action === 'approve') {
    const moved = engineApprove(state.workflow, item);
    const decision = entry(
      item,
      'approved',
      state.actingAs,
      trimmed || 'approved',
      step.id,
      step.name,
    );
    newAudit.push(decision);
    const history = [...item.history, decision];
    // Note any steps that were skipped on the way to the new position.
    if (moved.stage === 'approved') {
      const done = entry(moved, 'completed', 'engine', 'all steps cleared', '', '');
      newAudit.push(done);
      history.push(done);
    }
    updated = { ...moved, history };
  } else {
    const moved = engineReject(state.workflow, item);
    const decision = entry(
      item,
      'rejected',
      state.actingAs,
      trimmed || 'sent back',
      step.id,
      step.name,
    );
    newAudit.push(decision);
    updated = { ...moved, history: [...item.history, decision] };
  }

  commit({
    items: state.items.map((i) => (i.id === itemId ? updated : i)),
    audit: [...newAudit.reverse(), ...state.audit].slice(0, 200),
  });
}

// Wipe persisted items and audit and restore the seed set.
export function resetAll(): void {
  try {
    localStorage.removeItem(ITEMS_KEY);
    localStorage.removeItem(AUDIT_KEY);
  } catch {
    // ignore storage errors
  }
  const seed = seedItems();
  state = {
    workflow: WORKFLOW,
    items: seed,
    audit: seedAudit(seed),
    actingAs: 'manager',
  };
  persist(state.items, state.audit);
  emit();
}

// ---------- seed ----------

function seedItems(): Item[] {
  const now = Date.now();
  const mk = (
    id: string,
    title: string,
    fields: ItemFields,
    stepIndex: number,
    ageMin: number,
  ): Item => {
    const submittedAt = now - ageMin * 60_000;
    const e: HistoryEntry = {
      id: `${id}-h0`,
      itemId: id,
      stepId: '',
      stepName: '',
      kind: 'submitted',
      actor: 'requester',
      note: 'request submitted',
      at: submittedAt,
    };
    return {
      id,
      title,
      fields,
      stepIndex,
      stage: 'active',
      submittedAt,
      history: [e],
    };
  };
  return [
    mk('REQ-SEED1', 'New laptop for design hire', { amount: 1800, accessChange: false }, 0, 42),
    mk('REQ-SEED2', 'Conference travel budget', { amount: 650, accessChange: false }, 0, 18),
    mk('REQ-SEED3', 'Prod database admin grant', { amount: 0, accessChange: true }, 0, 7),
  ];
}

function seedAudit(items: Item[]): HistoryEntry[] {
  return items.flatMap((i) => i.history).sort((a, b) => b.at - a.at);
}
