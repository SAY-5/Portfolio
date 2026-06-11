import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './JobApplier.css';

// JobApplier runs a four-stage pipeline: a pasted job URL is scraped into a
// job description, a resume is tailored with an ATS audit that reports a
// before/after score and interview probability, and browser automation then
// auto-fills the application form field by field. This demo steps through
// that pipeline so the ATS score climb and the Greenhouse auto-fill are both
// visible.

const ease = [0.22, 1, 0.36, 1] as const;

const JOB_URL = 'boards.greenhouse.io/acme/jobs/backend-platform-5821';

const JD_CHIPS = [
  { label: 'Python', key: true },
  { label: 'FastAPI', key: true },
  { label: 'PostgreSQL', key: true },
  { label: 'distributed systems', key: true },
  { label: 'on-call rotation', key: false },
  { label: 'remote, US', key: false },
];

// Real ATS audit shape: a before/after score plus interview probability.
const ATS_BEFORE = 58;
const ATS_AFTER = 91;
const PROB_BEFORE = 12;
const PROB_AFTER = 47;

const FORM_FIELDS = [
  { label: 'Full name', value: 'Jordan Avery' },
  { label: 'Email', value: 'jordan.avery@mail.com' },
  { label: 'Resume', value: 'jordan-avery-backend.pdf' },
  { label: 'LinkedIn', value: 'linkedin.com/in/javery' },
];

const STEPS = [
  { num: '01', name: 'Paste URL' },
  { num: '02', name: 'Extract JD' },
  { num: '03', name: 'Tailor + ATS' },
  { num: '04', name: 'Auto-fill' },
];

