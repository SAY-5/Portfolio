// Port of conduit/worker.py. Per message: inspect the payload (quarantine on a
// schema or mapping violation), ask the breaker, claim the idempotency key with
// a conditional put (a delivered key means deduplicated), take a token from the
// bucket, deliver with retries, then acknowledge. A failed delivery releases
// the claim and sets visibility to 0, so SQS redelivers it and redrives it to
// the DLQ after maxReceiveCount receives.
import { IdempotencyStore } from './idempotency';
import type { QuarantineNote } from './models';
import type { Clock, Rng } from './prng';
import type { Queue, QueueMessage } from './queue';
import { DeliveryError, retryCall, TransientError } from './retry';
import { inspect } from './schema';
import type { ConnectorSpec } from './specs';
import { deliver, type FakeTarget } from './targets';
import { CircuitBreaker, isTargetFailure, TokenBucket } from './throttle';

export type EventKind = 'submit' | 'ok' | 'dedup' | 'retry' | 'fail' | 'dlq' | 'replay' | 'quarantine' | 'breaker' | 'info';

export interface LogEvent {
  seq: number;
  t: number;
  connector: string;
  kind: EventKind;
  event: string;
  taskId: string;
  detail: string;
}

export interface WorkerStats {
  received: number;
  delivered: number;
  deduplicated: number;
  quarantined: number;
  retried: number;
  failed: number;
  deadLettered: number;
  rateLimitWaits: number;
  rateLimitWaitSeconds: number;
  retryAfterHonored: number;
  breakerOpens: number;
  breakerPausedSeconds: number;
  breakerHolds: number;
}

const emptyStats = (): WorkerStats => ({
  received: 0, delivered: 0, deduplicated: 0, quarantined: 0, retried: 0, failed: 0, deadLettered: 0,
  rateLimitWaits: 0, rateLimitWaitSeconds: 0, retryAfterHonored: 0, breakerOpens: 0, breakerPausedSeconds: 0, breakerHolds: 0,
});

export const BATCH = 10;
const PAUSE_SLICE = 1;
const IN_PROGRESS_RECHECK = 10;

export interface WorkerParts {
  spec: ConnectorSpec;
  clock: Clock;
  rng: Rng;
  queue: Queue;
  quarantine: Queue;
  target: FakeTarget;
  store: IdempotencyStore;
  log: (e: Omit<LogEvent, 'seq' | 't' | 'connector'>) => void;
}

export class Worker {
  readonly stats = emptyStats();
  readonly bucket: TokenBucket;
  readonly breaker: CircuitBreaker;
  lastNote: QuarantineNote | null = null;
  private held: QueueMessage[] = [];
  private readonly p: WorkerParts;

  constructor(parts: WorkerParts) {
    this.p = parts;
    const now = () => parts.clock.now();
    const { rateLimit, breaker } = parts.spec;
    this.bucket = new TokenBucket(rateLimit.requestsPerSecond, rateLimit.burst, rateLimit.maxRetryAfterSeconds, now);
    this.breaker = new CircuitBreaker(breaker.failureThreshold, breaker.recoverySeconds, now);
  }

  private isOpen(): boolean {
    return this.breaker.state === 'open';
  }

  // Poll and handle until this worker's clock reaches the wall clock.
  runUntil(wall: number): void {
    const { clock, queue } = this.p;
    let guard = 0;
    while (clock.now() < wall && guard++ < 10_000) {
      if (this.isOpen()) {
        const remaining = this.breaker.remaining();
        for (const m of this.held) queue.changeVisibility(m.messageId, Math.floor(remaining) + 5);
        const nap = Math.min(PAUSE_SLICE, remaining, wall - clock.now());
        clock.advance(nap);
        this.stats.breakerPausedSeconds += nap;
        if (!this.isOpen() && this.breaker.remaining() === 0) this.p.log({ kind: 'breaker', event: 'breaker.half_open', taskId: '', detail: 'one probe admitted' });
        continue;
      }
      this.held = [];
      const batch = queue.receive(BATCH);
      if (!batch.length) {
        clock.advance(wall - clock.now());
        break;
      }
      for (let i = 0; i < batch.length; i++) {
        if (this.isOpen()) {
          this.held = batch.slice(i);
          this.p.log({ kind: 'breaker', event: 'breaker.paused', taskId: '', detail: `remaining=${this.breaker.remaining().toFixed(1)}s held=${this.held.length}` });
          break;
        }
        this.handle(batch[i]);
      }
    }
  }

