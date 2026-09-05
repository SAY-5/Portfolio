// The whole rideloop stack in one deterministic engine on a simulated clock:
// the fleet pings driver_location once a second, riders post trips, and the
// dispatch sweep matches requested trips to the nearest available driver
// inside an expanding radius, claiming each candidate with the conditional
// update from index.ts. Every figure the demo shows is read back from this
// state the way the real summary reads PostgreSQL and the stats endpoint.

import { DriverTable, haversineM, type ClaimResult } from './index';
import { encode } from './geohash';
import { mulberry32, gaussian, type Rng } from './prng';

export const CITY_CENTER = { lat: 37.7749, lng: -122.4194 };
export const CITY_HALF_M = 4000;
export const CELL_PRECISION = 5;
export const TTL_MS = 20_000;
export const RADII_M = [500, 1000, 2000, 4000];
export const RETRY_DELAY_MS = 1000;
export const SWEEP_MS = 100;
export const LOAD_RIDES = 600;
export const LOAD_RATE_PER_S = 10;
export const MANUAL_STEP_MS = 700;

const EARTH_R = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface Local {
  north: number;
  east: number;
}

export function toLatLng(p: Local): { lat: number; lng: number } {
  return {
    lat: CITY_CENTER.lat + toDeg(p.north / EARTH_R),
    lng: CITY_CENTER.lng + toDeg(p.east / (EARTH_R * Math.cos(toRad(CITY_CENTER.lat)))),
  };
}

export function toLocal(lat: number, lng: number): Local {
  return {
    north: toRad(lat - CITY_CENTER.lat) * EARTH_R,
    east: toRad(lng - CITY_CENTER.lng) * EARTH_R * Math.cos(toRad(CITY_CENTER.lat)),
  };
}

export interface Driver {
  id: string;
  pos: Local;
  heading: number;
  silent: boolean;
  lastPingAt: number;
  target: Local | null;
  tripId: string | null;
}

export type TripStatus = 'requested' | 'matched' | 'en_route' | 'completed';

export interface TraceStep {
  radiusM: number;
  cells: string[];
  candidates: number;
  claims: { driverId: string; distanceM: number; result: ClaimResult }[];
}

export interface Trip {
  id: string;
  pickup: Local;
  dropoff: Local;
  status: TripStatus;
  driverId: string | null;
  requestedAt: number;
  matchedAt: number | null;
  latencyMs: number | null;
  attempts: number;
  nextAttemptAt: number;
  manual: boolean;
  stepIdx: number;
  nextStepAt: number;
  trace: TraceStep[];
  completeAt: number | null;
  pausedMs: number;
}

export interface Snapshot {
  now: number;
  drivers: {
    id: string;
    pos: Local;
    status: 'available' | 'busy' | 'expired' | 'stale';
    silent: boolean;
    cell: string;
  }[];
  trips: Trip[];
  manual: Trip | null;
  load: {
    running: boolean;
    submitted: number;
    matched: number;
    completed: number;
    pending: number;
    firstRequestAt: number | null;
    lastMatchAt: number | null;
    matchesPerMinute: number;
    p50: number;
    p95: number;
    sweeps: number;
  };
  claims: { ok: number; failed: number; expiredSkipped: number; puts: number; queries: number };
  silent: {
    driverId: string;
    lastPingAt: number;
    ttlAt: number;
    visible: boolean;
  } | null;
}

function lognormal(rnd: Rng, median: number, sigma: number): number {
  return median * Math.exp(sigma * gaussian(rnd));
}

export class Engine {
  readonly table = new DriverTable(CELL_PRECISION, TTL_MS);
  readonly drivers: Driver[] = [];
  readonly trips: Trip[] = [];
  private readonly rnd: Rng;
  private now = 0;
  private nextPingAt = 0;
  private nextSweepAt = 0;
  private nextRideAt = Infinity;
  private ridesLeft = 0;
  private tripSeq = 0;
  private sweeps = 0;
  private silentId: string | null = null;
  private readonly latencies: number[] = [];
  private firstRequestAt: number | null = null;
  private lastMatchAt: number | null = null;
  private loadMatched = 0;
  private loadCompleted = 0;
  private loadSubmitted = 0;

