// Composes the demo panels on in-memory services: the three notes compiled
// with their citations, an approved onboarding set behind the drift gate, the
// incident set under a review policy that needs an admin approver, and the
// repo's demo script replayed one action at a time to its summary block.

import { citationCoverage, type Coverage } from './compile';
import { PEOPLE, SAMPLE_NOTES, type NoteKey } from './notes';
import { Conflict, IllegalTransition, type Publication, type State } from './service';
import {
  createApprovedWorld,
  createDemoWorld,
  createPolicyWorld,
  createSeededWorld,
  demoScript,
  README_SUMMARY,
  receiptId,
  summarize,
  summaryBlock,
  type DemoLine,
  type DemoSummary,
  type DemoWorld,
} from './script';

export const DRIFT_REF = 'onboarding/week-one';
const REWRITTEN = 'Handbook, engineering wiki, on-call primer, expense policy, laptop pickup desk, badge office.';

/** The figures the repo's demo run prints, quoted in its README. */
export const README_FIGURES = { steps: 18, citations: 26, coverage: 100, blocked: 1, deliveries: 8, rollbacks: 1 };

export type Reviewer = 'dana' | 'ravi' | 'mei' | 'ops';

export interface StepView {
  id: string;
  action: string;
  condition: string | null;
  tool: string | null;
  halts: boolean;
  rules: number;
  lineStart: number;
  lineEnd: number;
  refs: string[];
  citations: number;
}

export interface NoteView {
  key: NoteKey;
  title: string;
  file: string;
  lines: string[];
  steps: StepView[];
  coverage: Coverage;
}

export interface LogLine {
  id: number;
  kind: 'ok' | 'bad' | 'info' | 'blocked';
  text: string;
}

export interface ReceiptView {
  id: number;
  setId: number;
  target: string;
  action: string;
  version: number;
  detail: string;
}

export interface HashRow {
  stepId: string;
  action: string;
  source: string;
  cited: string;
  current: string;
  stale: boolean;
}

export interface DriftSnap {
  setId: number;
  name: string;
  version: number;
  state: State;
  live: number | null;
  ref: string;
  content: string;
  hash: string;
  rewritten: boolean;
  rows: HashRow[];
  stale: string[];
  flags: { id: number; stepId: string; cited: string; current: string; open: boolean; note: string }[];
  blocked: number;
  log: LogLine[];
  receipts: ReceiptView[];
}

export interface PolicySnap {
  setId: number;
  name: string;
  version: number;
  state: State;
  round: number;
  approvals: number;
  required: number;
  roles: string[];
  missing: string[];
  author: string;
  approvers: string[];
  log: LogLine[];
}

export interface ScriptSnap {
  started: boolean;
  done: boolean;
  chunk: number;
  total: number;
  lines: DemoLine[];
  summary: DemoSummary | null;
  live: DemoSummary | null;
  block: string | null;
  matches: boolean | null;
  receipts: ReceiptView[];
}

export interface LabSnap {
  notes: NoteView[];
  drift: DriftSnap;
  policy: PolicySnap;
  script: ScriptSnap;
}

function receiptView(p: Publication): ReceiptView {
  const r = p.receipt as {
    receipt_id?: string;
    signature?: string;
    body_sha256?: string;
    issue?: string;
    comment?: { id: string };
    attachment?: { filename: string; size: number };
  };
  const detail =
    p.target === 'webhook'
      ? `receipt ${r.receipt_id}, ${String(r.signature).slice(0, 19)}..., body sha256 ${String(r.body_sha256).slice(0, 12)} verified`
      : `${r.issue} comment ${r.comment?.id}, attachment ${r.attachment?.filename} (${r.attachment?.size} bytes)`;
  return { id: p.id, setId: p.instruction_set_id, target: p.target, action: p.action, version: p.version, detail };
}

function pushLine(log: LogLine[], kind: LogLine['kind'], text: string): LogLine[] {
  return [{ id: (log[0]?.id ?? 0) + 1, kind, text }, ...log].slice(0, 8);
}

