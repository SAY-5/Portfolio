// Core domain types for the equipfleet asset management app.

export type AssetStatus = 'available' | 'assigned' | 'maintenance' | 'retired';

export type AssetCategory =
  | 'vehicle'
  | 'machinery'
  | 'electronics'
  | 'tools'
  | 'safety'
  | 'other';

export type Asset = {
  id: string;
  name: string;
  category: AssetCategory;
  serial: string;
  status: AssetStatus;
  assignee: string | null;
  location: string;
  nextMaintenance: string | null; // ISO date string, e.g. "2026-07-01"
  createdAt: number; // epoch ms
};

export type StatusCount = Record<AssetStatus, number>;

export type SortField = 'name' | 'category' | 'status' | 'serial' | 'nextMaintenance';
export type SortDir = 'asc' | 'desc';
