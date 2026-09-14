// The plumbing every service shares: the event contracts, a Kafka-shaped log
// with committed offsets and at-least-once delivery, the transactional outbox
// with its relay, the idempotent consumer, a count-based circuit breaker, and
// the Service base class whose in-memory state a kill wipes.
import type { Prng } from './prng';

export const Topics = {
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
  INVENTORY_RESERVED: 'inventory.reserved',
  INVENTORY_REJECTED: 'inventory.rejected',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];
export type ServiceName = 'order-service' | 'inventory-service' | 'payment-service';
export type TraceSource = ServiceName | 'broker' | 'client' | 'chaos';

export interface OrderLine {
  sku: string;
  quantity: number;
}

// One envelope for all six event types; unused fields stay undefined.
export interface DomainEvent {
  type: string;
  topic: Topic;
  eventId: string;
  orderId: string;
  correlationId: string;
  occurredAt: number;
  customerId?: string;
  lines?: OrderLine[];
  amount?: number;
  reason?: string;
  authorizationCode?: string;
}

export interface Trace {
  t: number;
  source: TraceSource;
  kind: string;
  text: string;
  orderId?: string;
}

export type TraceFn = (t: Trace) => void;

export interface BusRecord {
  offset: number;
  topic: Topic;
  key: string;
  eventId: string;
  type: string;
  payload: DomainEvent;
  correlationId: string;
  appendedAt: number;
  redelivery?: boolean;
}

// A log per topic with committed offsets per consumer group. Offsets only move
// on an explicit commit, and a small share of polls hand out the previous
// record again, the way a rebalance or a lost commit would.
export class Broker {
  private logs = new Map<Topic, BusRecord[]>();
  private committed = new Map<string, number>();
  redeliveries = 0;
  private readonly rng: Prng;
  private readonly deliveryMs: number;
  private readonly redeliverChance: number;
  private readonly trace?: TraceFn;

  constructor(rng: Prng, deliveryMs: number, redeliverChance: number, trace?: TraceFn) {
    this.rng = rng;
    this.deliveryMs = deliveryMs;
    this.redeliverChance = redeliverChance;
    this.trace = trace;
  }

  append(event: DomainEvent, now: number): void {
    const log = this.log(event.topic);
    log.push({
      offset: log.length,
      topic: event.topic,
      key: event.orderId,
      eventId: event.eventId,
      type: event.type,
      payload: event,
      correlationId: event.correlationId,
      appendedAt: now,
    });
  }

  committedOffset(group: string, topic: Topic): number {
    return this.committed.get(group + '|' + topic) ?? 0;
  }

  fetch(group: string, topic: Topic, position: number, now: number): BusRecord | undefined {
    const log = this.log(topic);
    const record = log[position];
    if (!record || record.appendedAt + this.deliveryMs > now) return undefined;
    if (position > 0 && this.rng.next() < this.redeliverChance) {
      const again = log[position - 1];
      this.redeliveries++;
      this.trace?.({
        t: now,
        source: 'broker',
        kind: 'redelivery',
        text: `at-least-once: ${topic} offset ${again.offset} (${again.type}) delivered again to ${group}`,
        orderId: again.key,
      });
      return { ...again, redelivery: true };
    }
    return record;
  }

  commit(group: string, topic: Topic, nextOffset: number): void {
    const key = group + '|' + topic;
    if (nextOffset > (this.committed.get(key) ?? 0)) this.committed.set(key, nextOffset);
  }

  lag(group: string, topic: Topic): number {
    return this.log(topic).length - this.committedOffset(group, topic);
  }

  private log(topic: Topic): BusRecord[] {
    let log = this.logs.get(topic);
    if (!log) {
      log = [];
      this.logs.set(topic, log);
    }
    return log;
  }
}

interface OutboxRow {
  payload: DomainEvent;
  publishedAt?: number;
}

// The outbox_event table: durable, survives a kill, written only inside the
// same transaction as the state change it announces.
export class OutboxStore {
  rows: OutboxRow[] = [];
  private firstOpen = 0;

  append(event: DomainEvent): void {
    this.rows.push({ payload: event });
  }

