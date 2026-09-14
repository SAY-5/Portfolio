// In-memory port of the panelist service layer: routing under row locks with
// leases, rubric grading, hidden attention checks, reviews, payouts and the
// checksummed JSONL delivery. Each method mirrors a function in
// panelist/services; a row held by an open FOR UPDATE claim is a locked id.

import { Rng } from './prng';
import { sha256Hex, utf8Length } from './sha256';

export type Tier = 'junior' | 'senior' | 'lead';
export const TIER_RANK: Record<Tier, number> = { junior: 0, senior: 1, lead: 2 };
export type ExpertStatus = 'active' | 'paused';
export type TaskStatus = 'queued' | 'assigned' | 'submitted' | 'approved' | 'rejected';
export type PayoutStatus = 'pending' | 'withheld' | 'paid';
export type Decision = 'approve' | 'reject';

export const EPOCH_MS = Date.UTC(2026, 8, 1, 9, 0, 0);

export interface Settings {
  leaseSeconds: number;
  attentionFraction: number;
  attentionWindow: number;
  attentionMinChecks: number;
  attentionThreshold: number;
  attentionTolerance: number;
  deliveryBucket: string;
}

/** sim/demo.py overrides: 3 s leases, one serve in five golden, two checks can pause. */
export const DEMO_SETTINGS: Settings = {
  leaseSeconds: 3,
  attentionFraction: 0.2,
  attentionWindow: 10,
  attentionMinChecks: 2,
  attentionThreshold: 0.7,
  attentionTolerance: 1,
  deliveryBucket: 'panelist-deliveries',
};

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  position: number;
}

export interface Rubric {
  id: string;
  name: string;
  version: number;
  criteria: Criterion[];
}

export interface RateCard {
  tier: Tier;
  taskType: string;
  rateCents: number;
}

export interface Expert {
  id: string;
  name: string;
  tags: string[];
  tier: Tier;
  status: ExpertStatus;
  servedCount: number;
}

export interface TaskInput {
  externalRef: string;
  prompt: string;
  responses: { model: string; text: string }[];
  requiredTags: string[];
  taskType: string;
  minTier: Tier;
  priority: number;
  deadline: number | null;
  requiredGrades: number;
  isAttentionCheck: boolean;
  expectedScores: Record<string, number> | null;
}

export interface Task extends TaskInput {
  id: string;
  seq: number;
  rubricId: string;
  status: TaskStatus;
  gradesReceived: number;
  assignedExpertId: string | null;
  leaseExpiresAt: number | null;
  reclaimCount: number;
}

export interface Grade {
  id: string;
  seq: number;
  taskId: string;
  expertId: string;
  scores: Record<string, number>;
  rationale: string;
  timeSpentSeconds: number;
  weightedScore: number;
  review: Decision | null;
}

export interface Payout {
  id: string;
  seq: number;
  expertId: string;
  taskId: string;
  gradeId: string;
  amountCents: number;
  status: PayoutStatus;
  periodId: string | null;
}

export interface AttentionResult {
  seq: number;
  taskId: string;
  expertId: string;
  gradeId: string;
  passed: boolean;
  maxDeviation: number;
}

export interface Delivery {
  version: number;
  checksum: string;
  name: string;
  location: string;
  rowCount: number;
  sizeBytes: number;
}

export interface PeriodTotals {
  id: string;
  label: string;
  payoutCount: number;
  totalCents: number;
  expertCount: number;
}

export interface Agreement {
  multiGradedTasks: number;
  comparedPairs: number;
  meanAbsDiff: number | null;
  exactAgreement: number | null;
  withinOne: number | null;
}

export interface DeliveryRow {
  task_id: string;
  external_ref: string;
  task_type: string;
  required_tags: string[];
  prompt: string;
  responses: { model: string; text: string }[];
  rubric: { id: string; name: string; version: number };
  expert_id: string;
  expert_tier: Tier;
  scores: Record<string, number>;
  weighted_score: number;
  rationale: string;
  time_spent_seconds: number;
}

export type ClaimResult =
  | { ok: true; task: Task; preferredGolden: boolean }
  | { ok: false; statusCode: 204 | 423; detail: string };

