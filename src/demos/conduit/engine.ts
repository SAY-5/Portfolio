// The browser stand-in for deploy/docker-compose.yml and demo/run.py: one
// work queue, DLQ and quarantine queue per connector, one worker per
// connector on its own clock, three fake targets, and the make demo scenario.
// 300 tasks (80 unique plus 20 resubmits per connector) go out with faults on:
// the Jira fake answers 429 twice for 30 tasks and the webhook fake answers 400
// for 10. The queues drain, the webhook fault is cleared, the dead letters are
// replayed, and a fourth connector YAML is planned.
import { idempotencyKey } from './idempotency';
import { makeTask, type Task } from './models';
import { IdempotencyStore } from './idempotency';
import { Clock, Rng } from './prng';
import { Queue, replayDeadLetters } from './queue';
import { CONNECTOR_YAML, dlqName, loadSpec, NEW_CONNECTOR_NAME, NEW_CONNECTOR_YAML, quarantineName, queueName, type ConnectorSpec } from './specs';
import { FakeTarget, noFaults } from './targets';
import { diffPlans, plan } from './terraform';
import { Worker, type EventKind, type LogEvent } from './worker';

export const RUN_ID = 'D7DC282';
export const UNIQUE_PER_CONNECTOR = 80;
export const DUPLICATES_PER_CONNECTOR = 20;
export const JIRA_RATE_LIMITED_TASKS = 30;
export const JIRA_429_ATTEMPTS = 2;
export const WEBHOOK_HARD_FAIL_TASKS = 10;
export const CONNECTORS = ['jira-support', 'slack-ops', 'webhook-crm'] as const;
export type ConnectorName = (typeof CONNECTORS)[number];
const LOG_LIMIT = 400;
const BASE_PLAN = plan(CONNECTOR_YAML);
const FULL_PLAN = plan({ ...CONNECTOR_YAML, [NEW_CONNECTOR_NAME]: NEW_CONNECTOR_YAML });
// Plan totals: the shared table, 7 resources per connector and one SSM parameter per
// secret make 26 for the shipped three connectors and 34 once the fourth file is added.
export const PLAN_TOTALS = { base: BASE_PLAN.length, after: FULL_PLAN.length };

export interface Connector {
  spec: ConnectorSpec;
  clock: Clock;
  queue: Queue;
  dlq: Queue;
  quarantine: Queue;
  target: FakeTarget;
  worker: Worker;
}

export type Phase = 'idle' | 'draining' | 'clearing' | 'replaying' | 'done';

export interface Summary {
  submitted: number;
  unique: number;
  duplicates: number;
  deduplicated: number;
  delivered: Record<string, number>;
  deliveredAfter: number;
  retried: number;
  rejected429: number;
  rateLimitedTasks: number;
  paced: number;
  deadLettered: number;
  deadLetterIds: string[];
  replayed: number;
  dlqAfterReplay: number;
  webhookAfter: number;
  planSummary: string;
  planBase: number;
  planAfter: number;
  planAdded: string[];
  ok: boolean;
  problems: string[];
}

type PhaseOne = Pick<Summary, 'delivered' | 'retried' | 'rejected429' | 'rateLimitedTasks' | 'paced' | 'deadLetterIds'> & { deduplicated: number };

export class ConduitRun {
  wall = 0;
  phase: Phase = 'idle';
  submitted = 0;
  duplicates = 0;
  summary: Summary | null = null;
  outageBatches = 0;
  readonly rng = new Rng(RUN_ID);
  readonly store = new IdempotencyStore(() => this.wall);
  readonly connectors = {} as Record<ConnectorName, Connector>;
  readonly log: LogEvent[] = [];
  readonly planDiff = diffPlans(BASE_PLAN, FULL_PLAN);
  private seq = 0;
  private phaseAt = 0;
  private phaseOne: PhaseOne | null = null;
  private replayed = 0;

