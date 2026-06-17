// Framework-agnostic store for the Sigma Terminal. It owns the watchlist, the
// per-instrument tick count, the price alerts, and the list of alerts that have
// fired. Watchlist, tick counts, and alerts persist in localStorage so a reload
// restores the session. The price series itself is never stored: it is rebuilt
// deterministically from each instrument seed and its tick count, so state stays
// small and reproducible. Nothing here talks to a network.

import { defaultWatchlist, findInstrument, universe } from './data';
import {
  BASE_BARS,
  buildSeries,
  evaluateAlerts,
  quoteFromSeries,
} from './engine';
import type { Alert, AlertDirection, Bar, Quote, TriggeredAlert } from './types';

const WATCH_KEY = 'sigma.watchlist.v1';
const ALERTS_KEY = 'sigma.alerts.v1';
const TICKS_KEY = 'sigma.ticks.v1';

export type State = {
  // Tickers on the watchlist, in display order.
  watchlist: string[];
  // The currently selected instrument shown in the detail panel.
  selected: string;
  // Extra deterministic ticks applied per instrument beyond the base series.
  ticks: Record<string, number>;
  // User-defined price alerts.
  alerts: Alert[];
  // Alerts that fired on the most recent advance, newest first.
  triggered: TriggeredAlert[];
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
  const watchlist = readJSON<string[]>(WATCH_KEY, defaultWatchlist).filter(
    (t) => findInstrument(t),
  );
  const list = watchlist.length > 0 ? watchlist : [...defaultWatchlist];
  return {
    watchlist: list,
    selected: list[0] ?? universe[0].ticker,
    ticks: readJSON<Record<string, number>>(TICKS_KEY, {}),
    alerts: readJSON<Alert[]>(ALERTS_KEY, []),
    triggered: [],
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

// ---------- derived series ----------

// Rebuild an instrument series deterministically from its seed and tick count.
// Memoised on (ticker, tickCount) so repeated reads in one render are cheap and
// the result is stable.
const seriesCache = new Map<string, Bar[]>();

export function seriesFor(ticker: string): Bar[] {
  const inst = findInstrument(ticker);
  if (!inst) return [];
  const extra = Math.max(0, state.ticks[ticker] ?? 0);
  const count = BASE_BARS + extra;
  const cacheKey = `${ticker}:${count}`;
  const hit = seriesCache.get(cacheKey);
  if (hit) return hit;
  const built = buildSeries(inst, count);
  seriesCache.set(cacheKey, built);
  return built;
}

export function quoteFor(ticker: string): Quote {
  return quoteFromSeries(ticker, seriesFor(ticker));
}

export function lastPriceOf(ticker: string): number {
  const series = seriesFor(ticker);
  return series.length ? series[series.length - 1].c : 0;
}

// ---------- watchlist actions ----------

export function addTicker(ticker: string): void {
  if (!findInstrument(ticker)) return;
  if (state.watchlist.includes(ticker)) {
    set({ selected: ticker });
    return;
  }
  const watchlist = [...state.watchlist, ticker];
  writeJSON(WATCH_KEY, watchlist);
  set({ watchlist, selected: ticker });
}

export function removeTicker(ticker: string): void {
  const watchlist = state.watchlist.filter((t) => t !== ticker);
  writeJSON(WATCH_KEY, watchlist);
  const selected =
    state.selected === ticker ? (watchlist[0] ?? '') : state.selected;
  set({ watchlist, selected });
}

export function selectTicker(ticker: string): void {
  if (!findInstrument(ticker)) return;
  set({ selected: ticker });
}

// ---------- alert actions ----------

let alertCounter = 0;

function makeAlertId(): string {
  alertCounter += 1;
  return `al-${alertCounter}-${state.alerts.length}`;
}

export function addAlert(
  ticker: string,
  direction: AlertDirection,
  threshold: number,
): void {
  if (!findInstrument(ticker)) return;
  if (!Number.isFinite(threshold) || threshold <= 0) return;
  const alert: Alert = {
    id: makeAlertId(),
    ticker,
    direction,
    threshold: Math.round(threshold * 100) / 100,
  };
  const alerts = [...state.alerts, alert];
  writeJSON(ALERTS_KEY, alerts);
  set({ alerts });
}

export function removeAlert(id: string): void {
  const alerts = state.alerts.filter((a) => a.id !== id);
  writeJSON(ALERTS_KEY, alerts);
  set({ alerts });
}

// ---------- ticking ----------

// Advance one instrument's series by a single deterministic bar, then
// re-evaluate every alert against the new prices. `now` is supplied by the
// caller so the store never reads the clock during render.
export function step(ticker: string, now: number): void {
  if (!findInstrument(ticker)) return;
  const ticks = { ...state.ticks, [ticker]: (state.ticks[ticker] ?? 0) + 1 };
  writeJSON(TICKS_KEY, ticks);
  state = { ...state, ticks };
  const fired = evaluateAlerts(state.alerts, lastPriceOf, now);
  set({ triggered: fired });
}

// Advance every watchlist instrument one bar, then re-evaluate alerts once.
export function stepAll(now: number): void {
  const ticks = { ...state.ticks };
  for (const t of state.watchlist) {
    ticks[t] = (ticks[t] ?? 0) + 1;
  }
  writeJSON(TICKS_KEY, ticks);
  state = { ...state, ticks };
  const fired = evaluateAlerts(state.alerts, lastPriceOf, now);
  set({ triggered: fired });
}

export function clearTriggered(): void {
  set({ triggered: [] });
}

// Wipe persisted watchlist, alerts, and tick counts and reset the runtime.
export function resetAll(): void {
  try {
    localStorage.removeItem(WATCH_KEY);
    localStorage.removeItem(ALERTS_KEY);
    localStorage.removeItem(TICKS_KEY);
  } catch {
    // ignore storage errors
  }
  seriesCache.clear();
  const list = [...defaultWatchlist];
  state = {
    watchlist: list,
    selected: list[0],
    ticks: {},
    alerts: [],
    triggered: [],
  };
  emit();
}
