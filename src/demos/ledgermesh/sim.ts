// Runs the chaos harness against the cluster: the seeded load, the kill
// schedule, the drain until every order is terminal, and a plain snapshot the
// component renders.
import { Topics, type BreakerState, type CircuitBreaker, type ServiceName, type Trace } from './bus';
import { Cluster, formatSummary, LoadGenerator, planKills, type BreakerLogEntry, type ClusterStats, type Kill, type KillPlan } from './cluster';
import { isTerminal, type Order, type OrderStatus } from './services';

// Seed 1406 lands the seeded run on the measured summary: 1200 orders, 1162
// confirmed, 38 cancelled for stock, kills of inventory, payment, inventory.
export const CHAOS = { seed: 1406, rate: 20, durationMs: 60_000, kills: 3, restartAfterMs: 5000 };
export const SERVICE_NAMES: ServiceName[] = ['order-service', 'inventory-service', 'payment-service'];
const NOTABLE = new Set(['kill', 'restart', 'breaker', 'duplicate', 'deferred', 'sweep', 'redelivery']);

export type Phase = 'idle' | 'running' | 'draining' | 'done';

export interface ServiceSnap {
  name: ServiceName;
  alive: boolean;
  ready: boolean;
  note: string;
  outbox: number;
  relay: number;
  lag: number;
  restarts: number;
}

export interface BreakerSnap {
  owner: 'inventory' | 'processor';
  state: BreakerState;
  window: boolean[];
  size: number;
  minCalls: number;
  threshold: number;
  waitMs: number;
  permitted: number;
  failureRate: number;
  reopensInMs: number;
  trials: boolean[];
}

export interface OrderRow {
  id: string;
  sku: string;
  quantity: number;
  path: OrderStatus[];
  reason: string | null;
  ms: number;
  at: number;
}

export interface Snap {
  now: number;
  phase: Phase;
  paused: boolean;
  autoChaos: boolean;
  processorFault: boolean;
  services: ServiceSnap[];
  breakers: BreakerSnap[];
  breakerLog: BreakerLogEntry[];
  stats: ClusterStats;
  inFlight: number;
  openPayments: number;
  topics: { name: string; lag: number }[];
  recent: OrderRow[];
  lastStockout: OrderRow | null;
  log: Trace[];
  kills: Kill[];
  plan: KillPlan[];
  summary: string;
}

function orderRow(o: Order): OrderRow {
  return { id: o.id, sku: o.items[0]?.sku ?? '', quantity: o.items[0]?.quantity ?? 0, path: [...o.path], reason: o.reason, ms: o.updatedAt - o.createdAt, at: o.updatedAt };
}

function breakerSnap(owner: BreakerSnap['owner'], b: CircuitBreaker, now: number): BreakerSnap {
  return {
    owner,
    state: b.state,
    window: [...b.window],
    size: b.config.slidingWindowSize,
    minCalls: b.config.minimumNumberOfCalls,
    threshold: b.config.failureRateThreshold,
    waitMs: b.config.waitDurationInOpenStateMs,
    permitted: b.config.permittedNumberOfCallsInHalfOpenState,
    failureRate: b.failureRate(),
    reopensInMs: b.reopensIn(now),
    trials: [...b.halfOpenResults],
  };
}

export class ChaosSession {
  readonly cluster: Cluster;
  readonly load: LoadGenerator;
  readonly plan: KillPlan[];
  started = false;
  paused = false;
  done = false;
  autoChaos = true;
  processorFault = false;
  version = 0;
  private nextKill = 0;
  private log: Trace[] = [];
  private recent: Order[] = [];
  private lastStockout: Order | null = null;

  constructor(seed = CHAOS.seed) {
    this.cluster = new Cluster(seed);
    this.load = new LoadGenerator(CHAOS.rate, CHAOS.durationMs, seed);
    this.plan = planKills(CHAOS.durationMs, CHAOS.kills, seed);
    this.cluster.onTrace = (t) => {
      if (!NOTABLE.has(t.kind)) return;
      this.log.push(t);
      if (this.log.length > 40) this.log.shift();
    };
    this.cluster.order.onTerminal = (o) => {
      this.recent.push(o);
      if (this.recent.length > 8) this.recent.shift();
      if (o.reason === 'OUT_OF_STOCK') this.lastStockout = o;
    };
  }

  phase(): Phase {
    if (this.done) return 'done';
    if (!this.started) return 'idle';
    return this.load.finished(this.cluster.now) ? 'draining' : 'running';
  }