  constructor() {
    for (const name of CONNECTORS) {
      const spec = loadSpec(name, CONNECTOR_YAML[name]);
      const clock = new Clock();
      const now = () => clock.now();
      const queue = new Queue(queueName(name), now, spec.queue.visibilityTimeoutSeconds);
      const dlq = new Queue(dlqName(name), now, 30);
      queue.dlq = dlq;
      queue.maxReceiveCount = spec.queue.maxReceiveCount;
      const quarantine = new Queue(quarantineName(name), now, 30);
      const target = new FakeTarget(spec, this.rng);
      const worker = new Worker({ spec, clock, rng: this.rng, queue, quarantine, target, store: this.store, log: (e) => this.emit(name, e) });
      this.connectors[name] = { spec, clock, queue, dlq, quarantine, target, worker };
    }
  }

  get busy(): boolean {
    return this.phase === 'draining' || this.phase === 'clearing' || this.phase === 'replaying';
  }

  emit(connector: string, e: { kind: EventKind; event: string; taskId: string; detail: string }): void {
    this.log.push({ ...e, connector, seq: ++this.seq, t: this.wall });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  private submit(name: ConnectorName, tasks: Task[]): void {
    const { queue } = this.connectors[name];
    for (const task of tasks) {
      queue.send({ task, connector: name, idempotencyKey: idempotencyKey(name, task.id, task.version), submittedAt: this.wall, attempt: 0 });
    }
  }

  // conduit submit with faults on: the first half of demo/run.py.
  start(): void {
    if (this.phase !== 'idle') return;
    const tasks = {} as Record<ConnectorName, Task[]>;
    for (const name of CONNECTORS) {
      tasks[name] = Array.from({ length: UNIQUE_PER_CONNECTOR }, (_, i) =>
        makeTask({
          id: `${RUN_ID}-${name}-${String(i + 1).padStart(4, '0')}`,
          title: `Synthetic task ${i + 1} for ${name}`,
          body: `Body of task ${i + 1}`,
          priority: this.rng.choice(['low', 'normal', 'high']),
          labels: [name.split('-')[0], 'demo'],
        }),
      );
    }
    const hardFailed = new Set(tasks['webhook-crm'].slice(0, WEBHOOK_HARD_FAIL_TASKS).map((t) => t.id));
    this.connectors['jira-support'].target.setFaults({ rateLimitTasks: new Set(tasks['jira-support'].slice(0, JIRA_RATE_LIMITED_TASKS).map((t) => t.id)), rateLimitCount: JIRA_429_ATTEMPTS });
    this.connectors['webhook-crm'].target.setFaults({ hardFailTasks: hardFailed });
    for (const name of CONNECTORS) {
      const resubmits = this.rng.sample(tasks[name].filter((t) => !hardFailed.has(t.id)), DUPLICATES_PER_CONNECTOR);
      const batch = this.rng.shuffle([...tasks[name], ...resubmits]);
      this.submit(name, batch);
      this.submitted += batch.length;
      this.duplicates += resubmits.length;
      this.emit(name, { kind: 'submit', event: 'submit', taskId: '', detail: `${batch.length} messages (${tasks[name].length} unique, ${resubmits.length} resubmits)` });
    }
    this.phase = 'draining';
  }

  private queuesEmpty(): boolean {
    return CONNECTORS.every((n) => this.connectors[n].queue.messages.length === 0);
  }

  tick(dt: number): void {
    this.wall += dt;
    for (const name of CONNECTORS) this.connectors[name].worker.runUntil(this.wall);
    const webhook = this.connectors['webhook-crm'];
    if (this.phase === 'draining' && this.queuesEmpty()) {
      this.phaseOne = this.capture();
      webhook.target.setFaults(noFaults());
      this.emit('webhook-crm', { kind: 'info', event: 'faults.cleared', taskId: '', detail: 'DELETE /_faults on the webhook fake' });
      this.phase = 'clearing';
      this.phaseAt = this.wall;
    } else if (this.phase === 'clearing' && this.wall - this.phaseAt >= 1) {
      this.replayed = this.replay('webhook-crm');
      this.phase = 'replaying';
    } else if (this.phase === 'replaying' && this.queuesEmpty()) {
      this.summary = this.summarize();
      this.phase = 'done';
    }
  }

  private capture(): PhaseOne {
    const c = this.connectors;
    return {
      delivered: Object.fromEntries(CONNECTORS.map((n) => [n, c[n].target.inbox.length])),
      deduplicated: CONNECTORS.reduce((s, n) => s + c[n].worker.stats.deduplicated, 0),
      retried: CONNECTORS.reduce((s, n) => s + c[n].worker.stats.retried, 0),
      rejected429: c['jira-support'].target.rejected,
      rateLimitedTasks: c['jira-support'].target.rateLimitHits.size,
      paced: CONNECTORS.reduce((s, n) => s + c[n].worker.stats.rateLimitWaits, 0),
      deadLetterIds: c['webhook-crm'].dlq.messages.map((m) => m.envelope.task.id).sort(),
    };
  }

  private summarize(): Summary {
    const one = this.phaseOne!;
    const webhook = this.connectors['webhook-crm'];
    const s: Summary = {
      ...one,
      submitted: this.submitted,
      unique: UNIQUE_PER_CONNECTOR * CONNECTORS.length,
      duplicates: this.duplicates,
      deliveredAfter: CONNECTORS.reduce((n, c) => n + this.connectors[c].target.inbox.length, 0),
      deadLettered: one.deadLetterIds.length,
      replayed: this.replayed,
      dlqAfterReplay: webhook.dlq.messages.length,
      webhookAfter: webhook.target.inbox.length,
      planSummary: this.planDiff.summary,
      planBase: PLAN_TOTALS.base,
      planAfter: PLAN_TOTALS.after,
      planAdded: this.planDiff.add.map((r) => r.address),
      ok: true,
      problems: [],
    };
    const check = (ok: boolean, problem: string) => ok || s.problems.push(problem);
    check(s.submitted === 300, `submitted ${s.submitted}`);
    check(s.deduplicated === s.duplicates, `deduplicated ${s.deduplicated} != duplicates ${s.duplicates}`);
    check(s.deadLettered === WEBHOOK_HARD_FAIL_TASKS, `dead letters ${s.deadLettered}`);
    check(s.dlqAfterReplay === 0 && s.webhookAfter === UNIQUE_PER_CONNECTOR, 'replay did not drain the DLQ');
    check(s.retried === JIRA_RATE_LIMITED_TASKS * JIRA_429_ATTEMPTS, `retried ${s.retried}`);
    check(s.planAdded.length === 8, `planned ${s.planAdded.length}`);
    check(s.planBase === 26 && s.planAfter === 34, `stack ${s.planBase} then ${s.planAfter}`);
    s.ok = s.problems.length === 0;
    return s;
  }

  // conduit dlq replay -c <name>
  replay(name: ConnectorName): number {
    const c = this.connectors[name];
    const moved = replayDeadLetters(c.dlq, c.queue);
    for (const m of moved) this.emit(name, { kind: 'replay', event: 'dlq.replay', taskId: m.envelope.task.id, detail: `attempt=${m.envelope.attempt + 1} back onto ${c.queue.name}` });
    return moved.length;
  }

  // A payload the jira-support v2 schema rejects: priority is not in its enum.
  sendMalformed(): void {
    this.submit('jira-support', [makeTask({ id: 'T-91', title: 'Card payments failing at checkout', priority: 'critical', labels: ['billing'] })]);
    this.emit('jira-support', { kind: 'submit', event: 'submit', taskId: 'T-91', detail: '1 message, priority critical' });
  }

  // The fakes' outage fault: every call answers 503 until it is cleared.
  setOutage(on: boolean): void {
    const webhook = this.connectors['webhook-crm'];
    webhook.target.setFaults({ outage: on });
    this.emit('webhook-crm', { kind: 'info', event: on ? 'faults.outage' : 'faults.cleared', taskId: '', detail: on ? 'POST /_faults outage=true' : 'DELETE /_faults' });
    if (on) {
      this.outageBatches += 1;
      const batch = Array.from({ length: 6 }, (_, i) =>
        makeTask({ id: `OUT-${this.outageBatches}-${i + 1}`, title: `Account update ${i + 1}`, status: 'open', labels: ['crm'] }),
      );
      this.submit('webhook-crm', batch);
      this.emit('webhook-crm', { kind: 'submit', event: 'submit', taskId: '', detail: `${batch.length} messages into the outage` });
    }
  }
}
