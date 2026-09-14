// The three services of the saga. Order accepts orders, drives the state
// machine and emits compensation; inventory reserves a whole order atomically;
// payment records the payment inside the consumer transaction, authorizes
// outside it through Retry(CircuitBreaker(TimeLimiter(call))), and turns
// exhaustion or an open breaker into a deferred payment the sweeper retries.
import {
  CircuitBreaker,
  Service,
  Topics,
  type BreakerConfig,
  type BusRecord,
  type DomainEvent,
  type OrderLine,
  type ServiceEnv,
} from './bus';
import { bucket, hex, type Prng } from './prng';

export type OrderStatus = 'PENDING' | 'RESERVED' | 'CONFIRMED' | 'CANCELLED';
type SagaEvent = 'INVENTORY_RESERVED' | 'INVENTORY_REJECTED' | 'PAYMENT_COMPLETED' | 'PAYMENT_FAILED';

export function isTerminal(status: OrderStatus): boolean {
  return status === 'CONFIRMED' || status === 'CANCELLED';
}

// PENDING + INVENTORY_RESERVED -> RESERVED; PENDING + INVENTORY_REJECTED ->
// CANCELLED (OUT_OF_STOCK); RESERVED + PAYMENT_COMPLETED -> CONFIRMED;
// RESERVED + PAYMENT_FAILED -> CANCELLED (PAYMENT_DECLINED) and release stock.
function applyTransition(current: OrderStatus, event: SagaEvent) {
  if (isTerminal(current)) return null;
  switch (event) {
    case 'INVENTORY_RESERVED':
      return current === 'PENDING' ? { to: 'RESERVED' as const, reason: null, release: false } : null;
    case 'INVENTORY_REJECTED':
      return current === 'PENDING' ? { to: 'CANCELLED' as const, reason: 'OUT_OF_STOCK', release: false } : null;
    case 'PAYMENT_COMPLETED':
      return { to: 'CONFIRMED' as const, reason: null, release: false };
    case 'PAYMENT_FAILED':
      return { to: 'CANCELLED' as const, reason: 'PAYMENT_DECLINED', release: true };
  }
}

const SIGNALS: Record<string, SagaEvent> = {
  [Topics.INVENTORY_RESERVED]: 'INVENTORY_RESERVED',
  [Topics.INVENTORY_REJECTED]: 'INVENTORY_REJECTED',
  [Topics.PAYMENT_COMPLETED]: 'PAYMENT_COMPLETED',
  [Topics.PAYMENT_FAILED]: 'PAYMENT_FAILED',
};

export interface OrderItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  amount: number;
  status: OrderStatus;
  reason: string | null;
  correlationId: string;
  createdAt: number;
  updatedAt: number;
  path: OrderStatus[];
}

export type StockSource = 'live' | 'cache' | 'unknown';

export interface StockView {
  sku: string;
  available: number | null;
  source: StockSource;
}