  private noteTransient(err: TransientError, taskId: string): void {
    if (err.status === 429 && err.retryAfter !== null) {
      this.bucket.penalize(err.retryAfter);
      this.stats.retryAfterHonored += 1;
    }
    if (isTargetFailure(err.status) && this.breaker.recordFailure()) {
      this.stats.breakerOpens += 1;
      this.p.log({ kind: 'breaker', event: 'breaker.open', taskId, detail: `threshold=${this.breaker.failureThreshold} recovery=${this.breaker.recoverySeconds}s` });
    }
  }

  private noteTargetOk(taskId: string): void {
    if (this.breaker.recordSuccess()) this.p.log({ kind: 'breaker', event: 'breaker.closed', taskId, detail: 'probe succeeded' });
  }

  handle(message: QueueMessage): void {
    const { spec, clock, queue, store, target, log } = this.p;
    const env = message.envelope;
    const { task } = env;
    const key = env.idempotencyKey;
    const s = this.stats;
    s.received += 1;

    const note = inspect(spec, task);
    if (note) {
      this.p.quarantine.send({ ...env, quarantine: note });
      queue.delete(message.messageId);
      s.quarantined += 1;
      this.lastNote = note;
      log({ kind: 'quarantine', event: 'delivery.quarantined', taskId: task.id, detail: `stage=${note.stage} field=${note.field} reason=${note.reason}` });
      return;
    }

    if (!this.breaker.allow()) {
      const hold = Math.floor(this.breaker.remaining()) + 1;
      queue.changeVisibility(message.messageId, hold);
      s.breakerHolds += 1;
      return;
    }

    const claim = store.claim(key, spec.name, task.id);
    if (!claim.acquired) {
      if (claim.state === 'delivered') {
        queue.delete(message.messageId);
        s.deduplicated += 1;
        log({ kind: 'dedup', event: 'delivery.deduplicated', taskId: task.id, detail: `key=${key.slice(0, 12)} remote_id=${claim.remoteId ?? 'none'}` });
      } else {
        queue.changeVisibility(message.messageId, IN_PROGRESS_RECHECK);
      }
      return;
    }

    const remoteId = task.version > 1 ? store.latest(spec.name, task.id) : null;
    const wait = this.bucket.acquire();
    if (wait > 0) {
      s.rateLimitWaits += 1;
      s.rateLimitWaitSeconds += wait;
      clock.advance(wait);
    }

    try {
      const { value, outcome } = retryCall(
        () => deliver(spec, target, task, key, remoteId, env.attempt > 0),
        spec.retry,
        this.p.rng,
        (seconds) => clock.advance(seconds),
        (attempt, delay, err) => {
          s.retried += 1;
          queue.changeVisibility(message.messageId, Math.floor(delay + spec.retry.timeoutSeconds) + 5);
          log({ kind: 'retry', event: 'delivery.retry', taskId: task.id, detail: `attempt=${attempt} delay=${delay.toFixed(3)}s HTTP ${err.status}` });
          this.noteTransient(err, task.id);
        },
      );
      this.noteTargetOk(task.id);
      clock.advance(target.lastLatency);
      store.markDelivered(key, value);
      queue.delete(message.messageId);
      s.delivered += 1;
      log({ kind: 'ok', event: 'delivery.ok', taskId: task.id, detail: `remote_id=${value ?? 'none'} attempts=${outcome.attempts}` });
    } catch (exc) {
      const err = exc as DeliveryError;
      store.release(key);
      if (err instanceof TransientError) this.noteTransient(err, task.id);
      else this.noteTargetOk(task.id);
      s.failed += 1;
      const willDeadLetter = message.receiveCount >= spec.queue.maxReceiveCount;
      if (willDeadLetter) s.deadLettered += 1;
      log({
        kind: willDeadLetter ? 'dlq' : 'fail',
        event: 'delivery.failed',
        taskId: task.id,
        detail: `reason=${err.retryable ? 'exhausted' : 'permanent'} receive_count=${message.receiveCount} dead_letter=${willDeadLetter} HTTP ${err.status}`,
      });
      queue.changeVisibility(message.messageId, 0);
    }
  }
}