export class ServiceError extends Error {
  readonly statusCode: number;
  readonly detail: string;
  constructor(statusCode: number, detail: string) {
    super(detail);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/** json.dumps(sort_keys=True, separators=(",", ":")) */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export class Platform {
  readonly settings: Settings;
  now: number;
  readonly experts: Expert[] = [];
  readonly tasks: Task[] = [];
  readonly grades: Grade[] = [];
  readonly payouts: Payout[] = [];
  readonly attention: AttentionResult[] = [];
  readonly deliveries: Delivery[] = [];
  rubric: Rubric | null = null;
  readonly metrics = { claimsAssigned: 0, claimsEmpty: 0, doubleAssignBlocked: 0, gradesTotal: 0, expertsPaused: 0 };

  private readonly rates = new Map<string, number>();
  private readonly locked = new Set<string>();
  private readonly gradedPairs = new Set<string>();
  private readonly periodLabels = new Set<string>();
  private readonly ids: Rng;
  private taskSeq = 0;
  private gradeSeq = 0;
  private payoutSeq = 0;
  private attentionSeq = 0;

  constructor(settings: Settings, idSeed: number, now: number = EPOCH_MS) {
    this.settings = settings;
    this.ids = new Rng(idSeed);
    this.now = now;
  }

  advance(ms: number): void {
    if (ms < 0) throw new Error('clock cannot move backwards');
    this.now += ms;
  }

  // ----- seeding ------------------------------------------------------------

  createRubric(name: string, version: number, criteria: { key: string; label: string; weight: number }[]): Rubric {
    this.rubric = {
      id: this.ids.uuid(),
      name,
      version,
      criteria: criteria.map((c, i) => ({ ...c, scaleMin: 1, scaleMax: 5, position: i })),
    };
    return this.rubric;
  }

  putRateCards(cards: RateCard[]): void {
    for (const card of cards) this.rates.set(`${card.tier}:${card.taskType}`, card.rateCents);
  }

  createExpert(name: string, tags: string[], tier: Tier): Expert {
    const expert: Expert = { id: this.ids.uuid(), name, tags: [...tags], tier, status: 'active', servedCount: 0 };
    this.experts.push(expert);
    return expert;
  }

  createTasks(inputs: TaskInput[]): Task[] {
    if (!this.rubric) throw new ServiceError(422, 'no rubric');
    const rubricId = this.rubric.id;
    return inputs.map((input) => {
      const task: Task = {
        ...input,
        responses: input.responses.map((r) => ({ ...r })),
        requiredTags: [...input.requiredTags],
        expectedScores: input.expectedScores ? { ...input.expectedScores } : null,
        id: this.ids.uuid(),
        seq: ++this.taskSeq,
        rubricId,
        status: 'queued',
        gradesReceived: 0,
        assignedExpertId: null,
        leaseExpiresAt: null,
        reclaimCount: 0,
      };
      this.tasks.push(task);
      return task;
    });
  }

  expert(id: string): Expert {
    const e = this.experts.find((x) => x.id === id);
    if (!e) throw new ServiceError(404, 'expert not found');
    return e;
  }

  task(id: string): Task {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new ServiceError(404, 'task not found');
    return t;
  }

  // ----- routing (services/routing.py) ---------------------------------------

  /** UPDATE tasks SET status='queued' WHERE status='assigned' AND lease_expires_at < now() */
  reclaimExpired(): number {
    let n = 0;
    for (const t of this.tasks) {
      if (t.status === 'assigned' && t.leaseExpiresAt !== null && t.leaseExpiresAt < this.now && !this.locked.has(t.id)) {
        t.status = 'queued';
        t.assignedExpertId = null;
        t.leaseExpiresAt = null;
        t.reclaimCount += 1;
        n++;
      }
    }
    return n;
  }

  /** queued AND required_tags && expert.tags AND min_tier <= tier AND not graded by this expert */
  isEligible(expert: Expert, task: Task): boolean {
    if (task.status !== 'queued') return false;
    if (!task.requiredTags.some((tag) => expert.tags.includes(tag))) return false;
    if (TIER_RANK[task.minTier] > TIER_RANK[expert.tier]) return false;
    return !this.gradedPairs.has(`${task.id}:${expert.id}`);
  }

  /** ORDER BY priority DESC, deadline ASC NULLS LAST, seq ASC */
  static order(a: Task, b: Task): number {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.deadline !== b.deadline) {
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return a.deadline - b.deadline;
    }
    return a.seq - b.seq;
  }

  /** The candidate list an expert would see, locked rows skipped. */
  candidates(expert: Expert, wantAttention: boolean | null = null): Task[] {
    return this.tasks
      .filter((t) => (wantAttention === null || t.isAttentionCheck === wantAttention) && this.isEligible(expert, t) && !this.locked.has(t.id))
      .sort(Platform.order);
  }

  private assign(task: Task, expert: Expert): Task {
    task.status = 'assigned';
    task.assignedExpertId = expert.id;
    task.leaseExpiresAt = this.now + this.settings.leaseSeconds * 1000;
    expert.servedCount += 1;
    return task;
  }

  prefersAttention(expert: Expert): boolean {
    const f = this.settings.attentionFraction;
    const period = f ? Math.max(1, Math.round(1 / f)) : 0;
    return period > 0 && (expert.servedCount + 1) % period === 0;
  }

  /** POST /tasks/next */
  claimNext(expert: Expert): ClaimResult {
    if (expert.status !== 'active') return { ok: false, statusCode: 423, detail: `expert is ${expert.status}` };
    this.reclaimExpired();
    const preferredGolden = this.prefersAttention(expert);
    let task = preferredGolden ? this.candidates(expert, true)[0] : undefined;
    if (task === undefined) task = this.candidates(expert, false)[0];
    if (task === undefined) {
      this.metrics.claimsEmpty += 1;
      return { ok: false, statusCode: 204, detail: 'queue empty for this expert' };
    }
    this.metrics.claimsAssigned += 1;
    return { ok: true, task: this.assign(task, expert), preferredGolden };
  }

  /** POST /tasks/{id}/claim; holdLock keeps the row locked until releaseLock(). */
  claimById(expert: Expert, taskId: string, holdLock = false): Task {
    if (expert.status !== 'active') throw new ServiceError(423, `expert is ${expert.status}`);
    this.reclaimExpired();
    const task = this.task(taskId);
    if (this.locked.has(task.id)) {
      this.metrics.doubleAssignBlocked += 1;
      throw new ServiceError(409, 'task is being claimed by another expert');
    }
    if (task.status !== 'queued') {
      this.metrics.doubleAssignBlocked += 1;
      throw new ServiceError(409, `task is ${task.status}`);
    }
    if (!task.requiredTags.some((tag) => expert.tags.includes(tag))) {
      throw new ServiceError(403, 'task requires expertise the expert does not have');
    }
    if (TIER_RANK[task.minTier] > TIER_RANK[expert.tier]) throw new ServiceError(403, 'task requires a higher tier');
    this.metrics.claimsAssigned += 1;
    if (holdLock) this.locked.add(task.id);
    return this.assign(task, expert);
  }

  releaseLock(taskId: string): void {
    this.locked.delete(taskId);
  }

  /** POST /tasks/{id}/release */
  release(expert: Expert, taskId: string): Task {
    const task = this.task(taskId);
    if (task.status !== 'assigned' || task.assignedExpertId !== expert.id) {
      throw new ServiceError(409, 'task is not assigned to this expert');
    }
    task.status = 'queued';
    task.assignedExpertId = null;
    task.leaseExpiresAt = null;
    return task;
  }

  queueSummary(): Record<TaskStatus, number> {
    const out: Record<TaskStatus, number> = { queued: 0, assigned: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const t of this.tasks) out[t.status] += 1;
    return out;
  }

  // ----- grading and attention (services/grading.py, attention.py) -----------

  weighted(scores: Record<string, number>): number {
    const criteria = this.rubric?.criteria ?? [];
    const total = criteria.reduce((s, c) => s + c.weight, 0) || 1;
    return criteria.reduce((s, c) => s + (scores[c.key] ?? 0) * c.weight, 0) / total;
  }

  private validateScores(scores: Record<string, number>): void {
    const byKey = new Map((this.rubric?.criteria ?? []).map((c) => [c.key, c]));
    const missing = [...byKey.keys()].filter((k) => !(k in scores));
    const unknown = Object.keys(scores).filter((k) => !byKey.has(k));
    if (missing.length || unknown.length) {
      throw new ServiceError(422, `scores mismatch rubric: missing=[${missing.join(', ')}] unknown=[${unknown.join(', ')}]`);
    }
    for (const [key, value] of Object.entries(scores)) {
      const c = byKey.get(key);
      if (c && !(c.scaleMin <= value && value <= c.scaleMax)) {
        throw new ServiceError(422, `score for ${key} must be within [${c.scaleMin}, ${c.scaleMax}]`);
      }
    }
  }

  /** POST /grades */
  submitGrade(expert: Expert, taskId: string, scores: Record<string, number>, rationale: string, timeSpentSeconds: number): Grade {
    const task = this.task(taskId);
    if (task.status !== 'assigned' || task.assignedExpertId !== expert.id) {
      throw new ServiceError(409, 'task is not assigned to this expert');
    }
    this.validateScores(scores);
    const grade: Grade = {
      id: this.ids.uuid(),
      seq: ++this.gradeSeq,
      taskId: task.id,
      expertId: expert.id,
      scores: { ...scores },
      rationale,
      timeSpentSeconds,
      weightedScore: this.weighted(scores),
      review: null,
    };
    this.grades.push(grade);
    this.gradedPairs.add(`${task.id}:${expert.id}`);
    this.metrics.gradesTotal += 1;
    task.gradesReceived += 1;
    task.assignedExpertId = null;
    task.leaseExpiresAt = null;
    task.status = task.isAttentionCheck || task.gradesReceived < task.requiredGrades ? 'queued' : 'submitted';

    if (task.isAttentionCheck && task.expectedScores) {
      const expected = task.expectedScores;
      const deviations = Object.keys(expected).map((k) => Math.abs((grade.scores[k] ?? 0) - (expected[k] ?? 0)));
      const maxDeviation = deviations.length ? Math.max(...deviations) : 0;
      const passed = maxDeviation <= this.settings.attentionTolerance;
      this.attention.push({ seq: ++this.attentionSeq, taskId: task.id, expertId: expert.id, gradeId: grade.id, passed, maxDeviation });
      if (!passed) this.enforceAttention(expert);
    }
    return grade;
  }

  /** Pass rate over the most recent attentionWindow checks: [rate, passed, total]. */
  rollingPassRate(expertId: string): [number | null, number, number] {
    const recent = this.recentChecks(expertId);
    if (recent.length === 0) return [null, 0, 0];
    const passed = recent.filter((r) => r.passed).length;
    return [passed / recent.length, passed, recent.length];
  }

  /** The window of checks, newest first. */
  recentChecks(expertId: string): AttentionResult[] {
    return this.attention
      .filter((r) => r.expertId === expertId)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, this.settings.attentionWindow);
  }

