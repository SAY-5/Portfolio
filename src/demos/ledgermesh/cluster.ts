// The whole stack on one virtual clock: broker, Redis, the three services, the
// chaos load generator (20 orders/s, weighted skus, a stock probe every
// 500 ms) and the kill schedule from chaos/run.sh. Time only moves in step().
import { Broker, type BreakerTransition, type ServiceName, type Trace } from './bus';
import { Prng } from './prng';
import {
  InventoryService,
  OrderService,
  PaymentService,
  StockCache,
  isTerminal,
  type Order,
  type OrderItem,
  type ProcessorConfig,
} from './services';

export const DEFAULT_STOCK: Record<string, number> = {
  'SKU-ALPHA': 100000,
  'SKU-BRAVO': 100000,
  'SKU-CHARLIE': 100000,
  'SKU-SCARCE': 40,
};

export interface Kill {
  service: ServiceName;
  at: number;
  restartAt: number;
  readyAt: number;
}

export interface BreakerLogEntry extends BreakerTransition {
  owner: 'inventory' | 'processor';
}

export class Cluster {
  now = 0;
  readonly tickMs = 50;
  readonly broker: Broker;
  readonly redis = new StockCache(60_000);
  readonly order: OrderService;
  readonly inventory: InventoryService;
  readonly payment: PaymentService;
  readonly kills: Kill[] = [];
  readonly stockProbes = { live: 0, cache: 0, unknown: 0, error: 0 };
  readonly breakerTransitions = new Map<string, number>();
  readonly breakerLog: BreakerLogEntry[] = [];
  readonly submitted: string[] = [];
  refused = 0;
  onTrace?: (t: Trace) => void;
  private pendingRestarts: { name: ServiceName; at: number }[] = [];

  constructor(seed: number, processor: Partial<ProcessorConfig> = {}) {
    const trace = (t: Trace) => this.onTrace?.(t);
    this.broker = new Broker(new Prng(seed ^ 0x9e3779b9), 60, 0.0008, trace);
    const env = { broker: this.broker, trace, outboxPollMs: 200, bootMs: 2500, consumerConcurrency: 3 };
    this.inventory = new InventoryService(env, new Prng(seed + 1), this.redis);
    this.order = new OrderService(env, new Prng(seed + 2), () => this.inventory);
    this.payment = new PaymentService(env, new Prng(seed + 3), { limit: 10000, transientPercent: 5, slowPercent: 1, slowMillis: 3000, ...processor });
    this.inventory.seed(DEFAULT_STOCK, 0);
    this.order.breaker.onTransition = (t) => this.recordTransition('inventory', t);
    this.payment.breaker.onTransition = (t) => this.recordTransition('processor', t);
  }

  get services() {
    return [this.order, this.inventory, this.payment];
  }

  service(name: ServiceName) {
    return name === 'order-service' ? this.order : name === 'inventory-service' ? this.inventory : this.payment;
  }

  // POST /orders, refused while the order service is down.
  submit(customerId: string, items: OrderItem[]): Order | null {
    if (!this.order.ready(this.now)) {
      this.refused++;
      return null;
    }
    const order = this.order.create(customerId, items, this.now);
    this.submitted.push(order.id);
    return order;
  }

  probeStock(sku: string): void {
    if (!this.order.ready(this.now)) {
      this.stockProbes.error++;
      return;
    }
    this.order.stock(sku, this.now, (view) => {
      this.stockProbes[view.source]++;
    });
  }

  kill(name: ServiceName, restartAfterMs = 5000): Kill | null {
    const svc = this.service(name);
    if (!svc.alive) return null;
    svc.kill(this.now);
    const restartAt = this.now + restartAfterMs;
    this.pendingRestarts.push({ name, at: restartAt });
    const kill: Kill = { service: name, at: this.now, restartAt, readyAt: restartAt + 2500 };
    this.kills.push(kill);
    return kill;
  }

  step(): void {
    this.now += this.tickMs;
    if (this.pendingRestarts.length) {
      const due = this.pendingRestarts.filter((r) => r.at <= this.now);
      this.pendingRestarts = this.pendingRestarts.filter((r) => r.at > this.now);
      for (const r of due) {
        const svc = this.service(r.name);
        svc.restart(this.now);
        const kill = this.kills.find((k) => k.service === r.name && k.restartAt === r.at);
        if (kill) kill.readyAt = svc.readyAt;
      }
    }
    for (const s of this.services) s.tick(this.now);
  }

  open(): number {
    let n = 0;
    for (const id of this.submitted) {
      const o = this.order.orders.get(id);
      if (o && !isTerminal(o.status)) n++;
    }
    return n;
  }

  // No open order and nothing left in any outbox, topic or in-flight call.
  quiescent(): boolean {
    if (this.open() > 0) return false;
    for (const s of this.services) {
      if (s.outbox.backlog() > 0 || s.relay.inFlight() > 0 || s.lag() > 0) return false;
    }
    return this.payment.inFlight() === 0;
  }

  stats(): ClusterStats {
    let confirmed = 0;
    let cancelledStock = 0;
    let cancelledOther = 0;
    let stuck = 0;
    for (const id of this.submitted) {
      const o = this.order.orders.get(id);
      if (!o) continue;
      if (o.status === 'CONFIRMED') confirmed++;
      else if (o.status === 'CANCELLED' && o.reason === 'OUT_OF_STOCK') cancelledStock++;
      else if (o.status === 'CANCELLED') cancelledOther++;
      else stuck++;
    }
    const latencies = this.order.latencies;
    return {
      submitted: this.submitted.length,
      confirmed,
      cancelledStock,
      cancelledOther,
      stuck,
      refused: this.refused,
      failed: stuck + cancelledOther + this.refused,
      retries: { ...this.payment.retries },
      deferred: this.payment.deferred,
      duplicates: this.order.idempotent.duplicates + this.inventory.idempotent.duplicates + this.payment.idempotent.duplicates,
      stockProbes: { ...this.stockProbes },
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? Math.max(...latencies) : 0,
      kills: this.kills.map((k) => ({ ...k })),
      breakerTransitions: [...this.breakerTransitions.entries()].map(([k, v]) => `${k} x${v}`).sort(),
      outboxBacklog: this.services.reduce((n, s) => n + s.outbox.backlog(), 0),
    };
  }

