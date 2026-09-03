// In-memory port of the DynamoDB driver_positions table from
// services/driver_location: partition key = geohash cell of the position,
// sort key = driver id, a ttl attribute refreshed on every ping, and a
// read-side filter that drops expired items before DynamoDB reclaims them.
// The claim is the dispatch service's conditional update: it succeeds only if
// the item is still `available`, so two matchers cannot both take a driver.

import { encode, cellsCovering } from './geohash';

export type DriverStatus = 'available' | 'busy';

export interface DriverItem {
  driverId: string;
  cell: string;
  lat: number;
  lng: number;
  status: DriverStatus;
  tripId: string | null;
  updatedAt: number;
  ttl: number;
}

export interface Nearby {
  driverId: string;
  distanceM: number;
}

export type ClaimResult = 'ok' | 'ConditionalCheckFailed' | 'expired';

const EARTH_R = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export class DriverTable {
  readonly precision: number;
  readonly ttlMs: number;
  private readonly cells = new Map<string, Map<string, DriverItem>>();
  private readonly byDriver = new Map<string, DriverItem>();
  readonly ops = { put: 0, query: 0, claimOk: 0, claimFailed: 0, expiredSkipped: 0 };

  constructor(precision: number, ttlMs: number) {
    this.precision = precision;
    this.ttlMs = ttlMs;
  }

  // POST /drivers/{id}/position: upsert the cell item, refresh ttl, keep status.
  put(driverId: string, lat: number, lng: number, now: number): DriverItem {
    this.ops.put++;
    const cell = encode(lat, lng, this.precision);
    const prev = this.byDriver.get(driverId);
    if (prev && prev.cell !== cell) this.cells.get(prev.cell)?.delete(driverId);
    const item: DriverItem = {
      driverId,
      cell,
      lat,
      lng,
      status: prev?.status ?? 'available',
      tripId: prev?.tripId ?? null,
      updatedAt: now,
      ttl: now + this.ttlMs,
    };
    let bucket = this.cells.get(cell);
    if (!bucket) {
      bucket = new Map();
      this.cells.set(cell, bucket);
    }
    bucket.set(driverId, item);
    this.byDriver.set(driverId, item);
    return item;
  }

  get(driverId: string): DriverItem | undefined {
    return this.byDriver.get(driverId);
  }

  // The read-side expiry filter: an item past its ttl is invisible even if
  // the table has not reclaimed it yet.
  visible(item: DriverItem, now: number): boolean {
    return item.ttl > now;
  }

  // Cells whose box overlaps the radius around a point.
  cellsFor(lat: number, lng: number, radiusM: number): string[] {
    const dLat = (radiusM / EARTH_R) * (180 / Math.PI);
    const dLng = dLat / Math.cos(toRad(lat));
    return cellsCovering(
      { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng },
      this.precision,
    );
  }

  // GET /drivers/nearby: query each covering cell, filter expired, keep
  // available, sort nearest first.
  nearby(lat: number, lng: number, radiusM: number, now: number, limit: number): Nearby[] {
    this.ops.query++;
    const hits: Nearby[] = [];
    for (const cell of this.cellsFor(lat, lng, radiusM)) {
      const bucket = this.cells.get(cell);
      if (!bucket) continue;
      for (const item of bucket.values()) {
        if (!this.visible(item, now)) {
          this.ops.expiredSkipped++;
          continue;
        }
        if (item.status !== 'available') continue;
        const d = haversineM(lat, lng, item.lat, item.lng);
        if (d <= radiusM) hits.push({ driverId: item.driverId, distanceM: d });
      }
    }
    hits.sort((a, b) => a.distanceM - b.distanceM || (a.driverId < b.driverId ? -1 : 1));
    return hits.slice(0, limit);
  }

  // UpdateItem with ConditionExpression "status = :available".
  claim(driverId: string, tripId: string, now: number): ClaimResult {
    const item = this.byDriver.get(driverId);
    if (!item || !this.visible(item, now)) return 'expired';
    if (item.status !== 'available') {
      this.ops.claimFailed++;
      return 'ConditionalCheckFailed';
    }
    item.status = 'busy';
    item.tripId = tripId;
    this.ops.claimOk++;
    return 'ok';
  }

  // PUT /drivers/{id}/status?status=available after the trip completes.
  release(driverId: string): void {
    const item = this.byDriver.get(driverId);
    if (!item) return;
    item.status = 'available';
    item.tripId = null;
  }
}