// Redis stock:{sku}. Shared infrastructure outside the inventory process, so
// it survives a kill; every entry carries a TTL.
export class StockCache {
  private entries = new Map<string, { value: number; expiresAt: number }>();
  hits = 0;
  misses = 0;
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  read(sku: string, now: number): number | undefined {
    const entry = this.entries.get(sku);
    if (!entry || entry.expiresAt <= now) {
      if (entry) this.entries.delete(sku);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  write(sku: string, available: number, now: number): void {
    this.entries.set(sku, { value: available, expiresAt: now + this.ttlMs });
  }
}

function linesOf(items: { sku: string; quantity: number }[]): OrderLine[] {
  return items.map((i) => ({ sku: i.sku, quantity: i.quantity }));
}

function merge(lines: OrderLine[]): Map<string, number> {
  const wanted = new Map<string, number>();
  for (const line of lines) wanted.set(line.sku, (wanted.get(line.sku) ?? 0) + line.quantity);
  return wanted;
}

export class InventoryService extends Service {
  readonly stock = new Map<string, number>();
  reservations = { reserved: 0, rejected: 0 };
  releases = 0;
  private readonly rng: Prng;
  readonly cache: StockCache;

  constructor(env: ServiceEnv, rng: Prng, cache: StockCache) {
    super('inventory-service', env, [Topics.ORDER_CREATED, Topics.ORDER_CANCELLED]);
    this.rng = rng;
    this.cache = cache;
  }

  seed(entries: Record<string, number>, now: number): void {
    for (const [sku, available] of Object.entries(entries)) {
      this.stock.set(sku, available);
      this.cache.write(sku, available, now);
    }
  }

  // Rows locked in sku order, every line checked, then every line decremented.
  reserve(lines: OrderLine[]): Map<string, number> | string {
    const wanted = merge(lines);
    const skus = [...wanted.keys()].sort();
    if (skus.some((sku) => !this.stock.has(sku))) return 'UNKNOWN_SKU';
    if (skus.some((sku) => (this.stock.get(sku) ?? 0) < (wanted.get(sku) ?? 0))) return 'OUT_OF_STOCK';
    const remaining = new Map<string, number>();
    for (const sku of skus) {
      const left = (this.stock.get(sku) ?? 0) - (wanted.get(sku) ?? 0);
      this.stock.set(sku, left);
      remaining.set(sku, left);
    }
    return remaining;
  }

  // GET /stock/{sku}: cache first, database on a miss, the miss written through.
  available(sku: string, now: number): number | undefined {
    const cached = this.cache.read(sku, now);
    if (cached !== undefined) return cached;
    const value = this.stock.get(sku);
    if (value !== undefined) this.cache.write(sku, value, now);
    return value;
  }

  protected handle(record: BusRecord, now: number): void {
    const event = record.payload;
    if (record.topic === Topics.ORDER_CREATED) {
      this.idempotent.once(record.eventId, record.key, now, () => this.onCreated(event, now));
    } else if (record.topic === Topics.ORDER_CANCELLED) {
      this.idempotent.once(record.eventId, record.key, now, () => {
        const wanted = merge(event.lines ?? []);
        for (const sku of [...wanted.keys()].sort()) {
          if (!this.stock.has(sku)) continue;
          const back = (this.stock.get(sku) ?? 0) + (wanted.get(sku) ?? 0);
          this.stock.set(sku, back);
          this.cache.write(sku, back, now);
        }
        this.releases++;
      });
    }
  }

  protected onKilled(): void {}

  protected onTick(): void {}

  private onCreated(event: DomainEvent, now: number): void {
    const outcome = this.reserve(event.lines ?? []);
    const base = { eventId: this.rng.id('evt'), orderId: event.orderId, correlationId: event.correlationId, occurredAt: now };
    if (typeof outcome === 'string') {
      this.outbox.append({ ...base, type: 'InventoryRejected', topic: Topics.INVENTORY_REJECTED, reason: outcome });
      this.reservations.rejected++;
      return;
    }
    this.outbox.append({
      ...base,
      type: 'InventoryReserved',
      topic: Topics.INVENTORY_RESERVED,
      customerId: event.customerId,
      lines: event.lines,
      amount: event.amount,
    });
    this.reservations.reserved++;
    for (const [sku, left] of outcome) this.cache.write(sku, left, now);
  }
}

export const INVENTORY_BREAKER: BreakerConfig = {
  slidingWindowSize: 10,
  minimumNumberOfCalls: 4,
  failureRateThreshold: 50,
  waitDurationInOpenStateMs: 5000,
  permittedNumberOfCallsInHalfOpenState: 2,
};

const STOCK_TIME_LIMIT_MS = 800;

interface StockCall {
  sku: string;
  startedAt: number;
  resolveAt: number;
  ok: boolean;
  value: number | null;
  onDone: (view: StockView) => void;
}

export class OrderService extends Service {
  readonly orders = new Map<string, Order>();
  readonly breaker = new CircuitBreaker(INVENTORY_BREAKER);
  private lastKnown = new Map<string, StockView>();
  private stockCalls: StockCall[] = [];
  latencies: number[] = [];
  onTerminal?: (order: Order, now: number) => void;
  private readonly rng: Prng;
  private readonly inventory: () => InventoryService;

  constructor(env: ServiceEnv, rng: Prng, inventory: () => InventoryService) {
    super('order-service', env, [Topics.INVENTORY_RESERVED, Topics.INVENTORY_REJECTED, Topics.PAYMENT_COMPLETED, Topics.PAYMENT_FAILED]);
    this.rng = rng;
    this.inventory = inventory;
  }

  // POST /orders: the order row and the order.created outbox row commit together.
  create(customerId: string, items: OrderItem[], now: number): Order {
    const id = this.rng.id('ord');
    const correlationId = this.rng.id('req');
    const amount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const order: Order = { id, customerId, items, amount, status: 'PENDING', reason: null, correlationId, createdAt: now, updatedAt: now, path: ['PENDING'] };
    this.orders.set(id, order);
    this.outbox.append({
      type: 'OrderCreated',
      topic: Topics.ORDER_CREATED,
      eventId: this.rng.id('evt'),
      orderId: id,
      correlationId,
      occurredAt: now,
      customerId,
      lines: linesOf(items),
      amount,
    });
    return order;
  }

  // GET /stock/{sku} behind the breaker and an 800 ms time limiter, with the
  // last live value for the sku as the fallback.
  stock(sku: string, now: number, onDone: (view: StockView) => void): void {
    if (!this.breaker.tryAcquire(now)) {
      onDone(this.fromCache(sku));
      return;
    }
    const inventory = this.inventory();
    const live = inventory.ready(now);
    const value = live ? inventory.available(sku, now) : null;
    const latency = live ? 12 + this.rng.int(0, 40) : STOCK_TIME_LIMIT_MS;
    this.stockCalls.push({ sku, startedAt: now, resolveAt: now + latency, ok: live, value: value ?? null, onDone });
  }

  protected handle(record: BusRecord, now: number): void {
    const signal = SIGNALS[record.topic];
    if (!signal) return;
    this.idempotent.once(record.eventId, record.key, now, () => this.apply(record.key, signal, record.correlationId, now));
  }

  protected onKilled(): void {
    this.breaker.reset();
    this.stockCalls = [];
    this.lastKnown.clear();
  }

  protected onTick(now: number): void {
    if (this.stockCalls.length === 0) return;
    const inventory = this.inventory();
    const remaining: StockCall[] = [];
    for (const call of this.stockCalls) {
      if (call.ok && !inventory.alive) {
        call.ok = false;
        call.resolveAt = call.startedAt + STOCK_TIME_LIMIT_MS;
      }
      if (call.resolveAt > now) {
        remaining.push(call);
        continue;
      }
      if (call.ok) {
        this.breaker.onSuccess(now);
        const view: StockView = { sku: call.sku, available: call.value, source: 'live' };
        this.lastKnown.set(call.sku, view);
        call.onDone(view);
      } else {
        this.breaker.onError(now);
        call.onDone(this.fromCache(call.sku));
      }
    }
    this.stockCalls = remaining;
  }

  private apply(orderId: string, signal: SagaEvent, correlationId: string, now: number): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    const t = applyTransition(order.status, signal);
    if (!t) return;
    order.status = t.to;
    order.reason = t.reason;
    order.updatedAt = now;
    order.path.push(t.to);
    if (t.release) {
      this.outbox.append({
        type: 'OrderCancelled',
        topic: Topics.ORDER_CANCELLED,
        eventId: this.rng.id('evt'),
        orderId,
        correlationId,
        occurredAt: now,
        reason: t.reason ?? '',
        lines: linesOf(order.items),
      });
    }
    if (isTerminal(t.to)) {
      this.latencies.push(now - order.createdAt);
      this.onTerminal?.(order, now);
    }
  }

  private fromCache(sku: string): StockView {
    const cached = this.lastKnown.get(sku);
    return cached ? { ...cached, source: 'cache' } : { sku, available: null, source: 'unknown' };
  }
}

export type PaymentStatus = 'NEW' | 'DEFERRED' | 'AUTHORIZED' | 'DECLINED';

export interface Payment {
  orderId: string;
  customerId: string;
  amount: number;
  correlationId: string;
  status: PaymentStatus;
  attempts: number;
  nextAttemptAt: number;
}

export interface ProcessorConfig {
  limit: number;
  transientPercent: number;
  slowPercent: number;
  slowMillis: number;
}

export const PROCESSOR_BREAKER: BreakerConfig = {
  slidingWindowSize: 20,
  minimumNumberOfCalls: 10,
  failureRateThreshold: 60,
  waitDurationInOpenStateMs: 5000,
  permittedNumberOfCallsInHalfOpenState: 3,
};

export const PAYMENT = { maxAttempts: 3, retryWaitMs: 200, timeLimitMs: 1000, sweepMs: 1000, graceMs: 3000, retryDelayMs: 2000 };

type Result =
  | { kind: 'approved'; code: string; latency: number }
  | { kind: 'declined'; reason: string; latency: number }
  | { kind: 'transient'; latency: number }
  | { kind: 'slow'; latency: number };

type Outcome = { kind: 'authorized'; code: string } | { kind: 'declined'; reason: string } | { kind: 'deferred'; reason: string };

interface Call {
  orderId: string;
  attempts: number;
  phase: 'running' | 'waiting';
  resolveAt: number;
  result?: Result;
}

function isOpen(status: PaymentStatus): boolean {
  return status === 'NEW' || status === 'DEFERRED';
}

export class PaymentService extends Service {
  readonly payments = new Map<string, Payment>();
  readonly breaker = new CircuitBreaker(PROCESSOR_BREAKER);
  readonly retries = { successful_without_retry: 0, successful_with_retry: 0, failed_with_retry: 0, failed_without_retry: 0 };
  deferred = 0;
  private calls: Call[] = [];
  private lastSweep = -Infinity;
  private readonly rng: Prng;
  readonly processor: ProcessorConfig;