export class Lab {
  readonly notes: NoteView[];
  private drift: DemoWorld;
  private driftLog: LogLine[] = [];
  private policy: DemoWorld;
  private policyLog: LogLine[] = [];
  private scriptWorld: DemoWorld | null = null;
  private script: Generator<DemoLine[], DemoSummary> | null = null;
  private scriptLines: DemoLine[] = [];
  private chunk = 0;
  private summary: DemoSummary | null = null;
  private readonly totalChunks: number;

  constructor() {
    const seeded = createSeededWorld();
    this.notes = SAMPLE_NOTES.map((note) => {
      const set = seeded.service.getSet(seeded.sets[note.key]);
      const lines = note.body.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return {
        key: note.key,
        title: note.title,
        file: note.file,
        lines,
        coverage: citationCoverage(set.document),
        steps: set.document.steps.map((s) => ({
          id: s.id,
          action: s.action,
          condition: s.condition,
          tool: s.tool,
          halts: s.halts,
          rules: s.decision_rules.length,
          lineStart: s.citations[0].line_start,
          lineEnd: s.citations[0].line_end,
          refs: s.citations.filter((c) => c.source_ref).map((c) => `${c.source_kind}:${c.source_ref}`),
          citations: s.citations.length,
        })),
      };
    });
    this.drift = createApprovedWorld();
    this.policy = createPolicyWorld();
    let n = 0;
    const dry = demoScript(createDemoWorld());
    while (!dry.next().done) n++;
    this.totalChunks = n;
  }

  // --- source drift ----------------------------------------------------------

  rewriteSource(): void {
    const s = this.drift.service;
    const source = s.registry.find('doc', DRIFT_REF);
    if (!source || source.content === REWRITTEN) return;
    s.rehashSource(PEOPLE.ops, source.id, REWRITTEN);
    const stale = s.staleSteps(this.drift.sets.onboarding);
    this.driftLog = pushLine(
      this.driftLog,
      'bad',
      `doc:${DRIFT_REF} re-hashed to sha256:${source.content_hash.slice(0, 12)}; flagged ${stale.length ? stale.join(', ') : 'no steps'}`,
    );
  }

  publishDrift(): void {
    const w = this.drift;
    try {
      const out = w.service.publish(PEOPLE.ops, w.sets.onboarding, w.targets);
      for (const pub of out.publications) {
        this.driftLog = pushLine(this.driftLog, 'ok', `v${pub.version} delivered to ${pub.target} (receipt ${receiptId(pub)})`);
      }
    } catch (error) {
      if (!(error instanceof Conflict || error instanceof IllegalTransition)) throw error;
      this.driftLog = pushLine(this.driftLog, 'blocked', `409: ${error.message}`);
    }
  }

  reverifyDrift(): void {
    try {
      const resolved = this.drift.service.reverify(PEOPLE.dana, this.drift.sets.onboarding);
      this.driftLog = pushLine(
        this.driftLog,
        'ok',
        `dana re-verified ${resolved.map((f) => f.step_id).join(', ')} against the new content; the citation now carries the current hash`,
      );
    } catch (error) {
      this.driftLog = pushLine(this.driftLog, 'info', (error as Error).message);
    }
  }

  resetDrift(): void {
    this.drift = createApprovedWorld();
    this.driftLog = [];
  }

  // --- review policy ---------------------------------------------------------

  submitPolicy(): void {
    try {
      const set = this.policy.service.submit(PEOPLE.dana, this.policy.sets.incident);
      this.policyLog = pushLine(this.policyLog, 'info', `dana submitted v${set.version} -> in review, round ${set.review_round}`);
    } catch (error) {
      this.policyLog = pushLine(this.policyLog, 'blocked', `409: ${(error as Error).message}`);
    }
  }

  approvePolicy(who: Reviewer): void {
    const person = PEOPLE[who];
    try {
      const out = this.policy.service.review(person, this.policy.sets.incident, 'approve', 'verified against the source documents');
      const counted = `${out.approvals} approval${out.approvals === 1 ? '' : 's'}, ${out.set.required_approvals} required`;
      this.policyLog =
        out.set.state === 'approved'
          ? pushLine(this.policyLog, 'ok', `${who} (${person.role}) approved: ${counted}, required role present -> approved`)
          : pushLine(this.policyLog, 'info', `${who} (${person.role}) approval recorded: ${counted}, held in review for role ${out.missing.join(', ')}`);
    } catch (error) {
      if (!(error instanceof Conflict || error instanceof IllegalTransition)) throw error;
      this.policyLog = pushLine(this.policyLog, 'blocked', `409: ${error.message}`);
    }
  }

