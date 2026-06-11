import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './GPU-Provisioning-System.css';

// Real numbers from the project. A single API request becomes a running GPU
// environment in 6-10 minutes versus 5-7 days by hand, a 99.9% reduction. A Go
// engine runs 10 concurrent workers at roughly 100 provisions/hour using
// 30-35 MB of memory. The job lifecycle has six stages from PENDING to ACTIVE.
// Pre-built images (PyTorch, TensorFlow, Bioimaging, 9-13 GB) run on CUDA 11.2,
// with auto-shutdown on expiration.

const WORKERS = 10;
const PROVISIONS_PER_HOUR = 100;
const MEM_MB = '30-35';
const MANUAL_DAYS = 6; // middle of 5-7 days
const AUTO_MINUTES = 8; // middle of 6-10 minutes

type StageDef = { id: string; label: string; detail: string };

// Six-stage lifecycle from PENDING to ACTIVE.
const STAGES: StageDef[] = [
  { id: 'PENDING', label: 'Pending', detail: 'queued in PostgreSQL' },
  { id: 'VALIDATING', label: 'Validating', detail: 'request + quota check' },
  { id: 'LAUNCHING', label: 'Launching', detail: 'EC2 instance up' },
  { id: 'DEPLOYING', label: 'Deploying', detail: 'pull image, run container' },
  { id: 'VERIFYING', label: 'Verifying', detail: 'GPU + driver check' },
  { id: 'ACTIVE', label: 'Active', detail: 'Jupyter + TensorBoard ready' },
];

type ImageDef = { id: string; label: string; size: string };
const IMAGES: ImageDef[] = [
  { id: 'pytorch', label: 'PyTorch', size: '9 GB' },
  { id: 'tensorflow', label: 'TensorFlow', size: '11 GB' },
  { id: 'bioimaging', label: 'Bioimaging', size: '13 GB' },
];

const ease = [0.22, 1, 0.36, 1] as const;

type WorkerState = { id: number; busy: boolean; stage: number };