  /** Pause the expert and withhold pending payouts when the rolling rate is too low. */
  private enforceAttention(expert: Expert): boolean {
    const [rate, , total] = this.rollingPassRate(expert.id);
    if (rate === null || total < this.settings.attentionMinChecks || rate >= this.settings.attentionThreshold) return false;
    if (expert.status === 'paused') return false;
    expert.status = 'paused';
    for (const p of this.payouts) if (p.expertId === expert.id && p.status === 'pending') p.status = 'withheld';
    this.metrics.expertsPaused += 1;
    return true;
  }

  /** PATCH /experts/{id}/status active: releases withheld payouts. */
  reinstate(expert: Expert): number {
    expert.status = 'active';
    let n = 0;
    for (const p of this.payouts) {
      if (p.expertId === expert.id && p.status === 'withheld') {
        p.status = 'pending';
        n++;
      }
    }
    return n;
  }

  lifetimeAttention(expertId: string): { total: number; passed: number } {
    const mine = this.attention.filter((r) => r.expertId === expertId);
    return { total: mine.length, passed: mine.filter((r) => r.passed).length };
  }

  // ----- reviews and payouts (services/grading.py, payouts.py) ---------------

  rateFor(expert: Expert, taskType: string): number {
    const rate = this.rates.get(`${expert.tier}:${taskType}`) ?? this.rates.get(`${expert.tier}:default`);
    if (rate === undefined) throw new ServiceError(422, `no rate configured for tier=${expert.tier} type=${taskType}`);
    return rate;
  }