  start(): void {
    this.started = true;
    this.paused = false;
    this.version++;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.version++;
  }

  advance(ms: number): void {
    if (!this.started || this.paused || this.done) return;
    const until = this.cluster.now + ms;
    while (this.cluster.now < until && !this.done) this.stepOnce();
    this.version++;
  }

  // One harness step: submit what is due, fire a scheduled kill once the
  // previous victim is ready again, then advance the cluster.
  private stepOnce(): void {
    const c = this.cluster;
    if (!this.load.finished(c.now)) this.load.tick(c);
    if (this.autoChaos && this.nextKill < this.plan.length && c.now >= this.plan[this.nextKill].at) {
      const last = c.kills[c.kills.length - 1];
      if (!last || c.now >= last.readyAt) {
        c.kill(this.plan[this.nextKill].service, CHAOS.restartAfterMs);
        this.nextKill++;
      }
    }
    c.step();
    if (this.load.finished(c.now) && c.quiescent()) this.done = true;
  }

  kill(name: ServiceName): void {
    if (this.done) return;
    this.started = true;
    this.cluster.kill(name, CHAOS.restartAfterMs);
    this.version++;
  }

  setAutoChaos(on: boolean): void {
    this.autoChaos = on;
    this.version++;
  }

  // Every processor call answers a transient fault while this is on.
  setProcessorFault(on: boolean): void {
    this.processorFault = on;
    this.cluster.payment.processor.transientPercent = on ? 100 : 5;
    this.version++;
  }

  snapshot(): Snap {
    const c = this.cluster;
    const now = c.now;
    const raw = c.stats();
    // While orders are moving, open orders are in flight rather than stuck; the
    // harness only counts stuck orders once the drain is over.
    const stats = this.done ? raw : { ...raw, stuck: 0, failed: raw.cancelledOther + raw.refused };
    const services = SERVICE_NAMES.map((name): ServiceSnap => {
      const s = c.service(name);
      const kill = [...c.kills].reverse().find((k) => k.service === name);
      const note = !s.alive
        ? `SIGKILL, restart in ${kill ? Math.max(0, (kill.restartAt - now) / 1000).toFixed(1) : '?'} s`
        : !s.ready(now)
          ? `booting, ready in ${((s.readyAt - now) / 1000).toFixed(1)} s`
          : name === 'order-service'
            ? 'accepting POST /orders'
            : name === 'inventory-service'
              ? 'reserving stock'
              : 'authorizing payments';
      return { name, alive: s.alive, ready: s.ready(now), note, outbox: s.outbox.backlog(), relay: s.relay.inFlight(), lag: s.lag(), restarts: s.restarts };
    });
    const b = c.broker;
    return {
      now,
      phase: this.phase(),
      paused: this.paused,
      autoChaos: this.autoChaos,
      processorFault: this.processorFault,
      services,
      breakers: [breakerSnap('inventory', c.order.breaker, now), breakerSnap('processor', c.payment.breaker, now)],
      breakerLog: c.breakerLog.slice(-12),
      stats,
      inFlight: this.done ? 0 : raw.stuck,
      openPayments: c.payment.openPayments(),
      topics: [
        { name: Topics.ORDER_CREATED, lag: b.lag('inventory-service', Topics.ORDER_CREATED) },
        { name: Topics.INVENTORY_RESERVED, lag: b.lag('order-service', Topics.INVENTORY_RESERVED) + b.lag('payment-service', Topics.INVENTORY_RESERVED) },
        { name: Topics.INVENTORY_REJECTED, lag: b.lag('order-service', Topics.INVENTORY_REJECTED) },
        { name: Topics.PAYMENT_COMPLETED, lag: b.lag('order-service', Topics.PAYMENT_COMPLETED) },
        { name: Topics.PAYMENT_FAILED, lag: b.lag('order-service', Topics.PAYMENT_FAILED) },
        { name: Topics.ORDER_CANCELLED, lag: b.lag('inventory-service', Topics.ORDER_CANCELLED) },
      ],
      recent: this.recent.filter((o) => isTerminal(o.status)).slice(-6).reverse().map(orderRow),
      lastStockout: this.lastStockout ? orderRow(this.lastStockout) : null,
      log: this.log.slice(-12).reverse(),
      kills: c.kills.map((k) => ({ ...k })),
      plan: this.plan,
      summary: formatSummary(stats, CHAOS.durationMs / 1000, CHAOS.rate),
    };
  }
}
