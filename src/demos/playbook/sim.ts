// Drives the feedback loop one graded run per tick and flattens what the
// panels render (grid cells, per-version figures, traces, gate decisions) into
// a plain snapshot.
import { formatPromotion, gate, LoopRun, pct, type RunOutcome } from './arc';
import type { Correction, Scenario } from './types';

export const RUN_MS = 150;
const ROUND_PAUSE_TICKS = 7;
const REVIEWER = 'reviewer';

export type CellState = 'pass' | 'fail' | 'running' | 'pending';

export interface VersionSnap {
  version: number;
  graded: number;
  passed: number;
  passRate: string | null;
  meanScore: string | null;
  forbidden: number;
  complete: boolean;
  corrections: Correction[];
  newlyPassing: string[];
}

export interface Promotion {
  seq: number;
  version: number;
  promoted: boolean;
  text: string;
}

export interface Snap {
  running: boolean;
  done: boolean;
  stopReason: string | null;
  seed: number;
  scenarios: Scenario[];
  versions: VersionSnap[];
  cells: Record<string, CellState[]>;
  outcomes: Record<string, RunOutcome>;
  graded: number;
  toolCalls: number;
  promotions: Promotion[];
}

export const outcomeKey = (version: number, scenarioId: string) => `${version}:${scenarioId}`;

export class PlaybookSim {
  loop = new LoopRun();
  running = false;
  private hold = 0;
  private promotions: Promotion[] = [];

  start(): void {
    if (this.running) return;
    if (this.loop.done || this.loop.rounds.length || this.loop.outcomes.length) {
      this.loop = new LoopRun();
      this.promotions = [];
    }
    this.hold = 0;
    this.running = true;
  }

  finish(): void {
    this.loop.runToEnd();
    this.running = false;
  }

  tick(): void {
    if (!this.running) return;
    if (this.hold > 0) {
      this.hold -= 1;
      return;
    }
    for (const e of this.loop.step()) {
      if (e.kind === 'round') this.hold = ROUND_PAUSE_TICKS;
      if (e.kind === 'stop') this.running = false;
    }
  }

  // playbook promote --version N: the gate runs on that version's report.
  promote(version: number): void {
    const round = this.loop.rounds.find((r) => r.spec.version === version);
    if (!round) return;
    const blockers = gate(round.report);
    const seq = (this.promotions[0]?.seq ?? 0) + 1;
    this.promotions = [{ seq, version, promoted: blockers.length === 0, text: formatPromotion(round.report, blockers, REVIEWER) }, ...this.promotions].slice(0, 4);
  }

  snapshot(): Snap {
    const { loop } = this;
    const versions: VersionSnap[] = loop.rounds.map((r) => ({
      version: r.spec.version,
      graded: r.outcomes.length,
      passed: r.report.passed,
      passRate: pct(r.report.passRate),
      meanScore: pct(r.report.meanScore),
      forbidden: r.report.forbiddenViolations,
      complete: true,
      corrections: r.corrections,
      newlyPassing: r.comparison?.newlyPassing ?? [],
    }));
    if (!loop.done) {
      versions.push({
        version: loop.spec.version,
        graded: loop.outcomes.length,
        passed: loop.outcomes.filter((o) => o.grade.passed).length,
        passRate: null,
        meanScore: null,
        forbidden: loop.outcomes.reduce((n, o) => n + o.grade.forbiddenViolations, 0),
        complete: false,
        corrections: loop.spec.version > 1 ? loop.spec.corrections.filter((c) => c.version === loop.spec.version) : [],
        newlyPassing: [],
      });
    }
    const outcomes: Record<string, RunOutcome> = {};
    for (const o of [...loop.rounds.flatMap((r) => r.outcomes), ...(loop.done ? [] : loop.outcomes)]) {
      outcomes[outcomeKey(o.trace.promptVersion, o.trace.scenarioId)] = o;
    }
    const cells: Record<string, CellState[]> = {};
    loop.scenarios.forEach((sc, idx) => {
      cells[sc.id] = versions.map((v) => {
        const o = outcomes[outcomeKey(v.version, sc.id)];
        if (o) return o.grade.passed ? 'pass' : 'fail';
        return !v.complete && this.running && idx === loop.outcomes.length ? 'running' : 'pending';
      });
    });
    const all = Object.values(outcomes);
    return {
      running: this.running,
      done: loop.done,
      stopReason: loop.stopReason,
      seed: loop.seed,
      scenarios: loop.scenarios,
      versions,
      cells,
      outcomes,
      graded: all.length,
      toolCalls: all.reduce((n, o) => n + o.trace.toolCalls.length, 0),
      promotions: this.promotions,
    };
  }
}