  /** POST /reviews: an approval creates the payout, withheld if the expert is paused. */
  review(gradeId: string, decision: Decision): Payout | null {
    const grade = this.grades.find((g) => g.id === gradeId);
    if (!grade) throw new ServiceError(404, 'grade not found');
    if (grade.review !== null) throw new ServiceError(409, 'grade already reviewed');
    grade.review = decision;
    const task = this.task(grade.taskId);
    let payout: Payout | null = null;
    if (decision === 'approve') {
      const expert = this.expert(grade.expertId);
      payout = {
        id: this.ids.uuid(),
        seq: ++this.payoutSeq,
        expertId: expert.id,
        taskId: task.id,
        gradeId: grade.id,
        amountCents: this.rateFor(expert, task.taskType),
        status: expert.status === 'paused' ? 'withheld' : 'pending',
        periodId: null,
      };
      this.payouts.push(payout);
    }
    if (!task.isAttentionCheck) {
      if (decision === 'approve') task.status = 'approved';
      else if (task.status !== 'approved') task.status = 'rejected';
    }
    return payout;
  }

  unreviewedGrades(): Grade[] {
    return this.grades.filter((g) => g.review === null);
  }

  /** POST /payouts/periods/close: every pending payout without a period is paid. */
  closePeriod(label: string): PeriodTotals {
    if (this.periodLabels.has(label)) throw new ServiceError(409, `period ${label} already closed`);
    this.periodLabels.add(label);
    const id = this.ids.uuid();
    for (const p of this.payouts) {
      if (p.status === 'pending' && p.periodId === null) {
        p.status = 'paid';
        p.periodId = id;
      }
    }
    const rows = this.payouts.filter((p) => p.periodId === id);
    return {
      id,
      label,
      payoutCount: rows.length,
      totalCents: rows.reduce((s, p) => s + p.amountCents, 0),
      expertCount: new Set(rows.map((p) => p.expertId)).size,
    };
  }

