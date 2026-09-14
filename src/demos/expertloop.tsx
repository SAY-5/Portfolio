import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './expertloop.css';
import { Lab, README_FIGURES, type LabSnap, type LogLine, type ReceiptView, type Reviewer } from './expertloop/lab';

// Real mechanism from expertloop: a deterministic parser splits an expert
// note into sections whose items remember their line ranges, and the compiler
// turns each step item into an instruction step citing that range plus any
// doc:, ticket or URL reference on it. A citation stores its source's sha256;
// re-hashing a source to a new digest opens a drift flag on exactly the steps
// that cite it, and the publish gate refuses while a flag is open, the latest
// test run is not green on the current version, or the set is not approved.
// The review policy refuses approval by the version author and holds a set in
// review until a required role has approved. Publishing signs the payload
// with HMAC-SHA256 for a webhook receiver and posts to a Jira fake, and a
// rollback re-delivers the previous snapshot. Ids are sequential and the
// clock is a counter, so every run prints the same summary.
const STEP_MS = 420;
const TRACK = ['draft', 'in_review', 'approved'] as const;
const REVIEWERS: Reviewer[] = ['dana', 'ravi', 'mei', 'ops'];

function Log({ lines, empty }: { lines: LogLine[]; empty: string }) {
  return (
    <ul className="el__log" aria-live="polite">
      {lines.length === 0 ? (
        <li className="el__empty">{empty}</li>
      ) : (
        lines.map((l) => (
          <li key={l.id} data-kind={l.kind}>
            {l.text}
          </li>
        ))
      )}
    </ul>
  );
}

