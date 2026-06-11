import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './job-controller.css';

// Real numbers from the committed chaos artifact: 1 kill, primes sieve to
// 300000, reference_found and job_found both 25997, worker alive after kill,
// final state byte-identical to a non-crashed reference run.
const SIEVE_LIMIT = 300000;
const PRIMES_FOUND = 25997;
const CKPT_AT = 0.62; // last durable checkpoint as a fraction of the sieve

type LogKind = 'info' | 'kill' | 'recover';
type LogLine = { t: string; text: string; kind: LogKind };

type Phase = 'idle' | 'running' | 'killed' | 'recovering' | 'done';

const ease = [0.22, 1, 0.36, 1] as const;

// A small deterministic hash so the reference run and the recovered run print
// the same digest, the way deterministic_match compares the two state files.
function digest(progress: number, primes: number) {
  const seed = Math.round(progress * SIEVE_LIMIT) * 31 + primes * 17;
  let h = 0x811c9dc5;
  for (let i = 0; i < 8; i++) {
    h ^= (seed >>> (i * 4)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const REFERENCE_HASH = digest(1, PRIMES_FOUND);

export default function JobControllerDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [ckpt, setCkpt] = useState(0);
  const [controllerAlive, setControllerAlive] = useState(true);
  const [workerAlive, setWorkerAlive] = useState(true);
  const [log, setLog] = useState<LogLine[]>([]);
  const [recoveredHash, setRecoveredHash] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef(0);

  function stopAnim() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  useEffect(() => stopAnim, []);

  function clock() {
    tRef.current += 1;
    return tRef.current.toString().padStart(3, '0') + 'ms';
  }

  function push(text: string, kind: LogKind = 'info') {
    setLog((prev) => [...prev, { t: clock(), text, kind }]);
  }

  function primesAt(p: number) {
    return Math.round(PRIMES_FOUND * p);
  }

  function reset() {
    stopAnim();
    tRef.current = 0;
    setPhase('idle');
    setProgress(0);
    setCkpt(0);
    setControllerAlive(true);
    setWorkerAlive(true);
    setLog([]);
    setRecoveredHash(null);
  }

  function start() {
    if (phase === 'running' || phase === 'recovering') return;
    stopAnim();
    tRef.current = 0;
    setProgress(0);
    setCkpt(0);
    setControllerAlive(true);
    setWorkerAlive(true);
    setRecoveredHash(null);
    setLog([]);
    push('controller spawns worker container (primes)', 'info');
    push(`sieve to ${SIEVE_LIMIT.toLocaleString()} begins`, 'info');
    setPhase('running');
    run(0, false);
  }

  // Advance the sieve. `fromCkpt` marks a resume so the worker rolls back to
  // the last fsync'd checkpoint rather than restarting from zero.
  function run(from: number, fromCkpt: boolean) {
    if (reduce) {
      setProgress(1);
      setCkpt(CKPT_AT);
      finishWhole(fromCkpt);
      return;
    }
    const start = performance.now();
    const duration = 2600;
    const tick = (now: number) => {
      const elapsed = now - start;
      const p = Math.min(1, from + (elapsed / duration) * (1 - from));
      setProgress(p);
      if (p >= CKPT_AT) setCkpt((c) => (c < CKPT_AT ? CKPT_AT : c));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        finishWhole(fromCkpt);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function finishWhole(fromCkpt: boolean) {
    setProgress(1);
    const h = digest(1, PRIMES_FOUND);
    setRecoveredHash(h);
    if (fromCkpt) {
      push(`sieve complete, ${PRIMES_FOUND.toLocaleString()} primes found`, 'recover');
      push(`state hash matches reference: deterministic_match`, 'recover');
    } else {
      push(`sieve complete, ${PRIMES_FOUND.toLocaleString()} primes found`, 'info');
    }
    setPhase('done');
  }

  // The chaos move: SIGKILL the controller mid-run. The worker keeps running
  // (orphaned), then re-attaches via container labels and resumes from the
  // last checkpoint to a byte-identical final state.
  function kill() {
    if (phase !== 'running') return;
    stopAnim();
    setControllerAlive(false);
    setPhase('killed');
    const at = progress;
    push('SIGKILL controller mid-job', 'kill');
    push(`worker orphaned at ${primesAt(at).toLocaleString()} primes, still alive`, 'kill');

    const resume = () => {
      setControllerAlive(true);
      setPhase('recovering');
      push('controller restarts, re-attaches worker via container label', 'recover');
      push(`rolling back to checkpoint at ${primesAt(CKPT_AT).toLocaleString()} primes`, 'recover');
      setProgress(CKPT_AT);
      run(CKPT_AT, true);
    };

    if (reduce) {
      resume();
    } else {
      window.setTimeout(resume, 900);
    }
  }

  const pct = Math.round(progress * 100);
  const matched = recoveredHash !== null && recoveredHash === REFERENCE_HASH && phase === 'done';

  return (
    <div className="demo" aria-label="job-controller crash recovery demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Kill the controller, keep the result</h3>
      <p className="demo__lede">
        Start a prime-sieve job, then SIGKILL the controller while it runs. The
        worker is orphaned but stays alive, the restarted controller re-attaches
        it by container label, and the job resumes from its last checkpoint to a
        byte-identical final state.
      </p>

      <div className="jc__stage">
        <div className="jc__top">
          <div className="jc__panel">
            <div className="jc__panel-head">
              <span>worker: primes</span>
              <span className="jc__panel-tag" style={{ color: 'var(--accent)' }}>
                {pct}%
              </span>
            </div>
            <div className="jc__job-name">sieve_of_eratosthenes(n)</div>
            <div className="jc__job-sub">
              n = {SIEVE_LIMIT.toLocaleString()}, checkpoint every fsync
            </div>
            <div
              className="jc__bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="sieve progress"
            >
              <motion.div
                className="jc__bar-fill"
                animate={{ width: `${pct}%` }}
                transition={{ duration: reduce ? 0 : 0.18, ease }}
              />
              {ckpt > 0 && (
                <div
                  className="jc__bar-ckpt"
                  style={{ left: `${Math.round(ckpt * 100)}%` }}
                  title="last durable checkpoint"
                />
              )}
            </div>
            <div className="jc__counters">
              <div className="jc__counter">
                <span className="jc__counter-label">primes found</span>
                <span className="jc__counter-val">
                  {primesAt(progress).toLocaleString()}
                </span>
              </div>
              <div className="jc__counter">
                <span className="jc__counter-label">checkpoint at</span>
                <span className="jc__counter-val">
                  {ckpt > 0 ? primesAt(ckpt).toLocaleString() : '0'}
                </span>
              </div>
            </div>
          </div>

          <div className="jc__ctrl">
            <div className="jc__proc" data-alive={controllerAlive}>
              <span className="jc__proc-dot" />
              <span className="jc__proc-name">controller (Go)</span>
              <span className="jc__proc-state">
                {controllerAlive ? 'alive' : 'killed'}
              </span>
            </div>
            <div className="jc__proc" data-alive={workerAlive}>
              <span className="jc__proc-dot" />
              <span className="jc__proc-name">worker (C++)</span>
              <span className="jc__proc-state">
                {workerAlive ? 'alive' : 'down'}
              </span>
            </div>
            <div className="jc__panel" style={{ background: 'var(--ink-800)' }}>
              <div className="jc__panel-head" style={{ marginBottom: 8 }}>
                <span>crash mode</span>
              </div>
              <div className="jc__job-sub" style={{ margin: 0 }}>
                controller-only death, re-attach via container labels
              </div>
            </div>
          </div>
        </div>

        <div className="jc__log" aria-live="polite">
          <div className="jc__panel-head">
            <span>controller log</span>
          </div>
          {log.length === 0 ? (
            <div className="jc__log-empty">idle, press Start job</div>
          ) : (
            <ul className="jc__log-list">
              <AnimatePresence initial={false}>
                {log.map((l, i) => (
                  <motion.li
                    key={i}
                    className={`jc__log-line jc__log-line--${l.kind}`}
                    initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.22, ease }}
                  >
                    <span className="jc__log-t">{l.t}</span>
                    <span className="jc__log-text">{l.text}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <div className="jc__hashes">
          <div className="jc__hash">
            <div className="jc__hash-label">reference run (no crash)</div>
            <div className="jc__hash-val">{REFERENCE_HASH}</div>
          </div>
          <div className="jc__hash">
            <div className="jc__hash-label">this run</div>
            <div className="jc__hash-val">
              {recoveredHash ?? <span style={{ color: 'var(--text-faint)' }}>pending</span>}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {matched && (
            <motion.div
              className="jc__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="jc__verdict-head">deterministic_match</span>
              <span className="jc__verdict-text">
                The recovered worker landed on a state file byte-identical to the
                non-crashed reference: {PRIMES_FOUND.toLocaleString()} primes, same
                digest. This is what the chaos test asserts after each SIGKILL.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={start}
          disabled={phase === 'running' || phase === 'recovering'}
        >
          {phase === 'idle' || phase === 'done' ? 'Start job' : 'Running…'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={kill}
          disabled={phase !== 'running'}
        >
          Kill controller
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {phase === 'running'
            ? 'job in flight, try the kill'
            : phase === 'recovering'
              ? 'resuming from checkpoint'
              : 'controller-only crash mode'}
        </span>
      </div>
    </div>
  );
}
