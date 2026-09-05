// Port of common/shard/CityShardRouter: city id maps to floorMod(cityId, N).
// A pure function, so every service agrees on the shard without coordination.
export function floorMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export class CityShardRouter {
  readonly shardCount: number;

  constructor(shardCount: number) {
    this.shardCount = shardCount;
  }

  shardIndexFor(cityId: number): number {
    return floorMod(cityId, this.shardCount);
  }

  shardName(cityId: number): string {
    return `shard-${this.shardIndexFor(cityId)}`;
  }
}
