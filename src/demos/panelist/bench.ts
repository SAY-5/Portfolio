// The workbench behind the race, attention and delivery panels: a small seeded
// platform (8 experts, 36 tasks, a quarter of them golden, 3 s leases) that
// every panel acts on, flattened into a plain snapshot for rendering.

import { DEMO_SETTINGS, EPOCH_MS, Platform, ServiceError, type Decision, type Delivery, type Expert, type Task, type TaskStatus, type Tier } from './platform';
import { Rng } from './prng';
import { seedPlatform } from './run';
import { sha256Hex, utf8Length } from './sha256';
import { CRITERIA, createWorld, gradeFor, weighted, type SimTask, type World } from './world';

export const BENCH_SEED = 3;
/** The reviewer spot check from sim/demo.py: reject a grade whose weighted score drifts more than 1.5. */
export const SPOT_CHECK_DRIFT = 1.5;

export interface RaceRow {
  expert: string;
  code: number;
  detail: string;
}

export interface Verdict {
  ref: string;
  golden: boolean;
  careless: boolean;
  passed: boolean | null;
  maxDeviation: number | null;
  rows: { key: string; expected: number | null; submitted: number }[];
  weighted: number;
  review: Decision | null;
  payoutCents: number | null;
  pausedNow: boolean;
  withheldNow: number;
}

export interface RaceSnap {
  ref: string;
  tags: string[];
  minTier: Tier;
  priority: number;
  status: TaskStatus;
  rows: RaceRow[];
  owner: string | null;
  leaseLeftMs: number | null;
  reclaims: number;
  blocked: number;
  swept: number | null;
}

export interface AttentionSnap {
  expert: string;
  tier: Tier;
  tags: string[];
  paused: boolean;
  rate: number | null;
  passed: number;
  checks: number;
  history: boolean[];
  window: number;
  threshold: number;
  minChecks: number;
  tolerance: number;
  lifetimePassed: number;
  lifetimeTotal: number;
  pendingCount: number;
  pendingCents: number;
  withheldCount: number;
  withheldCents: number;
  goldenLeft: number;
  regularLeft: number;
  verdict: Verdict | null;
  note: string | null;
}

export interface DeliverySnap {
  rows: number;
  unreviewed: number;
  bytes: number;
  checksum: string;
  tampered: string | null;
  nextName: string;
  sample: { ref: string; expert: string; weighted: number }[];
  versions: Delivery[];
  reviewed: { approved: number; rejected: number } | null;
}

export interface BenchSnap {
  elapsedMs: number;
  leaseSeconds: number;
  race: RaceSnap | null;
  attention: AttentionSnap;
  delivery: DeliverySnap;
}

function at(ms: number): string {
  return `t+${(ms / 1000).toFixed(1)} s`;
}

export class Bench {
  readonly platform: Platform;
  readonly world: World;
  private readonly rng: Rng;
  private readonly simById: Map<string, SimTask>;
  private readonly raceId: string | null;
  private readonly attentionId: string;
  private raceRows: RaceRow[] = [];
  private swept: number | null = null;
  private verdict: Verdict | null = null;
  private note: string | null = null;
  private reviewed: { approved: number; rejected: number } | null = null;
  private cache: { body: string | null; sum: string; bytes: number; tampered: string | null } = { body: null, sum: '', bytes: 0, tampered: null };

  constructor(seed: number = BENCH_SEED) {
    this.world = createWorld({ seed, experts: 8, tasks: 36, goldenShare: 0.25, now: EPOCH_MS });
    this.platform = seedPlatform(this.world, DEMO_SETTINGS);
    this.rng = new Rng(seed * 31 + 5);
    this.simById = new Map(this.world.tasks.map((t) => [t.id, t]));
    // A few careful grades up front, as in the source workbench, so review and delivery have material.
    for (const sim of this.world.experts.slice(0, 3)) {
      if (sim.careless) continue;
      for (let i = 0; i < 2; i++) {
        const r = this.platform.claimNext(this.platform.expert(sim.id));
        if (!r.ok) break;
        const simTask = this.simById.get(r.task.id);
        if (!simTask) break;
        const g = gradeFor(this.rng, sim, simTask);
        this.platform.submitGrade(this.platform.expert(sim.id), r.task.id, g.scores, g.rationale, g.timeSpentSeconds);
        this.platform.advance(400);
      }
    }
    this.raceId = this.contested()[0]?.id ?? null;
    const fits = (id: string) => {
      const e = this.platform.expert(id);
      return this.goldenFor(e).length >= 2 && this.regularFor(e).length >= 2;
    };
    const pick = this.world.experts.find((e) => e.careless && fits(e.id)) ?? this.world.experts.find((e) => fits(e.id)) ?? this.world.experts[0];
    this.attentionId = pick.id;
  }

