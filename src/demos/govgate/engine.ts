// The GovGate engine: a pure, eval-free scorer for a compliance assessment. It
// turns the framework plus the recorded statuses into a weighted compliance
// score, a per-category breakdown, a pass or fail gate against the threshold,
// and a prioritized remediation list. Every function returns new values and
// never mutates its inputs, so the store can persist and the UI re-render
// predictably. There is no eval and no dynamic code: scoring is a fixed sum over
// data.

import type {
  Assessment,
  CategoryBreakdown,
  Control,
  ControlResult,
  ControlStatus,
  Framework,
  RemediationItem,
  Score,
  Severity,
  StatusCounts,
} from './types';

// Credit a status earns toward the score, as a fraction of the control's weight.
// n-a earns nothing because it is also removed from the denominator.
const CREDIT: Record<ControlStatus, number> = {
  met: 1,
  partial: 0.5,
  'not-met': 0,
  'n-a': 0,
};

// Severity ordering used to rank remediation work. Higher is more urgent.
const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// Read a control's recorded result, defaulting to not-met when the assessment
// has no entry for it. A missing answer is treated as an open gap, not a pass.
export function resultFor(
  assessment: Assessment,
  controlId: string,
): ControlResult {
  return assessment.results[controlId] ?? { status: 'not-met', note: '' };
}

// Whether a status counts toward the denominator. n-a controls are out of scope.
function inScope(status: ControlStatus): boolean {
  return status !== 'n-a';
}

// Clamp the threshold into the 0 to 100 range so a bad input cannot break the
// gate. Non-finite values fall back to 0.
export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

// Round earned and applicable weight into a 0 to 100 percent. An assessment with
// no applicable weight scores 0, which the gate then fails unless the threshold
// is also 0.
function toPercent(earned: number, applicable: number): number {
  if (applicable <= 0) return 0;
  return Math.round((earned / applicable) * 100);
}

// The headline weighted compliance score for the whole assessment.
export function scoreAssessment(
  framework: Framework,
  assessment: Assessment,
): Score {
  let earned = 0;
  let applicable = 0;
  for (const control of framework.controls) {
    const { status } = resultFor(assessment, control.id);
    if (!inScope(status)) continue;
    applicable += control.weight;
    earned += control.weight * CREDIT[status];
  }
  const threshold = clampThreshold(assessment.threshold);
  const percent = toPercent(earned, applicable);
  return {
    percent,
    earned,
    applicable,
    passed: percent >= threshold,
    threshold,
  };
}

// Empty status tally, used as the per-category accumulator seed.
function emptyCounts(): StatusCounts {
  return { met: 0, partial: 0, 'not-met': 0, 'n-a': 0, total: 0 };
}

// Per-category roll-up of the same weighted math plus status tallies, returned
// in the order categories first appear in the framework.
export function categoryBreakdown(
  framework: Framework,
  assessment: Assessment,
): CategoryBreakdown[] {
  const order: string[] = [];
  const acc = new Map<
    string,
    { earned: number; applicable: number; counts: StatusCounts }
  >();
  for (const control of framework.controls) {
    if (!acc.has(control.category)) {
      order.push(control.category);
      acc.set(control.category, {
        earned: 0,
        applicable: 0,
        counts: emptyCounts(),
      });
    }
    const bucket = acc.get(control.category)!;
    const { status } = resultFor(assessment, control.id);
    bucket.counts[status] += 1;
    bucket.counts.total += 1;
    if (inScope(status)) {
      bucket.applicable += control.weight;
      bucket.earned += control.weight * CREDIT[status];
    }
  }
  return order.map((category) => {
    const bucket = acc.get(category)!;
    return {
      category,
      percent: toPercent(bucket.earned, bucket.applicable),
      earned: bucket.earned,
      applicable: bucket.applicable,
      counts: bucket.counts,
    };
  });
}

// Whole-assessment status tally across every control.
export function statusCounts(
  framework: Framework,
  assessment: Assessment,
): StatusCounts {
  const counts = emptyCounts();
  for (const control of framework.controls) {
    const { status } = resultFor(assessment, control.id);
    counts[status] += 1;
    counts.total += 1;
  }
  return counts;
}

// The priority weight for a control: severity rank times weight. Higher means
// the gap is both more severe and counts for more, so fix it sooner.
export function priorityOf(control: Control): number {
  return SEVERITY_RANK[control.severity] * control.weight;
}

// The prioritized remediation list: every not-met or partial control, sorted by
// priority (descending), then by weight, then by id for a stable order. Met and
// n-a controls never appear because there is nothing to remediate.
export function remediationList(
  framework: Framework,
  assessment: Assessment,
): RemediationItem[] {
  const items: RemediationItem[] = [];
  for (const control of framework.controls) {
    const { status, note } = resultFor(assessment, control.id);
    if (status !== 'not-met' && status !== 'partial') continue;
    items.push({
      control,
      status,
      note,
      priority: priorityOf(control),
    });
  }
  return items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.control.weight !== a.control.weight) {
      return b.control.weight - a.control.weight;
    }
    return a.control.id.localeCompare(b.control.id);
  });
}
