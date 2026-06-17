// The seeded in-memory dataset the QueryFlow engine queries. It is a single
// orders table with typed columns, built deterministically so the same
// rows appear on every load (no Math.random, no clock). The generator is a
// small linear-congruential sequence, which keeps the data varied but stable
// for reproducible query results.

import type { Column, Row, Table } from './types';

export const ORDER_COLUMNS: Column[] = [
  { name: 'id', type: 'number', label: 'id' },
  { name: 'customer', type: 'string', label: 'customer' },
  { name: 'region', type: 'string', label: 'region' },
  { name: 'channel', type: 'string', label: 'channel' },
  { name: 'status', type: 'string', label: 'status' },
  { name: 'total', type: 'number', label: 'total' },
  { name: 'items', type: 'number', label: 'items' },
  { name: 'placed_on', type: 'date', label: 'placed_on' },
  { name: 'expedited', type: 'boolean', label: 'expedited' },
];

const CUSTOMERS = [
  'Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Soylent',
  'Hooli', 'Stark Industries', 'Wayne Enterprises', 'Wonka', 'Tyrell',
];
const REGIONS = ['north', 'south', 'east', 'west'];
const CHANNELS = ['web', 'mobile', 'partner', 'phone'];
const STATUSES = ['paid', 'pending', 'shipped', 'refunded', 'cancelled'];

// A deterministic pseudo-random sequence: stable across loads, no global state.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // Numerical Recipes LCG constants.
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Build a date string offset back from a fixed anchor date. The dataset is
// historical and fixed, so the anchor is a constant, not "now".
const ANCHOR = Date.UTC(2024, 11, 31); // 2024-12-31
const DAY_MS = 86_400_000;

function dateBack(days: number): string {
  const d = new Date(ANCHOR - days * DAY_MS);
  return d.toISOString().slice(0, 10);
}

function buildRows(count: number): Row[] {
  const rng = makeRng(0x5eed42);
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const status = pick(rng, STATUSES);
    const items = 1 + Math.floor(rng() * 8);
    // Total scales loosely with item count plus a per-item spread.
    const total = Math.round((items * (18 + rng() * 90) + rng() * 40) * 100) / 100;
    rows.push({
      id: 1000 + i,
      customer: pick(rng, CUSTOMERS),
      region: pick(rng, REGIONS),
      channel: pick(rng, CHANNELS),
      status,
      total,
      items,
      placed_on: dateBack(Math.floor(rng() * 364)),
      expedited: rng() < 0.28,
    });
  }
  return rows;
}

export const ordersTable: Table = {
  name: 'orders',
  columns: ORDER_COLUMNS,
  rows: buildRows(240),
};

export function columnByName(table: Table, name: string): Column | undefined {
  return table.columns.find((c) => c.name === name);
}