  constructor(env: ServiceEnv, rng: Prng, processor: ProcessorConfig) {
    super('payment-service', env, [Topics.INVENTORY_RESERVED]);
    this.rng = rng;
    this.processor = processor;
  }

  inFlight(): number {
    return this.calls.length;
  }

  openPayments(): number {
    let n = 0;
    for (const p of this.payments.values()) if (isOpen(p.status)) n++;
    return n;
  }

  protected handle(record: BusRecord, now: number): void {
    if (record.topic !== Topics.INVENTORY_RESERVED) return;
    const event = record.payload;
    const recorded = this.idempotent.once(record.eventId, record.key, now, () => {
      if (this.payments.has(event.orderId)) return;
      this.payments.set(event.orderId, {
        orderId: event.orderId,
        customerId: event.customerId ?? '',
        amount: event.amount ?? 0,
        correlationId: event.correlationId,
        status: 'NEW',
        attempts: 0,
        nextAttemptAt: now + PAYMENT.graceMs,
      });
    });
    if (recorded) this.attempt(event.orderId, now);
  }

  // In-flight authorizations vanish with the JVM; the rows stay NEW and the
  // sweeper finds them once the grace period is over.
  protected onKilled(): void {
    this.calls = [];
    this.breaker.reset();
    this.lastSweep = -Infinity;
  }

