import { radii } from './geo.ts';
import type { ClaimResult, MemoryDriverIndex, NearbyDriver } from './driverIndex.ts';

// Port of matching-service MatchingProperties with the application.yml defaults.
export interface MatchingProperties {
  initialRadiusMeters: number;
  radiusFactor: number;
  maxRadiusMeters: number;
  candidatesPerRadius: number;
  claimTtlMs: number;
}

export const DEFAULT_PROPS: MatchingProperties = {
  initialRadiusMeters: 1000,
  radiusFactor: 2.0,
  maxRadiusMeters: 8000,
  candidatesPerRadius: 20,
  claimTtlMs: 20_000,
};

export interface RideRequest {
  rideId: string;
  cityId: number;
  pickupLat: number;
  pickupLng: number;
  requestedAt: number;
}

export interface Match {
  rideId: string;
  driverId: string;
  cityId: number;
  distanceMeters: number;
  radiusMeters: number;
  matchLatencyMs: number;
  matchedAt: number;
}

export interface RideUnmatched {
  rideId: string;
  cityId: number;
  reason: 'all_candidates_taken' | 'no_drivers_in_range';
}

export type MatchOutcome = { matched: true; match: Match } | { matched: false; unmatched: RideUnmatched };

export type MatchTrace =
  | { kind: 'search'; radius: number; limit: number; candidates: NearbyDriver[] }
  | { kind: 'claim'; driverId: string; result: ClaimResult; distanceMeters: number }
  | { kind: 'grow'; radius: number; limit: number }
  | { kind: 'widen'; from: number; to: number }
  | { kind: 'matched'; match: Match }
  | { kind: 'unmatched'; unmatched: RideUnmatched };

export const MAX_CANDIDATES_PER_RING = 64;

// Port of matching-service Matcher: nearest-first inside a radius, claim each
// candidate, grow the candidate page within the ring while a full page was
// taken, then widen the radius.
export class Matcher {
  private readonly rings: number[];
  private readonly index: MemoryDriverIndex;
  private readonly props: MatchingProperties;
  private readonly clock: () => number;

  constructor(index: MemoryDriverIndex, props: MatchingProperties, clock: () => number) {
    this.index = index;
    this.props = props;
    this.clock = clock;
    this.rings = radii({
      initialMeters: props.initialRadiusMeters,
      factor: props.radiusFactor,
      maxMeters: props.maxRadiusMeters,
    });
  }

  match(r: RideRequest, trace?: (t: MatchTrace) => void): MatchOutcome {
    let taken = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const radius = this.rings[i];
      if (i > 0 && trace) trace({ kind: 'widen', from: this.rings[i - 1], to: radius });
      let limit = this.props.candidatesPerRadius;
      for (;;) {
        const candidates = this.index.nearby(r.cityId, r.pickupLat, r.pickupLng, radius, limit);
        trace?.({ kind: 'search', radius, limit, candidates });
        let takenHere = 0;
        for (const c of candidates) {
          const result = this.index.claim(r.cityId, c.driverId, r.rideId, this.props.claimTtlMs);
          trace?.({ kind: 'claim', driverId: c.driverId, result, distanceMeters: c.distanceMeters });
          if (result === 'CLAIMED') {
            const now = this.clock();
            const match: Match = {
              rideId: r.rideId,
              driverId: c.driverId,
              cityId: r.cityId,
              distanceMeters: c.distanceMeters,
              radiusMeters: radius,
              matchLatencyMs: Math.max(0, now - r.requestedAt),
              matchedAt: now,
            };
            trace?.({ kind: 'matched', match });
            return { matched: true, match };
          }
          if (result === 'TAKEN') takenHere++;
        }
        taken += takenHere;
        // A wider radius returns the same nearest drivers, so when a full page
        // of this ring was already claimed, ask the ring for more before widening.
        const ringMayHaveMore = candidates.length >= limit && limit < MAX_CANDIDATES_PER_RING;
        if (takenHere === 0 || !ringMayHaveMore) break;
        limit = Math.min(limit * 2, MAX_CANDIDATES_PER_RING);
        trace?.({ kind: 'grow', radius, limit });
      }
    }
    const unmatched: RideUnmatched = {
      rideId: r.rideId,
      cityId: r.cityId,
      reason: taken > 0 ? 'all_candidates_taken' : 'no_drivers_in_range',
    };
    trace?.({ kind: 'unmatched', unmatched });
    return { matched: false, unmatched };
  }
}
