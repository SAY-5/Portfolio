import { MemoryDriverIndex, type DriverPosition } from './driverIndex.ts';
import { toLocalMeters } from './geo.ts';
import { drawMatchLatencyMs, drawPollDelayMs } from './latency.ts';
import { DEFAULT_PROPS, Matcher, type Match, type MatchingProperties, type RideRequest, type RideUnmatched } from './matcher.ts';
import { Rng } from './rng.ts';
import { RolloutSim, type PodPhase } from './rollout.ts';
import { CityShardRouter } from './shard.ts';
import { MatchStats } from './stats.ts';
import {
  Consumer,
  Topic,
  TOPIC_DRIVER_POSITIONS,
  TOPIC_RIDE_MATCHES,
  TOPIC_RIDE_REQUESTS,
  TOPIC_RIDE_UNMATCHED,
  partitionFor,
} from './topics.ts';
import { CITIES, Fleet, RideSource, type City } from './world.ts';

// The whole stack in one deterministic engine on a simulated clock: the fleet
// pings positions once a second into the GEO index and the driver-positions
// topic, the ride source posts requests at a fixed rate (shard insert plus a
// produce to ride-requests), and the Streams task polls ride-requests, runs the
// Matcher, and branches into ride-matches or ride-unmatched. Every service call
// also routes through the rollout model, so a rolling update happens under the
// same load.
export interface EngineOptions {
  seed: number;
  driversPerCity: number;
  ridesPerSecond: number;
  durationMs: number;
  heartbeatTtlMs: number;
  shards: number;
  props: MatchingProperties;
}

export const DEMO_OPTIONS: EngineOptions = {
  seed: 7,
  driversPerCity: 40,
  ridesPerSecond: 10,
  durationMs: 60_000,
  heartbeatTtlMs: 15_000,
  shards: 2,
  // Trips are short here so the 40-driver fleet turns over; the real run holds
  // a claim for the 20 s default.
  props: { ...DEFAULT_PROPS, claimTtlMs: 4000 },
};

export const BURST_SIZE = 24;

