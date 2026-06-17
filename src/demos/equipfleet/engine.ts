// Pure functions for filtering, searching, sorting, maintenance scheduling,
// status transitions, and utilization summaries. No side effects, no eval.

import type { Asset, AssetStatus, SortField, SortDir, StatusCount } from './types.ts';

// Valid transitions: retired assets cannot be assigned or put back in service.
const ALLOWED_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  available: ['assigned', 'maintenance', 'retired'],
  assigned: ['available', 'maintenance', 'retired'],
  maintenance: ['available', 'retired'],
  retired: [],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function filterByStatus(assets: Asset[], status: AssetStatus | 'all'): Asset[] {
  if (status === 'all') return assets;
  return assets.filter((a) => a.status === status);
}

export function filterByCategory(assets: Asset[], category: string | 'all'): Asset[] {
  if (category === 'all') return assets;
  return assets.filter((a) => a.category === category);
}

export function searchAssets(assets: Asset[], query: string): Asset[] {
  const q = query.trim().toLowerCase();
  if (!q) return assets;
  return assets.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.serial.toLowerCase().includes(q) ||
      (a.assignee && a.assignee.toLowerCase().includes(q)) ||
      a.location.toLowerCase().includes(q),
  );
}

export function sortAssets(assets: Asset[], field: SortField, dir: SortDir): Asset[] {
  const sorted = [...assets];
  const mul = dir === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  });
  return sorted;
}

// Assets whose next maintenance date is on or before today.
export function maintenanceDue(assets: Asset[], today?: string): Asset[] {
  const d = today ?? new Date().toISOString().slice(0, 10);
  return assets.filter(
    (a) => a.nextMaintenance !== null && a.status !== 'retired' && a.nextMaintenance <= d,
  );
}

// Count of assets per status bucket.
export function statusSummary(assets: Asset[]): StatusCount {
  const counts: StatusCount = { available: 0, assigned: 0, maintenance: 0, retired: 0 };
  for (const a of assets) {
    counts[a.status]++;
  }
  return counts;
}

// Bump next maintenance forward by a given number of days from today.
export function bumpMaintenance(daysForward: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysForward);
  return d.toISOString().slice(0, 10);
}

// Generate a short unique id for new assets.
export function makeId(): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `EF-${n}`;
}
