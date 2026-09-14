// Drains the 500-task run in slices so the page stays responsive, keeps a
// short log of the notable events, and measures the compute time the run
// took in this browser.

import { createRun, RUN_OPTIONS, type FullRun, type RunEvent, type RunStats, type RunSummary } from './run';

export interface LogRow {
  seq: number;
  kind: string;
  text: string;
  flagged: boolean;
}

export interface RunSnap {
  started: boolean;
  running: boolean;
  done: boolean;
  drained: number;
  events: number;
  stats: RunStats | null;
  log: LogRow[];
  summary: RunSummary | null;
  computeMs: number;
}

const LOG_LIMIT = 7;

export function money(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Text for the events worth logging; claims, empty queues and passed checks are skipped. */
function describe(e: RunEvent): { text: string; flagged: boolean } | null {
  switch (e.kind) {
    case 'phase':
      return { text: `phase: ${e.name}`, flagged: false };
    case 'contention':
      return { text: `${e.claimed} simultaneous claims landed on ${e.unique} distinct rows; ${e.blocked} of ${e.attempts} steal attempts blocked with 409`, flagged: false };
    case 'reclaimed':
      return { text: `${e.count} expired lease${e.count === 1 ? '' : 's'} back in the queue: ${e.refs.slice(0, 3).join(', ')}`, flagged: true };
    case 'attention':
      return e.passed ? null : { text: `${e.expert} failed check ${e.ref}, max deviation ${e.maxDeviation}, rolling ${pct(e.rate)} over ${e.checks}`, flagged: true };
    case 'paused':
      return { text: `${e.expert} paused at ${pct(e.rate)} over ${e.checks} checks, ${e.withheld} pending payouts withheld`, flagged: true };
    case 'grade-conflict':
      return { text: `${e.expert} lost ${e.ref}: the lease had already been reclaimed`, flagged: true };
    case 'sweep':
      return { text: `admin sweep returned ${e.reclaimed} lease${e.reclaimed === 1 ? '' : 's'}`, flagged: false };
    case 'review-rejected':
      return { text: `${e.expert} rejected on ${e.ref}, drift ${e.drift.toFixed(2)} from the known answer`, flagged: true };
    case 'reviewed':
      return { text: `${e.approved} approved, ${e.rejected} rejected`, flagged: false };
    case 'period':
      return { text: `${e.label}: ${e.payouts} payouts, ${money(e.totalCents)} to ${e.experts} experts, ${money(e.withheldCents)} withheld`, flagged: false };
    case 'delivery':
      return { text: `v${e.version}: ${e.rows} rows, ${e.bytes.toLocaleString('en-US')} bytes, sha256 ${e.checksum.slice(0, 12)}`, flagged: false };
    default:
      return null;
  }
}

export class RunDriver {
  private run: FullRun | null = null;
  private summary: RunSummary | null = null;
  private log: LogRow[] = [];
  private seq = 0;
  private events = 0;
  private computeMs = 0;
  private running = false;

  start(): void {
    if (!this.run) this.run = createRun(RUN_OPTIONS);
    if (!this.summary) this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  reset(): void {
    this.run = null;
    this.summary = null;
    this.log = [];
    this.seq = 0;
    this.events = 0;
    this.computeMs = 0;
    this.running = false;
  }

  /** Consume up to maxEvents events; returns true once the run has finished. */
  step(maxEvents: number): boolean {
    const run = this.run;
    if (!run || this.summary) return this.summary !== null;
    const t0 = performance.now();
    for (let i = 0; i < maxEvents; i++) {
      const next = run.steps.next();
      if (next.done) {
        this.summary = next.value;
        this.running = false;
        break;
      }
      this.events += 1;
      const row = describe(next.value);
      if (row) {
        this.log.push({ seq: ++this.seq, kind: next.value.kind, ...row });
        if (this.log.length > LOG_LIMIT) this.log.shift();
      }
    }
    this.computeMs += performance.now() - t0;
    return this.summary !== null;
  }

  /** Drain to the end in one go, used when reduced motion is requested. */
  finish(): void {
    this.start();
    while (!this.step(1000)) {
      // keep draining
    }
  }

  snapshot(): RunSnap {
    const tasks = this.run ? this.run.platform.tasks.filter((t) => !t.isAttentionCheck) : [];
    const queued = tasks.filter((t) => t.status === 'queued').length;
    return {
      started: this.run !== null,
      running: this.running,
      done: this.summary !== null,
      drained: tasks.length ? (tasks.length - queued) / tasks.length : 0,
      events: this.events,
      stats: this.run ? { ...this.run.stats, paused: [...this.run.stats.paused] } : null,
      log: [...this.log],
      summary: this.summary,
      computeMs: this.computeMs,
    };
  }
}
