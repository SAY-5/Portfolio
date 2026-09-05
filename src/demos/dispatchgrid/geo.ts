// Port of common/geo/Geo and RadiusExpansion from dispatchgrid.
export const EARTH_RADIUS_METERS = 6_371_008.8;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function offset(lat: number, lng: number, northMeters: number, eastMeters: number): [number, number] {
  const dLat = toDeg(northMeters / EARTH_RADIUS_METERS);
  const dLng = toDeg(eastMeters / (EARTH_RADIUS_METERS * Math.cos(toRad(lat))));
  return [lat + dLat, lng + dLng];
}

export function toLocalMeters(originLat: number, originLng: number, lat: number, lng: number): [number, number] {
  const east = toRad(lng - originLng) * EARTH_RADIUS_METERS * Math.cos(toRad(originLat));
  const north = toRad(lat - originLat) * EARTH_RADIUS_METERS;
  return [east, north];
}

export interface RadiusExpansion {
  initialMeters: number;
  factor: number;
  maxMeters: number;
}

// Start at initial, multiply by factor, always finish exactly at max.
export function radii(e: RadiusExpansion): number[] {
  const out: number[] = [];
  let r = e.initialMeters;
  while (r < e.maxMeters) {
    out.push(Math.round(r));
    r *= e.factor;
  }
  out.push(e.maxMeters);
  return out;
}
