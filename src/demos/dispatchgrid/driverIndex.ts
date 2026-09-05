import { haversineMeters } from './geo.ts';

// In-memory port of common/redis/RedisDriverIndex. Per city: one searchable
// set of available drivers (the GEO set), one heartbeat record per driver with
// a TTL, and one claim key per driver. Each operation mirrors one Lua script,
// so claim, stale detection, and set membership never race with each other.
export type ClaimResult = 'CLAIMED' | 'TAKEN' | 'STALE';

export interface NearbyDriver {
  driverId: string;
  distanceMeters: number;
}

export interface DriverPosition {
  driverId: string;
  cityId: number;
  lat: number;
  lng: number;
  reportedAt: number;
}

interface Heartbeat {
  lat: number;
  lng: number;
  expiresAt: number;
}

interface Claim {
  rideId: string;
  expiresAt: number;
}

interface CityIndex {
  geo: Set<string>;
  heartbeats: Map<string, Heartbeat>;
  claims: Map<string, Claim>;
  // GEOSEARCH replies read at the start of a poll batch. Handlers in the same
  // batch search this view and then race through the claim script, which is
  // the situation the atomic SET NX claim exists for.
  searchView: Set<string> | null;
}

export interface DriverView {
  driverId: string;
  lat: number;
  lng: number;
  available: boolean;
  rideId: string | null;
}

export class MemoryDriverIndex {
  private readonly cities = new Map<number, CityIndex>();
  readonly ops = { geoadd: 0, geosearch: 0, claim: 0 };

  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  private city(cityId: number): CityIndex {
    let c = this.cities.get(cityId);
    if (!c) {
      c = { geo: new Set(), heartbeats: new Map(), claims: new Map(), searchView: null };
      this.cities.set(cityId, c);
    }
    return c;
  }

  private liveClaim(c: CityIndex, driverId: string, now: number): Claim | undefined {
    const claim = c.claims.get(driverId);
    if (!claim) return undefined;
    if (claim.expiresAt <= now) {
      c.claims.delete(driverId);
      return undefined;
    }
    return claim;
  }

  private liveHeartbeat(c: CityIndex, driverId: string, now: number): Heartbeat | undefined {
    const hb = c.heartbeats.get(driverId);
    if (!hb) return undefined;
    if (hb.expiresAt <= now) {
      c.heartbeats.delete(driverId);
      return undefined;
    }
    return hb;
  }

  beginBatch(): void {
    for (const c of this.cities.values()) c.searchView = new Set(c.geo);
  }

  endBatch(): void {
    for (const c of this.cities.values()) c.searchView = null;
  }

  // UPSERT_LUA: heartbeat + TTL; a claimed driver keeps its heartbeat but
  // stays out of the searchable set until the claim expires or is released.
  upsert(p: DriverPosition, heartbeatTtlMs: number): void {
    const now = this.clock();
    const c = this.city(p.cityId);
    c.heartbeats.set(p.driverId, { lat: p.lat, lng: p.lng, expiresAt: now + heartbeatTtlMs });
    if (this.liveClaim(c, p.driverId, now)) {
      c.geo.delete(p.driverId);
      return;
    }
    c.geo.add(p.driverId);
    this.ops.geoadd++;
  }

  // GEOSEARCH ... BYRADIUS ... ASC COUNT limit WITHDIST
  nearby(cityId: number, lat: number, lng: number, radiusMeters: number, limit: number): NearbyDriver[] {
    this.ops.geosearch++;
    const c = this.city(cityId);
    const hits: NearbyDriver[] = [];
    for (const driverId of c.searchView ?? c.geo) {
      const hb = c.heartbeats.get(driverId);
      if (!hb) continue;
      const d = haversineMeters(lat, lng, hb.lat, hb.lng);
      if (d <= radiusMeters) hits.push({ driverId, distanceMeters: d });
    }
    hits.sort((a, b) => a.distanceMeters - b.distanceMeters || (a.driverId < b.driverId ? -1 : 1));
    return hits.slice(0, limit);
  }

  // CLAIM_LUA: stale heartbeat -> STALE, SET NX PX -> CLAIMED, else TAKEN.
  // A win removes the driver from the GEO set in the same script.
  claim(cityId: number, driverId: string, rideId: string, claimTtlMs: number): ClaimResult {
    this.ops.claim++;
    const now = this.clock();
    const c = this.city(cityId);
    if (!this.liveHeartbeat(c, driverId, now)) {
      c.geo.delete(driverId);
      c.claims.delete(driverId);
      return 'STALE';
    }
    if (!this.liveClaim(c, driverId, now)) {
      c.claims.set(driverId, { rideId, expiresAt: now + claimTtlMs });
      c.geo.delete(driverId);
      return 'CLAIMED';
    }
    return 'TAKEN';
  }

  // RELEASE_LUA: only the owning ride can release; the driver goes back at its
  // last heartbeat position.
  release(cityId: number, driverId: string, rideId: string): boolean {
    const now = this.clock();
    const c = this.city(cityId);
    const claim = this.liveClaim(c, driverId, now);
    if (claim && claim.rideId === rideId) {
      c.claims.delete(driverId);
      if (this.liveHeartbeat(c, driverId, now)) c.geo.add(driverId);
      return true;
    }
    return false;
  }

  size(cityId: number): number {
    return this.city(cityId).geo.size;
  }

  drivers(cityId: number): DriverView[] {
    const now = this.clock();
    const c = this.city(cityId);
    const out: DriverView[] = [];
    for (const [driverId, hb] of c.heartbeats) {
      if (hb.expiresAt <= now) continue;
      const claim = this.liveClaim(c, driverId, now);
      out.push({ driverId, lat: hb.lat, lng: hb.lng, available: c.geo.has(driverId), rideId: claim?.rideId ?? null });
    }
    return out;
  }
}