export default function GpuProvisioningDemo() {
  const reduce = useReducedMotion();
  const [image, setImage] = useState('pytorch');
  const [running, setRunning] = useState(false);
  const [stageIdx, setStageIdx] = useState(-1);
  const [workers, setWorkers] = useState<WorkerState[]>(() =>
    Array.from({ length: WORKERS }, (_, i) => ({ id: i, busy: false, stage: 0 })),
  );
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // Percent-complete from the tracked job (stage 0..5 maps to 0..100).
  const pct =
    stageIdx < 0 ? 0 : Math.round(((stageIdx + 1) / STAGES.length) * 100);
  const activeImage = IMAGES.find((im) => im.id === image)!;

  // Randomize the background worker pool so the concurrency view feels live.
  function seedWorkers(busyCount: number) {
    const order = [...Array(WORKERS).keys()].sort(() => Math.random() - 0.5);
    const busySet = new Set(order.slice(0, busyCount));
    setWorkers(
      Array.from({ length: WORKERS }, (_, i) => ({
        id: i,
        busy: busySet.has(i),
        stage: 1 + Math.floor(Math.random() * (STAGES.length - 1)),
      })),
    );
  }

  function provision() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setStageIdx(-1);
    seedWorkers(7); // pool already handling other jobs

    if (reduce) {
      setStageIdx(STAGES.length - 1);
      seedWorkers(6);
      setRunning(false);
      return;
    }

    STAGES.forEach((_, i) => {
      const t = window.setTimeout(() => {
        setStageIdx(i);
        // worker pool churns as jobs come and go
        seedWorkers(5 + Math.floor(Math.random() * 4));
        if (i === STAGES.length - 1) {
          const end = window.setTimeout(() => {
            setRunning(false);
            seedWorkers(6);
          }, 700);
          timers.current.push(end);
        }
      }, 650 * (i + 1));
      timers.current.push(t);
    });
  }

  function reset() {
    clearTimers();
    setRunning(false);
    setStageIdx(-1);
    setWorkers(
      Array.from({ length: WORKERS }, (_, i) => ({ id: i, busy: false, stage: 0 })),
    );
  }

  const busyCount = workers.filter((w) => w.busy).length;

  return (
    <div className="demo" aria-label="GPU provisioning job tracker demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">One request to a running GPU</h3>
      <p className="demo__lede">
        Pick an image and submit a request. The job moves through six stages
        from pending to active with live percent-complete, while the worker pool
        on the right keeps handling other provisions concurrently.
      </p>

      <div className="gp__stage">
        {/* image picker */}
        <div className="gp__images" role="group" aria-label="image selection">
          {IMAGES.map((im) => (
            <button
              key={im.id}
              type="button"
              className={'gp__image' + (image === im.id ? ' gp__image--on' : '')}
              aria-pressed={image === im.id}
              disabled={running}
              onClick={() => setImage(im.id)}
            >
              <span className="gp__image-name">{im.label}</span>
              <span className="gp__image-size">{im.size}, CUDA 11.2</span>
            </button>
          ))}
        </div>

        <div className="gp__main">
          {/* job tracker */}
          <div className="gp__tracker">
            <div className="gp__tracker-head">
              <span className="gp__tracker-title">Job lifecycle</span>
              <span className="gp__tracker-pct">{pct}%</span>
            </div>
            <div className="gp__progress" aria-hidden="true">
              <motion.span
                className="gp__progress-fill"
                animate={{ width: `${pct}%` }}
                transition={{ duration: reduce ? 0 : 0.5, ease }}
              />
            </div>
            <ol className="gp__steps">
              {STAGES.map((s, i) => {
                const done = stageIdx >= 0 && i < stageIdx;
                const cur = i === stageIdx;
                return (
                  <li
                    key={s.id}
                    className={
                      'gp__step' +
                      (done ? ' gp__step--done' : '') +
                      (cur ? ' gp__step--cur' : '')
                    }
                  >
                    <span className="gp__step-dot" aria-hidden="true">
                      {done ? '✓' : i + 1}
                    </span>
                    <span className="gp__step-body">
                      <span className="gp__step-label">{s.label}</span>
                      <span className="gp__step-detail">
                        {cur && i === 3 ? `pull ${activeImage.label} (${activeImage.size})` : s.detail}
                      </span>
                    </span>
                    {cur && !reduce && (
                      <motion.span
                        className="gp__step-spin"
                        aria-hidden="true"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* worker pool */}
          <div className="gp__pool">
            <div className="gp__pool-head">
              <span className="gp__pool-title">Worker pool</span>
              <span className="gp__pool-count">
                {busyCount}/{WORKERS} busy
              </span>
            </div>
            <div className="gp__grid" aria-label={`${busyCount} of ${WORKERS} workers active`}>
              {workers.map((w) => (
                <div
                  key={w.id}
                  className={'gp__cell' + (w.busy ? ' gp__cell--busy' : '')}
                >
                  <span className="gp__cell-id">w{w.id}</span>
                  <AnimatePresence>
                    {w.busy && (
                      <motion.span
                        className="gp__cell-bar"
                        initial={{ scaleY: reduce ? 1 : 0.2, opacity: 0 }}
                        animate={{ scaleY: 1, opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease }}
                      />
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
            <div className="gp__pool-meta">
              ~{PROVISIONS_PER_HOUR} provisions/hour, {MEM_MB} MB memory
            </div>
          </div>
        </div>

        {/* time comparison */}
        <div className="gp__compare">
          <div className="gp__compare-side gp__compare-side--manual">
            <span className="gp__compare-label">By hand</span>
            <span className="gp__compare-val">{MANUAL_DAYS} days</span>
            <span className="gp__compare-sub">5-7 days of setup</span>
          </div>
          <div className="gp__compare-arrow" aria-hidden="true">
            <motion.span
              className="gp__compare-track"
              initial={false}
              animate={pct === 100 && !reduce ? { backgroundPositionX: ['0%', '100%'] } : {}}
              transition={{ duration: 1.2, ease }}
            />
            <span className="gp__compare-cut">99.9% less</span>
          </div>
          <div className="gp__compare-side gp__compare-side--auto">
            <span className="gp__compare-label">Provisioned</span>
            <span className="gp__compare-val">{AUTO_MINUTES} min</span>
            <span className="gp__compare-sub">6-10 minutes, then auto-shutdown</span>
          </div>
        </div>

        <AnimatePresence>
          {stageIdx === STAGES.length - 1 && (
            <motion.div
              className="gp__ready"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="gp__ready-dot" aria-hidden="true" />
              <span className="gp__ready-text">
                {activeImage.label} environment is <b>ACTIVE</b>. Jupyter and
                TensorBoard reachable; idle instances shut down on expiration.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={provision} disabled={running}>
          {running ? 'Provisioning…' : 'Submit request'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">{WORKERS} concurrent Go workers</span>
      </div>
    </div>
  );
}