  constructor(seed: number, fleet: number) {
    this.rnd = mulberry32(seed);
    for (let i = 0; i < fleet; i++) {
      const r = CITY_HALF_M * 0.92 * Math.sqrt(this.rnd());
      const a = this.rnd() * 2 * Math.PI;
      this.drivers.push({
        id: `drv-${String(i).padStart(3, '0')}`,
        pos: { north: r * Math.cos(a), east: r * Math.sin(a) },
        heading: this.rnd() * 2 * Math.PI,
        silent: false,
        lastPingAt: 0,
        target: null,
        tripId: null,
      });
    }
    for (const d of this.drivers) this.ping(d);
  }

  get time(): number {
    return this.now;
  }

  private ping(d: Driver): void {
    const { lat, lng } = toLatLng(d.pos);
    this.table.put(d.id, lat, lng, this.now);
    d.lastPingAt = this.now;
  }

  // Stop one available driver's pings so its item ages past the ttl.
  silence(): string | null {
    if (this.silentId) return this.silentId;
    const pick = this.drivers.find((d) => !d.tripId && Math.hypot(d.pos.north, d.pos.east) < CITY_HALF_M * 0.6);
    if (!pick) return null;
    pick.silent = true;
    this.silentId = pick.id;
    return pick.id;
  }

  resume(): void {
    const d = this.drivers.find((x) => x.id === this.silentId);
    if (d) {
      d.silent = false;
      this.ping(d);
    }
    this.silentId = null;
  }

  private newTrip(pickup: Local, dropoff: Local, manual: boolean): Trip {
    const trip: Trip = {
      id: `trip-${(this.tripSeq++).toString(36).padStart(3, '0')}`,
      pickup,
      dropoff,
      status: 'requested',
      driverId: null,
      requestedAt: this.now,
      matchedAt: null,
      latencyMs: null,
      attempts: 0,
      nextAttemptAt: this.now,
      manual,
      stepIdx: 0,
      nextStepAt: this.now,
      trace: [],
      completeAt: null,
      pausedMs: 0,
    };
    this.trips.push(trip);
    return trip;
  }

  // POST /rides from the map: pickup where the user clicked.
  requestRide(pickup: Local): Trip {
    const a = this.rnd() * 2 * Math.PI;
    const dropoff = {
      north: Math.max(-CITY_HALF_M, Math.min(CITY_HALF_M, pickup.north + 1500 * Math.cos(a))),
      east: Math.max(-CITY_HALF_M, Math.min(CITY_HALF_M, pickup.east + 1500 * Math.sin(a))),
    };
    return this.newTrip(pickup, dropoff, true);
  }

  // Rides start on the next sweep boundary so the first request is not
  // charged a partial poll interval that the rest of the run never sees.
  startLoad(): void {
    this.ridesLeft = LOAD_RIDES;
    this.nextRideAt = this.nextSweepAt;
  }

  get loadRunning(): boolean {
    return this.ridesLeft > 0 || this.trips.some((t) => !t.manual && t.status !== 'completed');
  }

  private randomPoint(): Local {
    const r = CITY_HALF_M * 0.85 * Math.sqrt(this.rnd());
    const a = this.rnd() * 2 * Math.PI;
    return { north: r * Math.cos(a), east: r * Math.sin(a) };
  }

  private submitLoadRide(): void {
    const t = this.newTrip(this.randomPoint(), this.randomPoint(), false);
    if (this.firstRequestAt === null) this.firstRequestAt = t.requestedAt;
    this.loadSubmitted++;
  }

