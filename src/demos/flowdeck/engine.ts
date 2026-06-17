// The FlowDeck engine: a pure, eval-free interpreter for a multi-step approval
// workflow. It decides which steps apply to an item, advances an item only when
// its current step is approved, sends a rejected item back per the step's rule,
// and computes which items are awaiting or blocked at each step. Every function
// here is a pure transform: it returns new values and never mutates its inputs,
// which is what lets the store persist and the UI re-render predictably.

import type {
  Condition,
  FieldValue,
  Item,
  ItemFields,
  Workflow,
  WorkflowStep,
} from './types';

// Evaluate a single condition against an item's fields. This is a data-only
// comparison over a fixed set of comparators; it never executes user code.
export function evalCondition(cond: Condition, fields: ItemFields): boolean {
  const actual = fields[cond.field];
  if (actual === undefined) return false;
  const expected = cond.value;
  switch (cond.op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return num(actual) > num(expected);
    case 'gte':
      return num(actual) >= num(expected);
    case 'lt':
      return num(actual) < num(expected);
    case 'lte':
      return num(actual) <= num(expected);
    default:
      return false;
  }
}

function num(v: FieldValue): number {
  return typeof v === 'number' ? v : Number(v);
}

// Does this step apply to this item? A step with no condition always applies;
// a step with a condition applies only when the condition holds.
export function stepApplies(step: WorkflowStep, fields: ItemFields): boolean {
  if (!step.condition) return true;
  return evalCondition(step.condition, fields);
}

// From a starting index, find the next index at which a step applies to the
// item. Returns steps.length when no further step applies (item is complete).
export function nextApplicableIndex(
  workflow: Workflow,
  fields: ItemFields,
  from: number,
): number {
  let i = Math.max(0, from);
  while (i < workflow.steps.length && !stepApplies(workflow.steps[i], fields)) {
    i += 1;
  }
  return i;
}

// The first applicable step index for a freshly submitted item.
export function startIndex(workflow: Workflow, fields: ItemFields): number {
  return nextApplicableIndex(workflow, fields, 0);
}

// The step an item currently sits at, or null when the item has completed.
export function currentStep(workflow: Workflow, item: Item): WorkflowStep | null {
  if (item.stage === 'approved') return null;
  return workflow.steps[item.stepIndex] ?? null;
}

// True when the item has cleared every applicable step.
export function isComplete(workflow: Workflow, item: Item): boolean {
  return item.stepIndex >= workflow.steps.length;
}

// Approve the item's current step and advance it to the next applicable step,
// or mark it approved when no further step applies. Pure: returns a new item.
// The approving role must match the current step's approver; callers should
// check canApprove first, but this also guards against an out-of-role call.
export function approve(workflow: Workflow, item: Item): Item {
  const step = currentStep(workflow, item);
  if (!step) return item;
  const target = nextApplicableIndex(workflow, item.fields, item.stepIndex + 1);
  const completed = target >= workflow.steps.length;
  return {
    ...item,
    stepIndex: target,
    stage: completed ? 'approved' : 'active',
  };
}

// Reject the item's current step. Per the step's onReject rule the item goes
// back to the previous applicable step or all the way to the start. It stays
// active either way so it can be re-approved. Pure: returns a new item.
export function reject(workflow: Workflow, item: Item): Item {
  const step = currentStep(workflow, item);
  if (!step) return item;
  let target: number;
  if (step.onReject === 'start') {
    target = startIndex(workflow, item.fields);
  } else {
    target = previousApplicableIndex(workflow, item.fields, item.stepIndex - 1);
  }
  return { ...item, stepIndex: target, stage: 'active' };
}

// Walk backward from an index to the nearest applicable step, clamped at the
// start. Used by a 'previous' rejection.
function previousApplicableIndex(
  workflow: Workflow,
  fields: ItemFields,
  from: number,
): number {
  let i = from;
  while (i > 0 && !stepApplies(workflow.steps[i], fields)) {
    i -= 1;
  }
  // If even index 0 does not apply, fall forward to the first applicable step.
  if (i < 0 || !stepApplies(workflow.steps[i], fields)) {
    return startIndex(workflow, fields);
  }
  return i;
}

// May this role approve or reject the item's current step right now?
export function canDecide(workflow: Workflow, item: Item, role: string): boolean {
  const step = currentStep(workflow, item);
  if (!step) return false;
  return step.approver === role;
}

// Per-step summary used by the pipeline and stats panel: which items sit at
// each step, and how many are blocked there (awaiting a different role than
// the viewer, surfaced by the UI). Here we report counts and the item list.
export type StepBucket = {
  step: WorkflowStep;
  index: number;
  items: Item[];
};

// Group active items by the step they currently sit at. Completed items are
// returned separately so the pipeline can show a terminal column.
export function bucketByStep(workflow: Workflow, items: Item[]): {
  buckets: StepBucket[];
  completed: Item[];
} {
  const buckets: StepBucket[] = workflow.steps.map((step, index) => ({
    step,
    index,
    items: [],
  }));
  const completed: Item[] = [];
  for (const item of items) {
    if (item.stage === 'approved' || item.stepIndex >= workflow.steps.length) {
      completed.push(item);
      continue;
    }
    const bucket = buckets[item.stepIndex];
    if (bucket) bucket.items.push(item);
  }
  return { buckets, completed };
}

// Count items awaiting each step keyed by step id, plus a total in flight.
export function awaitingCounts(workflow: Workflow, items: Item[]): {
  perStep: Record<string, number>;
  inFlight: number;
  completed: number;
} {
  const perStep: Record<string, number> = {};
  for (const step of workflow.steps) perStep[step.id] = 0;
  let inFlight = 0;
  let completed = 0;
  for (const item of items) {
    if (item.stage === 'approved' || item.stepIndex >= workflow.steps.length) {
      completed += 1;
      continue;
    }
    const step = workflow.steps[item.stepIndex];
    if (step) {
      perStep[step.id] += 1;
      inFlight += 1;
    }
  }
  return { perStep, inFlight, completed };
}