  private contested(): Task[] {
    const p = this.platform;
    return p.tasks
      .filter((t) => t.status === 'queued' && !t.isAttentionCheck)
      .map((t) => ({ t, n: p.experts.filter((e) => p.isEligible(e, t)).length }))
      .filter((c) => c.n >= 2)
      .sort((a, b) => b.n - a.n || a.t.seq - b.t.seq)
      .map((c) => c.t);
  }

  private goldenFor(e: Expert): Task[] {
    return this.platform.candidates(e, true);
  }

  private regularFor(e: Expert): Task[] {
    return this.platform.candidates(e, false).filter((t) => t.id !== this.raceId);
  }

  /** The virtual clock only moves while a lease is outstanding. */
  tick(ms: number): void {
    if (this.platform.tasks.some((t) => t.status === 'assigned')) this.platform.advance(ms);
  }

  /** Every eligible expert issues POST /tasks/{id}/claim against the same row. */
  race(): void {
    const p = this.platform;
    const task = this.raceId ? p.task(this.raceId) : null;
    if (!task || task.status !== 'queued') return;
    const claimants = p.experts.filter((e) => p.isEligible(e, task));
    this.raceRows = [];
    this.swept = null;
    for (const e of claimants) {
      try {
        const t = p.claimById(e, task.id, true);
        this.raceRows.push({ expert: e.name, code: 201, detail: `assigned, lease until ${at((t.leaseExpiresAt ?? 0) - EPOCH_MS)}` });
      } catch (err) {
        if (!(err instanceof ServiceError)) throw err;
        this.raceRows.push({ expert: e.name, code: err.statusCode, detail: err.detail });
      }
    }
    p.releaseLock(task.id);
  }

  sweep(): void {
    this.swept = this.platform.reclaimExpired();
  }

  /** Claim a regular task or serve a golden check to the attention expert, then grade it. */
  grade(golden: boolean, careless: boolean): void {
    const p = this.platform;
    const e = p.expert(this.attentionId);
    this.note = null;
    if (e.status !== 'active') {
      this.note = `423: expert is ${e.status}, claims are refused until reinstated`;
      return;
    }
    const task = (golden ? this.goldenFor(e) : this.regularFor(e))[0];
    if (!task) {
      this.note = golden ? 'no golden task is eligible for this expert' : '204: queue empty for this expert';
      return;
    }
    p.claimById(e, task.id);
    const truth = this.simById.get(task.id)?.trueScores ?? {};
    const body = gradeFor(this.rng, { careless }, { trueScores: truth });
    const grade = p.submitGrade(e, task.id, body.scores, body.rationale, body.timeSpentSeconds);
    const result = p.attention.find((a) => a.gradeId === grade.id) ?? null;
    let review: Decision | null = null;
    let payoutCents: number | null = null;
    if (!golden) {
      review = Math.abs(grade.weightedScore - weighted(truth)) > SPOT_CHECK_DRIFT ? 'reject' : 'approve';
      payoutCents = p.review(grade.id, review)?.amountCents ?? null;
    }
    const expected = task.expectedScores;
    this.verdict = {
      ref: task.externalRef,
      golden,
      careless,
      passed: result ? result.passed : null,
      maxDeviation: result ? result.maxDeviation : null,
      rows: CRITERIA.map((key) => ({ key, expected: expected ? (expected[key] ?? null) : null, submitted: body.scores[key] ?? 0 })),
      weighted: grade.weightedScore,
      review,
      payoutCents,
      pausedNow: p.expert(this.attentionId).status === 'paused',
      withheldNow: p.payouts.filter((x) => x.expertId === e.id && x.status === 'withheld').length,
    };
  }

