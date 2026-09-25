// Composes the demo panels on in-memory services: the three notes compiled
// with their citations and checked against the repo's golden fixtures, an
// approved onboarding set behind the drift gate, the incident set under a
// review policy with a required admin approver and a 4 h deadline, the
// onboarding set branched, merged and driven into a merge conflict, and the
// repo's demo script replayed one action at a time to its run section and
// summary block.

import { citationCoverage, compileNote, type Coverage, type InstructionDocument } from './compile';
import { runTestCase } from './executor';
import { EXPECTED_COMPILED, EXPECTED_DEMO_SUMMARY, EXPECTED_PHRASINGS, EXPECTED_TRACES, README_RUN, README_SUMMARY, SOURCE_COMMIT_SHORT } from './expected';
import { PEOPLE, SAMPLE_NOTES, SAMPLE_TEST_CASES, type NoteKey } from './notes';
import { Conflict, HOUR_MS, IllegalTransition, Invalid, type InstructionSet, type Publication, type State } from './service';
import {
  createApprovedWorld,
  createDemoWorld,
  createPolicyWorld,
  createSeededWorld,
  demoScript,
  POLICY_DEADLINE_HOURS,
  receiptId,
  runBlock,
  summarize,
  summaryBlock,
  type DemoLine,
  type DemoSummary,
  type DemoWorld,
} from './script';
import { canonicalCompact } from './sources';
import type { MergeConflict } from './versioning';

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

/** How the port compares with samples/expected at the source commit. */
export interface FixtureVerdict {
  commit: string;
  compiled: number;
  compiledTotal: number;
  traces: number;
  tracesTotal: number;
  ok: boolean;
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
  deadlineHours: number | null;
  /** Hours of virtual time since the submit; null before the set is submitted. */
  hoursSinceSubmit: number | null;
  overdue: boolean;
  escalated: boolean;
  escalations: number;
  log: LogLine[];
}

export interface DiffRow {
  stepId: string;
  field: string;
  before: string;
  after: string;
}

export interface VersionsSnap {
  parentId: number;
  parentName: string;
  parentVersion: number;
  parentState: State;
  stage: number;
  steps: string[];
  next: string | null;
  branch: { id: number; name: string; version: number; from: number; mergedInto: number | null } | null;
  versions: { version: number; label: string }[];
  diffFrom: number;
  diffTo: number;
  diff: DiffRow[];
  conflicts: { stepId: string; field: string; parent: string; branch: string }[];
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
  fixtureMatches: boolean | null;
  runBlock: string | null;
  runMatches: boolean | null;
  receipts: ReceiptView[];
}

export interface LabSnap {
  notes: NoteView[];
  fixtures: FixtureVerdict;
  provenance: LogLine[];
  drift: DriftSnap;
  policy: PolicySnap;
  versions: VersionsSnap;
  script: ScriptSnap;
}

function receiptView(p: Publication): ReceiptView {
  const r = p.receipt as {
    receipt_id?: string;
    signature?: string;
    body_sha256?: string;
    issue?: string;
    comment?: { id: string };
    attachment?: Array<{ filename: string; size: number }>;
  };
  const attachment = r.attachment?.[0];
  const detail =
    p.target === 'webhook'
      ? `receipt ${r.receipt_id}, ${String(r.signature).slice(0, 19)}..., body sha256 ${String(r.body_sha256).slice(0, 12)} verified`
      : `${r.issue} comment ${r.comment?.id}, attachment ${attachment?.filename} (${attachment?.size} bytes)`;
  return { id: p.id, setId: p.instruction_set_id, target: p.target, action: p.action, version: p.version, detail };
}

function pushLine(log: LogLine[], kind: LogLine['kind'], text: string): LogLine[] {
  return [{ id: (log[0]?.id ?? 0) + 1, kind, text }, ...log].slice(0, 8);
}

function sameAsFixture(produced: unknown, fixture: unknown): boolean {
  return canonicalCompact(produced) === canonicalCompact(fixture);
}