// Consecutive TAKEN claims collapse into one line so a burst trace stays readable.
function compressTaken(lines: TraceLine[]): TraceLine[] {
  const out: TraceLine[] = [];
  let run: TraceLine[] = [];
  const flush = () => {
    if (run.length > 2) {
      const first = run[0].text.split(' ')[1];
      const last = run[run.length - 1].text.split(' ')[1];
      out.push({ text: `claim ${first} .. ${last}: ${run.length} TAKEN`, tone: 'warn' });
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const l of lines) {
    if (l.tone === 'warn' && l.text.endsWith(': TAKEN')) run.push(l);
    else {
      flush();
      out.push(l);
    }
  }
  flush();
  return out;
}

export type TraceTone = 'dim' | 'ok' | 'warn' | 'bad' | 'strong';

export interface TraceLine {
  text: string;
  tone: TraceTone;
}

export interface DriverDot {
  id: string;
  east: number;
  north: number;
  available: boolean;
}

export interface CityView {
  id: number;
  name: string;
  shard: string;
  partition: number;
  available: number;
  claimed: number;
  drivers: DriverDot[];
  pickup: { east: number; north: number } | null;
  ring: number | null;
  driver: { east: number; north: number } | null;
}

export interface PodView {
  name: string;
  phase: PodPhase;
  revision: number;
}

export interface DeploymentView {
  name: string;
  revision: number;
  served: number;
  errors: number;
  pods: PodView[];
}

export interface EngineSnapshot {
  now: number;
  rides: 'idle' | 'running' | 'stopped';
  finished: boolean;
  idle: boolean;
  submitted: number;
  matched: number;
  unmatched: number;
  dropped: number;
  matchesPerMinute: number;
  p50: number;
  p95: number;
  p99: number;
  lag: number;
  partitionDepths: Record<string, number[]>;
  topicTotals: Record<string, number>;
  byShardCity: Array<Record<number, number>>;
  byShard: number[];
  cities: CityView[];
  trace: TraceLine[];
  traceRide: string | null;
  counters: { taken: number; grows: number; widens: number; stale: number };
  rolling: boolean;
  rolloutMs: number | null;
  deployments: DeploymentView[];
  events: string[];
}

interface TripRow {
  cityId: number;
  status: 'REQUESTED' | 'MATCHED' | 'UNMATCHED';
}

interface HandledTrace {
  rideId: string;
  lines: TraceLine[];
  score: number;
}

const DEPLOY_SPECS = [
  { name: 'rider-request-service', replicas: 2 },
  { name: 'driver-location-service', replicas: 2 },
  { name: 'matching-service', replicas: 2 },
];

export class Engine {
  readonly opts: EngineOptions;
  readonly cities: City[];
  private readonly router: CityShardRouter;
  private readonly index: MemoryDriverIndex;
  private readonly matcher: Matcher;
  private readonly stats: MatchStats;
  private readonly fleet: Fleet;
  private readonly source: RideSource;
  private readonly rideRequests = new Topic<RideRequest>(TOPIC_RIDE_REQUESTS);
  private readonly driverPositions = new Topic<DriverPosition>(TOPIC_DRIVER_POSITIONS);
  private readonly rideMatches = new Topic<Match>(TOPIC_RIDE_MATCHES);
  private readonly rideUnmatched = new Topic<RideUnmatched>(TOPIC_RIDE_UNMATCHED);
  private readonly consumer: Consumer<RideRequest>;
  private readonly shards: Map<string, TripRow>[];
  private readonly rollout: RolloutSim;
  private readonly rnd: Rng;
  private now = 0;
  private nextPingAt = 1000;
  private rideBase = 0;
  private nextRideAt = 0;
  private nextPollAt = 0;
  private rides: 'idle' | 'running' | 'stopped' = 'idle';
  private submitted = 0;
  private lastMatch = new Map<number, { pickup: RideRequest; match: Match }>();
  private trace: TraceLine[] = [];
  private traceRide: string | null = null;
  private traceHoldUntil = 0;
  private readonly counters = { taken: 0, grows: 0, widens: 0, stale: 0 };

  constructor(opts: EngineOptions = DEMO_OPTIONS) {
    this.opts = opts;
    this.cities = CITIES;
    this.router = new CityShardRouter(opts.shards);
    this.index = new MemoryDriverIndex(() => this.now);
    this.matcher = new Matcher(this.index, opts.props, () => this.now);
    this.stats = new MatchStats(() => this.now);
    this.fleet = new Fleet(this.cities, opts.driversPerCity, opts.seed);
    this.source = new RideSource(this.cities, opts.seed + 99);
    this.consumer = new Consumer(this.rideRequests);
    this.shards = Array.from({ length: opts.shards }, () => new Map());
    this.rollout = new RolloutSim(opts.seed * 13 + 1, DEPLOY_SPECS);
    this.rnd = new Rng(opts.seed * 31 + 5);
    // The load generator seeds the index with one round of pings before rides start.
    for (const d of this.fleet.drivers) this.ping(d.position(this.now));
  }

  private deployment(name: string) {
    return this.rollout.deployments.find((d) => d.name === name)!;
  }

  // driver-location-service POST /drivers/{id}/position
  private ping(p: DriverPosition): void {
    this.rollout.route(this.deployment('driver-location-service'));
    this.index.upsert(p, this.opts.heartbeatTtlMs);
    this.driverPositions.append(String(p.cityId), p, this.now);
  }

  // rider-request-service POST /rides: write the trip to the city's shard,
  // produce ride.requested keyed by city.
  private submit(r: RideRequest): void {
    this.rollout.route(this.deployment('rider-request-service'));
    const shard = this.router.shardIndexFor(r.cityId);
    this.shards[shard].set(r.rideId, { cityId: r.cityId, status: 'REQUESTED' });
    this.rideRequests.append(String(r.cityId), r, this.now);
    this.submitted++;
  }

  start(): void {
    if (this.rides !== 'idle') return;
    this.rides = 'running';
    this.rideBase = this.now;
    this.nextRideAt = this.now;
  }

  burst(): void {
    const city = this.cities[0];
    for (const r of this.source.burst(city, BURST_SIZE, this.now)) this.submit(r);
  }

  startRollout(): void {
    this.rollout.startRollout();
  }

  // matching-service MatchService.handle on one polled record.
  private handle(r: RideRequest): HandledTrace {
    const lines: TraceLine[] = [];
    let score = 0;
    let claimsTried = 0;
    const outcome = this.matcher.match(r, (t) => {
      switch (t.kind) {
        case 'search':
          lines.push({ text: `GEOSEARCH ${t.radius} m, page ${t.limit}: ${t.candidates.length} candidates`, tone: 'dim' });
          break;
        case 'claim':
          claimsTried++;
          if (t.result === 'CLAIMED') {
            lines.push({ text: `claim ${t.driverId} at ${Math.round(t.distanceMeters)} m: SET NX ok`, tone: 'ok' });
          } else if (t.result === 'TAKEN') {
            this.counters.taken++;
            score += 1;
            lines.push({ text: `claim ${t.driverId} at ${Math.round(t.distanceMeters)} m: TAKEN`, tone: 'warn' });
          } else {
            this.counters.stale++;
            score += 1;
            lines.push({ text: `claim ${t.driverId}: STALE heartbeat, dropped from set`, tone: 'warn' });
          }
          break;
        case 'grow':
          this.counters.grows++;
          score += 3;
          lines.push({ text: `full page taken, grow page to ${t.limit} in the same ring`, tone: 'warn' });
          break;
        case 'widen':
          this.counters.widens++;
          score += 2;
          lines.push({ text: `widen radius ${t.from} m to ${t.to} m`, tone: 'warn' });
          break;
        case 'matched':
          break;
        case 'unmatched':
          lines.push({ text: `unmatched: ${t.unmatched.reason}, produce ride-unmatched`, tone: 'bad' });
          break;
      }
    });
    this.rollout.route(this.deployment('matching-service'));
    const shard = this.shards[this.router.shardIndexFor(r.cityId)];
    const row = shard.get(r.rideId);
    if (outcome.matched) {
      const m = outcome.match;
      if (!row || row.status !== 'REQUESTED') {
        this.index.release(m.cityId, m.driverId, m.rideId);
        this.stats.recordDropped();
        return { rideId: r.rideId, lines, score };
      }
      row.status = 'MATCHED';
      m.matchLatencyMs = drawMatchLatencyMs(this.rnd, claimsTried);
      this.stats.recordMatch(m.matchLatencyMs);
      this.rideMatches.append(String(m.cityId), m, this.now);
      this.lastMatch.set(m.cityId, { pickup: r, match: m });
      lines.push({
        text: `matched ${m.driverId} at ${Math.round(m.distanceMeters)} m in ring ${m.radiusMeters}, ${m.matchLatencyMs} ms, produce ride-matches`,
        tone: 'strong',
      });
      return { rideId: r.rideId, lines, score };
    }
    if (row && row.status === 'REQUESTED') {
      row.status = 'UNMATCHED';
      this.stats.recordUnmatched();
      this.rideUnmatched.append(String(r.cityId), outcome.unmatched, this.now);
    } else {
      this.stats.recordDropped();
    }
    score += 4;
    return { rideId: r.rideId, lines, score };
  }

  private pickTrace(handled: HandledTrace[]): void {
    if (handled.length === 0) return;
    let best = handled[0];
    for (const h of handled) if (h.score >= best.score) best = h;
    if (best.score === 0 && this.now < this.traceHoldUntil) return;
    this.trace = compressTaken(best.lines);
    this.traceRide = best.rideId;
    if (best.score > 0) this.traceHoldUntil = this.now + 4000;
  }

  // Advance simulated time by dt milliseconds, running every scheduled event in order.
  tick(dtMs: number): void {
    const target = this.now + dtMs;
    const handled: HandledTrace[] = [];
    while (this.now < target) {
      const nextRide = this.rides === 'running' ? this.nextRideAt : Infinity;
      this.now = Math.min(target, this.nextPingAt, nextRide, this.nextPollAt);
      if (this.now >= this.nextPingAt) {
        for (const d of this.fleet.drivers) {
          d.step();
          this.ping(d.position(this.now));
        }
        this.nextPingAt += 1000;
      }
      if (this.rides === 'running' && this.now >= this.nextRideAt) {
        // The loadgen ticker fires at a fixed period and the last two fire
        // during shutdown, which is why a 60 s run at 10 rides/s reports 603.
        if (this.rideBase > this.opts.durationMs + 250) {
          this.rides = 'stopped';
        } else {
          this.submit(this.source.next(this.now));
          this.rideBase += 1000 / this.opts.ridesPerSecond;
          this.nextRideAt = Math.max(this.now, this.rideBase + this.rnd.range(-40, 40));
        }
      }
      if (this.now >= this.nextPollAt) {
        const batch = this.consumer.poll(this.now, 64);
        if (batch.length > 0) {
          this.index.beginBatch();
          for (const rec of batch) handled.push(this.handle(rec.value));
          this.index.endBatch();
        }
        this.nextPollAt = this.now + drawPollDelayMs(this.rnd);
      }
    }
    this.pickTrace(handled);
    this.rollout.tick(dtMs);
  }

  private cityView(c: City): CityView {
    const drivers: DriverDot[] = this.index.drivers(c.id).map((d) => {
      const [east, north] = toLocalMeters(c.lat, c.lng, d.lat, d.lng);
      return { id: d.driverId, east, north, available: d.available };
    });
    const last = this.lastMatch.get(c.id);
    let pickup: CityView['pickup'] = null;
    let driver: CityView['driver'] = null;
    let ring: number | null = null;
    if (last && this.now - last.match.matchedAt < 2500) {
      const [pe, pn] = toLocalMeters(c.lat, c.lng, last.pickup.pickupLat, last.pickup.pickupLng);
      pickup = { east: pe, north: pn };
      ring = last.match.radiusMeters;
      const d = drivers.find((x) => x.id === last.match.driverId);
      if (d) driver = { east: d.east, north: d.north };
    }
    return {
      id: c.id,
      name: c.name,
      shard: this.router.shardName(c.id),
      partition: partitionFor(String(c.id)),
      available: this.index.size(c.id),
      claimed: drivers.filter((d) => !d.available).length,
      drivers,
      pickup,
      ring,
      driver,
    };
  }

  snapshot(): EngineSnapshot {
    const s = this.stats.snapshot();
    const byShardCity = this.shards.map((m) => {
      const counts: Record<number, number> = {};
      for (const row of m.values()) counts[row.cityId] = (counts[row.cityId] ?? 0) + 1;
      return counts;
    });
    const depths: Record<string, number[]> = {};
    const totals: Record<string, number> = {};
    for (const t of [this.rideRequests, this.driverPositions, this.rideMatches, this.rideUnmatched]) {
      depths[t.name] = t.depths();
      totals[t.name] = t.total;
    }
    const lag = this.consumer.lag();
    const finished = this.rides === 'stopped' && lag === 0;
    return {
      now: this.now,
      rides: this.rides,
      finished,
      idle: (this.rides !== 'running' && lag === 0) && !this.rollout.rolling,
      submitted: this.submitted,
      matched: s.matched,
      unmatched: s.unmatched,
      dropped: s.dropped,
      matchesPerMinute: s.matchesPerMinute,
      p50: s.p50,
      p95: s.p95,
      p99: s.p99,
      lag,
      partitionDepths: depths,
      topicTotals: totals,
      byShardCity,
      byShard: this.shards.map((m) => m.size),
      cities: this.cities.map((c) => this.cityView(c)),
      trace: this.trace,
      traceRide: this.traceRide,
      counters: { ...this.counters },
      rolling: this.rollout.rolling,
      rolloutMs: this.rollout.durationMs,
      deployments: this.rollout.deployments.map((d) => ({
        name: d.name,
        revision: d.revision,
        served: d.served,
        errors: d.errors,
        pods: d.pods.map((p) => ({ name: p.name, phase: p.phase, revision: p.revision })),
      })),
      events: this.rollout.events.slice(-5).map((e) => `${(e.at / 1000).toFixed(1)}s ${e.text}`),
    };
  }
}