  reinstate(): void {
    const n = this.platform.reinstate(this.platform.expert(this.attentionId));
    this.verdict = null;
    this.note = `reinstated, ${n} withheld payout${n === 1 ? '' : 's'} moved back to pending`;
  }

  /** The reviewer spot check over every unreviewed grade. */
  reviewPending(): void {
    const p = this.platform;
    let approved = 0;
    let rejected = 0;
    for (const g of p.unreviewedGrades()) {
      const truth = this.simById.get(g.taskId)?.trueScores;
      if (!truth) continue;
      const decision: Decision = Math.abs(g.weightedScore - weighted(truth)) > SPOT_CHECK_DRIFT ? 'reject' : 'approve';
      p.review(g.id, decision);
      if (decision === 'approve') approved++;
      else rejected++;
    }
    this.reviewed = { approved, rejected };
  }

  exportVersion(): void {
    if (this.platform.deliveryRows().length > 0) this.platform.exportDelivery();
  }

  snapshot(): BenchSnap {
    const p = this.platform;
    const raceTask = this.raceId ? p.task(this.raceId) : null;
    const race: RaceSnap | null = raceTask
      ? {
          ref: raceTask.externalRef,
          tags: [...raceTask.requiredTags],
          minTier: raceTask.minTier,
          priority: raceTask.priority,
          status: raceTask.status,
          rows: [...this.raceRows],
          owner: raceTask.assignedExpertId ? p.expert(raceTask.assignedExpertId).name : null,
          leaseLeftMs: raceTask.leaseExpiresAt === null ? null : raceTask.leaseExpiresAt - p.now,
          reclaims: raceTask.reclaimCount,
          blocked: p.metrics.doubleAssignBlocked,
          swept: this.swept,
        }
      : null;

    const e = p.expert(this.attentionId);
    const [rate, passed, checks] = p.rollingPassRate(e.id);
    const life = p.lifetimeAttention(e.id);
    const mine = p.payouts.filter((x) => x.expertId === e.id);
    const pending = mine.filter((x) => x.status === 'pending');
    const withheld = mine.filter((x) => x.status === 'withheld');
    const s = p.settings;
    const attention: AttentionSnap = {
      expert: e.name,
      tier: e.tier,
      tags: [...e.tags],
      paused: e.status === 'paused',
      rate,
      passed,
      checks,
      history: p.recentChecks(e.id).reverse().map((r) => r.passed),
      window: s.attentionWindow,
      threshold: s.attentionThreshold,
      minChecks: s.attentionMinChecks,
      tolerance: s.attentionTolerance,
      lifetimePassed: life.passed,
      lifetimeTotal: life.total,
      pendingCount: pending.length,
      pendingCents: pending.reduce((n, x) => n + x.amountCents, 0),
      withheldCount: withheld.length,
      withheldCents: withheld.reduce((n, x) => n + x.amountCents, 0),
      goldenLeft: this.goldenFor(e).length,
      regularLeft: this.regularFor(e).length,
      verdict: this.verdict,
      note: this.note,
    };

    const rows = p.deliveryRows();
    const body = Platform.jsonl(rows);
    if (body !== this.cache.body) {
      const tamperedRows = rows.map((r, i) => (i === 0 ? { ...r, rationale: `${r.rationale} (edited)` } : r));
      this.cache = {
        body,
        sum: sha256Hex(body),
        bytes: utf8Length(body),
        tampered: rows.length ? sha256Hex(Platform.jsonl(tamperedRows)) : null,
      };
    }
    const delivery: DeliverySnap = {
      rows: rows.length,
      unreviewed: p.unreviewedGrades().length,
      bytes: this.cache.bytes,
      checksum: this.cache.sum,
      tampered: this.cache.tampered,
      nextName: `panelist-grades-v${p.deliveries.length + 1}-${this.cache.sum.slice(0, 12)}.jsonl`,
      sample: rows.slice(0, 4).map((r) => ({ ref: r.external_ref, expert: p.expert(r.expert_id).name, weighted: r.weighted_score })),
      versions: p.deliveries.map((d) => ({ ...d })),
      reviewed: this.reviewed,
    };

    return { elapsedMs: p.now - EPOCH_MS, leaseSeconds: s.leaseSeconds, race, attention, delivery };
  }
}
