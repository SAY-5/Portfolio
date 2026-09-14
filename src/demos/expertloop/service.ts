// In-memory port of expertloop/service.py for the paths the demo exercises:
// ingest and compile, edits against an expected version, the approval state
// machine under a review policy, test runs, the publish gate (state approved,
// a green run on the current version, no open drift flag), signed delivery,
// rollback and source drift. Ids are sequential and the audit clock is a
// counter, so every run records the same rows.

import { citationCoverage, compileNote, renderPrompt, validateDocument, type Coverage, type InstructionDocument } from './compile';
import { runTestCase, type CaseResult, type Expectations, type Scenario } from './executor';
import type { Principal } from './notes';
import {
  contentHash,
  DeliveryError,
  flagsClosedByEdit,
  lineChanges,
  scanDocument,
  SourceRegistry,
  type DeliveryPayload,
  type DriftFlag,
  type Target,
} from './sources';

export type State = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'retired';
export type Action = 'submit' | 'resubmit' | 'request_changes' | 'approve' | 'edit_after_approval' | 'publish' | 'revise' | 'retire';

/** draft -> in_review -> changes_requested -> in_review -> approved -> published -> retired */
export const TRANSITIONS: Record<Action, [State, State]> = {
  submit: ['draft', 'in_review'],
  resubmit: ['changes_requested', 'in_review'],
  request_changes: ['in_review', 'changes_requested'],
  approve: ['in_review', 'approved'],
  edit_after_approval: ['approved', 'draft'],
  publish: ['approved', 'published'],
  revise: ['published', 'draft'],
  retire: ['published', 'retired'],
};

const EDITABLE: ReadonlySet<State> = new Set<State>(['draft', 'changes_requested', 'approved', 'published']);

export class IllegalTransition extends Error {
  constructor(action: string, current: State) {
    super(`cannot ${action} an instruction set in state ${current}`);
    this.name = 'IllegalTransition';
  }
}

export class Conflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Conflict';
  }
}

export class Invalid extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[]) {
    super(message);
    this.name = 'Invalid';
    this.problems = problems;
  }
}

export function assertTransition(action: string, current: State): State {
  const entry = (TRANSITIONS as Record<string, [State, State] | undefined>)[action];
  if (!entry || entry[0] !== current) throw new IllegalTransition(action, current);
  return entry[1];
}

export interface ReviewPolicy {
  required_roles: string[];
  allow_self_approval: boolean;
}

export const REVIEW_ROLES = ['reviewer', 'admin'];

export interface Note {
  id: number;
  title: string;
  author: string;
  body: string;
}

export interface InstructionSet {
  id: number;
  note_id: number;
  name: string;
  state: State;
  version: number;
  published_version: number | null;
  required_approvals: number;
  review_round: number;
  review_policy: ReviewPolicy;
  document: InstructionDocument;
}

export interface Edit {
  id: number;
  instruction_set_id: number;
  author: string;
  from_version: number;
  to_version: number;
  reason: string;
  added: number;
  removed: number;
}

export interface ReviewDecision {
  id: number;
  instruction_set_id: number;
  reviewer: string;
  reviewer_role: string;
  version: number;
  review_round: number;
  decision: 'approve' | 'request_changes';
  comment: string;
}

export interface AuditEvent {
  id: number;
  instruction_set_id: number;
  actor: string;
  action: string;
  from_state: State | null;
  to_state: State | null;
  detail: Record<string, unknown>;
  at: number;
}

export interface TestCase {
  id: number;
  instruction_set_id: number;
  name: string;
  scenario: Scenario;
  expectations: Expectations;
}

export interface TestRun {
  id: number;
  instruction_set_id: number;
  version: number;
  status: 'passed' | 'failed';
  passed: number;
  failed: number;
  results: Array<CaseResult & { test_case_id: number; name: string }>;
}

export interface Publication {
  id: number;
  instruction_set_id: number;
  version: number;
  actor: string;
  action: 'publish' | 'rollback';
  target: string;
  status: 'delivered' | 'failed';
  receipt: Record<string, unknown>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutHashes(step: object): string {
  const { citations, ...body } = step as { citations?: Array<Record<string, unknown>> };
  const cites = (citations ?? []).map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'source_hash')));
  return JSON.stringify([body, cites]);
}

