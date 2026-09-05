// Geohash encode and cell geometry, mirroring rideloop_common/geo.py. The
// driver table is partitioned by the precision-5 cell of each position, and a
// nearby query reads every cell whose box overlaps the search radius.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function encode(lat: number, lng: number, precision: number): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        minLng = mid;
      } else {
        ch <<= 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        minLat = mid;
      } else {
        ch <<= 1;
        maxLat = mid;
      }
    }
    even = !even;
    bit++;
    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function bounds(hash: string): Bounds {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    for (let n = 4; n >= 0; n--) {
      const bit = (idx >> n) & 1;
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (bit) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (bit) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

// Cell height and width in degrees for a precision.
export function cellSize(precision: number): { dLat: number; dLng: number } {
  const bits = precision * 5;
  const lngBits = Math.ceil(bits / 2);
  const latBits = Math.floor(bits / 2);
  return { dLat: 180 / 2 ** latBits, dLng: 360 / 2 ** lngBits };
}

// Every cell whose box overlaps the given bounding box, row by row.
export function cellsCovering(box: Bounds, precision: number): string[] {
  const { dLat, dLng } = cellSize(precision);
  const out: string[] = [];
  const start = bounds(encode(box.minLat, box.minLng, precision));
  for (let lat = start.minLat + dLat / 2; lat < box.maxLat + dLat; lat += dLat) {
    if (lat - dLat / 2 > box.maxLat) break;
    for (let lng = start.minLng + dLng / 2; lng < box.maxLng + dLng; lng += dLng) {
      if (lng - dLng / 2 > box.maxLng) break;
      out.push(encode(lat, lng, precision));
    }
  }
  return out;
}