  // One radius step of the matcher for a trip. Returns true when matched.
  private matchStep(trip: Trip, radiusM: number): boolean {
    const { lat, lng } = toLatLng(trip.pickup);
    const cells = this.table.cellsFor(lat, lng, radiusM);
    const candidates = this.table.nearby(lat, lng, radiusM, this.now, 5);
    const step: TraceStep = { radiusM, cells, candidates: candidates.length, claims: [] };
    trip.trace.push(step);
    for (const c of candidates) {
      const result = this.table.claim(c.driverId, trip.id, this.now);
      step.claims.push({ driverId: c.driverId, distanceM: c.distanceM, result });
      if (result === 'ok') {
        this.commitMatch(trip, c.driverId);
        return true;
      }
    }
    return false;
  }

  private commitMatch(trip: Trip, driverId: string): void {
    // Service time: the conditional claim, the FOR UPDATE SKIP LOCKED row
    // update, and the event insert, drawn around the measured p50.
    const service = lognormal(this.rnd, 54, 0.3);
    trip.status = 'matched';
    trip.driverId = driverId;
    trip.matchedAt = this.now + service;
    // Manual trips pause between rings so the rings can be seen; that pause
    // is not part of the measured match latency.
    trip.latencyMs = Math.round(trip.matchedAt - trip.requestedAt - trip.pausedMs);
    const d = this.drivers.find((x) => x.id === driverId);
    if (d) {
      d.tripId = trip.id;
      d.target = trip.pickup;
    }
    if (!trip.manual) {
      this.loadMatched++;
      this.latencies.push(trip.latencyMs);
      this.lastMatchAt = trip.matchedAt;
      const dist = haversineDistance(trip.pickup, trip.dropoff);
      trip.completeAt = trip.matchedAt + 1000 + dist / 500;
    }
  }

  // The dispatch sweep: pull requested trips whose retry time has come
  // (FOR UPDATE SKIP LOCKED), and match each against the driver table.
  private sweep(): void {
    this.sweeps++;
    for (const trip of this.trips) {
      if (trip.status !== 'requested' || trip.nextAttemptAt > this.now) continue;
      if (trip.manual) {
        if (trip.nextStepAt > this.now) continue;
        const radius = RADII_M[trip.stepIdx];
        if (this.matchStep(trip, radius)) continue;
        trip.stepIdx++;
        trip.nextStepAt = this.now + MANUAL_STEP_MS;
        trip.pausedMs += MANUAL_STEP_MS;
        if (trip.stepIdx >= RADII_M.length) {
          trip.attempts++;
          trip.stepIdx = 0;
          trip.nextAttemptAt = this.now + RETRY_DELAY_MS;
        }
        continue;
      }
      let matched = false;
      for (const radius of RADII_M) {
        if (this.matchStep(trip, radius)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        trip.attempts++;
        trip.nextAttemptAt = this.now + RETRY_DELAY_MS;
      }
    }
  }

  private moveDrivers(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const d of this.drivers) {
      if (d.target) {
        const dn = d.target.north - d.pos.north;
        const de = d.target.east - d.pos.east;
        const dist = Math.hypot(dn, de);
        const step = 60 * dt;
        if (dist <= step) {
          d.pos = { ...d.target };
          const trip = this.trips.find((t) => t.id === d.tripId);
          if (trip && trip.status === 'matched') {
            trip.status = 'en_route';
            d.target = trip.dropoff;
          } else if (trip && trip.status === 'en_route') {
            this.complete(trip, d);
          } else {
            d.target = null;
          }
        } else {
          d.pos = { north: d.pos.north + (dn / dist) * step, east: d.pos.east + (de / dist) * step };
        }
        continue;
      }
      d.heading += (this.rnd() - 0.5) * 0.5;
      const speed = 8 + this.rnd() * 6;
      d.pos = {
        north: d.pos.north + speed * dt * Math.cos(d.heading),
        east: d.pos.east + speed * dt * Math.sin(d.heading),
      };
      if (Math.hypot(d.pos.north, d.pos.east) > CITY_HALF_M * 0.95) d.heading += Math.PI;
    }
  }