function Receipts({ rows }: { rows: ReceiptView[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="el__receipts" aria-label="Delivery receipts">
      {rows.map((r) => (
        <li key={r.id}>
          <b>{r.target}</b>
          <span>
            set {r.setId} {r.action} v{r.version}: {r.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'on' }) {
  return (
    <div className="el__stat" data-tone={tone}>
      <span className="el__stat-label">{label}</span>
      <span className="el__stat-val">{value}</span>
      {sub && <span className="el__stat-sub">{sub}</span>}
    </div>
  );
}

export default function ExpertloopDemo() {
  const reduce = useReducedMotion();
  const [lab, setLab] = useState(() => new Lab());
  const [snap, setSnap] = useState<LabSnap>(() => lab.snapshot());
  const [noteIdx, setNoteIdx] = useState(1);
  const [stepId, setStepId] = useState('s6');
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const done = lab.stepScript();
      setSnap(lab.snapshot());
      if (done) setPlaying(false);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, lab]);

  function act(fn: (l: Lab) => void) {
    fn(lab);
    setSnap(lab.snapshot());
  }
  function runScript() {
    if (reduce) {
      lab.finishScript();
      setSnap(lab.snapshot());
      return;
    }
    lab.startScript();
    setSnap(lab.snapshot());
    setPlaying(true);
  }
  function resetRun() {
    setPlaying(false);
    act((l) => l.resetScript());
  }
  function reset() {
    const next = new Lab();
    setPlaying(false);
    setLab(next);
    setSnap(next.snapshot());
    setNoteIdx(1);
    setStepId('s6');
  }
  function pickNote(i: number) {
    setNoteIdx(i);
    setStepId('s1');
  }

  const note = snap.notes[noteIdx];
  const step = note.steps.find((s) => s.id === stepId) ?? note.steps[0];
  const cited = new Set<number>();
  for (const s of note.steps) for (let n = s.lineStart; n <= s.lineEnd; n++) cited.add(n);
  const totals = snap.notes.reduce(
    (t, n) => ({ steps: t.steps + n.coverage.steps, cited: t.cited + n.coverage.cited_steps, citations: t.citations + n.coverage.citations }),
    { steps: 0, cited: 0, citations: 0 },
  );

  const d = snap.drift;
  const gate = d.stale.length > 0 ? 'blocked' : d.state === 'published' ? 'open' : 'clear';
  const p = snap.policy;
  const sc = snap.script;
  const live = sc.live;
  const trackAt = TRACK.indexOf(p.state as (typeof TRACK)[number]);

  return (
    <div className="demo" aria-label="expertloop instruction set demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Cited steps, a drift gate, a review policy</h3>
      <p className="demo__lede">
        Each instruction step compiled from an expert note cites the note lines it came from. Rewriting a
        cited source flags exactly the steps that cite it, and the publish gate refuses until an expert
        re-verifies them. The review policy refuses approval by the version author and holds the set in
        review until an admin approves. The replayed demo script ends on the summary the repo prints:{' '}
        {README_FIGURES.steps} steps, {README_FIGURES.citations} citations, {README_FIGURES.blocked} blocked
        publish, {README_FIGURES.deliveries} deliveries and {README_FIGURES.rollbacks} rollback.
      </p>

      <div className="el__stage">
        <section className="el__panel el__panel--wide" aria-label="Compile notes into cited steps">
          <div className="el__head">
            <span className="el__title">compile: note lines to cited steps</span>
            <span className="el__meta">
              {totals.steps} steps, {totals.citations} citations as ingested, {totals.cited}/{totals.steps} steps cited
            </span>
          </div>
          <div className="el__tabs" role="group" aria-label="Note">
            {snap.notes.map((n, i) => (
              <button key={n.key} className="el__tab" aria-pressed={i === noteIdx} onClick={() => pickNote(i)}>
                {n.file}
              </button>
            ))}
          </div>
          <div className="el__compile">
            <div>
              <span className="el__file">
                {note.file}, {note.lines.length} lines, {step.id} cites L{step.lineStart}
                {step.lineEnd !== step.lineStart ? `-${step.lineEnd}` : ''}
              </span>
              <ol className="el__note" aria-label={`${note.file} source lines`}>
                {note.lines.map((text, i) => {
                  const no = i + 1;
                  return (
                    <li key={no} className="el__line" data-on={no >= step.lineStart && no <= step.lineEnd} data-cited={cited.has(no)}>
                      <span className="el__line-no">{no}</span>
                      <span className="el__line-text">{text}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div>
              <span className="el__file">
                {note.coverage.steps} steps, {note.coverage.citations} citations, {Math.round(note.coverage.coverage * 100)}% cited
              </span>
              <ul className="el__steps">
                {note.steps.map((s) => (
                  <li key={s.id}>
                    <button className="el__step" aria-pressed={s.id === step.id} onClick={() => setStepId(s.id)}>
                      <span className="el__step-id">{s.id}</span>
                      <span className="el__step-action">
                        {s.condition ? `only if ${s.condition}: ` : ''}
                        {s.action}
                      </span>
                      <span className="el__step-cites">
                        <span className="el__chip el__chip--on">
                          L{s.lineStart}
                          {s.lineEnd !== s.lineStart ? `-${s.lineEnd}` : ''}
                        </span>
                        {s.refs.map((r) => (
                          <span key={r} className="el__chip">
                            {r}
                          </span>
                        ))}
                        {s.tool && <span className="el__chip">tool {s.tool}</span>}
                        {s.rules > 0 && <span className="el__chip">{s.rules} rule</span>}
                        {s.halts && <span className="el__chip el__chip--bad">halts</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="el__panel" aria-label="Source drift">
          <div className="el__head">
            <span className="el__title">source drift, set {d.setId}</span>
            <span className="el__meta">
              v{d.version}, {d.state.replace('_', ' ')}
              {d.live !== null ? `, live v${d.live}` : ''}
            </span>
          </div>
          <div className="el__doc" data-changed={d.rewritten}>
            <div className="el__doc-ref">doc:{d.ref}</div>
            <p className="el__doc-text">{d.content}</p>
            <div className="el__doc-hash">sha256:{d.hash.slice(0, 32)}</div>
          </div>
          <div className="el__table-wrap">
            <table className="el__table">
              <thead>
                <tr>
                  <th>step</th>
                  <th>source</th>
                  <th>cited</th>
                  <th>registry</th>
                  <th>state</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={`${r.stepId}-${r.source}`} data-stale={r.stale}>
                    <td>{r.stepId}</td>
                    <td>{r.source}</td>
                    <td>{r.cited.slice(0, 10)}</td>
                    <td>{r.current.slice(0, 10)}</td>
                    <td>{r.stale ? 'stale' : 'verified'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="el__gate" data-state={gate} aria-live="polite">
            {gate === 'blocked'
              ? `publish blocked: ${d.stale.join(', ')} cites a changed source, ${d.blocked} refused attempt${d.blocked === 1 ? '' : 's'} audited`
              : gate === 'open'
                ? `published: live v${d.live}, delivered to the signed webhook and Jira`
                : `approved with a green run on v${d.version}; no open drift flag`}
          </div>
          <div className="el__row">
            <button className="demo__btn el__small" onClick={() => act((l) => l.rewriteSource())} disabled={d.rewritten}>
              Rewrite doc:{d.ref}
            </button>
            <button className="demo__btn demo__btn--ghost el__small" onClick={() => act((l) => l.publishDrift())} disabled={d.state !== 'approved'}>
              Publish as ops
            </button>
            <button className="demo__btn demo__btn--ghost el__small" onClick={() => act((l) => l.reverifyDrift())} disabled={d.stale.length === 0}>
              Re-verify {d.stale.length ? d.stale.join(', ') : 'stale steps'}
            </button>
            <button className="demo__btn demo__btn--ghost el__small" onClick={() => act((l) => l.resetDrift())}>
              Reset
            </button>
          </div>
          <Log lines={d.log} empty="The gate stays clear until a cited source changes." />
          <Receipts rows={d.receipts} />
        </section>

        <section className="el__panel" aria-label="Review policy">
          <div className="el__head">
            <span className="el__title">review policy, set {p.setId}</span>
            <span className="el__meta">
              requires role {p.roles.join(', ')}, {p.required} approval
            </span>
          </div>
          <div className="el__track" aria-label={`State ${p.state.replace('_', ' ')}`}>
            {TRACK.map((s, i) => (
              <span key={s} className="el__track-item">
                <span className="el__state" data-on={i === trackAt}>
                  {s.replace('_', ' ')}
                </span>
                {i < TRACK.length - 1 && <span className="el__arrow" aria-hidden="true" />}
              </span>
            ))}
          </div>
          <dl className="el__kv">
            <dt>set</dt>
            <dd>{p.name}</dd>
            <dt>version author</dt>
            <dd>
              {p.author}, v{p.version}
            </dd>
            <dt>approvals</dt>
            <dd>{p.approvers.length ? p.approvers.join(', ') : 'none this round'}</dd>
            <dt>missing roles</dt>
            <dd>{p.state === 'approved' || p.missing.length === 0 ? 'none' : p.missing.join(', ')}</dd>
          </dl>
          <div className="el__row">
            <button className="demo__btn el__small" onClick={() => act((l) => l.submitPolicy())} disabled={p.state !== 'draft'}>
              Submit as dana
            </button>
            {REVIEWERS.map((who) => (
              <button key={who} className="demo__btn demo__btn--ghost el__small" onClick={() => act((l) => l.approvePolicy(who))} disabled={p.state === 'approved'}>
                Approve as {who}
              </button>
            ))}
            <button className="demo__btn demo__btn--ghost el__small" onClick={() => act((l) => l.resetPolicy())}>
              Reset
            </button>
          </div>
          <Log lines={p.log} empty="dana wrote the note, so dana cannot approve it; reviewers alone cannot satisfy the admin role." />
        </section>

        <section className="el__panel el__panel--wide" aria-label="Demo script run">
          <div className="el__head">
            <span className="el__title">make demo, replayed</span>
            <span className="el__meta">{sc.done ? `${sc.total} actions, complete` : sc.started ? `action ${sc.chunk} of ${sc.total}` : `${sc.total} actions`}</span>
          </div>
          <div className="el__progress" aria-hidden="true">
            <span style={{ width: `${(sc.done ? 1 : sc.chunk / sc.total) * 100}%` }} />
          </div>
          <div className="el__script">
            <div>
              <ul className="el__log" aria-live="polite">
                {sc.lines.length === 0 ? (
                  <li className="el__empty">
                    The script registers eight sources, ingests the three notes, requests changes on the incident set,
                    reviews, tests and publishes, fixes the blocked refund SOP, then revises onboarding to v2 and rolls it
                    back to v1.
                  </li>
                ) : (
                  sc.lines.map((line, i) => (
                    <li key={`${sc.chunk}-${i}`} data-kind={line.kind}>
                      {line.text}
                    </li>
                  ))
                )}
              </ul>
              <Receipts rows={sc.receipts} />
            </div>
            <div>
              <div className="el__stats el__stats--flush">
                <Stat label="steps compiled" value={live ? live.steps : '...'} sub={`README ${README_FIGURES.steps}`} tone={sc.done && sc.summary?.steps === README_FIGURES.steps ? 'on' : undefined} />
                <Stat
                  label="citations"
                  value={live ? live.citations : '...'}
                  sub={live ? `${live.cited_steps}/${live.steps} steps, ${Math.round(live.coverage * 100)}%` : `README ${README_FIGURES.citations}, ${README_FIGURES.coverage}%`}
                  tone={sc.done && sc.summary?.citations === README_FIGURES.citations ? 'on' : undefined}
                />
                <Stat label="publishes blocked" value={live ? live.publishes_blocked : '...'} sub={`README ${README_FIGURES.blocked}`} tone={sc.done && sc.summary?.publishes_blocked === README_FIGURES.blocked ? 'on' : undefined} />
                <Stat label="deliveries" value={live ? live.deliveries : '...'} sub={`README ${README_FIGURES.deliveries}`} tone={sc.done && sc.summary?.deliveries === README_FIGURES.deliveries ? 'on' : undefined} />
                <Stat label="rollbacks" value={live ? live.rollbacks : '...'} sub={`README ${README_FIGURES.rollbacks}`} tone={sc.done && sc.summary?.rollbacks === README_FIGURES.rollbacks ? 'on' : undefined} />
                <Stat label="test runs" value={live ? live.test_runs : '...'} sub={live ? `${live.runs_green} green, ${live.runs_red} red` : 'README 5'} />
              </div>
              {sc.done && sc.summary && (
                <p className="el__verdict" data-pass={sc.matches === true}>
                  <b>{sc.matches ? 'summary block matches the README' : 'summary block differs from the README'}</b>:{' '}
                  {sc.summary.steps} steps, {sc.summary.citations} citations at {Math.round(sc.summary.coverage * 100)}%,{' '}
                  {sc.summary.publishes_blocked} blocked publish, {sc.summary.deliveries} deliveries, {sc.summary.rollbacks} rollback.
                </p>
              )}
            </div>
          </div>
          {sc.block && <pre className="el__block">{sc.block}</pre>}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runScript} disabled={playing || sc.done}>
          {sc.done ? 'Run complete' : sc.started ? 'Resume the script' : 'Run the demo script'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={() => setPlaying(false)} disabled={!playing}>
          Pause
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={resetRun} disabled={!sc.started}>
          Reset run
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset all
        </button>
        <span className="demo__hint">sequential ids and a counter clock, the same summary every run</span>
      </div>
    </div>
  );
}
