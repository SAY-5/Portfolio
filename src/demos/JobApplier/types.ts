// Domain model for JobApplier, an in-browser tracker for your own job search.
// Each record is one application you have filed (or plan to file), moving along
// a pipeline from a wishlist entry through applied, screen, interview, and a
// terminal offer or rejected. The whole thing runs in the browser: the funnel,
// the follow-ups due on a given day, and the response rate are all pure
// functions of this data, so the numbers you see are the arithmetic of the
// applications you entered, never a guess.

// The stages an application moves through, ordered from a saved lead to a
// terminal outcome. "rejected" is terminal and sits off the linear path.
export const STAGES = [
  'wishlist',
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
] as const;

export type Stage = (typeof STAGES)[number];

// The forward path, in order. "rejected" is excluded: it is a terminal side
// exit reachable from any active stage, not a step you advance into.
export const ADVANCE_PATH = [
  'wishlist',
  'applied',
  'screen',
  'interview',
  'offer',
] as const;

export type AdvanceStage = (typeof ADVANCE_PATH)[number];

// Human labels for each stage, used in the board headers and selects.
export const STAGE_LABEL: Record<Stage, string> = {
  wishlist: 'Wishlist',
  applied: 'Applied',
  screen: 'Screen',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

// The point in the funnel at which an application counts as a real submission.
// Anything at or past this stage has been sent to an employer; "wishlist" has
// not. The response rate is measured against this baseline.
export const APPLIED_INDEX = ADVANCE_PATH.indexOf('applied');

// One tracked application. Dates are stored as plain ISO calendar days
// (YYYY-MM-DD) so comparisons against the settable "today" are exact and
// timezone free. nextActionDate is the day a follow-up is due, or null when
// nothing is scheduled. salary is an optional whole-number annual figure.
export type Application = {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  appliedDate: string | null; // YYYY-MM-DD, null while still on the wishlist
  nextActionDate: string | null; // YYYY-MM-DD follow-up due day, or null
  salary: number | null; // annual figure, whole number, or null when unknown
  notes: string;
};

export type Persisted = {
  applications: Application[];
  // The "today" the dashboard reckons against, as a YYYY-MM-DD calendar day.
  // Kept in state (never read live from the clock during render) so the funnel
  // and follow-ups-due list are fully deterministic.
  today: string;
};

// The fields a user may edit on an application. id and stage transitions are
// handled by dedicated actions, not this patch.
export type ApplicationDraft = {
  company: string;
  role: string;
  appliedDate: string | null;
  nextActionDate: string | null;
  salary: number | null;
  notes: string;
};
