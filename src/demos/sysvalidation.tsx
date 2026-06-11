import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './sysvalidation.css';

// Real numbers from the project: C++ scenario binaries deliberately exercise
// defect classes (RACE, LEAK, DOUBLE_FREE, UAF) under ASan/TSan while a Python
// orchestrator runs them, classifies the result, and emits a release-go or
// release-no-go verdict. A configurable block list lets teams ship with known
// leaks while still failing on fresh races. A single gate() call replaces 20+
// minutes of manual triage and surfaces 30% more defects than manual review.
const MORE_DEFECTS = 30;
const TRIAGE_MINUTES = 20;
const TOTAL_TESTS = 21;

type DefectClass = 'RACE' | 'LEAK' | 'DOUBLE_FREE' | 'UAF' | 'NONE';

const CLASS_META: Record<DefectClass, { label: string; sanitizer: string; sev: number }> = {
  RACE: { label: 'data race', sanitizer: 'TSan', sev: 3 },
  UAF: { label: 'use-after-free', sanitizer: 'ASan', sev: 3 },
  DOUBLE_FREE: { label: 'double free', sanitizer: 'ASan', sev: 3 },
  LEAK: { label: 'memory leak', sanitizer: 'ASan', sev: 1 },
  NONE: { label: 'clean', sanitizer: 'none', sev: 0 },
};

type Scenario = {
  bin: string;
  desc: string;
  defect: DefectClass;
  ms: number; // how long the binary "runs" before reporting
};

// Each scenario binary deliberately triggers one defect class (or none).
const SCENARIOS: Scenario[] = [
  { bin: 'race_counter', desc: 'two threads bump a shared counter', defect: 'RACE', ms: 620 },
  { bin: 'leak_buffer', desc: 'allocates and forgets a buffer', defect: 'LEAK', ms: 360 },
  { bin: 'clean_queue', desc: 'lock-guarded work queue', defect: 'NONE', ms: 300 },
  { bin: 'uaf_handle', desc: 'reads a freed handle', defect: 'UAF', ms: 540 },
  { bin: 'double_free_pool', desc: 'frees a pool slot twice', defect: 'DOUBLE_FREE', ms: 460 },
  { bin: 'clean_parser', desc: 'bounds-checked tokenizer', defect: 'NONE', ms: 280 },
];

const ALL_CLASSES: DefectClass[] = ['RACE', 'UAF', 'DOUBLE_FREE', 'LEAK'];

type RowState = 'pending' | 'running' | 'reported';

const ease = [0.22, 1, 0.36, 1] as const;

