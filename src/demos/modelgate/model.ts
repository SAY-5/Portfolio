import type { PredictInput } from './validate';

// Two fixed-weight ETA estimators standing in for the trained checkpoints.
// v1 is the shallow 19-64-64-1 MLP: close to linear in distance with flat
// traffic and rush-hour offsets. v2 (19-96-96-96-1) learned the interactions:
// traffic and rush hour scale with distance, rain is heavier on long trips,
// and zones carry their own offsets. Both are pure functions of the input, so
// the divergence between them is a property of the request, not of a clock.

export type Version = 'v1' | 'v2';

export const VERSIONS: Record<Version, { arch: string; epochs: number; mae: number }> = {
  v1: { arch: 'MLP 19-64-64-1', epochs: 10, mae: 3.105 },
  v2: { arch: 'MLP 19-96-96-96-1', epochs: 25, mae: 1.888 },
};

const ZONE_V1 = [0, 0.12, 0.24, 0.06, 0.33, 0.18, 0.09, 0.42, 0.27, 0.15, 0.3, 0.21, 0.06];
const ZONE_V2 = [0, 0.1, 2.6, 0.9, 3.4, 0.2, 1.8, 3.9, 0.4, 2.2, 0.6, 2.9, 1.3];

function rush(hour: number): number {
  if (hour >= 7 && hour <= 9) return 1;
  if (hour >= 16 && hour <= 18) return 1;
  return 0;
}

function night(hour: number): number {
  return hour <= 5 || hour >= 22 ? 1 : 0;
}

export function predict(version: Version, x: PredictInput): number {
  const d = x.distance_km;
  const t = x.traffic_index;
  const r = x.is_raining ? 1 : 0;
  const weekend = x.day_of_week >= 5 ? 1 : 0;
  if (version === 'v1') {
    const eta =
      2.4 + 2.15 * d + 6.0 * t + 1.6 * r + 2.6 * rush(x.hour_of_day) - 1.2 * night(x.hour_of_day) + ZONE_V1[x.pickup_zone_id];
    return Math.max(1, Math.round(eta * 100) / 100);
  }
  const eta =
    1.7 +
    d * (1.8 + 2.1 * t + 0.55 * rush(x.hour_of_day) - 0.25 * night(x.hour_of_day) - 0.15 * weekend) +
    r * (0.8 + 0.22 * d) +
    ZONE_V2[x.pickup_zone_id] * (1 - 0.35 * weekend);
  return Math.max(1, Math.round(eta * 100) / 100);
}
