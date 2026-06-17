// localStorage-backed store for changesets and verdicts.
// Exposes a useSyncExternalStore-compatible interface.

import { useSyncExternalStore } from 'react';
import type { Changeset, ReviewState, Verdict, VerdictKind } from './types';
import { parseDiff } from './diff';

const STORAGE_KEY = 'reviewdeck_v1';

// ---- persistence helpers ----

function load(): ReviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ReviewState;
  } catch {
    // ignore parse errors; fall through to empty state
  }
  return { changesets: [], verdicts: [] };
}

function save(state: ReviewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or private browsing; continue in-memory
  }
}

// ---- in-memory singleton ----

let _state: ReviewState = load();
const _listeners = new Set<() => void>();

function getSnapshot(): ReviewState {
  return _state;
}

function getServerSnapshot(): ReviewState {
  return { changesets: [], verdicts: [] };
}

function notify(): void {
  for (const fn of _listeners) fn();
}

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function setState(next: ReviewState): void {
  _state = next;
  save(_state);
  notify();
}

// ---- uid ----

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- public actions ----

export function addChangeset(title: string, author: string, rawDiff: string): Changeset {
  const patches = parseDiff(rawDiff);
  const cs: Changeset = {
    id: uid(),
    title: title.trim(),
    author: author.trim(),
    createdAt: Date.now(),
    rawDiff,
    patches,
    status: 'open',
  };
  setState({ ..._state, changesets: [cs, ..._state.changesets] });
  return cs;
}

export function addVerdict(
  changesetId: string,
  reviewer: string,
  kind: VerdictKind,
  comment: string,
): Verdict {
  const v: Verdict = {
    id: uid(),
    changesetId,
    reviewer: reviewer.trim(),
    kind,
    comment: comment.trim(),
    createdAt: Date.now(),
  };
  setState({ ..._state, verdicts: [..._state.verdicts, v] });
  return v;
}

export function mergeChangeset(id: string): void {
  const changesets = _state.changesets.map((cs) =>
    cs.id === id ? { ...cs, status: 'merged' as const } : cs,
  );
  setState({ ..._state, changesets });
}

export function resetStore(): void {
  setState({ changesets: [], verdicts: [] });
}

// ---- review-policy engine ----

// A changeset is merge-eligible when:
//   - it has at least 2 approvals, AND
//   - it has no open (not superseded) change-requests.
//
// "Superseded" means a reviewer who left a request-changes verdict later
// left an approve verdict; in that case their request-changes is resolved.

export type PolicyResult = {
  eligible: boolean;
  approvals: number;
  openRequests: number;
  blockedReason: string | null;
};

export function evaluatePolicy(changesetId: string, verdicts: Verdict[]): PolicyResult {
  const mine = verdicts.filter((v) => v.changesetId === changesetId);

  // Build the latest verdict per reviewer (ordered by createdAt)
  const latestByReviewer = new Map<string, Verdict>();
  for (const v of mine.slice().sort((a, b) => a.createdAt - b.createdAt)) {
    latestByReviewer.set(v.reviewer, v);
  }

  let approvals = 0;
  let openRequests = 0;

  for (const v of latestByReviewer.values()) {
    if (v.kind === 'approve') approvals++;
    else if (v.kind === 'request-changes') openRequests++;
  }

  const REQUIRED_APPROVALS = 2;

  if (openRequests > 0) {
    return {
      eligible: false,
      approvals,
      openRequests,
      blockedReason: `${openRequests} open change request${openRequests > 1 ? 's' : ''}`,
    };
  }
  if (approvals < REQUIRED_APPROVALS) {
    const need = REQUIRED_APPROVALS - approvals;
    return {
      eligible: false,
      approvals,
      openRequests: 0,
      blockedReason: `needs ${need} more approval${need > 1 ? 's' : ''}`,
    };
  }
  return { eligible: true, approvals, openRequests: 0, blockedReason: null };
}

// ---- React hook ----

export function useReviewStore(): ReviewState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
