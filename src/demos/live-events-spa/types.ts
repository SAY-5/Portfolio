// Shared domain types for the in-browser conference scheduler. A schedule is a
// flat list of sessions placed on a single conference day; every time is held
// as minutes from midnight so the engine can reason about overlap and ordering
// with plain integer math and no Date parsing in the hot path.

export type Session = {
  id: string;
  title: string;
  speaker: string;
  track: string;
  room: string;
  // Minutes from midnight at which the session starts, e.g. 540 == 09:00.
  startMin: number;
  durationMin: number;
  tags: string[];
  abstract: string;
};

// A session with its derived end time, used everywhere the UI needs a range.
export type PlacedSession = Session & { endMin: number };

// One row of the grouped agenda: a track and the sessions on it in time order.
export type TrackGroup = {
  track: string;
  sessions: PlacedSession[];
};

// A detected clash between two saved sessions whose time ranges overlap.
export type Conflict = {
  a: PlacedSession;
  b: PlacedSession;
  // Length of the overlap in minutes, always > 0 for a real conflict.
  overlapMin: number;
};

// Search and filter inputs the schedule view binds to.
export type ScheduleFilter = {
  query: string;
  track: string | 'all';
  tag: string | 'all';
};

// Where the provided current minute sits relative to the agenda.
export type NowNext = {
  nowMin: number;
  current: PlacedSession[];
  next: PlacedSession | null;
};
