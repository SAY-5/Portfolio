// Seed traces. These are read-only sample data: three end-to-end request traces
// modelled on a typical web request fanning out across services. Offsets and
// durations are fixed integers so every derived view is deterministic.

import type { Trace } from './types';

export const SERVICES = [
  'gateway',
  'auth',
  'orders',
  'inventory',
  'payments',
  'db',
  'cache',
  'email',
] as const;

export const traces: Trace[] = [
  {
    id: 'checkout',
    name: 'POST /checkout',
    spans: [
      { id: 'c0', name: 'POST /checkout', service: 'gateway', parentId: null, startMs: 0, durationMs: 300, status: 'ok' },
      { id: 'c1', name: 'verify session', service: 'auth', parentId: 'c0', startMs: 4, durationMs: 22, status: 'ok' },
      { id: 'c2', name: 'auth cache lookup', service: 'cache', parentId: 'c1', startMs: 6, durationMs: 3, status: 'ok' },
      { id: 'c3', name: 'create order', service: 'orders', parentId: 'c0', startMs: 28, durationMs: 264, status: 'ok' },
      { id: 'c4', name: 'reserve stock', service: 'inventory', parentId: 'c3', startMs: 34, durationMs: 64, status: 'ok' },
      { id: 'c5', name: 'inventory query', service: 'db', parentId: 'c4', startMs: 40, durationMs: 52, status: 'ok' },
      { id: 'c6', name: 'charge card', service: 'payments', parentId: 'c3', startMs: 104, durationMs: 188, status: 'ok' },
      { id: 'c7', name: 'payments ledger write', service: 'db', parentId: 'c6', startMs: 116, durationMs: 170, status: 'ok' },
      { id: 'c8', name: 'send receipt', service: 'email', parentId: 'c0', startMs: 12, durationMs: 10, status: 'ok' },
    ],
  },
  {
    id: 'search',
    name: 'GET /search',
    spans: [
      { id: 's0', name: 'GET /search', service: 'gateway', parentId: null, startMs: 0, durationMs: 96, status: 'ok' },
      { id: 's1', name: 'verify token', service: 'auth', parentId: 's0', startMs: 3, durationMs: 14, status: 'ok' },
      { id: 's2', name: 'query catalog', service: 'orders', parentId: 's0', startMs: 20, durationMs: 70, status: 'ok' },
      { id: 's3', name: 'catalog cache miss', service: 'cache', parentId: 's2', startMs: 22, durationMs: 4, status: 'ok' },
      { id: 's4', name: 'catalog db read', service: 'db', parentId: 's2', startMs: 28, durationMs: 58, status: 'ok' },
    ],
  },
  {
    id: 'refund',
    name: 'POST /refund',
    spans: [
      { id: 'r0', name: 'POST /refund', service: 'gateway', parentId: null, startMs: 0, durationMs: 242, status: 'error' },
      { id: 'r1', name: 'verify session', service: 'auth', parentId: 'r0', startMs: 4, durationMs: 18, status: 'ok' },
      { id: 'r2', name: 'load order', service: 'orders', parentId: 'r0', startMs: 26, durationMs: 40, status: 'ok' },
      { id: 'r3', name: 'order lookup', service: 'db', parentId: 'r2', startMs: 30, durationMs: 30, status: 'ok' },
      { id: 'r4', name: 'reverse charge', service: 'payments', parentId: 'r0', startMs: 70, durationMs: 168, status: 'error' },
      { id: 'r5', name: 'gateway timeout', service: 'db', parentId: 'r4', startMs: 80, durationMs: 150, status: 'error' },
    ],
  },
];