  private recordTransition(owner: 'inventory' | 'processor', t: BreakerTransition): void {
    const key = `${owner === 'inventory' ? 'order-service/inventory' : 'payment-service/processor'} ${t.from}->${t.to}`;
    this.breakerTransitions.set(key, (this.breakerTransitions.get(key) ?? 0) + 1);
    this.breakerLog.push({ ...t, owner });
    if (this.breakerLog.length > 200) this.breakerLog.splice(0, this.breakerLog.length - 200);
    this.onTrace?.({ t: t.at, source: owner === 'inventory' ? 'order-service' : 'payment-service', kind: 'breaker', text: `breaker ${owner} ${t.from} -> ${t.to}` });
  }
}

export interface ClusterStats {
  submitted: number;
  confirmed: number;
  cancelledStock: number;
  cancelledOther: number;
  stuck: number;
  refused: number;
  failed: number;
  retries: PaymentService['retries'];
  deferred: number;
  duplicates: number;
  stockProbes: Cluster['stockProbes'];
  p50: number;
  p95: number;
  max: number;
  kills: Kill[];
  breakerTransitions: string[];
  outboxBacklog: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const k = ((ordered.length - 1) * p) / 100;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, ordered.length - 1);
  return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo);
}

export const SKUS = ['SKU-ALPHA', 'SKU-BRAVO', 'SKU-CHARLIE', 'SKU-SCARCE'] as const;
const SKU_WEIGHTS = [40, 30, 25, 5];

// chaos/loadgen.py: a fixed order rate, weighted skus, quantities 1..3,
// prices 5..80, and a stock probe every 500 ms on the breaker-protected path.
export class LoadGenerator {
  private readonly rng: Prng;
  private startedAt = -1;
  private seq = 0;
  private nextProbeAt = 0;
  readonly rate: number;
  readonly durationMs: number;

  constructor(rate: number, durationMs: number, seed: number) {
    this.rate = rate;
    this.durationMs = durationMs;
    this.rng = new Prng(seed);
  }

  finished(now: number): boolean {
    return this.startedAt >= 0 && now - this.startedAt >= this.durationMs;
  }

  tick(cluster: Cluster): void {
    const now = cluster.now;
    if (this.startedAt < 0) this.startedAt = now;
    const interval = 1000 / this.rate;
    while (now - this.startedAt < this.durationMs && this.startedAt + this.seq * interval <= now) {
      const sku = this.rng.choice(SKUS, SKU_WEIGHTS);
      const quantity = this.rng.int(1, 3);
      const unitPrice = this.rng.int(5, 80);
      cluster.submit(`cust-${this.seq % 250}`, [{ sku, quantity, unitPrice }]);
      this.seq++;
    }
    if (now >= this.nextProbeAt && now - this.startedAt < this.durationMs) {
      this.nextProbeAt = now + 500;
      cluster.probeStock('SKU-ALPHA');
    }
  }
}

export interface KillPlan {
  at: number;
  service: ServiceName;
}

// Kills spread over the window with jitter; the harness only picks inventory
// or payment, never the order service that accepts the load.
export function planKills(durationMs: number, kills: number, seed: number): KillPlan[] {
  const rng = new Prng(seed ^ 0x5eed);
  const victims: ServiceName[] = ['inventory-service', 'payment-service'];
  const slot = Math.floor(durationMs / 1000 / (kills + 1));
  const plan: KillPlan[] = [];
  for (let i = 0; i < kills; i++) {
    let target = slot * (i + 1) + rng.int(0, Math.floor(slot / 2)) - Math.floor(slot / 4);
    if (target < 5) target = 5;
    plan.push({ at: target * 1000, service: victims[rng.int(0, victims.length - 1)] });
  }
  return plan;
}

// The chaos script's summary block, line for line.
export function formatSummary(stats: ClusterStats, durationS: number, rate: number): string {
  const timeline = stats.kills.map((k) => `${k.service} @${Math.round(k.at / 1000)}s`).join(', ');
  const r = stats.retries;
  const p = stats.stockProbes;
  return [
    'LedgerMesh chaos summary',
    `  load                 ${durationS}s at ${rate} orders/s`,
    `  orders submitted     ${stats.submitted}`,
    `  confirmed            ${stats.confirmed}`,
    `  cancelled (stock)    ${stats.cancelledStock}`,
    `  failed / stuck       ${stats.failed}`,
    `  kills                ${stats.kills.length}  (${timeline})`,
    `  saga latency         p50 ${Math.round(stats.p50)} ms   p95 ${Math.round(stats.p95)} ms   max ${Math.round(stats.max)} ms`,
    `  breaker transitions  ${stats.breakerTransitions.length ? stats.breakerTransitions.join('; ') : 'none'}`,
    `  retries              with retry ${r.successful_with_retry} ok / ${r.failed_with_retry} exhausted, without retry ${r.successful_without_retry} ok / ${r.failed_without_retry} failed`,
    `  deferred payments    ${stats.deferred}`,
    `  duplicate events     ${stats.duplicates} ignored by idempotent consumers`,
    `  stock probes         {'live': ${p.live}, 'cache': ${p.cache}, 'unknown': ${p.unknown}, 'error': ${p.error}}`,
  ].join('\n');
}
