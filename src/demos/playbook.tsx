import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './playbook.css';
import { outcomeKey, PlaybookSim, RUN_MS, type Snap } from './playbook/sim';
import type { RunTrace } from './playbook/types';

// Real mechanism from playbook: the support triage SOP and a recorded expert
// walkthrough are parsed into a cited procedure and rendered as a versioned
// system prompt. A bounded tool-calling loop runs each of 16 scenarios against
// stand-ins for Jira, Slack and a knowledge base, using the offline stand-in
// for the model API that only follows rules it can parse. Every run is graded
// against the expert rubric; failed criteria become explicit corrections
// under the SOP step they belong to, and the next version runs the whole set
// again. The promotion gate refuses any version whose report still holds a
// forbidden action. Ids and latencies come from a seeded PRNG, so every run
// reproduces 12.5% to 87.5% to 100% with 12 corrections.
const STEP_MS = 700;

type EntryKind = 'prompt' | 'intake' | 'model' | 'tool' | 'final';

interface Entry {
  kind: EntryKind;
  label: string;
  meta: string;
  body: string;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function buildEntries(trace: RunTrace): Entry[] {
  const entries: Entry[] = [
    { kind: 'prompt', label: 'system prompt', meta: `v${trace.promptVersion}, ${trace.systemPrompt.split('\n').length} lines`, body: trace.systemPrompt },
    { kind: 'intake', label: 'intake', meta: 'first user turn', body: trace.userMessage },
  ];
  for (const turn of trace.turns) {
    const names = turn.toolUses.map((u) => u.name).join(', ');
    entries.push({
      kind: 'model',
      label: `model turn ${turn.turn}`,
      meta: `stop_reason=${turn.stopReason ?? 'none'} in=${turn.inputTokens} out=${turn.outputTokens}`,
      body: turn.text.trim() || (names ? `requests ${names}` : '(no text)'),
    });
    for (const call of trace.toolCalls.filter((c) => c.turn === turn.turn)) {
      entries.push({
        kind: 'tool',
        label: call.name,
        meta: `${call.durationMs} ms${call.error ? ', error' : ''}`,
        body: `arguments\n${pretty(call.args)}\n\nresult\n${pretty(call.error ? { error: call.error } : call.result)}`,
      });
    }
  }
  entries.push({ kind: 'final', label: 'final message', meta: `status=${trace.status} run=${trace.runId}`, body: trace.finalText });
  return entries;
}

export default function PlaybookDemo() {
  const reduce = useReducedMotion();
  const simRef = useRef<PlaybookSim | null>(null);
  const [snap, setSnap] = useState<Snap>(() => new PlaybookSim().snapshot());
  const [sel, setSel] = useState({ scenarioId: 'triage-01', version: 1 });
  const [step, setStep] = useState(0);
  const [autoStep, setAutoStep] = useState(false);

  function sim(): PlaybookSim {
    if (!simRef.current) simRef.current = new PlaybookSim();
    return simRef.current;
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sim();
      if (!s.running) return;
      s.tick();
      setSnap(s.snapshot());
    }, RUN_MS);
    return () => window.clearInterval(id);
  }, []);

  const outcome = snap.outcomes[outcomeKey(sel.version, sel.scenarioId)] ?? null;
  const entries = outcome ? buildEntries(outcome.trace) : [];
  const index = Math.min(step, Math.max(0, entries.length - 1));
  const entry = entries[index];
  const playing = autoStep && index < entries.length - 1;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  function run() {
    const s = sim();
    s.start();
    if (reduce) s.finish();
    setSnap(s.snapshot());
  }
  function reset() {
    simRef.current = new PlaybookSim();
    setSnap(simRef.current.snapshot());
    setSel({ scenarioId: 'triage-01', version: 1 });
    setStep(0);
    setAutoStep(false);
  }
  function select(scenarioId: string, version: number) {
    setSel({ scenarioId, version });
    setStep(0);
    setAutoStep(false);
  }
  function promote(version: number) {
    sim().promote(version);
    setSnap(sim().snapshot());
  }

  const done = snap.versions.filter((v) => v.complete);
  const current = snap.versions.find((v) => !v.complete);
  const corrections = done.flatMap((v) => v.corrections);
  const status = snap.running
    ? `prompt v${current?.version ?? 1} running, ${current?.graded ?? 0} of ${snap.scenarios.length} scenarios graded`
    : snap.done
      ? `loop stopped after v${done.length}: ${snap.stopReason}`
      : 'ready';
  const failed = outcome ? outcome.grade.results.filter((r) => !r.passed) : [];

  return (
    <div className="demo" aria-label="playbook evaluation loop demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Prompt versions graded against an expert rubric</h3>
      <p className="demo__lede">
        The support triage SOP and walkthrough become prompt v1, which runs all 16 scenarios through a bounded tool-calling
        loop against stand-ins for Jira, Slack and a knowledge base. Each run is graded against the expert rubric, failed
        criteria turn into corrections under the SOP step they belong to, and the next version runs the set again until
        every scenario passes.
      </p>

      <div className="pb__status mono" aria-live="polite">
        <span className="pb__status-dot" data-live={snap.running} data-done={snap.done} />
        {status}
      </div>

      <div className="pb__stats">
        <Stat label="pass rate by version" value={done.length ? done.map((v) => v.passRate).join(' > ') : 'not run'} pinned={snap.done} />
        <Stat label="forbidden actions" value={done.length ? done.map((v) => v.forbidden).join(' > ') : '-'} />
        <Stat label="corrections" value={corrections.length} />
        <Stat label="graded runs" value={snap.graded} sub={`${snap.toolCalls} tool calls`} />
      </div>

      <div className="pb__stage">
        <section className="pb__panel" aria-label="Evaluation grid">
          <div className="pb__panel-head">
            <span className="pb__panel-title">evaluation grid</span>
            <span className="pb__panel-meta">pass threshold 0.95, no forbidden action</span>
          </div>
          <div className="pb__grid-wrap">
            <table className="pb__grid">
              <thead>
                <tr>
                  <th scope="col">scenario</th>
                  {snap.versions.map((v) => (
                    <th scope="col" key={v.version}>
                      v{v.version}
                      <span className="pb__rate">{v.passRate ?? `${v.graded}/${snap.scenarios.length}`}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snap.scenarios.map((sc) => (
                  <tr key={sc.id}>
                    <th scope="row">
                      <span className="pb__sc-id">{sc.id}</span>
                      <span className="pb__sc-tags">{sc.tags.join(' ')}</span>
                    </th>
                    {snap.versions.map((v, i) => {
                      const cell = snap.cells[sc.id][i];
                      const isNew = v.newlyPassing.includes(sc.id);
                      return (
                        <td key={v.version}>
                          <button
                            className="pb__cell"
                            data-state={cell}
                            data-new={isNew}
                            data-sel={sel.scenarioId === sc.id && sel.version === v.version}
                            disabled={cell === 'pending' || cell === 'running'}
                            onClick={() => select(sc.id, v.version)}
                            aria-label={`${sc.id} under v${v.version}: ${cell}`}
                          >
                            {cell === 'running' ? 'run' : cell === 'pending' ? '' : cell}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pb__note mono">
            {done.length
              ? done.map((v) => `v${v.version}: ${v.passed}/${v.graded} pass, mean ${v.meanScore}, ${v.forbidden} forbidden`).join('; ')
              : 'cells fill as each run is graded; a cell opens its transcript'}
          </p>
        </section>

        <section className="pb__panel" aria-label="Transcript">
          <div className="pb__panel-head">
            <span className="pb__panel-title">transcript</span>
            <span className="pb__panel-meta">
              {sel.scenarioId} under v{sel.version}
              {outcome ? `, score ${(outcome.grade.score * 100).toFixed(1)}%, ${outcome.grade.passed ? 'pass' : 'fail'}` : ''}
            </span>
          </div>
          {outcome && entry ? (
            <>
              <ol className="pb__steps mono">
                {entries.map((e, i) => (
                  <li key={i}>
                    <button className="pb__step" data-kind={e.kind} data-on={i === index} onClick={() => { setStep(i); setAutoStep(false); }}>
                      {e.label}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="pb__entry-head mono">
                <b>{entry.label}</b> <span>{entry.meta}</span>
              </div>
              <pre className="pb__body mono">{entry.body}</pre>
              <div className="pb__row">
                <button className="demo__btn demo__btn--ghost pb__small" onClick={() => { setStep(Math.max(0, index - 1)); setAutoStep(false); }} disabled={index === 0}>
                  Previous
                </button>
                <button className="demo__btn demo__btn--ghost pb__small" onClick={() => { setStep(Math.min(entries.length - 1, index + 1)); setAutoStep(false); }} disabled={index >= entries.length - 1}>
                  Next
                </button>
                <button className="demo__btn demo__btn--ghost pb__small" onClick={() => { if (index >= entries.length - 1) setStep(0); setAutoStep(!playing); }}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <span className="pb__count mono">{index + 1} / {entries.length}</span>
              </div>
              <ul className="pb__failed mono">
                {failed.length === 0 && <li className="pb__failed-none">every criterion passed</li>}
                {failed.map((r) => (
                  <li key={r.id} data-forbidden={r.forbidden}>
                    <b>{r.id}</b>
                    {r.forbidden ? ' (forbidden)' : ''}: {r.rationale}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="pb__empty">The transcript for {sel.scenarioId} under v{sel.version} appears once that run is graded.</p>
          )}
        </section>

        <section className="pb__panel" aria-label="Corrections">
          <div className="pb__panel-head">
            <span className="pb__panel-title">corrections</span>
            <span className="pb__panel-meta">derived from failed criteria, appended under their SOP step</span>
          </div>
          {done.filter((v) => v.corrections.length).length === 0 && <p className="pb__empty">No version has been corrected yet.</p>}
          {done
            .filter((v) => v.corrections.length)
            .map((v) => {
              const before = done.find((x) => x.version === v.version - 1);
              return (
                <div key={v.version} className="pb__round">
                  <div className="pb__round-head mono">
                    v{v.version - 1} to v{v.version}: {before?.passRate} to {v.passRate}, {v.corrections.length} correction{v.corrections.length === 1 ? '' : 's'}, {v.newlyPassing.length} newly passing
                  </div>
                  <ul className="pb__corrections">
                    {v.corrections.map((c) => (
                      <li key={`${c.stepId}-${c.text}`}>
                        <span className="pb__corr-text">
                          <b className="mono">[{c.stepId}]</b> {c.text}
                        </span>
                        <span className="pb__corr-meta mono">
                          {c.criterion}, {c.evidence}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </section>

        <section className="pb__panel" aria-label="Promotion gate">
          <div className="pb__panel-head">
            <span className="pb__panel-title">promotion gate</span>
            <span className="pb__panel-meta">refuses a version while a forbidden action remains</span>
          </div>
          <div className="pb__row">
            {(done.length ? done : [{ version: 1 }, { version: 2 }, { version: 3 }]).map((v) => (
              <button key={v.version} className="demo__btn demo__btn--ghost pb__small" disabled={!snap.done} onClick={() => promote(v.version)}>
                Promote v{v.version}
              </button>
            ))}
          </div>
          <div className="pb__gate mono" aria-live="polite">
            {snap.promotions.length === 0 && <p className="pb__empty">{snap.done ? 'Each graded version can be put to the gate.' : 'The gate opens once the loop has stopped.'}</p>}
            {snap.promotions.map((p) => (
              <pre key={p.seq} className="pb__decision" data-promoted={p.promoted}>
                {p.text}
              </pre>
            ))}
          </div>
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={snap.running}>
          {snap.running ? 'Running the loop…' : snap.done ? 'Run again' : 'Run the loop'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          seed 0x{snap.seed.toString(16)}, {snap.done ? `${snap.graded} graded runs` : '48 graded runs when complete'}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, pinned }: { label: string; value: string | number; sub?: string; pinned?: boolean }) {
  return (
    <div className="pb__stat" data-pinned={pinned === true}>
      <span className="pb__stat-label">{label}</span>
      <span className="pb__stat-val">{value}</span>
      {sub && <span className="pb__stat-sub">{sub}</span>}
    </div>
  );
}