  pending(limit: number): OutboxRow[] {
    while (this.firstOpen < this.rows.length && this.rows[this.firstOpen].publishedAt !== undefined) this.firstOpen++;
    const out: OutboxRow[] = [];
    for (let i = this.firstOpen; i < this.rows.length && out.length < limit; i++) {
      if (this.rows[i].publishedAt === undefined) out.push(this.rows[i]);
    }
    return out;
  }

  backlog(): number {
    return this.pending(Infinity).length;
  }
}

// Polls unpublished rows in id order and sends each to the broker. A row is
// stamped published only once the ack is observed on the following tick, so a
// kill between send and stamp re-sends the row after restart and the consumer
// sees a duplicate it ignores by event id.
export class OutboxRelay {
  private awaitingAck: OutboxRow[] = [];
  private lastRun = -Infinity;
  published = 0;
  private readonly store: OutboxStore;
  private readonly broker: Broker;
  private readonly pollMs: number;

  constructor(store: OutboxStore, broker: Broker, pollMs: number) {
    this.store = store;
    this.broker = broker;
    this.pollMs = pollMs;
  }

  tick(now: number): void {
    for (const row of this.awaitingAck) {
      row.publishedAt = now;
      this.published++;
    }
    this.awaitingAck = [];
    if (now - this.lastRun < this.pollMs) return;
    this.lastRun = now;
    for (const row of this.store.pending(200)) {
      this.broker.append(row.payload, now);
      this.awaitingAck.push(row);
    }
  }

  reset(): void {
    this.awaitingAck = [];
    this.lastRun = -Infinity;
  }

  inFlight(): number {
    return this.awaitingAck.length;
  }
}

// Runs a unit of work once per event id. The processed marker commits with the
// work, so a crash before the commit leaves nothing and a redelivery after it
// is a no-op.
export class IdempotentConsumer {
  private processed = new Set<string>();
  duplicates = 0;
  private readonly consumer: ServiceName;
  private readonly trace?: TraceFn;

  constructor(consumer: ServiceName, trace?: TraceFn) {
    this.consumer = consumer;
    this.trace = trace;
  }

  once(eventId: string, orderId: string, now: number, work: () => void): boolean {
    if (this.processed.has(eventId)) {
      this.duplicates++;
      this.trace?.({ t: now, source: this.consumer, kind: 'duplicate', text: `duplicate event ${eventId} ignored by ${this.consumer}`, orderId });
      return false;
    }
    work();
    this.processed.add(eventId);
    return true;
  }
}

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerConfig {
  slidingWindowSize: number;
  minimumNumberOfCalls: number;
  failureRateThreshold: number;
  waitDurationInOpenStateMs: number;
  permittedNumberOfCallsInHalfOpenState: number;
}

export interface BreakerTransition {
  at: number;
  from: BreakerState;
  to: BreakerState;
}

// Count-based Resilience4j breaker. Timeouts count as failures; the breaker
// moves to half-open after the open wait, permits a fixed number of trial
// calls, and closes or reopens on their outcome.
export class CircuitBreaker {
  state: BreakerState = 'CLOSED';
  window: boolean[] = [];
  private openedAt = 0;
  private halfOpenIssued = 0;
  halfOpenResults: boolean[] = [];
  onTransition?: (t: BreakerTransition) => void;
  readonly config: BreakerConfig;

  constructor(config: BreakerConfig) {
    this.config = config;
  }