  payoutTotals(): Record<PayoutStatus, number> {
    const out: Record<PayoutStatus, number> = { pending: 0, withheld: 0, paid: 0 };
    for (const p of this.payouts) out[p.status] += p.amountCents;
    return out;
  }

  // ----- analytics and delivery (services/analytics.py, delivery.py) ---------

  /** Mean pairwise absolute score difference across multi-graded, non-golden tasks. */
  globalAgreement(): Agreement {
    const byTask = new Map<string, Grade[]>();
    for (const g of this.grades) {
      if (this.task(g.taskId).isAttentionCheck) continue;
      byTask.set(g.taskId, [...(byTask.get(g.taskId) ?? []), g]);
    }
    const multi = [...byTask.values()].filter((gs) => gs.length > 1);
    const diffs: number[] = [];
    let exact = 0;
    for (const gs of multi) {
      for (const c of this.rubric?.criteria ?? []) {
        for (let i = 0; i < gs.length; i++) {
          for (let j = i + 1; j < gs.length; j++) {
            const x = gs[i].scores[c.key] ?? 0;
            const y = gs[j].scores[c.key] ?? 0;
            diffs.push(Math.abs(x - y));
            if (x === y) exact++;
          }
        }
      }
    }
    const n = diffs.length;
    return {
      multiGradedTasks: multi.length,
      comparedPairs: n,
      meanAbsDiff: n ? diffs.reduce((s, d) => s + d, 0) / n : null,
      exactAgreement: n ? exact / n : null,
      withinOne: n ? diffs.filter((d) => d <= 1).length / n : null,
    };
  }

  /** Approved, non-golden grades ordered by task sequence then expert id. */
  deliveryRows(): DeliveryRow[] {
    const rubric = this.rubric;
    if (!rubric) return [];
    const criteria = [...rubric.criteria].sort((a, b) => a.position - b.position);
    return this.grades
      .filter((g) => g.review === 'approve' && !this.task(g.taskId).isAttentionCheck)
      .map((g) => ({ g, task: this.task(g.taskId) }))
      .sort((a, b) => a.task.seq - b.task.seq || (a.g.expertId < b.g.expertId ? -1 : a.g.expertId > b.g.expertId ? 1 : 0))
      .map(({ g, task }) => ({
        task_id: task.id,
        external_ref: task.externalRef,
        task_type: task.taskType,
        required_tags: [...task.requiredTags].sort(),
        prompt: task.prompt,
        responses: task.responses,
        rubric: { id: rubric.id, name: rubric.name, version: rubric.version },
        expert_id: g.expertId,
        expert_tier: this.expert(g.expertId).tier,
        scores: Object.fromEntries(criteria.map((c) => [c.key, g.scores[c.key] ?? 0])),
        weighted_score: g.weightedScore,
        rationale: g.rationale,
        time_spent_seconds: g.timeSpentSeconds,
      }));
  }

  static jsonl(rows: readonly DeliveryRow[]): string {
    return rows.length ? rows.map((r) => stableStringify(r)).join('\n') + '\n' : '';
  }

  /** GET /deliveries/export: the sha256 of the body is part of the object name. */
  exportDelivery(): Delivery {
    const rows = this.deliveryRows();
    const body = Platform.jsonl(rows);
    const checksum = sha256Hex(body);
    const version = this.deliveries.reduce((m, d) => Math.max(m, d.version), 0) + 1;
    const name = `panelist-grades-v${version}-${checksum.slice(0, 12)}.jsonl`;
    const delivery: Delivery = {
      version,
      checksum,
      name,
      location: `s3://${this.settings.deliveryBucket}/deliveries/${name}`,
      rowCount: rows.length,
      sizeBytes: utf8Length(body),
    };
    this.deliveries.push(delivery);
    return delivery;
  }
}
