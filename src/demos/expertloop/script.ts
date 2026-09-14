// The repo's end-to-end demo (expertloop/demo.py) as a generator: register
// sources, ingest three notes, request changes and edit, review, run tests,
// publish (the refund SOP is blocked by a failing forbidden-action case), fix
// and republish, revise onboarding to v2 and roll it back to v1. Each yield is
// one action's log lines; the return value is the summary computed from the
// records, which is compared with the block quoted in the README.

import type { InstructionDocument } from './compile';
import { PEOPLE, SAMPLE_NOTES, SAMPLE_SOURCES, SAMPLE_TEST_CASES, type NoteKey } from './notes';
import { Conflict, ExpertLoopService, IllegalTransition, type Publication } from './service';
import { FakeJira, FakeWebhookReceiver, JiraTarget, WebhookTarget, type Target } from './sources';

export const WEBHOOK_SECRET = 'demo-secret';
export const JIRA_ISSUE = 'OPS-1';

export interface DemoLine {
  kind: 'section' | 'info' | 'ok' | 'fail' | 'blocked';
  text: string;
}

export interface DemoSummary {
  notes: number;
  steps: number;
  cited_steps: number;
  citations: number;
  coverage: number;
  edits: number;
  approvals: number;
  changes_requested: number;
  test_runs: number;
  runs_green: number;
  runs_red: number;
  cases_passed: number;
  cases_failed: number;
  publishes_blocked: number;
  deliveries: number;
  versions_delivered: number;
  rollbacks: number;
  webhook_receipts: number;
  jira_comments: number;
  jira_attachments: number;
  states: { id: number; state: string; live: number | null }[];
}

export interface DemoWorld {
  service: ExpertLoopService;
  webhook: FakeWebhookReceiver;
  jira: FakeJira;
  targets: Target[];
  sets: Record<NoteKey, number>;
  blocked: number;
}

export function createDemoWorld(): DemoWorld {
  const service = new ExpertLoopService();
  const webhook = new FakeWebhookReceiver(WEBHOOK_SECRET);
  const jira = new FakeJira();
  return { service, webhook, jira, targets: [new WebhookTarget(WEBHOOK_SECRET, webhook), new JiraTarget(JIRA_ISSUE, jira)], sets: { refund: 0, onboarding: 0, incident: 0 }, blocked: 0 };
}

function registerSources(world: DemoWorld): void {
  for (const s of SAMPLE_SOURCES) world.service.registry.register(s.kind, s.ref, s.content, s.title);
}

function ingestAll(world: DemoWorld, log: DemoLine[]): void {
  for (const note of SAMPLE_NOTES) {
    const out = world.service.ingestNote(PEOPLE.dana, note.title, note.body, note.required_approvals);
    world.sets[note.key] = out.set.id;
    log.push({
      kind: 'info',
      text: `set ${out.set.id}: ${note.title} -> ${out.coverage.steps} steps, ${out.coverage.citations} citations, coverage ${Math.round(out.coverage.coverage * 100)}%, ${out.linked} sources linked, needs ${note.required_approvals} approval(s)`,
    });
  }
}

function addTestCases(world: DemoWorld, log: DemoLine[]): void {
  for (const key of Object.keys(SAMPLE_TEST_CASES) as NoteKey[]) {
    for (const tc of SAMPLE_TEST_CASES[key]) world.service.addTestCase(world.sets[key], tc.name, tc.scenario, tc.expectations);
    log.push({ kind: 'info', text: `set ${world.sets[key]}: ${SAMPLE_TEST_CASES[key].length} test cases` });
  }
}

/** All three notes ingested with sources and test cases; nothing reviewed yet. */
export function createSeededWorld(): DemoWorld {
  const world = createDemoWorld();
  registerSources(world);
  ingestAll(world, []);
  addTestCases(world, []);
  return world;
}

/** Onboarding approved by ravi with a green run on v1: publishable until a cited source drifts. */
export function createApprovedWorld(): DemoWorld {
  const world = createSeededWorld();
  reviewRound(world, world.sets.onboarding, ['ravi'], []);
  runTests(world, world.sets.onboarding, []);
  return world;
}

/** The incident set under a review policy that requires an admin among the approvers. */
export function createPolicyWorld(): DemoWorld {
  const world = createSeededWorld();
  world.service.setReviewPolicy(PEOPLE.ops, world.sets.incident, { required_roles: ['admin'] });
  return world;
}

function edit(world: DemoWorld, setId: number, reason: string, mutate: (doc: InstructionDocument) => void, log: DemoLine[]): void {
  const current = world.service.getSet(setId);
  const document = JSON.parse(JSON.stringify(current.document)) as InstructionDocument;
  mutate(document);
  const out = world.service.applyEdit(PEOPLE.dana, setId, current.version, reason, document);
  log.push({ kind: 'info', text: `edit ${out.id} on set ${setId}: v${out.from_version} -> v${out.to_version} (${out.added} lines added) reason: ${reason}` });
}

