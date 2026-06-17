// Browser-side store for the conversation flow builder. The whole flow (nodes
// plus a start node) lives in localStorage and is edited in place. This is a
// framework-agnostic external store: a single mutable snapshot, a listener set,
// and a React binding via useSyncExternalStore (see the hook at the bottom).
// Nothing executes flow data; the store only reads and writes plain objects.

import { useSyncExternalStore } from 'react';
import type {
  ChoiceNode,
  ChoiceOption,
  Flow,
  FlowNode,
  MessageNode,
  NodeKind,
} from './types';

const FLOW_KEY = 'convoengine.flow.v1';

// ---------- seed ----------

// A small support-script flow used on first load: greet, branch on the kind of
// problem, resolve or escalate, and close. It validates clean so a new visitor
// sees a working flow immediately.
function seedFlow(): Flow {
  return {
    start: 'greet',
    nodes: [
      {
        id: 'greet',
        kind: 'message',
        label: 'Greeting',
        text: 'Hello, thanks for reaching out. Lets get you to the right place.',
        next: 'topic',
      } as MessageNode,
      {
        id: 'topic',
        kind: 'choice',
        label: 'Pick a topic',
        text: 'What can we help you with today?',
        options: [
          { id: 'o-billing', label: 'A billing question', to: 'billing' },
          { id: 'o-tech', label: 'A technical problem', to: 'tech' },
          { id: 'o-other', label: 'Something else', to: 'operator' },
        ],
      } as ChoiceNode,
      {
        id: 'billing',
        kind: 'choice',
        label: 'Billing detail',
        text: 'Is this about a charge you did not expect, or a refund?',
        options: [
          { id: 'b-charge', label: 'An unexpected charge', to: 'charge-info' },
          { id: 'b-refund', label: 'A refund', to: 'refund-info' },
        ],
      } as ChoiceNode,
      {
        id: 'charge-info',
        kind: 'message',
        label: 'Charge explainer',
        text: 'Most surprise charges are mid-cycle plan changes. We can itemise it for you.',
        next: 'resolved',
      } as MessageNode,
      {
        id: 'refund-info',
        kind: 'message',
        label: 'Refund explainer',
        text: 'Refunds post in three to five business days to the original method.',
        next: 'resolved',
      } as MessageNode,
      {
        id: 'tech',
        kind: 'choice',
        label: 'Technical detail',
        text: 'Have you already tried signing out and back in?',
        options: [
          { id: 't-yes', label: 'Yes, still broken', to: 'operator' },
          { id: 't-no', label: 'Not yet', to: 'tech-step' },
        ],
      } as ChoiceNode,
      {
        id: 'tech-step',
        kind: 'message',
        label: 'Suggest a step',
        text: 'Please sign out, clear the app cache, and sign back in.',
        next: 'resolved',
      } as MessageNode,
      {
        id: 'operator',
        kind: 'message',
        label: 'Hand to operator',
        text: 'Connecting you with a person now. A short summary has been posted to the queue.',
        next: 'closed',
      } as MessageNode,
      {
        id: 'resolved',
        kind: 'choice',
        label: 'Did that help?',
        text: 'Did that resolve your question?',
        options: [
          { id: 'r-yes', label: 'Yes, thank you', to: 'closed' },
          { id: 'r-no', label: 'No, I need a person', to: 'operator' },
        ],
      } as ChoiceNode,
      {
        id: 'closed',
        kind: 'end',
        label: 'Closed',
        text: 'Thanks for chatting. This conversation is now closed.',
      },
    ],
  };
}

// ---------- persistence ----------

function readFlow(): Flow {
  try {
    const raw = localStorage.getItem(FLOW_KEY);
    if (!raw) return seedFlow();
    const parsed = JSON.parse(raw) as Flow;
    if (!parsed || !Array.isArray(parsed.nodes)) return seedFlow();
    return parsed;
  } catch {
    return seedFlow();
  }
}