/** Compile the sample notes and run the demo cases the way tests/test_golden.py does, then compare. */
function checkFixtures(): FixtureVerdict {
  let compiled = 0;
  let traces = 0;
  for (const note of SAMPLE_NOTES) {
    const document = compileNote(note.body, 1, note.title);
    if (sameAsFixture(document, EXPECTED_COMPILED[note.key])) compiled += 1;
    SAMPLE_TEST_CASES[note.key].forEach((testCase, index) => {
      const produced = { name: testCase.name, ...runTestCase(document, testCase.scenario, testCase.expectations) };
      if (sameAsFixture(produced, EXPECTED_TRACES[note.key][index])) traces += 1;
    });
  }
  if (sameAsFixture(compileNote(EXPECTED_PHRASINGS.note, 1, 'Warehouse dispatch phrasings'), EXPECTED_PHRASINGS.document)) compiled += 1;
  const compiledTotal = SAMPLE_NOTES.length + 1;
  const tracesTotal = Object.values(SAMPLE_TEST_CASES).reduce((n, cases) => n + cases.length, 0);
  return { commit: SOURCE_COMMIT_SHORT, compiled, compiledTotal, traces, tracesTotal, ok: compiled === compiledTotal && traces === tracesTotal };
}

function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const VERSION_STEPS = [
  'Branch set 2 v1 as dana',
  'Edit s3 on the branch, s4 on the parent',
  'Merge the branch into set 2',
  'Branch v3, then edit s3 on both sides',
  'Merge the second branch',
];

export class Lab {
  readonly notes: NoteView[];
  readonly fixtures: FixtureVerdict;
  private seeded: DemoWorld;
  private provenanceLog: LogLine[] = [];
  private drift: DemoWorld;
  private driftLog: LogLine[] = [];
  private policy: DemoWorld;
  private policyLog: LogLine[] = [];
  private versions: DemoWorld;
  private versionsLog: LogLine[] = [];
  private versionsStage = 0;
  private versionsBranch: number | null = null;
  private versionsConflicts: MergeConflict[] = [];
  private scriptWorld: DemoWorld | null = null;
  private script: Generator<DemoLine[], DemoSummary> | null = null;
  private scriptLines: DemoLine[] = [];
  private chunk = 0;
  private summary: DemoSummary | null = null;
  private readonly totalChunks: number;

  constructor() {
    this.seeded = createSeededWorld();
    this.notes = SAMPLE_NOTES.map((note) => {
      const set = this.seeded.service.getSet(this.seeded.sets[note.key]);
      const lines = note.body.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return {
        key: note.key,
        title: note.title,
        file: note.file,
        lines,
        coverage: citationCoverage(set.document),
        steps: set.document.steps.map((s) => {
          const range = s.citations.find((c) => c.line_start != null && c.line_end != null);
          return {
            id: s.id,
            action: s.action,
            condition: s.condition,
            tool: s.tool,
            halts: s.halts,
            rules: s.decision_rules.length,
            lineStart: range?.line_start ?? 0,
            lineEnd: range?.line_end ?? 0,
            refs: s.citations.filter((c) => c.source_ref).map((c) => `${c.source_kind}:${c.source_ref}`),
            citations: s.citations.length,
          };
        }),
      };
    });
    this.fixtures = checkFixtures();
    this.drift = createApprovedWorld();
    this.policy = createPolicyWorld();
    this.versions = createSeededWorld();
    let n = 0;
    const dry = demoScript(createDemoWorld());
    while (!dry.next().done) n++;
    this.totalChunks = n;
  }

  // --- provenance check --------------------------------------------------------