function reviewRound(world: DemoWorld, setId: number, reviewers: Array<'ravi' | 'mei'>, log: DemoLine[]): void {
  const submitted = world.service.submit(PEOPLE.dana, setId);
  log.push({ kind: 'info', text: `set ${setId}: submitted -> ${submitted.state}` });
  for (const reviewer of reviewers) {
    const out = world.service.review(PEOPLE[reviewer], setId, 'approve', 'verified against the source documents');
    log.push({ kind: 'ok', text: `set ${setId}: ${reviewer} approved (${out.approvals}/${out.set.required_approvals}) -> ${out.set.state}` });
  }
}

function runTests(world: DemoWorld, setId: number, log: DemoLine[]): void {
  const run = world.service.runTests(PEOPLE.ravi, setId);
  log.push({ kind: run.status === 'passed' ? 'ok' : 'fail', text: `set ${setId} v${run.version}: ${run.status.toUpperCase()} (${run.passed} passed, ${run.failed} failed)` });
  for (const result of run.results) {
    if (!result.passed) log.push({ kind: 'fail', text: `FAIL ${result.name}: ${result.failures.join('; ')}` });
  }
}

export function receiptId(pub: Publication): string {
  const receipt = pub.receipt as { receipt_id?: string; comment?: { id?: string } };
  return receipt.receipt_id ?? receipt.comment?.id ?? '?';
}

function publish(world: DemoWorld, setId: number, log: DemoLine[]): void {
  try {
    const out = world.service.publish(PEOPLE.ops, setId, world.targets);
    for (const pub of out.publications) log.push({ kind: 'ok', text: `set ${setId} v${pub.version}: delivered to ${pub.target} (receipt ${receiptId(pub)})` });
  } catch (error) {
    if (!(error instanceof Conflict || error instanceof IllegalTransition)) throw error;
    world.blocked += 1;
    log.push({ kind: 'blocked', text: `set ${setId}: publish BLOCKED: ${error.message}` });
  }
}

function applyManagerThreshold(document: InstructionDocument): void {
  const step = document.steps[3];
  step.decision_rules.push({ condition: 'amount is over 500', then: 'request manager approval and stop', halts: true });
  step.citations.push({ note_id: step.citations[0].note_id, line_start: step.citations[0].line_start, line_end: step.citations[0].line_end, source_kind: 'doc', source_ref: 'policy/refunds-v4' });
}

function announceMitigation(document: InstructionDocument): void {
  const step = document.steps[5];
  step.action = 'Post the mitigation plan in #incidents, then ' + step.action[0].toLowerCase() + step.action.slice(1);
  step.citations.push({ note_id: step.citations[0].note_id, line_start: step.citations[0].line_start, line_end: step.citations[0].line_end, source_kind: 'url', source_ref: 'https://status.example.com/runbooks/triage' });
}

function addOncallChannel(document: InstructionDocument): void {
  document.steps[3].action += ' and #eng-oncall';
}

/** One yield per action, in the order demo.py performs them. */
export function* demoScript(world: DemoWorld): Generator<DemoLine[], DemoSummary> {
  const { service } = world;
  let log: DemoLine[] = [];
  const flush = () => {
    const out = log;
    log = [];
    return out;
  };
  const section = (text: string) => log.push({ kind: 'section', text });

  section('Registering sources with content hashes');
  registerSources(world);
  for (const s of service.registry.list()) log.push({ kind: 'info', text: `${s.kind} ${s.ref} sha256:${s.content_hash.slice(0, 12)}` });
  yield flush();
  section('Ingesting expert notes and compiling instruction sets');
  ingestAll(world, log);
  yield flush();
  section('Adding test cases');
  addTestCases(world, log);
  yield flush();

  section('Review: edit requested on the incident note, then approvals');
  const incident = world.sets.incident;
  service.submit(PEOPLE.dana, incident);
  const changes = service.review(PEOPLE.ravi, incident, 'request_changes', 'step 6 must announce mitigation in #incidents first');
  log.push({ kind: 'info', text: `set ${incident}: ravi requested changes -> ${changes.set.state}` });
  yield flush();
  edit(world, incident, 'announce mitigation in #incidents before acting', announceMitigation, log);
  yield flush();
  reviewRound(world, incident, ['mei'], log);
  yield flush();
  reviewRound(world, world.sets.onboarding, ['ravi'], log);
  yield flush();
  reviewRound(world, world.sets.refund, ['ravi', 'mei'], log);
  yield flush();

  section('Running test cases and publishing approved sets');
  const order: NoteKey[] = ['onboarding', 'incident', 'refund'];
  for (const key of order) {
    runTests(world, world.sets[key], log);
    yield flush();
  }
  for (const key of order) {
    publish(world, world.sets[key], log);
    yield flush();
  }

  const refund = world.sets.refund;
  section(`Fixing set ${refund}: add the manager approval threshold from policy/refunds-v4`);
  edit(world, refund, 'manager approval required above 500 (policy/refunds-v4)', applyManagerThreshold, log);
  log.push({ kind: 'info', text: `set ${refund}: state after edit -> ${service.getSet(refund).state}` });
  yield flush();
  reviewRound(world, refund, ['ravi', 'mei'], log);
  yield flush();
  runTests(world, refund, log);
  yield flush();
  publish(world, refund, log);
  yield flush();

  const onboarding = world.sets.onboarding;
  section(`Revising published set ${onboarding}, publishing v2, then rolling back`);
  edit(world, onboarding, 'also add the on-call channel', addOncallChannel, log);
  yield flush();
  reviewRound(world, onboarding, ['ravi'], log);
  yield flush();
  runTests(world, onboarding, log);
  yield flush();
  publish(world, onboarding, log);
  yield flush();
  const rolled = service.rollback(PEOPLE.ops, onboarding, world.targets);
  for (const pub of rolled.publications) log.push({ kind: 'ok', text: `set ${onboarding}: rollback delivered v${pub.version} to ${pub.target} (receipt ${receiptId(pub)})` });
  log.push({ kind: 'info', text: `set ${onboarding}: live version is now v${rolled.set.published_version}` });
  yield flush();

  return summarize(world);
}