export default function JobApplierDemo() {
  const reduce = useReducedMotion();
  // step: 0 idle, 1..4 active stages, 5 done
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [typed, setTyped] = useState('');
  const [score, setScore] = useState(ATS_BEFORE);
  const [prob, setProb] = useState(PROB_BEFORE);
  const [filled, setFilled] = useState(0);
  const [fillingIdx, setFillingIdx] = useState(-1);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  function after(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setStep(0);
    setTyped('');
    setScore(ATS_BEFORE);
    setProb(PROB_BEFORE);
    setFilled(0);
    setFillingIdx(-1);
  }

  function run() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setTyped('');
    setScore(ATS_BEFORE);
    setProb(PROB_BEFORE);
    setFilled(0);
    setFillingIdx(-1);

    if (reduce) {
      setStep(5);
      setTyped(JOB_URL);
      setScore(ATS_AFTER);
      setProb(PROB_AFTER);
      setFilled(FORM_FIELDS.length);
      setRunning(false);
      return;
    }

    // Stage 1: type the URL.
    setStep(1);
    const chars = JOB_URL.length;
    for (let i = 1; i <= chars; i++) {
      after(i * 22, () => setTyped(JOB_URL.slice(0, i)));
    }
    const t1 = chars * 22 + 300;

    // Stage 2: extracted JD appears.
    after(t1, () => setStep(2));
    const t2 = t1 + 1100;

    // Stage 3: ATS score and probability climb.
    after(t2, () => setStep(3));
    const climbStart = t2 + 250;
    const climbMs = 1100;
    const frames = 28;
    for (let f = 1; f <= frames; f++) {
      const p = f / frames;
      const e = 1 - Math.pow(1 - p, 3);
      after(climbStart + p * climbMs, () => {
        setScore(Math.round(ATS_BEFORE + (ATS_AFTER - ATS_BEFORE) * e));
        setProb(Math.round(PROB_BEFORE + (PROB_AFTER - PROB_BEFORE) * e));
      });
    }
    const t3 = climbStart + climbMs + 450;

    // Stage 4: auto-fill the form field by field.
    after(t3, () => setStep(4));
    let cursor = t3 + 250;
    FORM_FIELDS.forEach((_, i) => {
      after(cursor, () => setFillingIdx(i));
      after(cursor + 360, () => {
        setFilled(i + 1);
        setFillingIdx(-1);
      });
      cursor += 520;
    });
    after(cursor + 150, () => {
      setStep(5);
      setRunning(false);
    });
  }

  const stageOn = (s: number) => step === s;
  const stageDone = (s: number) => step > s || step === 5;

  return (
    <div className="demo" aria-label="JobApplier pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">From job URL to a filled application</h3>
      <p className="demo__lede">
        Run the pipeline. A pasted URL is scraped into a job description, the
        resume is tailored as the ATS score climbs, and the Greenhouse form
        fills field by field through browser automation.
      </p>

      <div className="ja__stage">
        <div className="ja__steps">
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              className="ja__step"
              data-on={stageOn(i + 1)}
              data-done={stageDone(i + 1)}
            >
              <span className="ja__step-num">{s.num}</span>
              <span className="ja__step-name">{s.name}</span>
            </div>
          ))}
        </div>

        <div className="ja__panel" aria-live="polite">
          <AnimatePresence mode="wait">
            {step <= 1 && (
              <motion.div
                key="s1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3 }}
              >
                <div className="ja__panel-head">Pasted job posting</div>
                <div className="ja__url">
                  <span className="ja__url-dot" />
                  <span>
                    {typed || (step === 0 ? JOB_URL : '')}
                    {step === 1 && typed.length < JOB_URL.length && (
                      <span className="ja__caret" />
                    )}
                  </span>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="s2"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease }}
              >
                <div className="ja__panel-head">Extracted job description</div>
                <div className="ja__jd">
                  <span className="ja__jd-tag">parsed from page</span>
                  <div className="ja__chips">
                    {JD_CHIPS.map((c, i) => (
                      <motion.span
                        key={c.label}
                        className={`ja__chip ${c.key ? 'ja__chip--key' : ''}`}
                        initial={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: reduce ? 0 : 0.25,
                          delay: reduce ? 0 : i * 0.07,
                        }}
                      >
                        {c.label}
                      </motion.span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="s3"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease }}
              >
                <div className="ja__panel-head">ATS audit</div>
                <div className="ja__score">
                  <div
                    className="ja__gauge"
                    style={{ ['--val' as string]: score }}
                    role="img"
                    aria-label={`ATS score ${score} out of 100`}
                  >
                    <span className="ja__gauge-num">{score}</span>
                  </div>
                  <div className="ja__score-meta">
                    <span className="ja__score-row">
                      ATS score <b>{ATS_BEFORE}</b> to <b>{score}</b>
                      <span className="ja__delta">
                        +{score - ATS_BEFORE}
                      </span>
                    </span>
                    <span className="ja__score-row">
                      interview probability <b>{prob}%</b>
                    </span>
                    <span className="ja__prob">
                      tailored to {JD_CHIPS.filter((c) => c.key).length} key
                      requirements
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            {step >= 4 && (
              <motion.div
                key="s4"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease }}
              >
                <div className="ja__panel-head">Greenhouse application</div>
                <div className="ja__form">
                  <div className="ja__form-brand">
                    auto-fill on <b>Greenhouse</b> portal
                  </div>
                  {FORM_FIELDS.map((f, i) => {
                    const isFilled = i < filled;
                    const isFilling = i === fillingIdx;
                    return (
                      <div className="ja__field" key={f.label}>
                        <span className="ja__field-label">{f.label}</span>
                        <span
                          className="ja__field-box"
                          data-filling={isFilling}
                          data-filled={isFilled}
                        >
                          {isFilled || isFilling ? f.value : ''}
                          {isFilling && <span className="ja__caret" />}
                        </span>
                      </div>
                    );
                  })}
                  <div className="ja__progress">
                    <span>
                      {filled}/{FORM_FIELDS.length} fields
                    </span>
                    <span className="ja__progress-track">
                      <motion.span
                        className="ja__progress-fill"
                        animate={{
                          width: `${(filled / FORM_FIELDS.length) * 100}%`,
                        }}
                        transition={{ duration: reduce ? 0 : 0.3, ease }}
                      />
                    </span>
                    <span>{step === 5 ? 'submitted' : 'filling'}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : step === 5 ? 'Run again' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          ATS {ATS_BEFORE} to {ATS_AFTER}, four portals supported
        </span>
      </div>
    </div>
  );
}
