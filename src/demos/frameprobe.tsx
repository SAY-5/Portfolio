import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './frameprobe.css';

// Real mechanism: a three-thread pipeline (decoder, inference, sink) connected
// by bounded queues. A target FPS sets a per-frame deadline; 30 FPS is 33.3 ms.
// When inference falls behind, the bounded queue back-pressures and the v4
// adaptive controller skips frames proportionally to how far behind it is,
// holding the deadline for the frames it does process.
const QUEUE_CAP = 4; // bounded queue depth between stages
const ease = [0.22, 1, 0.36, 1] as const;

type Stage = { id: string; label: string; name: string; x: number };
const stages: Stage[] = [
  { id: 'dec', label: 'thread 1', name: 'decoder', x: 70 },
  { id: 'inf', label: 'thread 2', name: 'inference', x: 270 },
  { id: 'sink', label: 'thread 3', name: 'sink', x: 470 },
];

type Run = {
  fps: number;
  deadlineMs: number;
  inferMs: number;
  adaptive: boolean;
  queueFill: number; // 0..QUEUE_CAP backlog before inference
  processed: number;
  dropped: number;
  missed: number;
  sustainedFps: number;
  p95: number;
};

function simulate(targetFps: number, inferMs: number, adaptive: boolean): Run {
  const deadlineMs = +(1000 / targetFps).toFixed(1);
  // How much slower than the deadline a single inference is.
  const overrun = inferMs / deadlineMs; // >1 means inference cannot keep up
  const arrivalsPerSec = targetFps;
  const servicePerSec = 1000 / inferMs;

  let processedPerSec: number;
  let droppedPerSec: number;
  let queueFill: number;
  let p95: number;
  let missedRate: number;

  if (servicePerSec >= arrivalsPerSec) {
    // Pipeline keeps up: queue stays shallow, deadlines hold.
    processedPerSec = arrivalsPerSec;
    droppedPerSec = 0;
    queueFill = Math.min(QUEUE_CAP, Math.max(0, Math.round(overrun * 1.5)));
    p95 = +(inferMs * 1.08).toFixed(1);
    missedRate = 0;
  } else if (adaptive) {
    // v4 controller skips frames proportionally to how far behind we are, so
    // the frames it does run still land inside the deadline.
    processedPerSec = Math.round(servicePerSec);
    droppedPerSec = Math.max(0, arrivalsPerSec - processedPerSec);
    queueFill = Math.min(QUEUE_CAP, 2); // controller keeps the queue shallow
    p95 = +(inferMs * 1.05).toFixed(1);
    missedRate = 0;
  } else {
    // No controller: the bounded queue saturates and back-pressure stalls
    // decode, so deadlines blow out and frames pile up.
    processedPerSec = Math.round(servicePerSec);
    droppedPerSec = Math.max(0, arrivalsPerSec - processedPerSec);
    queueFill = QUEUE_CAP; // saturated
    // queued frames wait behind the backlog, so p95 latency stacks up
    p95 = +(inferMs * (1 + QUEUE_CAP * 0.6)).toFixed(1);
    missedRate = Math.min(
      100,
      Math.round((1 - servicePerSec / arrivalsPerSec) * 100),
    );
  }

  return {
    fps: targetFps,
    deadlineMs,
    inferMs,
    adaptive,
    queueFill,
    processed: processedPerSec,
    dropped: droppedPerSec,
    missed: missedRate,
    sustainedFps: Math.min(targetFps, Math.round(processedPerSec)),
    p95,
  };
}

