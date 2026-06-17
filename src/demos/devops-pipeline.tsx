import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './devops-pipeline.css';
import { useStore } from './devops-pipeline/state';
import {
  resetAll,
  retry,
  run,
  setJobAllowFailure,
  setJobDuration,
  setJobFailureRate,
  setSeed,
} from './devops-pipeline/store';
import type { JobResult, RunRecord, StageResult } from './devops-pipeline/types';

// In-browser CI/CD pipeline runner. The deterministic engine computes the whole
// run up front from the seed; this component reveals each stage left to right
// over time so the user watches stages pass or fail, a failing job halt the
// downstream stages, retry a failed stage, and read a per-job trace plus run
// history. No clock is read in render: the run start time is snapshotted into
// the engine and a single rAF loop drives a numeric progress cursor.

// How long a stage takes to reveal on screen, independent of its simulated
// duration, so the animation stays watchable.
const REVEAL_MS = 900;

type LiveStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

function jobStatusLabel(s: JobResult['status'], tolerated: boolean): string {
  if (s === 'passed') return 'passed';
  if (s === 'skipped') return 'skipped';
  return tolerated ? 'failed (tolerated)' : 'failed';
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function clockNow(): number {
  // Snapshotted once at the call site (run/retry), never during render.
  return Date.now();
}

export default function DevopsPipelineDemo() {
  const reduce = useReducedMotion();
  const { def, seed, lastRun, history } = useStore();

  // Index of the stage currently revealing, -1 when idle/finished. Drives the
  // left-to-right animation of the last run.
  const [revealIdx, setRevealIdx] = useState<number>(-1);
  const [animating, setAnimating] = useState(false);
  // Which run the history/trace panel is focused on.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const selectedRun: RunRecord | null = useMemo(() => {
    if (selectedId) {
      const found = history.find((r) => r.id === selectedId);
      if (found) return found;
    }
    return lastRun;
  }, [selectedId, history, lastRun]);

  function stopRaf() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  useEffect(() => stopRaf, []);

  function lastVisibleIndex(record: RunRecord): number {
    const failed = record.stages.findIndex((s) => s.status === 'failed');
    return failed >= 0 ? failed : record.stages.length - 1;
  }

  // Reveal stages of the active run one by one. Stops at the first failed stage
  // since downstream stages are skipped anyway.
  function animateReveal(record: RunRecord) {
    stopRaf();
    if (reduce) {
      setRevealIdx(record.stages.length - 1);
      setAnimating(false);
      return;
    }
    setAnimating(true);
    setRevealIdx(0);
    // Baseline the clock from the first rAF callback rather than reading a
    // clock here, keeping render and its helpers free of impure calls.
    startRef.current = -1;
    const lastVisible = lastVisibleIndex(record);
    const tick = (now: number) => {
      if (startRef.current < 0) startRef.current = now;
      const elapsed = now - startRef.current;
      const idx = Math.min(lastVisible, Math.floor(elapsed / REVEAL_MS));
      setRevealIdx(idx);
      if (idx >= lastVisible) {
        setAnimating(false);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function onRun() {
    const record = run(clockNow());
    setSelectedId(record.id);
    animateReveal(record);
  }

  function onRetry(stageId: string) {
    const record = retry(stageId);
    if (!record) return;
    setSelectedId(record.id);
    animateReveal(record);
  }

  function onReset() {
    stopRaf();
    setAnimating(false);
    setRevealIdx(-1);
    setSelectedId(null);
    resetAll();
  }

  // The status of a stage for the currently animating last run: stages past the
  // reveal cursor read as pending on screen even though the engine already
  // decided them.
  function liveStageStatus(stage: StageResult, index: number): LiveStatus {
    const isActiveRun = lastRun && selectedRun && lastRun.id === selectedRun.id;
    if (!isActiveRun || !animating) return stage.status;
    if (index > revealIdx) return 'pending';
    if (index === revealIdx && stage.status !== 'skipped') return 'running';
    return stage.status;
  }

  const failedStage = lastRun?.stages.find((s) => s.status === 'failed') ?? null;
  const canRetry =
    !!failedStage && !!lastRun && selectedRun?.id === lastRun.id && !animating;

  return (
    <div className="demo" aria-label="devops-pipeline CI/CD runner demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Run a commit through ordered stages</h3>
      <p className="demo__lede">
        Each stage runs its jobs in parallel and takes as long as its slowest
        job. A non-tolerated job failure fails its stage and halts every
        downstream stage. Edit the failure rates, pick a seed, run, then retry a
        failed stage to continue the pipeline. Same seed, same run.
      </p>

      <div className="dp__seedbar">
        <label className="dp__seed">
          <span className="dp__seed-label">seed</span>
          <input
            className="dp__seed-input"
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
            aria-label="run seed"
          />
        </label>
        <span className="demo__hint" role="status">
          {lastRun
            ? `last run ${lastRun.status} in ${formatDuration(lastRun.durationMs)}`
            : 'no run yet'}
        </span>
      </div>

      <div className="dp__flow" role="list" aria-label="pipeline stages">
        {def.stages.map((stageDef, index) => {
          const result = lastRun?.stages.find((s) => s.stageId === stageDef.id);
          const status: LiveStatus = result
            ? liveStageStatus(result, index)
            : 'pending';
          return (
            <div className="dp__stagecol" role="listitem" key={stageDef.id}>
              <article
                className="dp__stagecard"
                data-status={status}
                aria-label={`stage ${stageDef.name}, ${status}`}
              >
                <header className="dp__stage-head">
                  <span className="dp__stage-name">{stageDef.name}</span>
                  <span className="dp__stage-status" data-status={status}>
                    {status}
                  </span>
                </header>
                <ul className="dp__joblist">
                  {stageDef.jobs.map((jobDef) => {
                    const jr = result?.jobs.find((j) => j.jobId === jobDef.id);
                    const jobStatus: LiveStatus =
                      status === 'pending'
                        ? 'pending'
                        : status === 'running'
                          ? 'running'
                          : (jr?.status ?? 'pending');
                    return (
                      <li
                        className="dp__job"
                        key={jobDef.id}
                        data-status={jobStatus}
                      >
                        <span className="dp__job-dot" aria-hidden />
                        <span className="dp__job-name">{jobDef.name}</span>
                        {jobDef.allowFailure && (
                          <span className="dp__job-tag">allow-fail</span>
                        )}
                        <span className="dp__job-dur">
                          {formatDuration(jobDef.durationMs)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {result && status === 'failed' && (
                  <button
                    className="dp__retry"
                    onClick={() => onRetry(stageDef.id)}
                    disabled={!canRetry}
                  >
                    Retry stage
                  </button>
                )}
              </article>
              {index < def.stages.length - 1 && (
                <span className="dp__arrow" aria-hidden>
                  &rsaquo;
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="dp__editor glass">
        <h4 className="dp__editor-head">Edit jobs</h4>
        <div className="dp__editrows">
          {def.stages.map((stage) =>
            stage.jobs.map((job) => (
              <div className="dp__editrow" key={`${stage.id}-${job.id}`}>
                <span className="dp__edit-job">
                  <span className="dp__edit-stage">{stage.name}</span>
                  {job.name}
                </span>
                <label className="dp__edit-field">
                  <span>fail %</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(job.failureRate * 100)}
                    onChange={(e) =>
                      setJobFailureRate(
                        stage.id,
                        job.id,
                        Number(e.target.value) / 100,
                      )
                    }
                    aria-label={`${stage.name} ${job.name} failure rate`}
                  />
                  <b>{Math.round(job.failureRate * 100)}%</b>
                </label>
                <label className="dp__edit-field dp__edit-field--num">
                  <span>ms</span>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={job.durationMs}
                    onChange={(e) =>
                      setJobDuration(stage.id, job.id, Number(e.target.value))
                    }
                    aria-label={`${stage.name} ${job.name} duration`}
                  />
                </label>
                <label className="dp__edit-allow">
                  <input
                    type="checkbox"
                    checked={job.allowFailure}
                    onChange={(e) =>
                      setJobAllowFailure(stage.id, job.id, e.target.checked)
                    }
                  />
                  <span>allow failure</span>
                </label>
              </div>
            )),
          )}
        </div>
      </div>

      <div className="dp__lower">
        <section className="dp__history glass" aria-label="run history">
          <h4 className="dp__editor-head">Run history</h4>
          {history.length === 0 ? (
            <p className="dp__empty">No runs yet. Press Run pipeline.</p>
          ) : (
            <ul className="dp__runlist">
              {history.map((r) => (
                <li key={r.id}>
                  <button
                    className="dp__runitem"
                    data-status={r.status}
                    aria-pressed={selectedRun?.id === r.id}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className="dp__run-dot" aria-hidden />
                    <span className="dp__run-seed">seed {r.seed}</span>
                    <span className="dp__run-status">{r.status}</span>
                    <span className="dp__run-dur">
                      {formatDuration(r.durationMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dp__trace glass" aria-label="run trace">
          <h4 className="dp__editor-head">
            {selectedRun ? `Trace · seed ${selectedRun.seed}` : 'Trace'}
          </h4>
          {!selectedRun ? (
            <p className="dp__empty">
              Select or run a pipeline to see its trace.
            </p>
          ) : (
            <ol className="dp__tracelist">
              {selectedRun.stages.map((s) => (
                <li className="dp__traceitem" key={s.stageId}>
                  <div className="dp__traceitem-head" data-status={s.status}>
                    <span className="dp__trace-stage">{s.name}</span>
                    <span className="dp__trace-meta">
                      attempt {s.attempt} · {s.status} ·{' '}
                      {formatDuration(s.durationMs)}
                    </span>
                  </div>
                  <ul className="dp__tracejobs">
                    {s.jobs.map((j) => (
                      <li
                        className="dp__tracejob"
                        key={j.jobId}
                        data-status={j.status}
                        data-tolerated={j.tolerated}
                      >
                        <span className="dp__tracejob-name">{j.name}</span>
                        <span className="dp__tracejob-state">
                          {jobStatusLabel(j.status, j.tolerated)}
                          {j.status !== 'skipped' &&
                            ` · ${formatDuration(j.durationMs)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={onRun} disabled={animating}>
          {animating ? 'Running...' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={onReset}
          disabled={animating}
        >
          Reset
        </button>
        <span className="demo__hint">
          {def.stages.length} stages ·{' '}
          {def.stages.reduce((n, s) => n + s.jobs.length, 0)} jobs · deterministic
          per seed
        </span>
      </div>
    </div>
  );
}
