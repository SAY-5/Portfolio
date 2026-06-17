// Browser-side model of the AgentDesk operations console. It owns the inbound
// queue, runs the provider agent loop for a selected request, scores confidence
// as signal x tool-call completeness, routes the request to the resolved lane or
// the human-review queue against a tunable threshold, and keeps a full transcript
// and audit trail per request. Processed requests and the threshold persist in
// localStorage so the console survives a reload. Nothing here talks to a server:
// the mock backend in data.ts stands in for the orders, billing, and customer
// services the real tools call.

import {
  DEFAULT_THRESHOLD,
  PLANS,
  findOrder,
  inbound,
  type Intent,
  type Request,
  type ToolName,
} from './data';

const PROCESSED_KEY = 'agentdesk.processed.v1';
const THRESHOLD_KEY = 'agentdesk.threshold.v1';
const AUDIT_KEY = 'agentdesk.audit.v1';

// One step in a request transcript. The agent emits a tool call per plan entry,
// then a score line, then the routing decision. The UI replays these with delays
// for the step-by-step view and stores them as the permanent transcript.
export type ToolCall = {
  tool: ToolName;
  ok: boolean;
  detail: string;
};

export type Decision = 'resolved' | 'escalated';

// What the operator did to an escalated request. 'pending' means it is waiting
// in the human-review queue for a decision.
export type Review = 'pending' | 'approved' | 'overridden';

export type AuditEntry = {
  at: number;
  requestId: string;
  action: 'auto-resolve' | 'escalate' | 'approve' | 'override' | 'reset';
  note: string;
};

// The permanent record of a processed request: its tool transcript, the scores,
// the routing decision, and any human review applied afterward.
export type Processed = {
  requestId: string;
  intent: Intent;
  calls: ToolCall[];
  signal: number;
  completeness: number;
  confidence: number;
  threshold: number; // the threshold in force when it was scored
  decision: Decision;
  review: Review;
  resolution: string; // the proposal the agent drafted
  processedAt: number;
};

// The pure result of running the agent loop, before it is committed to state.
export type RunResult = {
  requestId: string;
  calls: ToolCall[];
  signal: number;
  completeness: number;
  confidence: number;
  decision: Decision;
  resolution: string;
};