export default function SysvalidationDemo() {
  const reduce = useReducedMotion();
  // block list: which defect classes the gate treats as blocking. LEAK starts
  // allowed so teams can ship with known leaks while failing on fresh races.
  const [blockList, setBlockList] = useState<Set<DefectClass>>(
    new Set(['RACE', 'UAF', 'DOUBLE_FREE']),
  );
  const [states, setStates] = useState<RowState[]>(SCENARIOS.map(() => 'pending'));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setStates(SCENARIOS.map(() => 'pending'));
    setRunning(false);
    setDone(false);
  }

  function toggleClass(cls: DefectClass) {
    if (running) return;
    setBlockList((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }

  function runGate() {
    clearTimers();
    setRunning(true);
    setDone(false);
    setStates(SCENARIOS.map(() => 'pending'));

    if (reduce) {
      setStates(SCENARIOS.map(() => 'reported'));
      setRunning(false);
      setDone(true);
      return;
    }

    // stream each binary's run sequentially, like SSE frames arriving
    let elapsed = 0;
    SCENARIOS.forEach((s, i) => {
      const startAt = elapsed + 120;
      timers.current.push(
        window.setTimeout(() => {
          setStates((prev) => {
            const next = [...prev];
            next[i] = 'running';
            return next;
          });
        }, startAt),
      );
      const reportAt = startAt + s.ms;
      timers.current.push(
        window.setTimeout(() => {
          setStates((prev) => {
            const next = [...prev];
            next[i] = 'reported';
            return next;
          });
        }, reportAt),
      );
      elapsed = reportAt;
      if (i === SCENARIOS.length - 1) {
        timers.current.push(
          window.setTimeout(() => {
            setRunning(false);
            setDone(true);
          }, reportAt + 200),
        );
      }
    });
  }

  const reportedCount = states.filter((s) => s === 'reported').length;

  // verdict is computed live from reported rows against the current block list
  const reportedDefects = SCENARIOS.filter((s, i) => states[i] === 'reported' && s.defect !== 'NONE');
  const blockingHits = reportedDefects.filter((s) => blockList.has(s.defect));
  const allowedHits = reportedDefects.filter((s) => !blockList.has(s.defect));
  const verdictGo = done && blockingHits.length === 0;

  return (
    <div className="demo" aria-label="sysvalidation release gate demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Classify defects, then gate the release</h3>
      <p className="demo__lede">
        Each scenario binary deliberately triggers one defect class under ASan or
        TSan. The orchestrator runs them, streams a classification per binary, and
        a single gate() call flips between release-go and release-no-go. Edit the
        block list to ship with a known leak while still failing on a fresh race.
      </p>

      <div className="sv__blocklist" role="group" aria-label="gate block list">
        <span className="sv__blocklist-label">Block list</span>
        {ALL_CLASSES.map((cls) => {
          const on = blockList.has(cls);
          return (
            <button
              key={cls}
              className={`sv__chip${on ? ' sv__chip--on' : ''}`}
              role="switch"
              aria-checked={on}
              onClick={() => toggleClass(cls)}
              disabled={running}
            >
              <span className="sv__chip-dot" aria-hidden="true" />
              {cls}
            </button>
          );
        })}
        <span className="sv__blocklist-hint">{blockList.size} classes block the gate</span>
      </div>

      <div className="sv__stage">
        <div className="sv__board" role="table" aria-label="scenario binaries">
          <div className="sv__row sv__row--head" role="row">
            <span role="columnheader">binary</span>
            <span role="columnheader">scenario</span>
            <span role="columnheader">class</span>
            <span role="columnheader">gate</span>
          </div>
          {SCENARIOS.map((s, i) => {
            const st = states[i];
            const reported = st === 'reported';
            const isDefect = s.defect !== 'NONE';
            const blocked = reported && isDefect && blockList.has(s.defect);
            const allowed = reported && isDefect && !blockList.has(s.defect);
            const meta = CLASS_META[s.defect];
            const sevClass = reported
              ? blocked
                ? 'sv__row--block'
                : allowed
                  ? 'sv__row--allow'
                  : 'sv__row--clean'
              : '';
            return (
              <motion.div
                key={s.bin}
                className={`sv__row ${sevClass}`}
                role="row"
                initial={false}
                animate={{
                  opacity: st === 'pending' ? 0.5 : 1,
                }}
                transition={{ duration: reduce ? 0 : 0.25 }}
              >
                <span className="sv__bin" role="cell">
                  {s.bin}
                </span>
                <span className="sv__desc" role="cell">
                  {s.desc}
                </span>
                <span className="sv__class" role="cell">
                  {st === 'pending' && <span className="sv__muted">queued</span>}
                  {st === 'running' && (
                    <span className="sv__running">
                      <span className="sv__spinner" aria-hidden="true" /> {meta.sanitizer}&hellip;
                    </span>
                  )}
                  {reported && (
                    <motion.span
                      className="sv__verdict-class"
                      initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <b>{s.defect}</b>
                      <span className="sv__class-sub">{meta.label}</span>
                    </motion.span>
                  )}
                </span>
                <span className="sv__gatecell" role="cell">
                  {reported &&
                    (blocked ? 'BLOCK' : allowed ? 'allow' : s.defect === 'NONE' ? 'pass' : '')}
                </span>
              </motion.div>
            );
          })}
        </div>

        <div className={`sv__gate${verdictGo ? ' sv__gate--go' : done ? ' sv__gate--nogo' : ''}`}>
          <div className="sv__gate-title">gate()</div>
          <AnimatePresence mode="wait">
            <motion.div
              key={done ? (verdictGo ? 'go' : 'nogo') : 'wait'}
              className="sv__gate-verdict"
              initial={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.3, ease }}
            >
              {!done && (running ? `streaming ${reportedCount}/${SCENARIOS.length}` : 'ready')}
              {done && (verdictGo ? 'RELEASE GO' : 'RELEASE NO-GO')}
            </motion.div>
          </AnimatePresence>
          <div className="sv__gate-meta">
            {done ? (
              <>
                <div className="sv__gate-line">
                  <span>blocking defects</span>
                  <b className={blockingHits.length ? 'sv__bad' : ''}>{blockingHits.length}</b>
                </div>
                <div className="sv__gate-line">
                  <span>allowed by block list</span>
                  <b>{allowedHits.length}</b>
                </div>
                <div className="sv__gate-line">
                  <span>binaries classified</span>
                  <b>{reportedCount}</b>
                </div>
              </>
            ) : (
              <div className="sv__gate-line">
                <span>one gate() call replaces</span>
                <b>{TRIAGE_MINUTES}+ min triage</b>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            className="sv__note"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            {verdictGo
              ? `No blocking defects under the current block list, so the gate returns release-go. Any allowed hits are recorded but do not fail the build. The framework surfaces ${MORE_DEFECTS}% more defects than manual review across its ${TOTAL_TESTS} tests.`
              : `${blockingHits.length} blocking defect${blockingHits.length === 1 ? '' : 's'} (${blockingHits
                  .map((s) => s.defect)
                  .join(', ')}) failed the gate, so it returns release-no-go in place of ${TRIAGE_MINUTES}+ minutes of manual triage. Move a class off the block list to ship despite it.`}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runGate} disabled={running}>
          {running ? 'Running…' : done ? 'Run gate again' : 'Run gate()'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running || (!done && reportedCount === 0)}>
          Reset
        </button>
        <span className="demo__hint">toggle LEAK on the block list to flip the verdict</span>
      </div>
    </div>
  );
}
