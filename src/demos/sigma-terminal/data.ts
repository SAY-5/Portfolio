// Instrument seed for the in-browser Sigma Terminal. In the real terminal these
// quotes stream over a market-data WebSocket; here each instrument carries a
// fixed seed and base price so the engine can synthesise a stable price series
// fully in the browser with no network. None of these are electric-vehicle
// makers; they are large-cap technology, financial, and consumer names.

import type { Instrument } from './types';

export const CURRENCY = 'USD';

// The full universe a user can add to a watchlist. `vol` scales the per-tick
// move so higher-beta names swing wider while staying deterministic.
export const universe: Instrument[] = [
  { ticker: 'NVDA', name: 'NVIDIA Corp', seed: 1031, base: 121.6, vol: 2.6 },
  { ticker: 'AAPL', name: 'Apple Inc', seed: 2087, base: 188.4, vol: 1.7 },
  { ticker: 'MSFT', name: 'Microsoft Corp', seed: 3119, base: 415.2, vol: 1.9 },
  { ticker: 'AMZN', name: 'Amazon.com Inc', seed: 4127, base: 178.9, vol: 2.1 },
  { ticker: 'GOOGL', name: 'Alphabet Inc', seed: 5153, base: 164.3, vol: 1.8 },
  { ticker: 'AMD', name: 'Advanced Micro Devices', seed: 6173, base: 142.7, vol: 2.4 },
  { ticker: 'JPM', name: 'JPMorgan Chase', seed: 7193, base: 201.5, vol: 1.4 },
  { ticker: 'KO', name: 'Coca-Cola Co', seed: 8219, base: 62.8, vol: 0.9 },
  { ticker: 'META', name: 'Meta Platforms', seed: 9241, base: 512.4, vol: 2.2 },
  { ticker: 'NFLX', name: 'Netflix Inc', seed: 10267, base: 678.1, vol: 2.8 },
  { ticker: 'INTC', name: 'Intel Corp', seed: 11287, base: 31.2, vol: 1.1 },
  { ticker: 'ORCL', name: 'Oracle Corp', seed: 12301, base: 138.6, vol: 1.6 },
];

// The watchlist a fresh session starts with: eight non-EV large caps.
export const defaultWatchlist: string[] = [
  'NVDA',
  'AAPL',
  'MSFT',
  'AMZN',
  'GOOGL',
  'AMD',
  'JPM',
  'KO',
];

const byTicker = new Map(universe.map((i) => [i.ticker, i]));

export function findInstrument(ticker: string): Instrument | undefined {
  return byTicker.get(ticker);
}