/**
 * Only steps that changed pick up the registry's current hashes; untouched
 * steps keep their previous hashes, so their drift flags stay open until an
 * expert edits or re-verifies them (port of _keep_hashes_of_unchanged_steps).
 */
function keepHashesOfUnchangedSteps(oldDoc: InstructionDocument, newDoc: InstructionDocument): void {
  const previous = new Map(oldDoc.steps.map((s) => [s.id, s]));
  for (const step of newDoc.steps) {
    const before = previous.get(step.id);
    if (before && withoutHashes(before) === withoutHashes(step)) step.citations = clone(before.citations);
  }
}

export class ExpertLoopService {
  readonly registry = new SourceRegistry();
  readonly notes: Note[] = [];
  readonly sets: InstructionSet[] = [];
  readonly versions: Array<{ instruction_set_id: number; version: number; document: InstructionDocument }> = [];
  readonly edits: Edit[] = [];
  readonly reviews: ReviewDecision[] = [];
  readonly audit: AuditEvent[] = [];
  readonly testCases: TestCase[] = [];
  readonly testRuns: TestRun[] = [];
  readonly publications: Publication[] = [];
  readonly driftFlags: DriftFlag[] = [];
  private tick = 0;
  private ids = { note: 1, set: 1, edit: 1, review: 1, audit: 1, testCase: 1, testRun: 1, publication: 1, flag: 1 };

  /** Monotonic counter used for audit ordering and webhook timestamps. */
  readonly clock = (): number => {
    this.tick += 1;
    return 1_700_000_000 + this.tick;
  };

  private record(set: InstructionSet, actor: Principal, action: string, from: State | null, to: State | null, detail: Record<string, unknown> = {}): void {
    this.audit.push({ id: this.ids.audit++, instruction_set_id: set.id, actor: actor.name, action, from_state: from, to_state: to, detail, at: this.clock() });
  }

  getSet(id: number): InstructionSet {
    const set = this.sets.find((s) => s.id === id);
    if (!set) throw new Conflict(`instruction set ${id} not found`);
    return set;
  }

  ingestNote(actor: Principal, title: string, body: string, requiredApprovals: number): { set: InstructionSet; coverage: Coverage; linked: number } {
    const note: Note = { id: this.ids.note++, title, author: actor.name, body };
    this.notes.push(note);
    const document = compileNote(body, note.id, title);
    const linked = this.registry.resolveCitations(document);
    const problems = validateDocument(document);
    if (problems.length) throw new Invalid('compiled document is not valid', problems);
    const set: InstructionSet = {
      id: this.ids.set++,
      note_id: note.id,
      name: title,
      state: 'draft',
      version: 1,
      published_version: null,
      required_approvals: requiredApprovals,
      review_round: 0,
      review_policy: { required_roles: [], allow_self_approval: false },
      document,
    };
    this.sets.push(set);
    this.versions.push({ instruction_set_id: set.id, version: 1, document: clone(document) });
    const coverage = citationCoverage(document);
    this.record(set, actor, 'ingest', null, 'draft', { note_id: note.id, ...coverage });
    return { set, coverage, linked };
  }

  /** PUT with expected_version: a stale version is a conflict, an uncited step is invalid. */
  applyEdit(actor: Principal, setId: number, expectedVersion: number, reason: string, incoming: InstructionDocument): Edit {
    const set = this.getSet(setId);
    if (!EDITABLE.has(set.state)) throw new IllegalTransition('edit', set.state);
    if (set.version !== expectedVersion) throw new Conflict(`version mismatch: expected ${expectedVersion}, current is ${set.version}`);
    const document = clone(incoming);
    const problems = validateDocument(document);
    if (problems.length) throw new Invalid('edited document is not valid', problems);
    this.registry.resolveCitations(document);
    keepHashesOfUnchangedSteps(set.document, document);
    document.agent_prompt = renderPrompt(document);
    const { added, removed } = lineChanges(set.document, document);
    if (added === 0 && removed === 0) throw new Conflict('edit does not change the document');
    const fromState = set.state;
    const edit: Edit = { id: this.ids.edit++, instruction_set_id: set.id, author: actor.name, from_version: set.version, to_version: set.version + 1, reason, added, removed };
    this.edits.push(edit);
    this.versions.push({ instruction_set_id: set.id, version: edit.to_version, document: clone(document) });
    set.document = document;
    set.version = edit.to_version;
    const resolved = flagsClosedByEdit(document, this.flagsFor(set.id));
    this.closeFlags(actor, resolved, 'edited');
    if (fromState === 'approved') set.state = assertTransition('edit_after_approval', fromState);
    else if (fromState === 'published') set.state = assertTransition('revise', fromState);
    this.record(set, actor, 'edit', fromState, set.state, { from_version: edit.from_version, to_version: edit.to_version, reason });
    return edit;
  }