function writeFlow(flow: Flow): void {
  try {
    localStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

// ---------- external store ----------

let flow: Flow = readFlow();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: Flow): void {
  flow = next;
  writeFlow(flow);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getFlow(): Flow {
  return flow;
}

// ---------- id helpers ----------

let counter = 0;

// Deterministic, collision-checked id. No clock or randomness so the store
// stays a pure function of its own call sequence (and lint stays happy about
// impure calls in render paths, which never reach here anyway).
function uniqueId(prefix: string): string {
  let id = `${prefix}-${counter++}`;
  const ids = new Set(flow.nodes.map((n) => n.id));
  while (ids.has(id)) id = `${prefix}-${counter++}`;
  return id;
}

function optionId(node: ChoiceNode): string {
  const used = new Set(node.options.map((o) => o.id));
  let id = `opt-${counter++}`;
  while (used.has(id)) id = `opt-${counter++}`;
  return id;
}

// ---------- node actions ----------

function blankNode(kind: NodeKind, id: string): FlowNode {
  if (kind === 'message') {
    return { id, kind, label: 'New message', text: '', next: null };
  }
  if (kind === 'choice') {
    return {
      id,
      kind,
      label: 'New choice',
      text: '',
      options: [{ id: `opt-${counter++}`, label: 'Option one', to: null }],
    };
  }
  return { id, kind: 'end', label: 'New end', text: '' };
}

export function addNode(kind: NodeKind): string {
  const id = uniqueId(kind);
  const node = blankNode(kind, id);
  const nodes = [...flow.nodes, node];
  const start = flow.start ?? id;
  commit({ nodes, start });
  return id;
}

export function deleteNode(id: string): void {
  const nodes = flow.nodes
    .filter((n) => n.id !== id)
    .map((n) => clearRefsTo(n, id));
  const start = flow.start === id ? (nodes[0]?.id ?? null) : flow.start;
  commit({ nodes, start });
}

// Null out any edge that targeted a now-deleted node so the flow never holds a
// dangling reference. The validator would catch it, but keeping data clean is
// cheaper.
function clearRefsTo(node: FlowNode, removedId: string): FlowNode {
  if (node.kind === 'message') {
    return node.next === removedId ? { ...node, next: null } : node;
  }
  if (node.kind === 'choice') {
    return {
      ...node,
      options: node.options.map((o) =>
        o.to === removedId ? { ...o, to: null } : o,
      ),
    };
  }
  return node;
}

function replaceNode(id: string, update: (n: FlowNode) => FlowNode): void {
  const nodes = flow.nodes.map((n) => (n.id === id ? update(n) : n));
  commit({ ...flow, nodes });
}

export function setNodeLabel(id: string, label: string): void {
  replaceNode(id, (n) => ({ ...n, label }));
}

export function setNodeText(id: string, text: string): void {
  replaceNode(id, (n) => ({ ...n, text }));
}

export function setMessageNext(id: string, next: string | null): void {
  replaceNode(id, (n) => (n.kind === 'message' ? { ...n, next } : n));
}

export function addOption(id: string): void {
  replaceNode(id, (n) => {
    if (n.kind !== 'choice') return n;
    const oid = optionId(n);
    const opt: ChoiceOption = { id: oid, label: 'New option', to: null };
    return { ...n, options: [...n.options, opt] };
  });
}

export function setOptionLabel(
  id: string,
  optId: string,
  label: string,
): void {
  replaceNode(id, (n) => {
    if (n.kind !== 'choice') return n;
    return {
      ...n,
      options: n.options.map((o) => (o.id === optId ? { ...o, label } : o)),
    };
  });
}

export function setOptionTarget(
  id: string,
  optId: string,
  to: string | null,
): void {
  replaceNode(id, (n) => {
    if (n.kind !== 'choice') return n;
    return {
      ...n,
      options: n.options.map((o) => (o.id === optId ? { ...o, to } : o)),
    };
  });
}

export function deleteOption(id: string, optId: string): void {
  replaceNode(id, (n) => {
    if (n.kind !== 'choice') return n;
    return { ...n, options: n.options.filter((o) => o.id !== optId) };
  });
}

export function setStart(id: string | null): void {
  commit({ ...flow, start: id });
}

// Restore the seed and clear the persisted flow.
export function resetFlow(): void {
  try {
    localStorage.removeItem(FLOW_KEY);
  } catch {
    // ignore storage errors
  }
  flow = seedFlow();
  emit();
}

// ---------- React binding ----------

export function useFlow(): Flow {
  return useSyncExternalStore(subscribe, getFlow, getFlow);
}