export default function FrameprobeDemo() {
  const reduce = useReducedMotion();
  const [targetFps, setTargetFps] = useState(30);
  const [inferMs, setInferMs] = useState(28);
  const [adaptive, setAdaptive] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [frameId, setFrameId] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = simulate(targetFps, inferMs, adaptive);
  const behind = run.inferMs > run.deadlineMs;
  const dropping = run.dropped > 0;

  useEffect(() => {
    if (!playing || reduce) return;
    timer.current = setInterval(() => setFrameId((f) => (f + 1) % 1000), 420);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, reduce]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  // A frame is dropped when it would push the bounded queue past capacity and
  // the controller decides to skip it; modeled by the drop ratio.
  const dropEveryN =
    run.dropped > 0 ? Math.max(2, Math.round(run.fps / run.dropped)) : 0;
  const thisFrameDropped = dropEveryN > 0 && frameId % dropEveryN === 0;

  return (
    <div className="demo" aria-label="frameprobe pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Frames against a deadline</h3>
      <p className="demo__lede">
        Frames flow through three threads joined by bounded queues. The target
        FPS sets a per-frame deadline. Push inference past the deadline and watch
        the queue back up; the adaptive controller skips frames in proportion to
        how far behind it is, holding the deadline for the frames it keeps.
      </p>

      <div className="fp__stage">
        <div className="fp__pipe">
          <svg
            className="fp__svg"
            viewBox="0 0 560 200"
            role="group"
            aria-label="three thread pipeline with bounded queues"
          >
            {/* connecting rails */}
            <line x1={140} y1={90} x2={196} y2={90} stroke="var(--line)" strokeWidth={2} />
            <line x1={344} y1={90} x2={400} y2={90} stroke="var(--line)" strokeWidth={2} />

            {/* bounded queue between decoder and inference */}
            <g>
              <text x={168} y={48} textAnchor="middle" className="fp__queue-cap">
                queue {run.queueFill}/{QUEUE_CAP}
              </text>
              {Array.from({ length: QUEUE_CAP }).map((_, i) => {
                const filled = i < run.queueFill;
                return (
                  <motion.rect
                    key={`q-${i}`}
                    x={150 + i * 9}
                    y={60}
                    width={7}
                    height={16}
                    rx={2}
                    fill={
                      filled
                        ? run.queueFill >= QUEUE_CAP && !adaptive
                          ? 'var(--accent)'
                          : 'var(--accent-soft)'
                        : 'var(--ink-700)'
                    }
                    stroke="var(--line)"
                    strokeWidth={0.5}
                    animate={{ opacity: filled ? 1 : 0.4 }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                  />
                );
              })}
            </g>

            {/* stage boxes */}
            {stages.map((s) => {
              const isInfer = s.id === 'inf';
              const hot = isInfer && behind;
              return (
                <g key={s.id}>
                  <rect
                    x={s.x}
                    y={66}
                    width={70}
                    height={48}
                    rx={10}
                    fill={hot ? 'var(--accent-glow)' : 'var(--ink-800)'}
                    stroke={hot ? 'var(--accent-line)' : 'var(--line)'}
                    strokeWidth={hot ? 2 : 1}
                  />
                  <text x={s.x + 35} y={84} textAnchor="middle" className="fp__stage-label">
                    {s.label}
                  </text>
                  <text x={s.x + 35} y={102} textAnchor="middle" className="fp__stage-name">
                    {s.name}
                  </text>
                </g>
              );
            })}

            {/* the moving frame token */}
            <AnimatePresence mode="popLayout">
              {playing && !reduce && (
                <motion.g
                  key={`frame-${frameId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.circle
                    r={7}
                    cy={140}
                    fill={thisFrameDropped ? 'var(--ink-700)' : 'var(--accent)'}
                    stroke={thisFrameDropped ? 'var(--accent-line)' : 'none'}
                    strokeDasharray={thisFrameDropped ? '3 2' : undefined}
                    initial={{ cx: 105 }}
                    animate={{
                      cx: thisFrameDropped ? [105, 180] : [105, 305, 505],
                      cy: thisFrameDropped ? [140, 170] : 140,
                      opacity: thisFrameDropped ? [1, 0] : 1,
                    }}
                    transition={{ duration: 0.4, ease }}
                  />
                </motion.g>
              )}
            </AnimatePresence>
            <text x={105} y={170} textAnchor="middle" className="fp__queue-cap">
              {playing && thisFrameDropped ? 'frame skipped' : 'frame in'}
            </text>
          </svg>
        </div>

        <div className="fp__controls-row">
          <div className="fp__slider-group">
            <label className="fp__slider-label" htmlFor="fp-fps">
              <span>target FPS</span>
              <b>
                {targetFps} ({run.deadlineMs} ms deadline)
              </b>
            </label>
            <input
              id="fp-fps"
              className="fp__slider"
              type="range"
              min={15}
              max={60}
              step={1}
              value={targetFps}
              onChange={(e) => setTargetFps(+e.target.value)}
            />
          </div>
          <div className="fp__slider-group">
            <label className="fp__slider-label" htmlFor="fp-infer">
              <span>inference cost</span>
              <b>{inferMs} ms / frame</b>
            </label>
            <input
              id="fp-infer"
              className="fp__slider"
              type="range"
              min={8}
              max={90}
              step={1}
              value={inferMs}
              onChange={(e) => setInferMs(+e.target.value)}
            />
          </div>
          <button
            type="button"
            className="fp__toggle"
            aria-pressed={adaptive}
            onClick={() => setAdaptive((a) => !a)}
          >
            <span className="fp__switch" data-on={adaptive}>
              <span className="fp__switch-knob" />
            </span>
            adaptive controller
          </button>
        </div>

        <div className="fp__stats">
          <div className="fp__stat">
            <span className="fp__stat-name">sustained</span>
            <span className="fp__stat-val">
              {run.sustainedFps}
              <span className="fp__stat-unit">fps</span>
            </span>
          </div>
          <div className={`fp__stat${run.p95 > run.deadlineMs ? ' fp__stat--alert' : ''}`}>
            <span className="fp__stat-name">latency p95</span>
            <span className="fp__stat-val">
              {run.p95}
              <span className="fp__stat-unit">ms</span>
            </span>
          </div>
          <div className={`fp__stat${run.missed > 0 ? ' fp__stat--alert' : ''}`}>
            <span className="fp__stat-name">deadline miss</span>
            <span className="fp__stat-val">
              {run.missed}
              <span className="fp__stat-unit">%</span>
            </span>
          </div>
          <div className={`fp__stat${dropping ? ' fp__stat--alert' : ''}`}>
            <span className="fp__stat-name">dropped / s</span>
            <span className="fp__stat-val">{run.dropped}</span>
          </div>
        </div>

        <div className="fp__note">
          {!behind ? (
            <>
              Inference fits inside the <b>{run.deadlineMs} ms</b> deadline, so
              the queue stays shallow and every frame is processed on time at{' '}
              <b>{run.sustainedFps} FPS</b>.
            </>
          ) : adaptive ? (
            <>
              Inference runs <b>{run.inferMs} ms</b> against a{' '}
              <b>{run.deadlineMs} ms</b> deadline. The controller skips{' '}
              <b>{run.dropped} frames/s</b> so the queue stays shallow and
              processed frames still hold the deadline at p95{' '}
              <b>{run.p95} ms</b>.
            </>
          ) : (
            <>
              Without the controller the bounded queue saturates at{' '}
              <b>{QUEUE_CAP}/{QUEUE_CAP}</b>, back-pressure stalls decode, and{' '}
              <b>{run.missed}%</b> of frames miss the deadline as p95 latency
              stacks to <b>{run.p95} ms</b>.
            </>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={!!reduce}
        >
          {playing ? 'Pause' : 'Play frames'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            setTargetFps(30);
            setInferMs(28);
            setAdaptive(true);
          }}
        >
          Reset
        </button>
        <span className="demo__hint">
          {reduce
            ? 'reduced motion: live metrics only'
            : 'drag the sliders, then toggle the controller'}
        </span>
      </div>
    </div>
  );
}