  /** Try an edit that cites a line past the end of the note; the document check refuses it. */
  citePastEnd(noteIdx: number, stepId: string): void {
    const note = this.notes[noteIdx];
    const setId = this.seeded.sets[note.key];
    const set = this.seeded.service.getSet(setId);
    const document = JSON.parse(JSON.stringify(set.document)) as InstructionDocument;
    const step = document.steps.find((s) => s.id === stepId) ?? document.steps[0];
    const line = note.lines.length + 1;
    step.citations.push({ note_id: set.note_id, line_start: line, line_end: line });
    try {
      this.seeded.service.applyEdit(PEOPLE.dana, setId, set.version, `cite line ${line}`, document);
      this.provenanceLog = pushLine(this.provenanceLog, 'ok', `edit accepted: ${step.id} now cites L${line}`);
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      this.provenanceLog = pushLine(this.provenanceLog, 'blocked', `422 on ${note.file}: ${error.problems.join('; ')}`);
    }
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
      const hours = set.review_policy.review_deadline_hours;
      this.policyLog = pushLine(
        this.policyLog,
        'info',
        `dana submitted v${set.version} -> in review, round ${set.review_round}${hours === null ? '' : `, review clock started: due in ${hours} h`}`,
      );
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

  /** Move the virtual clock; the review deadline is measured against it. */
  advancePolicyClock(hours = 5): void {
    const s = this.policy.service;
    const set = s.getSet(this.policy.sets.incident);
    s.advance(hours);
    const since = this.hoursSince(set.submitted_at);
    const late = set.review_deadline_at !== null && s.now() > set.review_deadline_at ? `, ${this.hoursSince(set.review_deadline_at)} h past the deadline` : '';
    this.policyLog = pushLine(
      this.policyLog,
      'info',
      `virtual clock advanced ${hours} h${since === null ? '' : ` to T+${since} h after submit`}${set.state === 'in_review' ? late : ''}`,
    );
  }

  /** POST /reviews/escalate: one review_escalated event per overdue set, never a second. */
  escalatePolicy(): void {
    const s = this.policy.service;
    const set = s.getSet(this.policy.sets.incident);
    const escalated = s.escalateOverdue(PEOPLE.ops);
    if (escalated.length) {
      const event = s.auditFor(set.id).filter((a) => a.action === 'review_escalated').pop();
      const detail = (event?.detail ?? {}) as { overdue_seconds?: number; approvals?: number; required_approvals?: number; missing_roles?: string[] };
      this.policyLog = pushLine(
        this.policyLog,
        'ok',
        `review_escalated audited for set ${set.id}: ${detail.overdue_seconds} s past the ${set.review_policy.review_deadline_hours} h deadline, ${detail.approvals}/${detail.required_approvals} approvals, missing role ${(detail.missing_roles ?? []).join(', ') || 'none'}`,
      );
      return;
    }
    let why: string;
    if (set.state !== 'in_review') why = `set ${set.id} is ${set.state.replace('_', ' ')}, not in review`;
    else if (set.escalated_at !== null) why = `set ${set.id} was already escalated at T+${this.hoursBetween(set.submitted_at, set.escalated_at)} h; the event is written once per review round`;
    else if (set.review_deadline_at !== null && s.now() < set.review_deadline_at) why = `set ${set.id} is due in ${Math.round(((set.review_deadline_at - s.now()) / HOUR_MS) * 10) / 10} h, not overdue yet`;
    else why = `set ${set.id} has no deadline`;
    this.policyLog = pushLine(this.policyLog, 'info', `nothing to escalate: ${why}`);
  }

  private hoursSince(at: number | null): number | null {
    return this.hoursBetween(at, this.policy.service.now());
  }

  private hoursBetween(from: number | null, to: number | null): number | null {
    if (from === null || to === null) return null;
    return Math.round(((to - from) / HOUR_MS) * 10) / 10;
  }

  resetPolicy(): void {
    this.policy = createPolicyWorld();
    this.policyLog = [];
  }

  // --- versions, branch and merge ----------------------------------------------

  /** Perform the next step of the branch and merge sequence. */
  nextVersionStep(): void {
    const s = this.versions.service;
    const parentId = this.versions.sets.onboarding;
    const editStep = (setId: number, index: number, mutate: (action: string) => string, reason: string) => {
      const current = s.getSet(setId);
      const document = JSON.parse(JSON.stringify(current.document)) as InstructionDocument;
      document.steps[index].action = mutate(document.steps[index].action);
      const out = s.applyEdit(PEOPLE.dana, setId, current.version, reason, document);
      return `set ${setId} v${out.from_version} -> v${out.to_version}: s${index + 1} action ${reason}`;
    };
    switch (this.versionsStage) {
      case 0: {
        const child = s.branch(PEOPLE.dana, parentId, 'contractor variant');
        this.versionsBranch = child.id;
        this.versionsLog = pushLine(this.versionsLog, 'info', `set ${child.id} "${child.name}" branched from set ${parentId} v${child.branched_from_version}: draft v1, its own edits and review`);
        break;
      }
      case 1: {
        const branchId = this.versionsBranch as number;
        const a = editStep(branchId, 2, (action) => `${action} and record the contractor end date`, 'gains "and record the contractor end date"');
        const b = editStep(parentId, 3, (action) => `${action} and #eng-oncall`, 'gains "and #eng-oncall"');
        this.versionsLog = pushLine(pushLine(this.versionsLog, 'info', a), 'info', b);
        break;
      }
      case 2: {
        const branchId = this.versionsBranch as number;
        const out = s.merge(PEOPLE.dana, branchId, 'merge the contractor variant');
        const changed = s.diffVersions(parentId, out.edit.from_version - 1, out.parent.version).steps.changed.map((c) => c.id);
        this.versionsLog = pushLine(
          this.versionsLog,
          'ok',
          `merged set ${branchId} into set ${parentId}: v${out.edit.from_version} -> v${out.parent.version}, three-way against base v1, ${out.summary.steps_changed} steps changed one side each (${changed.join(', ')}), 0 conflicts`,
        );
        break;
      }
      case 3: {
        const child = s.branch(PEOPLE.dana, parentId, 'invite variant');
        this.versionsBranch = child.id;
        const a = editStep(child.id, 2, () => 'Invite the GitHub user as an outside collaborator only', 'rewritten on the branch');
        const b = editStep(parentId, 2, () => 'Invite the GitHub user to the organisation with the requested team', 'rewritten on the parent');
        this.versionsLog = pushLine(pushLine(pushLine(this.versionsLog, 'info', `set ${child.id} "${child.name}" branched from set ${parentId} v${child.branched_from_version}`), 'info', a), 'info', b);
        break;
      }
      case 4: {
        const branchId = this.versionsBranch as number;
        const before = s.getSet(parentId).version;
        try {
          s.merge(PEOPLE.dana, branchId, 'merge the invite variant');
          this.versionsLog = pushLine(this.versionsLog, 'ok', `merged set ${branchId} into set ${parentId}`);
        } catch (error) {
          if (!(error instanceof Conflict)) throw error;
          this.versionsConflicts = (error.detail.conflicts as MergeConflict[] | undefined) ?? [];
          const named = this.versionsConflicts.map((c) => `${c.step_id ?? ''}.${c.field ?? 'step'}`).join(', ');
          this.versionsLog = pushLine(
            this.versionsLog,
            'blocked',
            `409: ${error.message}; ${named} changed on both sides; set ${parentId} stays at v${before}, merge_conflict audited`,
          );
        }
        break;
      }
      default:
        return;
    }
    this.versionsStage += 1;
  }

  resetVersions(): void {
    this.versions = createSeededWorld();
    this.versionsLog = [];
    this.versionsStage = 0;
    this.versionsBranch = null;
    this.versionsConflicts = [];
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

  private versionsSnap(): VersionsSnap {
    const s = this.versions.service;
    const parentId = this.versions.sets.onboarding;
    const parent = s.getSet(parentId);
    const branch: InstructionSet | null = this.versionsBranch === null ? null : s.getSet(this.versionsBranch);
    const edits = s.editsFor(parentId);
    const versions = s.versionsFor(parentId).map((v) => {
      const edit = edits.find((e) => e.to_version === v.version);
      return { version: v.version, label: edit ? `${edit.reason} (${edit.author})` : 'compiled from the note (dana)' };
    });
    const diff: DiffRow[] = [];
    if (parent.version > 1) {
      for (const changed of s.diffVersions(parentId, 1, parent.version).steps.changed) {
        for (const [field, change] of Object.entries(changed.fields)) diff.push({ stepId: changed.id, field, before: show(change.before), after: show(change.after) });
      }
    }
    return {
      parentId,
      parentName: parent.name,
      parentVersion: parent.version,
      parentState: parent.state,
      stage: this.versionsStage,
      steps: VERSION_STEPS,
      next: this.versionsStage < VERSION_STEPS.length ? VERSION_STEPS[this.versionsStage] : null,
      branch: branch ? { id: branch.id, name: branch.name, version: branch.version, from: branch.branched_from_version ?? 1, mergedInto: branch.merged_into_version } : null,
      versions,
      diffFrom: 1,
      diffTo: parent.version,
      diff,
      conflicts: this.versionsConflicts.map((c) => ({ stepId: c.step_id ?? '', field: c.field ?? 'step', parent: show(c.parent), branch: show(c.branch) })),
      log: this.versionsLog,
    };
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
      deadlineHours: pSet.review_policy.review_deadline_hours ?? POLICY_DEADLINE_HOURS,
      hoursSinceSubmit: this.hoursSince(pSet.submitted_at),
      overdue: ps.isOverdue(pSet),
      escalated: pSet.escalated_at !== null,
      escalations: ps.auditFor(pId).filter((a) => a.action === 'review_escalated').length,
      log: this.policyLog,
    };

    const block = this.summary ? summaryBlock(this.summary) : null;
    const run = runBlock(this.scriptLines);
    const runComplete = run !== null && run.split('\n').length === README_RUN.split('\n').length;
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
      fixtureMatches: block === null ? null : block === EXPECTED_DEMO_SUMMARY,
      runBlock: run,
      runMatches: run === null || !runComplete ? null : run === README_RUN,
      receipts: this.scriptWorld ? this.scriptWorld.service.publications.map(receiptView).reverse().slice(0, 6) : [],
    };

    return { notes: this.notes, fixtures: this.fixtures, provenance: this.provenanceLog, drift, policy, versions: this.versionsSnap(), script };
  }
}