  tryAcquire(now: number): boolean {
    if (this.state === 'OPEN') {
      if (now - this.openedAt < this.config.waitDurationInOpenStateMs) return false;
      this.transition('HALF_OPEN', now);
    }
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenIssued >= this.config.permittedNumberOfCallsInHalfOpenState) return false;
      this.halfOpenIssued++;
    }
    return true;
  }

  onSuccess(now: number): void {
    this.record(true, now);
  }

  onError(now: number): void {
    this.record(false, now);
  }

  failureRate(): number {
    if (this.window.length === 0) return 0;
    return (this.window.filter((ok) => !ok).length / this.window.length) * 100;
  }

  // A restarted JVM starts closed with an empty window.
  reset(): void {
    this.state = 'CLOSED';
    this.window = [];
    this.halfOpenIssued = 0;
    this.halfOpenResults = [];
  }

  reopensIn(now: number): number {
    return this.state === 'OPEN' ? Math.max(0, this.config.waitDurationInOpenStateMs - (now - this.openedAt)) : 0;
  }

  private record(ok: boolean, now: number): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenResults.push(ok);
      if (this.halfOpenResults.length >= this.config.permittedNumberOfCallsInHalfOpenState) {
        const rate = (this.halfOpenResults.filter((r) => !r).length / this.halfOpenResults.length) * 100;
        this.transition(rate >= this.config.failureRateThreshold ? 'OPEN' : 'CLOSED', now);
      }
      return;
    }
    if (this.state === 'OPEN') return;
    this.window.push(ok);
    if (this.window.length > this.config.slidingWindowSize) this.window.shift();
    if (this.window.length >= this.config.minimumNumberOfCalls && this.failureRate() >= this.config.failureRateThreshold) {
      this.transition('OPEN', now);
    }
  }

  private transition(to: BreakerState, now: number): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    if (to === 'OPEN') {
      this.openedAt = now;
      this.window = [];
    }
    if (to === 'HALF_OPEN') {
      this.halfOpenIssued = 0;
      this.halfOpenResults = [];
    }
    if (to === 'CLOSED') this.window = [];
    this.onTransition?.({ at: now, from, to });
  }
}

export interface ServiceEnv {
  broker: Broker;
  trace?: TraceFn;
  outboxPollMs: number;
  bootMs: number;
  consumerConcurrency: number;
}

// A database (outbox and processed markers, durable), a relay and Kafka
// consumers (in memory, gone on a kill). Offsets commit on the tick after the
// listener returned, exactly the window in which a kill causes a redelivery.
export abstract class Service {
  alive = true;
  readyAt = 0;
  restarts = 0;
  readonly outbox = new OutboxStore();
  readonly relay: OutboxRelay;
  readonly idempotent: IdempotentConsumer;
  private positions = new Map<Topic, number>();
  private pendingCommits: { topic: Topic; next: number }[] = [];
  readonly name: ServiceName;
  protected readonly env: ServiceEnv;
  private readonly topics: Topic[];

  protected constructor(name: ServiceName, env: ServiceEnv, topics: Topic[]) {
    this.name = name;
    this.env = env;
    this.topics = topics;
    this.relay = new OutboxRelay(this.outbox, env.broker, env.outboxPollMs);
    this.idempotent = new IdempotentConsumer(name, env.trace);
  }

  protected abstract handle(record: BusRecord, now: number): void;
  protected abstract onKilled(): void;
  protected abstract onTick(now: number): void;

  ready(now: number): boolean {
    return this.alive && now >= this.readyAt;
  }

  kill(now: number): void {
    if (!this.alive) return;
    this.alive = false;
    this.relay.reset();
    this.positions.clear();
    this.pendingCommits = [];
    this.onKilled();
    this.env.trace?.({ t: now, source: 'chaos', kind: 'kill', text: `SIGKILL ${this.name}` });
  }

  restart(now: number): void {
    if (this.alive) return;
    this.alive = true;
    this.readyAt = now + this.env.bootMs;
    this.restarts++;
    this.env.trace?.({ t: now, source: 'chaos', kind: 'restart', text: `${this.name} starting, ready in ${this.env.bootMs} ms` });
  }

  tick(now: number): void {
    if (!this.ready(now)) return;
    for (const c of this.pendingCommits) this.env.broker.commit(this.name, c.topic, c.next);
    this.pendingCommits = [];
    this.relay.tick(now);
    for (const topic of this.topics) {
      for (let i = 0; i < this.env.consumerConcurrency; i++) {
        const position = this.positions.get(topic) ?? this.env.broker.committedOffset(this.name, topic);
        const record = this.env.broker.fetch(this.name, topic, position, now);
        if (!record) break;
        this.handle(record, now);
        if (!record.redelivery) {
          this.positions.set(topic, position + 1);
          this.pendingCommits.push({ topic, next: position + 1 });
        }
      }
    }
    this.onTick(now);
  }

  lag(): number {
    let n = 0;
    for (const t of this.topics) n += this.env.broker.lag(this.name, t);
    return n;
  }
}
