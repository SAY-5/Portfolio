// Drives the conduit run on a virtual clock and flattens queues, workers,
// the jira-support token bucket, the webhook-crm breaker and the plan into a
// plain snapshot for the panels.
import { ConduitRun, CONNECTORS, type Phase, type Summary } from './engine';
import type { QuarantineNote } from './models';
import type { PlannedResource } from './terraform';
import type { BreakerState } from './throttle';
import type { LogEvent } from './worker';

export const TICK_MS = 100;
const RUN_DT = 0.25;
const LAB_DT = 0.5;

export interface LaneSnap {
  name: string;
  type: string;
  rate: number;
  burst: number;
  maxReceive: number;
  queued: number;
  inFlight: number;
  delivered: number;
  dedup: number;
  retried: number;
  paced: number;
  dlq: number;
  quarantine: number;
  breaker: BreakerState;
}

export interface Snap {
  phase: Phase;
  busy: boolean;
  wall: number;
  submitted: number;
  lanes: LaneSnap[];
  bucket: { tokens: number; capacity: number; rate: number; waits: number; waitSeconds: number; honored: number; rejected: number; maxPenalty: number };
  breaker: { state: BreakerState; remaining: number; opens: number; paused: number; threshold: number; recovery: number; failures: number; outage: boolean };
  deadLetters: { id: string; receives: number; replays: number }[];
  quarantine: { depth: number; dlq: number; note: QuarantineNote | null };
  log: LogEvent[];
  summary: Summary | null;
  plan: { summary: string; add: PlannedResource[] };
}

export class ConduitSim {
  run = new ConduitRun();

  tick(): void {
    this.run.tick(this.run.busy ? RUN_DT : LAB_DT);
  }

  start(): void {
    this.run = new ConduitRun();
    this.run.start();
  }

  reset(): void {
    this.run = new ConduitRun();
  }

  sendMalformed(): void {
    if (!this.run.busy) this.run.sendMalformed();
  }

  setOutage(on: boolean): void {
    if (!this.run.busy) this.run.setOutage(on);
  }

  replay(): void {
    if (!this.run.busy) this.run.replay('webhook-crm');
  }

  snapshot(): Snap {
    const { run } = this;
    const jira = run.connectors['jira-support'];
    const webhook = run.connectors['webhook-crm'];
    return {
      phase: run.phase,
      busy: run.busy,
      wall: run.wall,
      submitted: run.submitted,
      lanes: CONNECTORS.map((name) => {
        const c = run.connectors[name];
        const depth = c.queue.depth();
        const st = c.worker.stats;
        return {
          name,
          type: c.spec.type,
          rate: c.spec.rateLimit.requestsPerSecond,
          burst: c.spec.rateLimit.burst,
          maxReceive: c.spec.queue.maxReceiveCount,
          queued: depth.visible,
          inFlight: depth.inFlight,
          delivered: c.target.inbox.length,
          dedup: st.deduplicated,
          retried: st.retried,
          paced: st.rateLimitWaits,
          dlq: c.dlq.messages.length,
          quarantine: c.quarantine.messages.length,
          breaker: c.worker.breaker.state,
        };
      }),
      bucket: {
        tokens: jira.worker.bucket.level(),
        capacity: jira.worker.bucket.capacity,
        rate: jira.worker.bucket.rate,
        waits: jira.worker.stats.rateLimitWaits,
        waitSeconds: jira.worker.stats.rateLimitWaitSeconds,
        honored: jira.worker.stats.retryAfterHonored,
        rejected: jira.target.rejected,
        maxPenalty: jira.worker.bucket.maxPenalty,
      },
      breaker: {
        state: webhook.worker.breaker.state,
        remaining: webhook.worker.breaker.remaining(),
        opens: webhook.worker.stats.breakerOpens,
        paused: webhook.worker.stats.breakerPausedSeconds,
        threshold: webhook.worker.breaker.failureThreshold,
        recovery: webhook.worker.breaker.recoverySeconds,
        failures: webhook.worker.breaker.failures,
        outage: webhook.target.faults.outage,
      },
      deadLetters: webhook.dlq.messages.map((m) => ({ id: m.envelope.task.id, receives: m.receiveCount, replays: m.replays })),
      quarantine: { depth: jira.quarantine.messages.length, dlq: jira.dlq.messages.length, note: jira.quarantine.messages[jira.quarantine.messages.length - 1]?.envelope.quarantine ?? null },
      log: run.log.slice(-8).reverse(),
      summary: run.summary,
      plan: { summary: run.planDiff.summary, add: run.planDiff.add },
    };
  }
}
