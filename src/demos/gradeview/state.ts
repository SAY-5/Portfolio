// View-state store for the GradeView dashboard. This is the dashboard's own UI
// state (selected skill, focused learner, week range, drill-down target, active
// view), kept separate from the dataset and the aggregation helpers. The
// selected view persists in localStorage so a reload reopens the same slice.
// The pattern mirrors the other demos: a tiny framework-agnostic store exposed
// to React through useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { WEEKS, type SkillKey } from './data';
import { clampRange, type WeekRange } from './compute';

const KEY = 'gradeview.view.v1';

export type View = 'class' | 'learners' | 'skill';

export type ViewState = {
  view: View;
  skill: SkillKey;
  // the learner highlighted in the small multiples, or null for none
  focusLearner: number | null;
  // inclusive week range that cross-filters every panel
  range: WeekRange;
  // the skill opened in the drill-down, or null when no drill-down is open
  drillSkill: SkillKey | null;
};

const DEFAULTS: ViewState = {
  view: 'class',
  skill: 'word-problems',
  focusLearner: null,
  range: [8, 14],
  drillSkill: null,
};

// Only a safe subset is persisted; bad or stale values fall back to defaults.
function load(): ViewState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    const range = Array.isArray(parsed.range)
      ? clampRange([Number(parsed.range[0]), Number(parsed.range[1])])
      : DEFAULTS.range;
    return {
      view: parsed.view === 'learners' || parsed.view === 'skill' ? parsed.view : 'class',
      skill: typeof parsed.skill === 'string' ? (parsed.skill as SkillKey) : DEFAULTS.skill,
      focusLearner:
        typeof parsed.focusLearner === 'number' ? parsed.focusLearner : DEFAULTS.focusLearner,
      range,
      drillSkill: typeof parsed.drillSkill === 'string' ? (parsed.drillSkill as SkillKey) : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: ViewState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode); the dashboard still works.
  }
}

let state: ViewState = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<ViewState>): void {
  state = { ...state, ...next };
  save(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): ViewState {
  return state;
}

export function useViewState(): ViewState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------- actions ----------

export function setView(view: View): void {
  set({ view });
}

export function setSkill(skill: SkillKey): void {
  set({ skill });
}

export function setFocusLearner(id: number | null): void {
  set({ focusLearner: id });
}

export function setRange(range: WeekRange): void {
  set({ range: clampRange(range) });
}

// Nudge one end of the range by a week, keeping start <= end and in bounds.
export function nudgeRange(end: 'start' | 'finish', dir: -1 | 1): void {
  const [a, b] = state.range;
  if (end === 'start') {
    set({ range: clampRange([Math.min(b, a + dir), b]) });
  } else {
    set({ range: clampRange([a, Math.max(a, b + dir)]) });
  }
}

// Open the drill-down on a skill, switching to the skill view.
export function openDrill(skill: SkillKey): void {
  set({ view: 'skill', skill, drillSkill: skill });
}

export function closeDrill(): void {
  set({ drillSkill: null });
}

// Reset every view choice back to the defaults and clear what was persisted.
export function resetView(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  state = { ...DEFAULTS };
  emit();
}

export const FULL_RANGE: WeekRange = [0, WEEKS - 1];
