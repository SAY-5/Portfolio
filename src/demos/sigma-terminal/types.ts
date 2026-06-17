// Shared types for the in-browser Sigma Terminal. Every value here is derived
// from a deterministic seeded series, so the same instrument always produces
// the same chart and statistics across reloads and across server/client render.

// A single OHLC bar in an instrument's price series.
export type Bar = {
  o: number;
  h: number;
  l: number;
  c: number;
};

// A static instrument definition. The price series is generated from `seed`
// and `base` by the engine, never stored, so it stays deterministic.
export type Instrument = {
  ticker: string;
  name: string;
  seed: number;
  base: number;
  vol: number;
};

// Direction of a price alert relative to its threshold.
export type AlertDirection = 'above' | 'below';

// A user-defined price alert on one instrument. `id` is assigned by the store.
export type Alert = {
  id: string;
  ticker: string;
  direction: AlertDirection;
  threshold: number;
};

// An alert that has fired against the current price, returned by evaluation.
export type TriggeredAlert = {
  alert: Alert;
  price: number;
  at: number;
};

// Summary statistics computed over an instrument's current series.
export type Quote = {
  ticker: string;
  last: number;
  prevClose: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
