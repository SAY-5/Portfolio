import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './panelist.css';
import { Bench, BENCH_SEED, SPOT_CHECK_DRIFT, type BenchSnap } from './panelist/bench';
import { money, RunDriver, type RunSnap } from './panelist/driver';
import { RUN_OPTIONS } from './panelist/run';

// Real mechanism from panelist: a claim is one transaction that takes the
// highest-priority queued task whose required tags overlap the expert's,
// gates it on tier, skips rows another transaction holds FOR UPDATE and
// stamps a lease; a lease that runs out puts the row back in the queue. One
// serve in five is a hidden golden task with known scores, and a rolling pass
// rate under 70 percent after two checks pauses the expert and moves their
// pending payouts to withheld. Approved grades export as JSONL whose sha256
// names the object. Experts, tasks and grades come from one seeded PRNG, so
// every run reports the same figures; the 500-task run is the port of
// sim/demo.py, and its counts are measured in the browser rather than copied
// from the Python run.
const TICK_MS = 100;
const RUN_SLICE = 24;
const ARC = Math.PI * 100;
const GAUGE_PATH = 'M 20 120 A 100 100 0 0 1 220 120';

function polar(fraction: number, radius: number): [number, number] {
  const theta = Math.PI - fraction * Math.PI;
  return [120 + radius * Math.cos(theta), 120 - radius * Math.sin(theta)];
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export default function PanelistDemo() {
  const reduce = useReducedMotion();
  const [bench, setBench] = useState(() => new Bench());
  const [snap, setSnap] = useState<BenchSnap>(() => bench.snapshot());
  const [driver, setDriver] = useState(() => new RunDriver());
  const [run, setRun] = useState<RunSnap>(() => driver.snapshot());
  const [careless, setCareless] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      bench.tick(TICK_MS);
      setSnap(bench.snapshot());
      if (driver.isRunning()) {
        driver.step(RUN_SLICE);
        setRun(driver.snapshot());
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [bench, driver]);

  function act(fn: (b: Bench) => void) {
    fn(bench);
    setSnap(bench.snapshot());
  }
  function startRun() {
    if (reduce) driver.finish();
    else driver.start();
    setRun(driver.snapshot());
  }
  function pauseRun() {
    driver.pause();
    setRun(driver.snapshot());
  }
  function reset() {
    const b = new Bench();
    const d = new RunDriver();
    setBench(b);
    setSnap(b.snapshot());
    setDriver(d);
    setRun(d.snapshot());
    setCareless(false);
  }

  const race = snap.race;
  const att = snap.attention;
  const del = snap.delivery;
  const leaseTotal = snap.leaseSeconds * 1000;
  const leaseLeft = race?.leaseLeftMs ?? null;
  const expired = leaseLeft !== null && leaseLeft < 0;
  const owners = race ? race.rows.filter((r) => r.code === 201).length : 0;
  const turnedAway = race ? race.rows.length - owners : 0;
  const shown = att.rate ?? 0;
  const [tx, ty] = polar(att.threshold, 112);
  const [tx2, ty2] = polar(att.threshold, 86);
  const v = att.verdict;
  const st = run.stats;
  const sum = run.summary;

  return (
    <div className="demo" aria-label="panelist grading platform demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Claim race, hidden checks, checksummed delivery</h3>
      <p className="demo__lede">
        Every eligible expert claims the same row at once; one gets the lease and the rest receive
        409. The holder never grades, so the {snap.leaseSeconds} s lease runs out and a sweep returns
        the task to the queue. Careless grades on hidden golden checks pull the rolling pass rate
        under {pct(att.threshold)}, which pauses the expert and withholds the payouts already earned.
        Approved grades export as JSONL named by its live sha256, and the {RUN_OPTIONS.tasks}-task run
        reports the counts this port measures in the browser.
      </p>

      <div className="pn__stage">
        <section className="pn__panel pn__panel--wide" aria-label="Claim race on one row">
          <div className="pn__head">
            <span className="pn__title">{'POST /tasks/{id}/claim, one row'}</span>
            <span className="pn__meta">{race?.blocked ?? 0} double assignments blocked so far</span>
          </div>
          {race ? (
            <div className="pn__race">
              <div className="pn__claims-wrap">
                <div className="pn__task">
                  <span>{race.ref}</span>
                  {race.tags.map((t) => (
                    <span key={t} className="pn__chip pn__chip--on">
                      {t}
                    </span>
                  ))}
                  <span className="pn__chip">min tier {race.minTier}</span>
                  <span className="pn__chip">priority {race.priority}</span>
                  <span className="pn__chip">{race.status}</span>
                </div>
                {race.rows.length === 0 ? (
                  <p className="pn__empty">
                    Each expert whose tags overlap this row and whose tier clears it sends a claim inside its
                    own transaction. The first one holds the row under SELECT ... FOR UPDATE; the others are
                    turned away.
                  </p>
                ) : (
                  <ul className="pn__claims" aria-live="polite">
                    {race.rows.map((r) => (
                      <li key={r.expert} className="pn__claim" data-code={r.code}>
                        <span className="pn__claim-who">{r.expert}</span>
                        <span className="pn__claim-code">{r.code}</span>
                        <span className="pn__claim-detail">{r.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {race.rows.length > 0 && (
                  <p className="pn__note">
                    {race.rows.length} claimants: {owners} owner, {turnedAway} rejected.
                  </p>
                )}
              </div>
              <div className="pn__lease" data-expired={expired}>
                <span className="pn__hash-label">lease, {snap.leaseSeconds} s</span>
                <div className="pn__lease-big">
                  {leaseLeft === null ? race.status : expired ? 'expired' : (leaseLeft / 1000).toFixed(1)}
                  {leaseLeft !== null && !expired && <small>s left</small>}
                </div>
                <div className="pn__bar" aria-hidden="true">
                  <span
                    className="pn__bar-fill"
                    style={{ width: `${leaseLeft === null ? 0 : expired ? 100 : Math.max(0, (leaseLeft / leaseTotal) * 100)}%` }}
                  />
                </div>
                <dl className="pn__kv">
                  <dt>holder</dt>
                  <dd>{race.owner ?? 'none'}</dd>
                  <dt>state</dt>
                  <dd>{expired ? 'lease_expires_at < now(), ungraded' : race.status}</dd>
                  <dt>reclaimed</dt>
                  <dd>{race.reclaims} time{race.reclaims === 1 ? '' : 's'}</dd>
                </dl>
                {race.swept !== null && (
                  <p className="pn__note">
                    sweep returned {race.swept} expired lease{race.swept === 1 ? '' : 's'} to the queue
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="pn__empty">No task in this seed is eligible for two experts.</p>
          )}
          <div className="pn__row">
            <button className="demo__btn pn__small" onClick={() => act((b) => b.race())} disabled={!race || race.status !== 'queued'}>
              {race && race.reclaims > 0 ? 'Claim the row again' : 'Everyone claims at once'}
            </button>
            <button className="demo__btn demo__btn--ghost pn__small" onClick={() => act((b) => b.sweep())} disabled={!expired}>
              Sweep expired leases
            </button>
          </div>
        </section>

        <section className="pn__panel" aria-label="Rubric grading">
          <div className="pn__head">
            <span className="pn__title">rubric grade, {att.expert}</span>
            <span className="pn__meta">
              {att.tier}, {att.tags.join(', ')}
            </span>
          </div>
          <div className="pn__modes" role="group" aria-label="Grading behaviour">
            <button className="pn__mode" aria-pressed={!careless} onClick={() => setCareless(false)}>
              careful
            </button>
            <button className="pn__mode" aria-pressed={careless} onClick={() => setCareless(true)}>
              careless
            </button>
          </div>
          <div className="pn__row">
            <button className="demo__btn pn__small" onClick={() => act((b) => b.grade(false, careless))} disabled={att.regularLeft === 0}>
              Take a regular task
            </button>
            <button className="demo__btn demo__btn--ghost pn__small" onClick={() => act((b) => b.grade(true, careless))} disabled={att.goldenLeft === 0}>
              Serve a golden check
            </button>
          </div>
          {v ? (
            <>
              <div className="pn__table-wrap">
                <table className="pn__table">
                  <caption>
                    {v.ref}, {v.golden ? 'golden check, expected scores revealed after submit' : 'regular task'}
                  </caption>
                  <thead>
                    <tr>
                      <th>criterion</th>
                      <th className="num">submitted</th>
                      {v.golden && <th className="num">expected</th>}
                      {v.golden && <th className="num">deviation</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {v.rows.map((r) => {
                      const dev = r.expected === null ? null : Math.abs(r.submitted - r.expected);
                      return (
                        <tr key={r.key} data-out={dev !== null && dev > att.tolerance}>
                          <td>{r.key}</td>
                          <td className="num">{r.submitted}</td>
                          {v.golden && <td className="num">{r.expected}</td>}
                          {v.golden && <td className="num">{dev}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="pn__note" data-tone={v.golden && v.passed === false ? 'bad' : undefined}>
                weighted {v.weighted.toFixed(2)};{' '}
                {v.golden
                  ? `max deviation ${v.maxDeviation} against a tolerance of ${att.tolerance}, check ${v.passed ? 'passed' : 'failed'}`
                  : v.review === 'approve'
                    ? `spot check approved, payout ${money(v.payoutCents ?? 0)} created`
                    : `spot check rejected, drift over ${SPOT_CHECK_DRIFT} from the known answer`}
              </p>
              {v.pausedNow && (
                <p className="pn__note" data-tone="bad">
                  expert paused; {v.withheldNow} pending payout{v.withheldNow === 1 ? '' : 's'} moved to withheld
                </p>
              )}
            </>
          ) : (
            <p className="pn__note">
              Accuracy (weight 2.0), completeness (1.5), clarity (1.0) and safety (1.0) on a 1 to 5 scale.
              The expert-facing payload never carries the golden flag. Careless grading rolls dice; careful
              grading stays within one of the known answer.
            </p>
          )}
          {att.note && <p className="pn__note">{att.note}</p>}
        </section>

        <section className="pn__panel" aria-label="Rolling attention gauge">
          <div className="pn__head">
            <span className="pn__title">rolling attention</span>
            <span className="pn__status" data-paused={att.paused}>
              {att.paused ? 'paused' : 'active'}
            </span>
          </div>
          <svg
            className="pn__gauge"
            viewBox="0 0 240 150"
            role="img"
            data-paused={att.paused}
            data-reduce={reduce === true}
            aria-label={`Rolling pass rate ${att.rate === null ? 'not measured' : pct(att.rate)} over ${att.checks} checks`}
          >
            <path className="pn__gauge-track" d={GAUGE_PATH} />
            <path className="pn__gauge-fill" d={GAUGE_PATH} strokeDasharray={`${shown * ARC} ${ARC}`} opacity={shown > 0 ? 1 : 0} />
            <line className="pn__gauge-tick" x1={tx2} y1={ty2} x2={tx} y2={ty} />
            <text className="pn__gauge-val" x="120" y="112" textAnchor="middle">
              {att.rate === null ? 'n/a' : pct(att.rate)}
            </text>
            <text className="pn__gauge-cap" x="120" y="136" textAnchor="middle">
              {att.passed} of {att.checks} passed, window {att.window}
            </text>
            <text className="pn__gauge-cap" x={tx} y={ty - 6} textAnchor="middle">
              pause below {pct(att.threshold)}
            </text>
          </svg>
          <div className="pn__history" aria-label="Checks in the window, oldest first">
            {Array.from({ length: att.window }, (_, i) => (
              <span key={i} className="pn__dot" data-v={att.history[i] === undefined ? 'none' : att.history[i] ? 'pass' : 'fail'} />
            ))}
          </div>
          <div className="pn__stats">
            <Stat label="pending payouts" value={money(att.pendingCents)} sub={`${att.pendingCount} approved grades`} tone={att.pendingCount > 0 ? 'on' : undefined} />
            <Stat label="withheld" value={money(att.withheldCents)} sub={`${att.withheldCount} payouts`} tone={att.withheldCount > 0 ? 'bad' : undefined} />
          </div>
          <dl className="pn__kv pn__kv--gap">
            <dt>pause rule</dt>
            <dd>
              below {pct(att.threshold)} after {att.minChecks} checks
            </dd>
            <dt>tolerance</dt>
            <dd>within {att.tolerance} per criterion</dd>
            <dt>lifetime</dt>
            <dd>
              {att.lifetimePassed}/{att.lifetimeTotal} checks passed
            </dd>
          </dl>
          {att.paused && (
            <div className="pn__row">
              <button className="demo__btn demo__btn--ghost pn__small" onClick={() => act((b) => b.reinstate())}>
                Reinstate expert
              </button>
            </div>
          )}
        </section>

        <section className="pn__panel pn__panel--wide" aria-label="Delivery export">
          <div className="pn__head">
            <span className="pn__title">GET /deliveries/export</span>
            <span className="pn__meta">
              {del.rows} rows, {del.bytes.toLocaleString('en-US')} bytes, {del.unreviewed} grades awaiting review
            </span>
          </div>
          <div className="pn__delivery">
            <div>
              {del.rows === 0 ? (
                <p className="pn__empty">
                  No approved grades yet. The reviewer spot check approves grades within {SPOT_CHECK_DRIFT} of the
                  known answer; approved, non-golden grades become rows.
                </p>
              ) : (
                <div className="pn__table-wrap">
                  <table className="pn__table">
                    <caption>first rows, ordered by task sequence then expert id</caption>
                    <thead>
                      <tr>
                        <th>task</th>
                        <th>expert</th>
                        <th className="num">weighted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {del.sample.map((r) => (
                        <tr key={`${r.ref}-${r.expert}`}>
                          <td>{r.ref}</td>
                          <td>{r.expert}</td>
                          <td className="num">{r.weighted.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {del.reviewed && (
                <p className="pn__note">
                  spot check: {del.reviewed.approved} approved, {del.reviewed.rejected} rejected
                </p>
              )}
              <div className="pn__row">
                <button className="demo__btn pn__small" onClick={() => act((b) => b.reviewPending())} disabled={del.unreviewed === 0}>
                  Review pending grades
                </button>
                <button className="demo__btn demo__btn--ghost pn__small" onClick={() => act((b) => b.exportVersion())} disabled={del.rows === 0}>
                  Export a version
                </button>
              </div>
            </div>
            <div>
              <span className="pn__hash-label">sha256 of the JSONL body, live</span>
              <div className="pn__hash">
                <b>{del.checksum.slice(0, 12)}</b>
                {del.checksum.slice(12)}
              </div>
              <span className="pn__hash-label">same rows, one rationale edited</span>
              <div className="pn__hash" data-tone="bad">
                {del.tampered ? (
                  <>
                    <b>{del.tampered.slice(0, 12)}</b>
                    {del.tampered.slice(12)}
                  </>
                ) : (
                  'no rows to edit'
                )}
              </div>
              <span className="pn__hash-label">next object name</span>
              <div className="pn__hash">{del.nextName}</div>
              {del.versions.length > 0 && (
                <ul className="pn__log">
                  {del.versions.map((d) => (
                    <li key={d.version}>
                      <span className="pn__log-seq">v{d.version}</span>
                      <span>
                        {d.rowCount} rows, {d.sizeBytes.toLocaleString('en-US')} bytes, {d.location}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="pn__panel pn__panel--wide" aria-label="Full run">
          <div className="pn__head">
            <span className="pn__title">
              sim/demo.py, {RUN_OPTIONS.experts} experts, {RUN_OPTIONS.tasks} tasks
            </span>
            <span className="pn__meta">
              {run.done
                ? `measured in this browser, ${Math.round(run.computeMs)} ms of compute`
                : run.started
                  ? `${run.events} events, ${pct(run.drained)} of the queue drained`
                  : `seed ${RUN_OPTIONS.seed}, ${RUN_OPTIONS.settings.leaseSeconds} s leases, one serve in five golden`}
            </span>
          </div>
          <div className="pn__progress" aria-hidden="true">
            <span style={{ width: pct(run.done ? 1 : run.drained) }} />
          </div>
          <div className="pn__stats">
            <Stat label="claims" value={sum ? sum.claims : (st?.claims ?? 0)} />
            <Stat label="tag mismatches" value={st?.mismatches ?? 0} tone={run.done ? 'on' : undefined} />
            <Stat label="double assignments blocked" value={`${st?.doubleBlocked ?? 0}/${st?.doubleAttempts ?? 0}`} tone={run.done ? 'on' : undefined} />
            <Stat label="leases reclaimed" value={sum ? sum.reclaims : (st?.reclaims ?? 0)} />
            <Stat label="checks served / failed" value={sum ? `${sum.checksServed} / ${sum.checksFailed}` : `${st?.checksServed ?? 0} / ${st?.checksFailed ?? 0}`} />
            <Stat
              label="experts paused"
              value={sum ? sum.paused.length : (st?.paused.length ?? 0)}
              sub={(sum ? sum.paused : (st?.paused ?? [])).join(', ') || 'none'}
              tone={(sum ? sum.paused.length : (st?.paused.length ?? 0)) > 0 ? 'bad' : undefined}
            />
            <Stat label="approved / rejected" value={`${st?.approved ?? 0} / ${st?.rejected ?? 0}`} />
            <Stat label="delivery rows" value={sum ? sum.delivery.rowCount : '...'} sub={sum ? `sha256 ${sum.delivery.checksum.slice(0, 12)}` : 'after the export'} />
          </div>
          <ul className="pn__log" aria-live="polite">
            {run.log.length === 0 ? (
              <li>
                <span className="pn__log-seq">-</span>
                <span>contention, reclaimed leases, failed checks, pauses, rejections, the period close and the export appear here</span>
              </li>
            ) : (
              run.log.map((r) => (
                <li key={r.seq} data-flagged={r.flagged}>
                  <span className="pn__log-seq">{r.seq}</span>
                  <span>{r.text}</span>
                </li>
              ))
            )}
          </ul>
          {sum && (
            <p className="pn__verdict">
              <b>measured in this browser:</b> {sum.claims} claims, {sum.mismatches} tag mismatches,{' '}
              {sum.doubleBlocked} of {sum.doubleAttempts} double assignments blocked, {sum.reclaims} leases reclaimed,{' '}
              {sum.checksServed} checks served with {sum.checksFailed} failed, {sum.paused.length} experts paused (
              {sum.paused.join(', ')}); statement {sum.period.label} paid {sum.period.payoutCount} payouts,{' '}
              {money(sum.period.totalCents)} to {sum.period.expertCount} experts with {money(sum.withheldCents)} withheld;
              delivery v{sum.delivery.version} has {sum.delivery.rowCount} rows, {sum.delivery.sizeBytes.toLocaleString('en-US')} bytes,
              sha256 {sum.delivery.checksum.slice(0, 16)}.
            </p>
          )}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={startRun} disabled={run.running || run.done}>
          {run.done ? 'Run complete' : run.started ? 'Resume the run' : `Run ${RUN_OPTIONS.tasks} tasks`}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={pauseRun} disabled={!run.running}>
          Pause
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">workbench seed {BENCH_SEED}, run seed {RUN_OPTIONS.seed}, same figures every run</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'on' | 'bad' }) {
  return (
    <div className="pn__stat" data-tone={tone}>
      <span className="pn__stat-label">{label}</span>
      <span className="pn__stat-val">{value}</span>
      {sub && <span className="pn__stat-sub">{sub}</span>}
    </div>
  );
}
