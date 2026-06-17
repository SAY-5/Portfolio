// Pure scheduling engine for the conference SPA. No eval, no Date.now, no
// network: every function takes its inputs explicitly and returns a fresh value,
// so the same arguments always produce the same result and the UI can call into
// it freely during render. Times are minutes from midnight throughout.

import type {
  Conflict,
  NowNext,
  PlacedSession,
  ScheduleFilter,
  Session,
  TrackGroup,
} from './types';

export function endMin(s: Session): number {
  return s.startMin + s.durationMin;
}

export function place(s: Session): PlacedSession {
  return { ...s, endMin: endMin(s) };
}

// Two half-open ranges [aStart, aEnd) and [bStart, bEnd) overlap when each
// starts before the other ends. Touching edges (one ends exactly as the next
// begins) are not a conflict.
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Format minutes-from-midnight as HH:MM in 24h form.
export function formatMin(min: number): string {
  const clamped = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatRange(s: PlacedSession): string {
  return `${formatMin(s.startMin)} to ${formatMin(s.endMin)}`;
}

// Distinct track names in first-seen order, used to build columns and filters.
export function tracksOf(sessions: Session[]): string[] {
  const seen: string[] = [];
  for (const s of sessions) if (!seen.includes(s.track)) seen.push(s.track);
  return seen;
}

// Distinct tags across the schedule, sorted for a stable filter menu.
export function tagsOf(sessions: Session[]): string[] {
  const set = new Set<string>();
  for (const s of sessions) for (const t of s.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Apply the search box and the track/tag dropdowns. Search matches title,
// speaker, room, track, and tags case-insensitively.
export function filterSessions(
  sessions: Session[],
  filter: ScheduleFilter,
): PlacedSession[] {
  const q = filter.query.trim().toLowerCase();
  return sessions
    .filter((s) => {
      if (filter.track !== 'all' && s.track !== filter.track) return false;
      if (filter.tag !== 'all' && !s.tags.includes(filter.tag)) return false;
      if (q === '') return true;
      const hay = [s.title, s.speaker, s.room, s.track, ...s.tags]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    })
    .map(place);
}

// Group sessions by track, each group sorted by start time then title so the
// timeline columns read top to bottom in chronological order.
export function groupByTrack(sessions: Session[]): TrackGroup[] {
  const order = tracksOf(sessions);
  const groups: TrackGroup[] = order.map((track) => ({ track, sessions: [] }));
  const byTrack = new Map(groups.map((g) => [g.track, g]));
  for (const s of sessions) byTrack.get(s.track)?.sessions.push(place(s));
  for (const g of groups) g.sessions.sort(sortByStart);
  return groups;
}

export function sortByStart(a: PlacedSession, b: PlacedSession): number {
  if (a.startMin !== b.startMin) return a.startMin - b.startMin;
  return a.title.localeCompare(b.title);
}

// Resolve a set of saved ids to placed sessions in time order. Unknown ids are
// dropped so a stale localStorage entry cannot crash the agenda view.
export function agendaSessions(
  sessions: Session[],
  savedIds: string[],
): PlacedSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const out: PlacedSession[] = [];
  for (const id of savedIds) {
    const s = byId.get(id);
    if (s) out.push(place(s));
  }
  return out.sort(sortByStart);
}

// Detect every pair of overlapping sessions inside a personal agenda. The list
// is sorted first so we only have to compare each session against later ones
// that could still overlap, and we stop early once a later session starts after
// the current one ends.
export function findConflicts(agenda: PlacedSession[]): Conflict[] {
  const sorted = [...agenda].sort(sortByStart);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.startMin >= a.endMin) break;
      if (rangesOverlap(a.startMin, a.endMin, b.startMin, b.endMin)) {
        conflicts.push({
          a,
          b,
          overlapMin: overlapMinutes(a.startMin, a.endMin, b.startMin, b.endMin),
        });
      }
    }
  }
  return conflicts;
}

// Set of session ids that take part in at least one conflict, so the UI can
// flag the offending cards without re-running the pair search per card.
export function conflictingIds(agenda: PlacedSession[]): Set<string> {
  const ids = new Set<string>();
  for (const c of findConflicts(agenda)) {
    ids.add(c.a.id);
    ids.add(c.b.id);
  }
  return ids;
}

// Given a snapshot of the current minute, report which sessions are running now
// and which session starts next. The caller owns the clock so render stays pure.
export function nowNext(sessions: Session[], nowMin: number): NowNext {
  const placed = sessions.map(place).sort(sortByStart);
  const current = placed.filter(
    (s) => nowMin >= s.startMin && nowMin < s.endMin,
  );
  const next = placed.find((s) => s.startMin > nowMin) ?? null;
  return { nowMin, current, next };
}
