import { offset } from './geo.ts';
import { Rng } from './rng.ts';
import type { DriverPosition } from './driverIndex.ts';
import type { RideRequest } from './matcher.ts';

// Port of the load generator's world: ids are 1-based so the two demo cities
// land on different shards under floorMod(cityId, 2).
export interface City {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export const CITIES: City[] = [
  { id: 1, name: 'austin', lat: 30.2672, lng: -97.7431 },
  { id: 2, name: 'seattle', lat: 47.6062, lng: -122.3321 },
];

export const SPAWN_RADIUS_M = 5000;
export const FENCE_RADIUS_M = 6500;
export const PICKUP_RADIUS_M = 4000;

// Port of loadgen Fleet.Driver: wanders at 8 to 15 m/s, turns around at the fence.
export class Driver {
  north: number;
  east: number;
  heading: number;
  readonly id: string;
  readonly city: City;
  private readonly rnd: Rng;

  constructor(id: string, city: City, rnd: Rng) {
    this.id = id;
    this.city = city;
    this.rnd = rnd;
    const r = SPAWN_RADIUS_M * Math.sqrt(rnd.next());
    const a = rnd.next() * 2 * Math.PI;
    this.north = r * Math.cos(a);
    this.east = r * Math.sin(a);
    this.heading = rnd.next() * 2 * Math.PI;
  }

  step(): void {
    this.heading += (this.rnd.next() - 0.5) * 0.6;
    const speed = 8 + this.rnd.next() * 7;
    this.north += speed * Math.cos(this.heading);
    this.east += speed * Math.sin(this.heading);
    if (Math.hypot(this.north, this.east) > FENCE_RADIUS_M) this.heading += Math.PI;
  }

  position(reportedAt: number): DriverPosition {
    const [lat, lng] = offset(this.city.lat, this.city.lng, this.north, this.east);
    return { driverId: this.id, cityId: this.city.id, lat, lng, reportedAt };
  }
}

export class Fleet {
  readonly drivers: Driver[] = [];

  constructor(cities: City[], perCity: number, seed: number) {
    for (const c of cities) {
      for (let i = 0; i < perCity; i++) {
        this.drivers.push(new Driver(`d-${c.id}-${i}`, c, new Rng(seed + c.id * 100_000 + i)));
      }
    }
  }
}

// Port of loadgen Rides: round-robin across cities, pickup within 4 km of the centre.
export class RideSource {
  private counter = 0;
  private readonly rnd: Rng;
  private readonly cities: City[];

  constructor(cities: City[], seed: number) {
    this.cities = cities;
    this.rnd = new Rng(seed);
  }

  next(requestedAt: number): RideRequest {
    const c = this.cities[this.counter % this.cities.length];
    const n = this.counter++;
    const r = PICKUP_RADIUS_M * Math.sqrt(this.rnd.next());
    const a = this.rnd.next() * 2 * Math.PI;
    const [pickupLat, pickupLng] = offset(c.lat, c.lng, r * Math.cos(a), r * Math.sin(a));
    return { rideId: `ride-${n.toString(36).padStart(4, '0')}`, cityId: c.id, pickupLat, pickupLng, requestedAt };
  }

  // A synthetic burst: n requests around one point in one city at the same
  // instant, the shape of a venue letting out.
  burst(city: City, n: number, requestedAt: number): RideRequest[] {
    const out: RideRequest[] = [];
    for (let i = 0; i < n; i++) {
      const k = this.counter++;
      const north = 1400 + (this.rnd.next() - 0.5) * 500;
      const east = -1100 + (this.rnd.next() - 0.5) * 500;
      const [pickupLat, pickupLng] = offset(city.lat, city.lng, north, east);
      out.push({ rideId: `ride-${k.toString(36).padStart(4, '0')}`, cityId: city.id, pickupLat, pickupLng, requestedAt });
    }
    return out;
  }
}