  // POST /rides/{id}/complete: frees the driver.
  private complete(trip: Trip, d: Driver): void {
    trip.status = 'completed';
    d.target = null;
    d.tripId = null;
    this.table.release(d.id);
    if (!trip.manual) this.loadCompleted++;
  }

  tick(dtMs: number): void {
    const target = this.now + dtMs;
    while (this.now < target) {
      const next = Math.min(target, this.nextPingAt, this.nextSweepAt, this.nextRideAt);
      const step = next - this.now;
      if (step > 0) this.moveDrivers(step);
      this.now = next;
      // Load trips finish on the clock rather than by driving the whole way.
      for (const t of this.trips) {
        if (!t.manual && t.completeAt !== null && t.status !== 'completed' && this.now >= t.completeAt) {
          const d = this.drivers.find((x) => x.id === t.driverId);
          if (d) this.complete(t, d);
        }
      }
      if (this.now >= this.nextPingAt) {
        for (const d of this.drivers) if (!d.silent) this.ping(d);
        this.nextPingAt += 1000;
      }
      if (this.now >= this.nextRideAt) {
        if (this.ridesLeft > 0) {
          this.submitLoadRide();
          this.ridesLeft--;
          this.nextRideAt += 1000 / LOAD_RATE_PER_S;
        } else {
          this.nextRideAt = Infinity;
        }
      }
      if (this.now >= this.nextSweepAt) {
        this.sweep();
        this.nextSweepAt += SWEEP_MS;
      }
    }
    if (this.trips.length > 900) this.trips.splice(0, this.trips.length - 900);
  }

  private percentile(p: number): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5));
    return sorted[idx];
  }

  snapshot(): Snapshot {
    const manual = [...this.trips].reverse().find((t) => t.manual) ?? null;
    const silent = this.silentId ? this.table.get(this.silentId) : undefined;
    const span =
      this.firstRequestAt !== null && this.lastMatchAt !== null
        ? (this.lastMatchAt - this.firstRequestAt) / 60000
        : 0;
    return {
      now: this.now,
      drivers: this.drivers.map((d) => {
        const item = this.table.get(d.id);
        const visible = item ? this.table.visible(item, this.now) : false;
        const status = d.silent
          ? visible
            ? 'stale'
            : 'expired'
          : d.tripId
            ? 'busy'
            : 'available';
        const { lat, lng } = toLatLng(d.pos);
        return { id: d.id, pos: d.pos, status, silent: d.silent, cell: item?.cell ?? encode(lat, lng, CELL_PRECISION) };
      }),
      trips: this.trips.filter((t) => t.status !== 'completed'),
      manual,
      load: {
        running: this.loadRunning,
        submitted: this.loadSubmitted,
        matched: this.loadMatched,
        completed: this.loadCompleted,
        pending: this.trips.filter((t) => !t.manual && t.status === 'requested').length,
        firstRequestAt: this.firstRequestAt,
        lastMatchAt: this.lastMatchAt,
        matchesPerMinute: span > 0.05 ? Math.round(this.loadMatched / span) : 0,
        p50: Math.round(this.percentile(0.5)),
        p95: Math.round(this.percentile(0.95)),
        sweeps: this.sweeps,
      },
      claims: {
        ok: this.table.ops.claimOk,
        failed: this.table.ops.claimFailed,
        expiredSkipped: this.table.ops.expiredSkipped,
        puts: this.table.ops.put,
        queries: this.table.ops.query,
      },
      silent: silent
        ? {
            driverId: silent.driverId,
            lastPingAt: silent.updatedAt,
            ttlAt: silent.ttl,
            visible: this.table.visible(silent, this.now),
          }
        : null,
    };
  }
}

function haversineDistance(a: Local, b: Local): number {
  const p = toLatLng(a);
  const q = toLatLng(b);
  return haversineM(p.lat, p.lng, q.lat, q.lng);
}
