// Pure evaluation engine for release gates and the canary ramp. No eval, no
// I/O, no clock, no randomness: every output is a deterministic function of its
// inputs, which keeps the demo reproducible and safe.

import type {
  BooleanGate,
  CanaryState,
  CanaryStep,
  Gate,
  GateResult,
  Readiness,
  ThresholdGate,
} from './types';

// Evaluate one threshold gate against its bound.
function evalThreshold(g: ThresholdGate): boolean {
  return g.compare === 'atLeast'
    ? g.current >= g.threshold
    : g.current <= g.threshold;
}

function evalBoolean(g: BooleanGate): boolean {
  return g.current === g.expected;
}

// True when the gate's condition is currently satisfied.
export function gatePasses(g: Gate): boolean {
  return g.kind === 'threshold' ? evalThreshold(g) : evalBoolean(g);
}

function fmtThresholdCurrent(g: ThresholdGate): string {
  return g.unit === 'percent' ? `${g.current}%` : `${g.current}`;
}

function fmtThresholdRequired(g: ThresholdGate): string {
  const op = g.compare === 'atLeast' ? '≥' : '≤';
  const v = g.unit === 'percent' ? `${g.threshold}%` : `${g.threshold}`;
  return `${op} ${v}`;
}

// Build the per-gate result with display strings.
export function evaluateGate(g: Gate): GateResult {
  const pass = gatePasses(g);
  if (g.kind === 'threshold') {
    return {
      id: g.id,
      label: g.label,
      pass,
      required: g.required,
      weight: g.weight,
      currentText: fmtThresholdCurrent(g),
      requiredText: fmtThresholdRequired(g),
    };
  }
  return {
    id: g.id,
    label: g.label,
    pass,
    required: g.required,
    weight: g.weight,
    currentText: g.current ? 'met' : 'not met',
    requiredText: g.expected ? 'must be met' : 'must be clear',
  };
}

// Evaluate every gate, compute the weighted readiness score, and apply the
// required-gate veto. Any required gate failing forces NO-GO even if the
// weighted score is high.
export function evaluateReadiness(gates: Gate[]): Readiness {
  const results = gates.map(evaluateGate);

  let totalWeight = 0;
  let passWeight = 0;
  for (const r of results) {
    totalWeight += r.weight;
    if (r.pass) passWeight += r.weight;
  }
  const score =
    totalWeight === 0 ? 0 : Math.round((passWeight / totalWeight) * 100);

  const blockingIds = results
    .filter((r) => r.required && !r.pass)
    .map((r) => r.id);

  const passCount = results.filter((r) => r.pass).length;
  const decision = blockingIds.length === 0 ? 'GO' : 'NO-GO';

  return {
    decision,
    score,
    results,
    passCount,
    total: results.length,
    blockingIds,
  };
}

// ----- canary ramp -----

// The error rate observed at the active stage.
export function activeErrorRate(c: CanaryState): number {
  const stage = c.stages[c.stageIndex];
  return stage ? stage.errorRate : 0;
}

// True when the active stage is within the error budget and may promote.
export function stageWithinBudget(c: CanaryState): boolean {
  return activeErrorRate(c) <= c.errorBudget;
}

// Advance the canary one step. If the active stage is over budget, roll the
// whole rollout back. If under budget, promote to the next stage, or mark the
// rollout complete when the last stage clears. Returns the next state plus a
// step describing what happened; never mutates the input.
export function advanceCanary(c: CanaryState): {
  next: CanaryState;
  step: CanaryStep;
} {
  if (c.status === 'rolledback' || c.status === 'promoted') {
    return { next: c, step: { kind: 'noop' } };
  }

  const stage = c.stages[c.stageIndex];
  if (!stage) return { next: c, step: { kind: 'noop' } };

  // Over budget at the active stage: roll back the entire rollout.
  if (stage.errorRate > c.errorBudget) {
    return {
      next: { ...c, status: 'rolledback' },
      step: {
        kind: 'rollback',
        at: stage.percent,
        errorRate: stage.errorRate,
        budget: c.errorBudget,
      },
    };
  }

  // Under budget on the last stage: rollout is complete.
  if (c.stageIndex >= c.stages.length - 1) {
    return {
      next: { ...c, status: 'promoted' },
      step: { kind: 'complete', at: stage.percent },
    };
  }

  // Under budget with stages remaining: promote to the next one.
  const nextIndex = c.stageIndex + 1;
  return {
    next: { ...c, stageIndex: nextIndex, status: 'active' },
    step: {
      kind: 'promote',
      from: stage.percent,
      to: c.stages[nextIndex].percent,
    },
  };
}

// Reset the canary to the first stage and an active observation state, keeping
// the configured stages and budget.
export function resetCanary(c: CanaryState): CanaryState {
  return { ...c, stageIndex: 0, status: 'active' };
}
