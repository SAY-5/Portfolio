import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './videoagent.css';

// Real behavior from the project: a planner emits ops from eight closed-set
// verbs (Cut, Trim, Concat, FadeIn, FadeOut, Speed, Volume, Resize) with
// min/max bounds on every numeric field. A source-aware verifier rejects
// structurally-valid-but-impossible edits (like a Cut past a 120s source) with
// a structured VerifyError that feeds one bounded retry. Then FFmpeg runs.
const SOURCE_SECONDS = 120;

type Op = {
  verb: string;
  // start/end in seconds along the source timeline
  start: number;
  end: number;
  arg: string;
};

type Plan = {
  ops: Op[];
  // index of the op the verifier rejects, or -1 if the plan is clean
  bad: number;
  verifyError?: string;
};

type Example = {
  id: string;
  instruction: string;
  first: Plan; // initial plan from the planner (may be rejected)
  retry?: Plan; // bounded retry plan after a VerifyError
};

const EXAMPLES: Example[] = [
  {
    id: 'overrun',
    instruction: 'cut the first 10 seconds and add a fade at 1:30',
    first: {
      ops: [
        { verb: 'Cut', start: 0, end: 10, arg: 'drop 0:00 to 0:10' },
        { verb: 'FadeOut', start: 130, end: 134, arg: 'fade at 2:10' },
      ],
      bad: 1,
      verifyError: 'FadeOut start 130s past 120s source',
    },
    retry: {
      ops: [
        { verb: 'Cut', start: 0, end: 10, arg: 'drop 0:00 to 0:10' },
        { verb: 'FadeOut', start: 90, end: 94, arg: 'fade at 1:30' },
      ],
      bad: -1,
    },
  },
  {
    id: 'speedclamp',
    instruction: 'speed up the middle, trim to the first minute',
    first: {
      ops: [
        { verb: 'Trim', start: 0, end: 60, arg: 'keep 0:00 to 1:00' },
        { verb: 'Speed', start: 20, end: 40, arg: '2x on 0:20 to 0:40' },
        { verb: 'Volume', start: 0, end: 60, arg: '-3 dB' },
      ],
      bad: -1,
    },
  },
  {
    id: 'concat',
    instruction: 'add the intro then resize to 720p with a fade in',
    first: {
      ops: [
        { verb: 'Concat', start: 0, end: 8, arg: 'prepend intro' },
        { verb: 'FadeIn', start: 0, end: 3, arg: 'fade in 0:00 to 0:03' },
        { verb: 'Resize', start: 0, end: 128, arg: '1280x720' },
      ],
      bad: -1,
    },
  },
];

const ease = [0.22, 1, 0.36, 1] as const;
type Phase = 'idle' | 'planning' | 'verifying' | 'rejected' | 'retrying' | 'done';

const VERB_COLORS: Record<string, string> = {
  Cut: 'var(--accent)',
  Trim: '#7aa2ff',
  Concat: '#c89bff',
  FadeIn: '#6ee7a8',
  FadeOut: '#6ee7a8',
  Speed: '#ffd166',
  Volume: '#7adfff',
  Resize: '#ff9bce',
};

function clipStyle(op: Op) {
  const left = (Math.min(op.start, SOURCE_SECONDS) / SOURCE_SECONDS) * 100;
  const widthRaw = ((op.end - op.start) / SOURCE_SECONDS) * 100;
  const width = Math.max(3, Math.min(widthRaw, 100 - left));
  const overrun = op.end > SOURCE_SECONDS || op.start > SOURCE_SECONDS;
  return { left, width, overrun };
}