  protected onTick(now: number): void {
    const remaining: Call[] = [];
    for (const call of this.calls) {
      if (call.resolveAt > now) {
        remaining.push(call);
        continue;
      }
      if (call.phase === 'waiting') {
        if (this.startAttempt(call, now)) remaining.push(call);
        continue;
      }
      const result = call.result;
      if (!result) continue;
      if (result.kind === 'approved' || result.kind === 'declined') {
        this.breaker.onSuccess(now);
        if (call.attempts > 1) this.retries.successful_with_retry++;
        else this.retries.successful_without_retry++;
        this.commit(call.orderId, result.kind === 'approved' ? { kind: 'authorized', code: result.code } : { kind: 'declined', reason: result.reason }, now);
        continue;
      }
      this.breaker.onError(now);
      const error = result.kind === 'slow' ? 'TimeoutException (1 s time limit)' : 'ProcessorUnavailableException';
      if (call.attempts < PAYMENT.maxAttempts) {
        call.phase = 'waiting';
        call.resolveAt = now + PAYMENT.retryWaitMs;
        call.result = undefined;
        remaining.push(call);
      } else {
        this.retries.failed_with_retry++;
        this.commit(call.orderId, { kind: 'deferred', reason: error }, now);
      }
    }
    this.calls = remaining;
    if (now - this.lastSweep >= PAYMENT.sweepMs) {
      this.lastSweep = now;
      this.sweep(now);
    }
  }