  setReviewPolicy(actor: Principal, setId: number, policy: Partial<ReviewPolicy>): InstructionSet {
    const set = this.getSet(setId);
    if (set.state === 'in_review') throw new Conflict('the review policy cannot change while the set is in review');
    const unknown = (policy.required_roles ?? []).filter((r) => !REVIEW_ROLES.includes(r));
    if (unknown.length) throw new Invalid('review policy is not valid', unknown.map((r) => `unknown reviewer role: ${r}`));
    set.review_policy = { required_roles: [...(policy.required_roles ?? [])], allow_self_approval: policy.allow_self_approval ?? false };
    this.record(set, actor, 'policy_set', set.state, set.state, { review_policy: set.review_policy });
    return set;
  }

  /** Submit from draft or resubmit from changes_requested; either starts a new review round. */
  submit(actor: Principal, setId: number): InstructionSet {
    const set = this.getSet(setId);
    const action = set.state === 'changes_requested' ? 'resubmit' : 'submit';
    const from = set.state;
    set.state = assertTransition(action, from);
    set.review_round += 1;
    this.record(set, actor, action, from, set.state);
    return set;
  }

  /** The note author for v1, otherwise whoever made the edit that produced the current version. */
  versionAuthor(set: InstructionSet): string {
    const noteAuthor = this.notes.find((n) => n.id === set.note_id)?.author ?? '';
    if (set.version === 1) return noteAuthor;
    return this.edits.find((e) => e.instruction_set_id === set.id && e.to_version === set.version)?.author ?? noteAuthor;
  }

  private approvalsThisRound(set: InstructionSet): ReviewDecision[] {
    return this.reviews.filter((r) => r.instruction_set_id === set.id && r.version === set.version && r.review_round === set.review_round && r.decision === 'approve');
  }

  countApprovals(set: InstructionSet): number {
    return new Set(this.approvalsThisRound(set).map((r) => r.reviewer)).size;
  }

  /** Roles the policy demands that no approver on this round holds yet. */
  missingRoles(set: InstructionSet): string[] {
    const present = new Set(this.approvalsThisRound(set).map((r) => r.reviewer_role));
    return set.review_policy.required_roles.filter((role) => !present.has(role));
  }

  review(actor: Principal, setId: number, decision: 'approve' | 'request_changes', comment: string): { set: InstructionSet; approvals: number; missing: string[] } {
    const set = this.getSet(setId);
    if (set.state !== 'in_review') throw new IllegalTransition(decision, set.state);
    const noteAuthor = this.notes.find((n) => n.id === set.note_id)?.author;
    if (!set.review_policy.allow_self_approval && (actor.name === noteAuthor || actor.name === this.versionAuthor(set))) {
      throw new Conflict(`self-approval is not allowed: ${actor.name} authored version ${set.version} of this instruction set`);
    }
    if (actor.role !== 'reviewer' && actor.role !== 'admin') throw new Conflict(`role ${actor.role} may not review`);
    this.reviews.push({ id: this.ids.review++, instruction_set_id: set.id, reviewer: actor.name, reviewer_role: actor.role, version: set.version, review_round: set.review_round, decision, comment });
    const from = set.state;
    if (decision === 'request_changes') {
      set.state = assertTransition('request_changes', from);
      this.record(set, actor, 'request_changes', from, set.state, { comment });
      return { set, approvals: 0, missing: [] };
    }
    const approvals = this.countApprovals(set);
    const missing = this.missingRoles(set);
    if (approvals >= set.required_approvals && missing.length === 0) {
      set.state = assertTransition('approve', from);
      this.record(set, actor, 'approve', from, set.state, { approvals });
    } else {
      this.record(set, actor, 'approval_recorded', from, from, { approvals, missing_roles: missing });
    }
    return { set, approvals, missing };
  }