export function summarize(world: DemoWorld): DemoSummary {
  const { service } = world;
  const sets = service.sets;
  const steps = sets.reduce((n, s) => n + s.document.steps.length, 0);
  const cited = sets.reduce((n, s) => n + s.document.steps.filter((st) => st.citations.length > 0).length, 0);
  const delivered = service.publications.filter((p) => p.action === 'publish' && p.status === 'delivered');
  const rollbacks = new Set(service.publications.filter((p) => p.action === 'rollback').map((p) => `${p.instruction_set_id}:${p.version}`));
  return {
    notes: sets.length,
    steps,
    cited_steps: cited,
    citations: sets.reduce((n, s) => n + s.document.steps.reduce((m, st) => m + st.citations.length, 0), 0),
    coverage: steps ? cited / steps : 1,
    edits: service.edits.length,
    approvals: service.reviews.filter((r) => r.decision === 'approve').length,
    changes_requested: service.reviews.filter((r) => r.decision === 'request_changes').length,
    test_runs: service.testRuns.length,
    runs_green: service.testRuns.filter((r) => r.status === 'passed').length,
    runs_red: service.testRuns.filter((r) => r.status === 'failed').length,
    cases_passed: service.testRuns.reduce((n, r) => n + r.passed, 0),
    cases_failed: service.testRuns.reduce((n, r) => n + r.failed, 0),
    publishes_blocked: world.blocked,
    deliveries: delivered.length,
    versions_delivered: new Set(delivered.map((p) => `${p.instruction_set_id}:${p.version}`)).size,
    rollbacks: rollbacks.size,
    webhook_receipts: world.webhook.received.length,
    jira_comments: world.jira.comments.length,
    jira_attachments: world.jira.attachments.length,
    states: sets.map((s) => ({ id: s.id, state: s.state, live: s.published_version })),
  };
}

/** The summary block `make demo` prints, rendered from the in-memory records. */
export function summaryBlock(summary: DemoSummary): string {
  const pad = (label: string) => `  ${label}:`.padEnd(25);
  return [
    '== Summary',
    `${pad('notes ingested')}${summary.notes}`,
    `${pad('steps compiled')}${summary.steps}`,
    `${pad('citations linked')}${summary.citations} (${summary.cited_steps}/${summary.steps} steps cited, ${Math.round(summary.coverage * 100)}%)`,
    `${pad('edits recorded')}${summary.edits}`,
    `${pad('approvals')}${summary.approvals} (changes requested: ${summary.changes_requested})`,
    `${pad('test runs')}${summary.test_runs} (${summary.runs_green} green, ${summary.runs_red} red; ${summary.cases_passed} cases passed, ${summary.cases_failed} failed)`,
    `${pad('publishes blocked')}${summary.publishes_blocked}`,
    `${pad('publishes delivered')}${summary.deliveries} deliveries (${summary.versions_delivered} versions to 2 targets), rollbacks: ${summary.rollbacks}`,
    `${pad('receipts')}${summary.webhook_receipts} webhook (signed), ${summary.jira_comments} Jira comments, ${summary.jira_attachments} Jira attachments`,
    `${pad('states')}${summary.states.map((s) => `set ${s.id}=${s.state} (live v${s.live})`).join(', ')}`,
  ].join('\n');
}

/** The block quoted in the repo README. */
export const README_SUMMARY = `== Summary
  notes ingested:        3
  steps compiled:        18
  citations linked:      26 (18/18 steps cited, 100%)
  edits recorded:        3
  approvals:             7 (changes requested: 1)
  test runs:             5 (4 green, 1 red; 13 cases passed, 1 failed)
  publishes blocked:     1
  publishes delivered:   8 deliveries (4 versions to 2 targets), rollbacks: 1
  receipts:              5 webhook (signed), 5 Jira comments, 5 Jira attachments
  states:                set 1=published (live v2), set 2=published (live v1), set 3=published (live v2)`;