export default function VideoagentDemo() {
  const reduce = useReducedMotion();
  const [eid, setEid] = useState(EXAMPLES[0].id);
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);

  const ex = EXAMPLES.find((e) => e.id === eid)!;
  const willReject = ex.first.bad >= 0;

  // The plan currently on the track depends on phase.
  const showRetry = phase === 'retrying' || (phase === 'done' && willReject);
  const plan = showRetry && ex.retry ? ex.retry : ex.first;
  const flagged =
    (phase === 'rejected' || phase === 'verifying') && willReject
      ? ex.first.bad
      : -1;

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function selectEx(id: string) {
    if (phase !== 'idle' && phase !== 'done') return;
    clearTimers();
    setEid(id);
    setPhase('idle');
  }

  function planAndVerify() {
    if (phase !== 'idle' && phase !== 'done') return;
    clearTimers();
    const target = EXAMPLES.find((e) => e.id === eid)!;
    const rejects = target.first.bad >= 0;

    if (reduce) {
      setPhase('done');
      return;
    }

    setPhase('planning');
    timers.current.push(window.setTimeout(() => setPhase('verifying'), 850));
    if (rejects) {
      timers.current.push(window.setTimeout(() => setPhase('rejected'), 1700));
      timers.current.push(window.setTimeout(() => setPhase('retrying'), 2700));
      timers.current.push(window.setTimeout(() => setPhase('done'), 3700));
    } else {
      timers.current.push(window.setTimeout(() => setPhase('done'), 1900));
    }
  }

  function reset() {
    clearTimers();
    setPhase('idle');
  }

  const busy =
    phase === 'planning' ||
    phase === 'verifying' ||
    phase === 'rejected' ||
    phase === 'retrying';

  const statusText: Record<Phase, string> = {
    idle: 'ready',
    planning: 'planning ops',
    verifying: 'source-aware verify',
    rejected: 'VerifyError',
    retrying: 'bounded retry',
    done: 'FFmpeg run complete',
  };

  return (
    <div className="demo" aria-label="videoagent plan and verify demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Plan, verify, retry, run</h3>
      <p className="demo__lede">
        An instruction becomes ops from eight closed-set verbs, each with min and
        max bounds. The source-aware verifier rejects an edit that runs past the{' '}
        {SOURCE_SECONDS}s source with a structured VerifyError, feeds one bounded
        retry, and only then does FFmpeg run.
      </p>

      <div className="va__chips" role="group" aria-label="example instructions">
        {EXAMPLES.map((e) => (
          <button
            key={e.id}
            className={`va__chip${e.id === eid ? ' va__chip--on' : ''}`}
            aria-pressed={e.id === eid}
            onClick={() => selectEx(e.id)}
            disabled={busy}
          >
            {e.instruction}
          </button>
        ))}
      </div>

      <div className="va__instruction">
        <span className="va__quote">{ex.instruction}</span>
        <span className={`va__status va__status--${phase}`}>
          {statusText[phase]}
        </span>
      </div>

      <div className="va__timeline" aria-label="source timeline">
        <div className="va__ruler">
          {[0, 30, 60, 90, 120].map((s) => (
            <span key={s} className="va__tick" style={{ left: `${(s / SOURCE_SECONDS) * 100}%` }}>
              {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
            </span>
          ))}
        </div>
        <div className="va__track">
          <AnimatePresence>
            {phase !== 'idle' &&
              plan.ops.map((op, i) => {
                const { left, width, overrun } = clipStyle(op);
                const isFlagged = i === flagged;
                return (
                  <motion.div
                    key={`${eid}-${showRetry ? 'r' : 'f'}-${i}`}
                    className={`va__clip${isFlagged ? ' va__clip--bad' : ''}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `${8 + i * 30}px`,
                      ['--clip-color' as string]: isFlagged
                        ? 'var(--accent)'
                        : VERB_COLORS[op.verb] ?? 'var(--accent)',
                    }}
                    initial={{ opacity: 0, y: reduce ? 0 : -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: reduce ? 0 : 0.4,
                      delay: reduce ? 0 : i * 0.12,
                      ease,
                    }}
                    title={op.arg}
                  >
                    <span className="va__clip-verb">{op.verb}</span>
                    <span className="va__clip-arg">{op.arg}</span>
                    {overrun && <span className="va__clip-overrun" aria-hidden="true" />}
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {phase === 'rejected' && willReject && (
          <motion.div
            key="err"
            className="va__error"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            role="alert"
          >
            <span className="va__error-tag">VerifyError</span>
            <span className="va__error-msg">{ex.first.verifyError}</span>
            <span className="va__error-note">feeding one bounded retry</span>
          </motion.div>
        )}
        {phase === 'done' && (
          <motion.div
            key="ok"
            className="va__done"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease }}
          >
            <span className="va__done-tag">verified</span>
            <span className="va__done-msg">
              {willReject
                ? 'Retry stayed in bounds. Go pipeline ran FFmpeg and streamed frames.'
                : 'Plan passed the verifier first try. Go pipeline ran FFmpeg.'}
            </span>
            <div className="va__frames" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((f) => (
                <motion.div
                  key={f}
                  className="va__frame"
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : f * 0.07 }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={planAndVerify} disabled={busy}>
          {busy ? 'Working…' : 'Run instruction'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={busy}
        >
          Reset
        </button>
        <span className="demo__hint">8 closed-set verbs, source-aware verify</span>
      </div>
    </div>
  );
}