  addTestCase(setId: number, name: string, scenario: Scenario, expectations: Expectations): TestCase {
    const testCase: TestCase = { id: this.ids.testCase++, instruction_set_id: setId, name, scenario, expectations };
    this.testCases.push(testCase);
    return testCase;
  }

  runTests(actor: Principal, setId: number): TestRun {
    const set = this.getSet(setId);
    const cases = this.testCases.filter((c) => c.instruction_set_id === setId);
    if (!cases.length) throw new Conflict('instruction set has no test cases');
    const results = cases.map((c) => ({ test_case_id: c.id, name: c.name, ...runTestCase(set.document, c.scenario, c.expectations) }));
    const passed = results.filter((r) => r.passed).length;
    const run: TestRun = { id: this.ids.testRun++, instruction_set_id: set.id, version: set.version, status: passed === results.length ? 'passed' : 'failed', passed, failed: results.length - passed, results };
    this.testRuns.push(run);
    this.record(set, actor, 'test_run', null, null, { status: run.status, passed, failed: run.failed });
    return run;
  }

  /** Approved, no open drift flag, and a green run recorded for the current version. */
  private publishGate(set: InstructionSet): TestRun {
    if (set.state !== 'approved') throw new IllegalTransition('publish', set.state);
    const stale = this.staleSteps(set.id);
    if (stale.length) throw new Conflict('publish blocked: stale steps cite changed sources: ' + stale.join(', '));
    const runs = this.testRuns.filter((r) => r.instruction_set_id === set.id);
    const run = runs[runs.length - 1];
    if (!run) throw new Conflict('publish blocked: no test run recorded for this instruction set');
    if (run.version !== set.version) throw new Conflict(`publish blocked: latest test run covers version ${run.version}, current is ${set.version}`);
    if (run.status !== 'passed') {
      throw new Conflict('publish blocked: failing test cases: ' + run.results.filter((r) => !r.passed).map((r) => r.name).join(', '));
    }
    return run;
  }

  private deliver(actor: Principal, set: InstructionSet, version: number, document: InstructionDocument, action: 'publish' | 'rollback', targets: Target[], extra: Record<string, unknown>): Publication[] {
    const payload: DeliveryPayload = { event: `instruction_set.${action}`, action, instruction_set_id: set.id, name: set.name, version, document, ...extra };
    return targets.map((target) => {
      let status: Publication['status'];
      let receipt: Record<string, unknown>;
      try {
        const out = target.deliver(payload, this.clock);
        status = out.status;
        receipt = out.receipt;
      } catch (error) {
        if (!(error instanceof DeliveryError)) throw error;
        status = 'failed';
        receipt = { error: error.message };
      }
      const publication: Publication = { id: this.ids.publication++, instruction_set_id: set.id, version, actor: actor.name, action, target: target.name, status, receipt };
      this.publications.push(publication);
      return publication;
    });
  }

  publish(actor: Principal, setId: number, targets: Target[]): { set: InstructionSet; publications: Publication[] } {
    const set = this.getSet(setId);
    if (actor.role !== 'admin') throw new Conflict(`role ${actor.role} may not publish`);
    let run: TestRun;
    try {
      run = this.publishGate(set);
    } catch (error) {
      this.record(set, actor, 'publish_blocked', set.state, set.state, { reason: (error as Error).message });
      throw error;
    }
    const publications = this.deliver(actor, set, set.version, set.document, 'publish', targets, { test_run_id: run.id, approvals: this.countApprovals(set) });
    const failed = publications.filter((p) => p.status !== 'delivered');
    if (failed.length) throw new Conflict('publish failed: ' + failed.map((p) => p.target).join(', '));
    const from = set.state;
    set.state = assertTransition('publish', from);
    set.published_version = set.version;
    this.record(set, actor, 'publish', from, set.state, { version: set.version });
    return { set, publications };
  }

