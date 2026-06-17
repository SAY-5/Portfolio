// Pure pipeline engine for JobApplier. Every function here is a deterministic
// transform of plain data: there is no eval, no dynamic code, no clock, and no
// I/O. The funnel counts, the follow-ups due on a given day, and the response
// rate are arithmetic over the applications you entered and the "today" you
// pass in, so the same data always yields the same numbers.

import {
  ADVANCE_PATH,
  APPLIED_INDEX,
  STAGES,
  type AdvanceStage,
  type Application,
  type Stage,
} from './types';

// ---------- calendar-day helpers ----------

// Applications store dates as YYYY-MM-DD strings. Because they are zero-padded
// and ordered most-significant-first, a plain string comparison is also a
// chronological comparison, with no Date parsing and no timezone drift.
export function isValidDay(day: string | null): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

// True when `day` falls on or before `today`. Used to decide whether a
// follow-up is due. A null or malformed day is never due.
export function isOnOrBefore(day: string | null, today: string): boolean {
  if (!isValidDay(day)) return false;
  return day <= today;
}

// ---------- stage helpers ----------

const ADVANCE_INDEX: Record<string, number> = {};
ADVANCE_PATH.forEach((s, i) => {
  ADVANCE_INDEX[s] = i;
});

// The next forward stage after the given one, or null when there is none
// (offer is the end of the path, rejected is terminal and off the path).
export function nextStageOf(stage: Stage): AdvanceStage | null {
  const i = ADVANCE_INDEX[stage];
  if (i === undefined) return null; // rejected
  const next = ADVANCE_PATH[i + 1];
  return next ?? null;
}

// Whether an application can still be advanced one step forward.
export function canAdvance(app: Application): boolean {
  return nextStageOf(app.stage) !== null;
}

// Whether an application can be rejected: any active (non-terminal) stage.
export function canReject(app: Application): boolean {
  return app.stage !== 'rejected';
}

// ---------- funnel ----------

export type FunnelCounts = Record<Stage, number>;

// Count of applications sitting in each stage. Stages with none read 0.
export function funnelCounts(apps: Application[]): FunnelCounts {
  const counts = {} as FunnelCounts;
  for (const s of STAGES) counts[s] = 0;
  for (const a of apps) counts[a.stage] += 1;
  return counts;
}

// ---------- response rate ----------

const STAGE_INDEX: Record<string, number> = {};
ADVANCE_PATH.forEach((s, i) => {
  STAGE_INDEX[s] = i;
});

// An application counts as "submitted" once it has reached the applied stage or
// beyond. Wishlist entries are not submissions; rejected entries still count if
// they were ever submitted, which we infer from a recorded appliedDate.
function wasSubmitted(app: Application): boolean {
  if (app.stage === 'rejected') return isValidDay(app.appliedDate);
  const i = STAGE_INDEX[app.stage];
  return i !== undefined && i >= APPLIED_INDEX;
}

// An application "got a response" once it reached the screen stage or beyond.
// A rejection only counts as a response if it landed after a screen, which we
// cannot know from stage alone once it is terminal, so terminal rejections are
// treated as no response. This keeps the rate a lower bound that never inflates.
function gotResponse(app: Application): boolean {
  if (app.stage === 'rejected') return false;
  const screenIndex = STAGE_INDEX['screen'];
  const i = STAGE_INDEX[app.stage];
  return i !== undefined && i >= screenIndex;
}

export type ResponseRate = {
  submitted: number;
  responded: number;
  // Percent of submitted applications that reached a screen or beyond, rounded
  // to the nearest whole percent. Zero when nothing has been submitted.
  rate: number;
};

export function responseRate(apps: Application[]): ResponseRate {
  let submitted = 0;
  let responded = 0;
  for (const a of apps) {
    if (!wasSubmitted(a)) continue;
    submitted += 1;
    if (gotResponse(a)) responded += 1;
  }
  const rate = submitted === 0 ? 0 : Math.round((responded / submitted) * 100);
  return { submitted, responded, rate };
}

// ---------- follow-ups due ----------

// Applications whose next-action day is on or before `today` and which are not
// in a terminal stage, sorted by soonest due date first. These are the ones
// that need attention now.
export function followUpsDue(apps: Application[], today: string): Application[] {
  return apps
    .filter((a) => a.stage !== 'rejected' && isOnOrBefore(a.nextActionDate, today))
    .sort((a, b) => (a.nextActionDate ?? '').localeCompare(b.nextActionDate ?? ''));
}

// ---------- filtering and sorting ----------

export type StageFilter = Stage | 'all';
export type SortKey = 'company' | 'role' | 'stage' | 'nextAction' | 'salary';

// Case-insensitive substring match across company and role.
function matchesQuery(app: Application, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    app.company.toLowerCase().includes(q) || app.role.toLowerCase().includes(q)
  );
}

const STAGE_ORDER: Record<Stage, number> = {} as Record<Stage, number>;
STAGES.forEach((s, i) => {
  STAGE_ORDER[s] = i;
});

// Filter by stage and free-text query, then sort by the chosen key. Sorting is
// stable and total: ties and nulls fall back to a company-then-id comparison so
// the order never flickers between renders for equal rows.
export function filterAndSort(
  apps: Application[],
  opts: { stage: StageFilter; query: string; sort: SortKey },
): Application[] {
  const filtered = apps.filter(
    (a) =>
      (opts.stage === 'all' || a.stage === opts.stage) &&
      matchesQuery(a, opts.query),
  );

  const cmp = (a: Application, b: Application): number => {
    let primary = 0;
    switch (opts.sort) {
      case 'company':
        primary = a.company.localeCompare(b.company);
        break;
      case 'role':
        primary = a.role.localeCompare(b.role);
        break;
      case 'stage':
        primary = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
        break;
      case 'nextAction':
        // Nulls sort last so scheduled follow-ups surface first.
        primary =
          (a.nextActionDate ?? '9999-99-99').localeCompare(
            b.nextActionDate ?? '9999-99-99',
          );
        break;
      case 'salary':
        // Higher salary first; nulls sort last.
        primary = (b.salary ?? -1) - (a.salary ?? -1);
        break;
    }
    if (primary !== 0) return primary;
    const byCompany = a.company.localeCompare(b.company);
    if (byCompany !== 0) return byCompany;
    return a.id.localeCompare(b.id);
  };

  return [...filtered].sort(cmp);
}