  private attempt(orderId: string, now: number): boolean {
    const payment = this.payments.get(orderId);
    if (!payment || !isOpen(payment.status)) return false;
    if (this.calls.some((c) => c.orderId === orderId)) return false;
    const call: Call = { orderId, attempts: 0, phase: 'running', resolveAt: now };
    if (this.startAttempt(call, now)) this.calls.push(call);
    return true;
  }

  private startAttempt(call: Call, now: number): boolean {
    const payment = this.payments.get(call.orderId);
    if (!payment || !isOpen(payment.status)) return false;
    if (!this.breaker.tryAcquire(now)) {
      // CallNotPermitted is not in the retry list: defer immediately.
      this.retries.failed_without_retry++;
      this.commit(call.orderId, { kind: 'deferred', reason: 'CallNotPermittedException' }, now);
      return false;
    }
    call.attempts++;
    const result = this.authorize(payment, payment.attempts * PAYMENT.maxAttempts + call.attempts);
    call.result = result;
    call.phase = 'running';
    call.resolveAt = now + Math.min(result.latency, PAYMENT.timeLimitMs);
    return true;
  }

  // Deterministic synthetic processor: the outcome depends only on the order
  // id and the attempt number.
  private authorize(payment: Payment, attempt: number): Result {
    const base = 40 + (bucket(payment.orderId + ':lat:' + attempt) % 80);
    if (payment.customerId.endsWith('-declined')) return { kind: 'declined', reason: 'CARD_DECLINED', latency: base };
    if (payment.amount > this.processor.limit) return { kind: 'declined', reason: 'OVER_LIMIT', latency: base };
    const b = bucket(payment.orderId + ':' + attempt);
    if (b < this.processor.transientPercent) return { kind: 'transient', latency: 15 };
    if (b < this.processor.transientPercent + this.processor.slowPercent) return { kind: 'slow', latency: this.processor.slowMillis };
    return { kind: 'approved', code: 'AUTH-' + hex(payment.orderId, 12).toUpperCase(), latency: base };
  }

  private commit(orderId: string, outcome: Outcome, now: number): void {
    const payment = this.payments.get(orderId);
    if (!payment || !isOpen(payment.status)) return;
    payment.attempts++;
    const base = { eventId: '', orderId, correlationId: payment.correlationId, occurredAt: now };
    if (outcome.kind === 'authorized') {
      payment.status = 'AUTHORIZED';
      this.outbox.append({ ...base, eventId: this.rng.id('evt'), type: 'PaymentCompleted', topic: Topics.PAYMENT_COMPLETED, authorizationCode: outcome.code });
    } else if (outcome.kind === 'declined') {
      payment.status = 'DECLINED';
      this.outbox.append({ ...base, eventId: this.rng.id('evt'), type: 'PaymentFailed', topic: Topics.PAYMENT_FAILED, reason: outcome.reason });
    } else {
      const backoff = PAYMENT.retryDelayMs * Math.min(payment.attempts, 5);
      payment.status = 'DEFERRED';
      payment.nextAttemptAt = now + backoff;
      this.deferred++;
      this.env.trace?.({ t: now, source: 'payment-service', kind: 'deferred', text: `deferred (${outcome.reason}); next_attempt_at +${backoff / 1000} s`, orderId });
    }
  }

  // Attempts every open payment whose retry time has come, oldest first, up to 100.
  private sweep(now: number): void {
    const due: Payment[] = [];
    for (const p of this.payments.values()) if (isOpen(p.status) && p.nextAttemptAt <= now) due.push(p);
    due.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
    for (const p of due.slice(0, 100)) {
      if (this.attempt(p.orderId, now)) {
        this.env.trace?.({ t: now, source: 'payment-service', kind: 'sweep', text: `sweeper picked up open payment (${p.status}, ${p.attempts} attempt(s) so far)`, orderId: p.orderId });
      }
    }
  }
}