  /** Re-deliver the latest earlier delivered snapshot; the head version stays where it is. */
  rollback(actor: Principal, setId: number, targets: Target[]): { set: InstructionSet; publications: Publication[] } {
    const set = this.getSet(setId);
    if (actor.role !== 'admin') throw new Conflict(`role ${actor.role} may not roll back`);
    const live = set.published_version;
    if (live === null) throw new Conflict('nothing is published for this instruction set');
    const earlier = this.publications
      .filter((p) => p.instruction_set_id === set.id && p.action === 'publish' && p.status === 'delivered' && p.version < live)
      .map((p) => p.version);
    if (!earlier.length) throw new Conflict(`no earlier published version to roll back to (live is v${live})`);
    const previous = Math.max(...earlier);
    const snapshot = this.versions.find((v) => v.instruction_set_id === set.id && v.version === previous);
    if (!snapshot) throw new Conflict(`version ${previous} snapshot missing`);
    const publications = this.deliver(actor, set, previous, snapshot.document, 'rollback', targets, { rolled_back_from: live });
    if (publications.some((p) => p.status !== 'delivered')) throw new Conflict('rollback failed');
    set.published_version = previous;
    this.record(set, actor, 'rollback', set.state, set.state, { from_version: live, to_version: previous });
    return { set, publications };
  }

  // --- source drift ---------------------------------------------------------

  flagsFor(setId: number): DriftFlag[] {
    return this.driftFlags.filter((f) => f.instruction_set_id === setId);
  }

  staleSteps(setId: number): string[] {
    return Array.from(new Set(this.flagsFor(setId).filter((f) => f.open).map((f) => f.step_id))).sort();
  }

  /** Re-hash a source with new content; returns true and opens flags when the digest changed. */
  rehashSource(actor: Principal, sourceId: number, content: string): boolean {
    const source = this.registry.byId(sourceId);
    if (!source) throw new Conflict(`source ${sourceId} not found`);
    source.content = content;
    const next = contentHash(source.content, source.ref);
    const changed = next !== source.content_hash;
    source.content_hash = next;
    if (changed) this.scanDrift(actor, sourceId);
    return changed;
  }

  scanDrift(actor: Principal, sourceId: number | null = null): DriftFlag[] {
    const created: DriftFlag[] = [];
    for (const set of this.sets) {
      if (set.state === 'retired') continue;
      const fresh = scanDocument(set.document, this.registry, this.flagsFor(set.id), sourceId);
      if (!fresh.length) continue;
      const flags = fresh.map((f) => ({ id: this.ids.flag++, instruction_set_id: set.id, detected_by: actor.name, resolved_by: null, resolution: null, open: true, ...f }));
      this.driftFlags.push(...flags);
      this.record(set, actor, 'drift_detected', set.state, set.state, { steps: flags.map((f) => f.step_id) });
      created.push(...flags);
    }
    return created;
  }

  private closeFlags(actor: Principal, flags: DriftFlag[], resolution: string): DriftFlag[] {
    for (const flag of flags) {
      flag.open = false;
      flag.resolved_by = actor.name;
      flag.resolution = resolution;
    }
    return flags;
  }

  /** An expert re-reads the changed source and confirms the steps still hold; the citation takes the new hash. */
  reverify(actor: Principal, setId: number): DriftFlag[] {
    const set = this.getSet(setId);
    const target = this.flagsFor(setId).filter((f) => f.open);
    if (!target.length) throw new Conflict('no open drift flags to verify');
    this.closeFlags(actor, target, 'reverified');
    for (const flag of target) {
      for (const step of set.document.steps) {
        if (step.id !== flag.step_id) continue;
        for (const cite of step.citations) if (cite.source_id === flag.source_id) cite.source_hash = flag.current_hash;
      }
    }
    this.record(set, actor, 'drift_reverified', set.state, set.state, { steps: target.map((f) => f.step_id) });
    return target;
  }
}