export type State = {
  threshold: number;
  // Requests still waiting in the inbound queue, by id.
  queueIds: string[];
  // Processed requests keyed by request id, in processing order (newest first).
  processed: Processed[];
  audit: AuditEntry[];
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

function loadState(): State {
  const processed = readJSON<Processed[]>(PROCESSED_KEY, []);
  const done = new Set(processed.map((p) => p.requestId));
  const queueIds = inbound.map((r) => r.id).filter((id) => !done.has(id));
  return {
    threshold: readJSON<number>(THRESHOLD_KEY, DEFAULT_THRESHOLD),
    queueIds,
    processed,
    audit: readJSON<AuditEntry[]>(AUDIT_KEY, []),
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

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

export function findRequest(id: string): Request | undefined {
  return inbound.find((r) => r.id === id);
}

// ---------- the mock backend ----------

// Run a single tool against the mock backend for a request. Returns whether the
// call succeeded and a short human-readable detail line. Failures are
// deterministic and driven by the data, not random: issue_refund fails when the
// order is outside the return window, and any tool fails when the order it needs
// cannot be found. This keeps a run reproducible for a given request.
function runTool(tool: ToolName, req: Request): ToolCall {
  const order = findOrder(req.orderId);

  switch (tool) {
    case 'lookup_order': {
      if (!req.orderId || !order) {
        return {
          tool,
          ok: false,
          detail: 'no order id on the request: nothing to look up',
        };
      }
      return {
        tool,
        ok: true,
        detail: `${order.id} ${order.item}, status ${order.status}`,
      };
    }
    case 'check_refund_eligibility': {
      if (!order) {
        return { tool, ok: false, detail: 'order not found' };
      }
      if (!order.refundable) {
        return {
          tool,
          ok: false,
          detail: `${order.id} is outside the 30 day return window`,
        };
      }
      return { tool, ok: true, detail: `${order.id} is eligible for a refund` };
    }
    case 'issue_refund': {
      if (!order) {
        return { tool, ok: false, detail: 'order not found' };
      }
      if (!order.refundable) {
        return {
          tool,
          ok: false,
          detail: 'refund blocked: order is not eligible',
        };
      }
      return { tool, ok: true, detail: `refund of the order total posted` };
    }
    case 'update_address': {
      if (!req.newAddress) {
        return { tool, ok: false, detail: 'no new address supplied' };
      }
      return { tool, ok: true, detail: `shipping address set to ${req.newAddress}` };
    }
  }
}

// Draft the resolution the agent would send for a request, given how the tools
// resolved. This is the proposal an operator reviews on an escalation.
function draftResolution(req: Request, calls: ToolCall[]): string {
  const order = findOrder(req.orderId);
  switch (req.intent) {
    case 'order_status':
      return order
        ? `Order ${order.id} (${order.item}) is ${order.status}.`
        : 'No matching order was found for this customer request.';
    case 'refund_request':
      return calls.every((c) => c.ok)
        ? `Refund approved and posted for order ${order?.id ?? ''}.`
        : `Refund cannot be completed automatically for order ${order?.id ?? ''}.`;
    case 'address_change':
      return calls.every((c) => c.ok)
        ? `Shipping address updated to ${req.newAddress ?? ''}.`
        : 'Address change could not be applied automatically.';
    case 'cancel_order':
      return calls.every((c) => c.ok)
        ? `Cancellation eligible for order ${order?.id ?? ''}.`
        : `Cancellation needs a human check for order ${order?.id ?? ''}.`;
  }
}

// ---------- the agent loop and scoring ----------

// Run the full tool plan for a request, score it, and decide. This is pure: it
// reads the request and the current threshold and returns a result without
// mutating state, so the UI can replay the calls before committing the outcome.
export function runAgent(requestId: string, threshold = state.threshold): RunResult {
  const req = findRequest(requestId);
  if (!req) {
    return {
      requestId,
      calls: [],
      signal: 0,
      completeness: 0,
      confidence: 0,
      decision: 'escalated',
      resolution: 'Request not found.',
    };
  }

  const plan: ToolName[] = PLANS[req.intent];
  const calls = plan.map((tool) => runTool(tool, req));
  const passed = calls.filter((c) => c.ok).length;
  // Tool-call completeness is the fraction of planned calls that succeeded.
  const completeness = calls.length === 0 ? 0 : passed / calls.length;
  // Confidence is the provider signal times that completeness.
  const confidence = +(req.signal * completeness).toFixed(3);
  const decision: Decision = confidence >= threshold ? 'resolved' : 'escalated';
  const resolution = draftResolution(req, calls);

  return {
    requestId,
    calls,
    signal: req.signal,
    completeness,
    confidence,
    decision,
    resolution,
  };
}

// ---------- mutations ----------

function persist(): void {
  writeJSON(PROCESSED_KEY, state.processed);
  writeJSON(THRESHOLD_KEY, state.threshold);
  writeJSON(AUDIT_KEY, state.audit);
}

function addAudit(entry: AuditEntry): AuditEntry[] {
  return [entry, ...state.audit].slice(0, 60);
}

// Commit a completed run: record the processed request, drop it from the queue,
// and write the routing decision to the audit trail. Escalations start as a
// pending review awaiting a human; resolutions are final.
export function commitRun(result: RunResult): Processed {
  const req = findRequest(result.requestId);
  const entry: Processed = {
    requestId: result.requestId,
    intent: req?.intent ?? 'order_status',
    calls: result.calls,
    signal: result.signal,
    completeness: result.completeness,
    confidence: result.confidence,
    threshold: state.threshold,
    decision: result.decision,
    review: result.decision === 'escalated' ? 'pending' : 'approved',
    resolution: result.resolution,
    processedAt: Date.now(),
  };

  const audit = addAudit({
    at: entry.processedAt,
    requestId: entry.requestId,
    action: result.decision === 'resolved' ? 'auto-resolve' : 'escalate',
    note:
      result.decision === 'resolved'
        ? `confidence ${result.confidence.toFixed(2)} at or above ${state.threshold.toFixed(2)}`
        : `confidence ${result.confidence.toFixed(2)} below ${state.threshold.toFixed(2)}`,
  });

  set({
    processed: [entry, ...state.processed.filter((p) => p.requestId !== entry.requestId)],
    queueIds: state.queueIds.filter((id) => id !== entry.requestId),
    audit,
  });
  persist();
  return entry;
}

// Apply a human decision to an escalated request. Approving accepts the agent
// proposal; overriding records that the operator handled it differently. Both
// are written to the audit trail.
export function reviewRequest(requestId: string, review: 'approved' | 'overridden', note: string): void {
  const target = state.processed.find((p) => p.requestId === requestId);
  if (!target || target.decision !== 'escalated') return;
  const processed = state.processed.map((p) =>
    p.requestId === requestId ? { ...p, review } : p,
  );
  const audit = addAudit({
    at: Date.now(),
    requestId,
    action: review === 'approved' ? 'approve' : 'override',
    note,
  });
  set({ processed, audit });
  persist();
}

// Move the threshold. Re-routing of already-processed requests is recomputed on
// read by reroutedDecision, so a live threshold change reflects everywhere at
// once without rewriting history.
export function setThreshold(value: number): void {
  const threshold = Math.min(1, Math.max(0, +value.toFixed(2)));
  set({ threshold });
  writeJSON(THRESHOLD_KEY, threshold);
}

// Wipe persisted state and reset the runtime model back to the full inbound
// queue and the default threshold.
export function resetAll(): void {
  try {
    localStorage.removeItem(PROCESSED_KEY);
    localStorage.removeItem(THRESHOLD_KEY);
    localStorage.removeItem(AUDIT_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    threshold: DEFAULT_THRESHOLD,
    queueIds: inbound.map((r) => r.id),
    processed: [],
    audit: [
      {
        at: Date.now(),
        requestId: '-',
        action: 'reset',
        note: 'console reset, saved state cleared',
      },
    ],
  };
  writeJSON(AUDIT_KEY, state.audit);
  emit();
}

// ---------- derived ----------

// Recompute a processed request's lane against the current threshold without
// rewriting its stored decision. A processed request keeps its confidence; only
// which lane it falls into can change when the operator drags the threshold.
export function reroutedDecision(p: Processed, threshold = state.threshold): Decision {
  return p.confidence >= threshold ? 'resolved' : 'escalated';
}

export { inbound, DEFAULT_THRESHOLD };