  resetPolicy(): void {
    this.policy = createPolicyWorld();
    this.policyLog = [];
  }

  // --- demo script -----------------------------------------------------------

  startScript(): void {
    if (this.script) return;
    this.scriptWorld = createDemoWorld();
    this.script = demoScript(this.scriptWorld);
  }

  /** Perform the next action; returns true once the summary is in. */
  stepScript(): boolean {
    if (!this.script || this.summary) return this.summary !== null;
    const next = this.script.next();
    if (next.done) {
      this.summary = next.value;
    } else {
      this.chunk += 1;
      this.scriptLines = [...this.scriptLines, ...next.value];
    }
    return this.summary !== null;
  }

  finishScript(): void {
    this.startScript();
    while (!this.stepScript()) {
      // drain the remaining actions
    }
  }

  resetScript(): void {
    this.scriptWorld = null;
    this.script = null;
    this.scriptLines = [];
    this.chunk = 0;
    this.summary = null;
  }

  snapshot(): LabSnap {
    const ds = this.drift.service;
    const dId = this.drift.sets.onboarding;
    const dSet = ds.getSet(dId);
    const source = ds.registry.find('doc', DRIFT_REF);
    const rows: HashRow[] = [];
    for (const step of dSet.document.steps) {
      for (const cite of step.citations) {
        const registered = cite.source_id ? ds.registry.byId(cite.source_id) : undefined;
        if (!registered) continue;
        const cited = cite.source_hash ?? '';
        rows.push({
          stepId: step.id,
          action: step.action,
          source: `${registered.kind}:${registered.ref}`,
          cited,
          current: registered.content_hash,
          stale: cited !== registered.content_hash,
        });
      }
    }
    const drift: DriftSnap = {
      setId: dId,
      name: dSet.name,
      version: dSet.version,
      state: dSet.state,
      live: dSet.published_version,
      ref: DRIFT_REF,
      content: source?.content ?? '',
      hash: source?.content_hash ?? '',
      rewritten: source?.content === REWRITTEN,
      rows,
      stale: ds.staleSteps(dId),
      flags: ds.flagsFor(dId).map((f) => ({
        id: f.id,
        stepId: f.step_id,
        cited: f.cited_hash.slice(0, 10),
        current: f.current_hash.slice(0, 10),
        open: f.open,
        note: f.open ? `open, found by ${f.detected_by}` : `${f.resolution} by ${f.resolved_by}`,
      })),
      blocked: ds.audit.filter((a) => a.instruction_set_id === dId && a.action === 'publish_blocked').length,
      log: this.driftLog,
      receipts: ds.publications.filter((p) => p.instruction_set_id === dId).map(receiptView).reverse(),
    };

    const ps = this.policy.service;
    const pId = this.policy.sets.incident;
    const pSet = ps.getSet(pId);
    const policy: PolicySnap = {
      setId: pId,
      name: pSet.name,
      version: pSet.version,
      state: pSet.state,
      round: pSet.review_round,
      approvals: ps.countApprovals(pSet),
      required: pSet.required_approvals,
      roles: [...pSet.review_policy.required_roles],
      missing: ps.missingRoles(pSet),
      author: ps.versionAuthor(pSet),
      approvers: ps.reviews
        .filter((r) => r.instruction_set_id === pId && r.review_round === pSet.review_round && r.decision === 'approve')
        .map((r) => `${r.reviewer} (${r.reviewer_role})`),
      log: this.policyLog,
    };

    const block = this.summary ? summaryBlock(this.summary) : null;
    const script: ScriptSnap = {
      started: this.script !== null,
      done: this.summary !== null,
      chunk: this.chunk,
      total: this.totalChunks,
      lines: this.scriptLines.slice(-12),
      summary: this.summary,
      live: this.scriptWorld ? summarize(this.scriptWorld) : null,
      block,
      matches: block === null ? null : block === README_SUMMARY,
      receipts: this.scriptWorld ? this.scriptWorld.service.publications.map(receiptView).reverse().slice(0, 6) : [],
    };

    return { notes: this.notes, drift, policy, script };
  }
}
