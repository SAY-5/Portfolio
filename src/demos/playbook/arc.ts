// The feedback loop run one scenario at a time (playbook/runner.py,
// playbook/evals/report.py, playbook/feedback/loop.py): run prompt v1 over
// every scenario, grade it, derive corrections from the failures, render the
// next version, and repeat until every scenario passes or nothing applies.
// The promotion gate (playbook/feedback/approval.py) refuses any version whose
// report still holds a forbidden action.
import { deriveCorrections } from './corrections';
import { KB, RUBRIC, SCENARIOS, SOP, WALKTHROUGH } from './fixtures';
import { gradeRun } from './grader';
import { ingestProcedure } from './ingest';
import { runAgent } from './loop';
import { RuleEngine } from './model';
import { Prng, seedFrom } from './prng';
import { initialSpec, renderPrompt, specLabel, withCorrections } from './prompt';
import { FakeJira, FakeSlack, KnowledgeBase, ToolExecutor } from './tools';
import type { Comparison, Correction, Procedure, PromptSpec, RunGrade, RunTrace, Scenario, VersionReport } from './types';

export interface RunOutcome {
  trace: RunTrace;
  grade: RunGrade;
}

export interface Round {
  spec: PromptSpec;
  report: VersionReport;
  outcomes: RunOutcome[];
  corrections: Correction[];
  comparison: Comparison | null;
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

// Python's f"{x:.1f}%": half to even on exact ties.
export function pct(x: number): string {
  const v = x * 100;
  const scaled = v * 10;
  const floor = Math.floor(scaled);
  if (Math.abs(scaled - floor - 0.5) < 1e-9) return `${((floor % 2 === 0 ? floor : floor + 1) / 10).toFixed(1)}%`;
  return `${v.toFixed(1)}%`;
}

export function buildReport(grades: RunGrade[]): VersionReport {
  const n = grades.length;
  const perCriterion: Record<string, number> = {};
  for (const c of RUBRIC.criteria) {
    perCriterion[c.id] = r4(grades.filter((g) => g.results.some((r) => r.id === c.id && r.passed)).length / n);
  }
  const passed = grades.filter((g) => g.passed).length;
  return {
    procedureSlug: grades[0].procedureSlug,
    promptVersion: grades[0].promptVersion,
    scenarios: n,
    passed,
    passRate: r4(passed / n),
    meanScore: r4(grades.reduce((s, g) => s + g.score, 0) / n),
    perCriterion,
    requiredActionCoverage: r4(grades.reduce((s, g) => s + g.requiredActionsMade, 0) / (grades.reduce((s, g) => s + g.requiredActionsTotal, 0) || 1)),
    forbiddenViolations: grades.reduce((s, g) => s + g.forbiddenViolations, 0),
    grades,
  };
}

function compareReports(before: VersionReport, after: VersionReport): Comparison {
  const b = new Map(before.grades.map((g) => [g.scenarioId, g.passed]));
  const a = after.grades.map((g) => [g.scenarioId, g.passed] as const);
  return {
    before: before.promptVersion,
    after: after.promptVersion,
    passRateDelta: r4(after.passRate - before.passRate),
    newlyPassing: a.filter(([s, p]) => p && !(b.get(s) ?? false)).map(([s]) => s).sort(),
    newlyFailing: a.filter(([s, p]) => !p && (b.get(s) ?? false)).map(([s]) => s).sort(),
  };
}

export interface Blocker {
  kind: 'forbidden-action' | 'pending-review';
  detail: string;
}

// Everything standing between a graded version and promotion. Proposals are
// approved by the loop as it runs, so only forbidden actions can block here.
export function gate(report: VersionReport): Blocker[] {
  const offences = new Map<string, string[]>();
  for (const g of report.grades) {
    for (const r of g.results) if (r.forbidden && !r.passed) offences.set(r.id, [...(offences.get(r.id) ?? []), g.scenarioId]);
  }
  return Array.from(offences.keys())
    .sort()
    .map((criterion) => {
      const scenarios = offences.get(criterion)!;
      const shown = scenarios.slice(0, 4).join(', ') + (scenarios.length > 4 ? ` +${scenarios.length - 4}` : '');
      return { kind: 'forbidden-action' as const, detail: `${criterion} in ${scenarios.length} scenario(s): ${shown}` };
    });
}

// Python's f"{rate:.0%}" rounds half to even, so 12.5% prints as 12%.
function pct0(x: number): string {
  const v = x * 100;
  const floor = Math.floor(v);
  const whole = Math.abs(v - floor - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(v);
  return `${whole}%`;
}

export function formatPromotion(report: VersionReport, blockers: Blocker[], reviewer: string): string {
  const decision = blockers.length ? 'blocked' : 'promoted';
  const head = `v${report.promptVersion} ${decision} by ${reviewer}`;
  if (!blockers.length) return `${head} (pass rate ${pct0(report.passRate)}, ${report.forbiddenViolations} forbidden action(s))`;
  return [head, ...blockers.map((b) => `  blocked by ${b.kind}: ${b.detail}`)].join('\n');
}

export type LoopEvent =
  | { kind: 'run'; outcome: RunOutcome; round: number }
  | { kind: 'round'; round: Round }
  | { kind: 'stop'; reason: string };

export class LoopRun {
  readonly procedure: Procedure = ingestProcedure(SOP, WALKTHROUGH);
  readonly scenarios: Scenario[] = SCENARIOS.scenarios;
  readonly seed: number;
  readonly maxRounds = 5;
  readonly rounds: Round[] = [];
  stopReason: string | null = null;
  spec: PromptSpec;
  outcomes: RunOutcome[] = [];
  private readonly jira = new FakeJira();
  private readonly slack = new FakeSlack();
  private readonly executor = new ToolExecutor(new KnowledgeBase(KB), this.jira, this.slack);
  private readonly prng: Prng;
  private readonly engine: RuleEngine;
  private prompt: string;

  constructor(seed?: number) {
    this.seed = seed ?? seedFrom(this.procedure.slug);
    this.prng = new Prng(this.seed);
    this.engine = new RuleEngine(this.prng);
    this.spec = initialSpec(this.procedure.slug);
    this.prompt = renderPrompt(this.spec, this.procedure);
    this.beginRound(this.spec);
  }

  get done(): boolean {
    return this.stopReason !== null;
  }

  get systemPrompt(): string {
    return this.prompt;
  }

  private beginRound(spec: PromptSpec): void {
    this.jira.reset();
    this.slack.reset();
    this.spec = spec;
    this.prompt = renderPrompt(spec, this.procedure);
    this.outcomes = [];
  }

  // Run and grade the next scenario; finishing a round derives the next version.
  step(): LoopEvent[] {
    if (this.done) return [];
    const sc = this.scenarios[this.outcomes.length];
    const trace = runAgent(this.engine, this.prng, this.prompt, renderScenario(sc), this.executor, {
      procedureSlug: this.procedure.slug,
      promptVersion: this.spec.version,
      scenarioId: sc.id,
    });
    const outcome = { trace, grade: gradeRun(RUBRIC, trace, sc) };
    this.outcomes.push(outcome);
    const events: LoopEvent[] = [{ kind: 'run', outcome, round: this.rounds.length }];
    if (this.outcomes.length === this.scenarios.length) events.push(...this.finishRound());
    return events;
  }

  private finishRound(): LoopEvent[] {
    const prev = this.rounds[this.rounds.length - 1] ?? null;
    const report = buildReport(this.outcomes.map((o) => o.grade));
    const round: Round = {
      spec: this.spec,
      report,
      outcomes: this.outcomes,
      corrections: prev ? this.spec.corrections.filter((c) => c.version === this.spec.version) : [],
      comparison: prev ? compareReports(prev.report, report) : null,
    };
    this.rounds.push(round);
    const events: LoopEvent[] = [{ kind: 'round', round }];
    let reason: string | null = null;
    if (prev && (round.comparison?.passRateDelta ?? 0) <= 0) reason = `pass rate plateaued at ${Math.round(report.passRate * 100)}%`;
    else if (this.rounds.length - 1 >= this.maxRounds) reason = 'max rounds reached';
    else if (report.passRate >= 1) reason = 'all scenarios pass';
    if (reason === null) {
      const fresh = deriveCorrections(report.grades, SCENARIOS, RUBRIC, this.spec.version);
      const next = fresh.length
        ? withCorrections(this.spec, fresh, `${fresh.length} correction(s) from ${specLabel(this.spec)} failures (pass rate ${Math.round(report.passRate * 100)}%)`)
        : null;
      if (!next || next.corrections.length === this.spec.corrections.length) reason = 'no applicable corrections for the remaining failures';
      else this.beginRound(next);
    }
    if (reason !== null) {
      this.stopReason = reason;
      events.push({ kind: 'stop', reason });
    }
    return events;
  }

  runToEnd(): void {
    let guard = 0;
    while (!this.done && guard++ < 1000) this.step();
  }
}

// The intake message handed to the agent as its first user turn.
export function renderScenario(sc: Scenario): string {
  const lines = [`New ${sc.intake.kind ?? 'request'}`];
  for (const [key, value] of Object.entries(sc.intake)) {
    if (key === 'kind') continue;
    const cap = (s: string) => (s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
    lines.push(`${key === 'customer_facing' ? 'Customer-facing' : cap(key.replace(/_/g, '-'))}: ${value}`);
  }
  return lines.join('\n');
}
