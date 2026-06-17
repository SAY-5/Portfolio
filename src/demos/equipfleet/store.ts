// Browser-side store for equipfleet. Persists the asset list in localStorage
// and exposes CRUD + assignment + maintenance + retire actions. Seeded with
// sample fleet data on first load.

import type { Asset, AssetCategory, AssetStatus } from './types.ts';
import { canTransition, makeId, bumpMaintenance } from './engine.ts';

const STORAGE_KEY = 'equipfleet.assets.v1';

// Sample seed data for a construction/logistics fleet.
const SEED: Asset[] = [
  {
    id: 'EF-0001',
    name: 'Ford F-150 Pickup',
    category: 'vehicle',
    serial: 'VIN-F150-8827',
    status: 'available',
    assignee: null,
    location: 'Main Yard',
    nextMaintenance: '2026-06-15',
    createdAt: Date.now() - 86_400_000 * 30,
  },
  {
    id: 'EF-0002',
    name: 'CAT 320 Excavator',
    category: 'machinery',
    serial: 'CAT-320-4412',
    status: 'assigned',
    assignee: 'Jordan Kim',
    location: 'Site B',
    nextMaintenance: '2026-07-01',
    createdAt: Date.now() - 86_400_000 * 60,
  },
  {
    id: 'EF-0003',
    name: 'Hilti Rotary Hammer',
    category: 'tools',
    serial: 'HLT-TE70-9981',
    status: 'maintenance',
    assignee: null,
    location: 'Repair Shop',
    nextMaintenance: '2026-06-10',
    createdAt: Date.now() - 86_400_000 * 90,
  },
  {
    id: 'EF-0004',
    name: 'Dell Latitude 5540',
    category: 'electronics',
    serial: 'DL-5540-0073',
    status: 'assigned',
    assignee: 'Alex Chen',
    location: 'Office HQ',
    nextMaintenance: '2026-08-20',
    createdAt: Date.now() - 86_400_000 * 15,
  },
  {
    id: 'EF-0005',
    name: 'Komatsu WA320 Loader',
    category: 'machinery',
    serial: 'KOM-WA320-5567',
    status: 'available',
    assignee: null,
    location: 'Main Yard',
    nextMaintenance: '2026-06-12',
    createdAt: Date.now() - 86_400_000 * 120,
  },
  {
    id: 'EF-0006',
    name: 'MSA Hard Hat (10-pack)',
    category: 'safety',
    serial: 'MSA-HH-BATCH-44',
    status: 'retired',
    assignee: null,
    location: 'Storage',
    nextMaintenance: null,
    createdAt: Date.now() - 86_400_000 * 365,
  },
  {
    id: 'EF-0007',
    name: 'Toyota Hilux',
    category: 'vehicle',
    serial: 'VIN-HILUX-3301',
    status: 'assigned',
    assignee: 'Sam Rivera',
    location: 'Site A',
    nextMaintenance: '2026-06-25',
    createdAt: Date.now() - 86_400_000 * 45,
  },
  {
    id: 'EF-0008',
    name: 'Bosch Laser Level',
    category: 'tools',
    serial: 'BSH-GLL3-7788',
    status: 'available',
    assignee: null,
    location: 'Tool Crib',
    nextMaintenance: null,
    createdAt: Date.now() - 86_400_000 * 10,
  },
];

// ---- persistence ----

function readAssets(): Asset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Asset[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeAssets(assets: Asset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
  } catch {
    // storage unavailable; continue in-memory
  }
}

// ---- minimal external store ----

export type State = {
  assets: Asset[];
};

function loadState(): State {
  const persisted = readAssets();
  if (persisted.length > 0) return { assets: persisted };
  // First visit: seed and persist.
  writeAssets(SEED);
  return { assets: SEED };
}

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

// ---- CRUD ----

export function addAsset(fields: {
  name: string;
  category: AssetCategory;
  serial: string;
  location: string;
  nextMaintenance: string | null;
}): Asset {
  const asset: Asset = {
    id: makeId(),
    name: fields.name,
    category: fields.category,
    serial: fields.serial,
    status: 'available',
    assignee: null,
    location: fields.location,
    nextMaintenance: fields.nextMaintenance,
    createdAt: Date.now(),
  };
  const assets = [asset, ...state.assets];
  writeAssets(assets);
  set({ assets });
  return asset;
}

export function updateAsset(id: string, patch: Partial<Omit<Asset, 'id' | 'createdAt'>>): void {
  const assets = state.assets.map((a) => (a.id === id ? { ...a, ...patch } : a));
  writeAssets(assets);
  set({ assets });
}

export function removeAsset(id: string): void {
  const assets = state.assets.filter((a) => a.id !== id);
  writeAssets(assets);
  set({ assets });
}

// ---- domain actions ----

export function assignAsset(id: string, assignee: string): boolean {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset || !canTransition(asset.status, 'assigned')) return false;
  updateAsset(id, { status: 'assigned', assignee });
  return true;
}

export function unassignAsset(id: string): boolean {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset || asset.status !== 'assigned') return false;
  updateAsset(id, { status: 'available', assignee: null });
  return true;
}

export function completeMaintenance(id: string, daysForward = 90): boolean {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset || asset.status !== 'maintenance') return false;
  updateAsset(id, { status: 'available', nextMaintenance: bumpMaintenance(daysForward) });
  return true;
}

export function scheduleMaintenance(id: string): boolean {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset || !canTransition(asset.status, 'maintenance')) return false;
  updateAsset(id, {
    status: 'maintenance',
    assignee: null,
  });
  return true;
}

export function retireAsset(id: string): boolean {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset || !canTransition(asset.status, 'retired')) return false;
  updateAsset(id, { status: 'retired', assignee: null, nextMaintenance: null });
  return true;
}

// ---- transition helper for the UI ----

export function changeStatus(id: string, to: AssetStatus): boolean {
  switch (to) {
    case 'assigned':
      return false; // use assignAsset with an assignee name
    case 'available':
      return unassignAsset(id);
    case 'maintenance':
      return scheduleMaintenance(id);
    case 'retired':
      return retireAsset(id);
    default:
      return false;
  }
}

// ---- reset ----

export function resetAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  writeAssets(SEED);
  state = { assets: [...SEED] };
  emit();
}
