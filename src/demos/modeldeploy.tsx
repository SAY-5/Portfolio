import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './modeldeploy.css';

// Real mechanism from the project: a router splits traffic between model
// versions (the highlight cites ModelV1 at 90% and a ModelV2 canary at 10%).
// A metrics tracker watches error rate and automatically promotes the canary
// to full traffic or rolls it back when an error-rate threshold is breached.
const THRESHOLD = 0.05; // 5% rolling error rate trips the tracker
const STABLE_ERR = 0.012; // ModelV1 baseline error rate, ~1.2%
const RPS = 240; // requests per second flowing through the router
const WINDOW = 40; // points kept in the metric tail (SSE-streamed in v2)

type Phase = 'canary' | 'promoted' | 'rolledback';
type Point = { stable: number; canary: number };

// One simulated tick: sample an error rate for each version around its mean
// with a little noise, weighted toward the configured canary error level.
function sample(mean: number, jitter: number) {
  const n = (Math.random() - 0.5) * 2 * jitter;
  return Math.max(0, mean + n);
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function ModelDeployDemo() {
  const reduce = useReducedMotion();
  const [share, setShare] = useState(10); // canary traffic share, percent
  const [canaryErr, setCanaryErr] = useState(0.02); // configured canary fault rate
  const [phase, setPhase] = useState<Phase>('canary');
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [rolling, setRolling] = useState(0); // rolling canary error rate
  const timer = useRef<number | null>(null);
  const stateRef = useRef({ share: 10, canaryErr: 0.02, phase: 'canary' as Phase });

  stateRef.current.share = share;
  stateRef.current.canaryErr = canaryErr;
  stateRef.current.phase = phase;

  function stop() {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(() => stop, []);

  function tick() {
    const s = stateRef.current;
    const stableE = sample(STABLE_ERR, 0.006);
    const canaryE = sample(s.canaryErr, 0.01);
    setPoints((prev) => {
      const next = [...prev, { stable: stableE, canary: canaryE }].slice(-WINDOW);
      // Rolling error rate is the mean over the last several canary points,
      // which is what the tracker compares against the threshold.
      const tail = next.slice(-8);
      const avg = tail.reduce((a, p) => a + p.canary, 0) / tail.length;
      setRolling(avg);
      if (s.phase === 'canary') {
        if (avg > THRESHOLD) {
          // Error-rate breach: snap the canary back to zero traffic.
          setPhase('rolledback');
          setShare(0);
          setRunning(false);
          stop();
        } else if (next.length >= WINDOW) {
          // Held under threshold across the full window: promote to 100%.
          setPhase('promoted');
          setShare(100);
          setRunning(false);
          stop();
        }
      }
      return next;
    });
  }

  function play() {
    if (running) {
      setRunning(false);
      stop();
      return;
    }
    if (phase !== 'canary') restart();
    setRunning(true);
    if (reduce) {
      // Reduced motion: resolve immediately rather than animate the stream.
      for (let i = 0; i < WINDOW + 2; i++) tick();
      return;
    }
    timer.current = window.setInterval(tick, 180);
  }

  function restart() {
    stop();
    setPhase('canary');
    setShare(10);
    setPoints([]);
    setRolling(0);
    setRunning(false);
  }

  const stableShare = 100 - share;
  const lastStable = points.at(-1)?.stable ?? STABLE_ERR;
  const lastCanary = points.at(-1)?.canary ?? canaryErr;
  const breach = phase === 'rolledback' || rolling > THRESHOLD;

  // Chart geometry: map error rate 0..12% onto a 200x90 plot.
  const W = 320;
  const H = 96;
  const maxErr = 0.12;
  const toX = (i: number) => (i / Math.max(1, WINDOW - 1)) * W;
  const toY = (e: number) => H - Math.min(1, e / maxErr) * H;
  const path = (key: 'stable' | 'canary') =>
    points.length < 2
      ? ''
      : points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p[key]).toFixed(1)}`)
          .join(' ');
  const thrY = toY(THRESHOLD);

  const statusClass =
    phase === 'promoted'
      ? 'md__status--promoted'
      : phase === 'rolledback'
        ? 'md__status--rolledback'
        : 'md__status--canary';
  const badge =
    phase === 'promoted'
      ? 'Promoted'
      : phase === 'rolledback'
        ? 'Rolled back'
        : 'Canary live';
  const statusText =
    phase === 'promoted'
      ? `ModelV2 held under the ${(THRESHOLD * 100).toFixed(0)}% error-rate threshold across the full window, so the router shifted it to 100% of traffic.`
      : phase === 'rolledback'
        ? `Rolling error rate crossed ${(THRESHOLD * 100).toFixed(0)}%, so the tracker snapped ModelV2 back to 0% and kept ModelV1 serving.`
        : `Router holds ModelV1 at ${stableShare}% and the ModelV2 canary at ${share}%. The tracker promotes on a clean window or rolls back on breach.`;

  return (
    <div className="demo" aria-label="modeldeploy canary rollout demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Canary rollout that decides for itself</h3>
      <p className="demo__lede">
        The router splits live traffic between ModelV1 and a ModelV2 canary.
        Set the canary error rate, start the stream, and watch the metrics
        tracker promote the canary to full traffic or roll it straight back the
        moment its rolling error rate crosses {(THRESHOLD * 100).toFixed(0)}%.
      </p>

      <div className="md__stage">
        <div className="md__router">
          <div className="md__source">
            <span className="md__source-name">Prediction server</span>
            <span className="md__source-sub">FastAPI router</span>
            <span className="md__source-rps">{RPS} req/s</span>
          </div>

          <div className="md__split" aria-label="traffic split">
            <div className="md__flow md__flow--stable">
              <motion.span
                className="md__flow-fill"
                animate={{ width: `${stableShare}%` }}
                transition={{ duration: reduce ? 0 : 0.4, ease }}
              />
              <span className="md__flow-label">V1 {stableShare}%</span>
            </div>
            <div className="md__flow md__flow--canary">
              <motion.span
                className="md__flow-fill"
                animate={{ width: `${share}%` }}
                transition={{ duration: reduce ? 0 : 0.4, ease }}
              />
              <span className="md__flow-label">V2 {share}%</span>
            </div>
          </div>

          <div className="md__versions">
            <div className="md__ver md__ver--stable">
              <div className="md__ver-top">
                <span className="md__ver-name">ModelV1</span>
                <span className="md__ver-role">stable</span>
              </div>
              <div className="md__ver-stats">
                <div className="md__ver-stat">
                  <span className="md__ver-stat-label">error</span>
                  <span className="md__ver-stat-val">
                    {(lastStable * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="md__ver-stat">
                  <span className="md__ver-stat-label">share</span>
                  <span className="md__ver-stat-val">{stableShare}%</span>
                </div>
              </div>
            </div>
            <div
              className={`md__ver md__ver--canary${breach ? ' md__ver--breach' : ''}`}
            >
              <div className="md__ver-top">
                <span className="md__ver-name">ModelV2</span>
                <span className="md__ver-role">canary</span>
              </div>
              <div className="md__ver-stats">
                <div className="md__ver-stat">
                  <span className="md__ver-stat-label">error</span>
                  <span
                    className="md__ver-stat-val md__ver-stat-val--err"
                    data-breach={breach}
                  >
                    {(lastCanary * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="md__ver-stat">
                  <span className="md__ver-stat-label">share</span>
                  <span className="md__ver-stat-val">{share}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="md__metrics">
          <div className="md__metrics-head">
            <span>Metric tail</span>
            <span className="md__metrics-thr">
              rolling {(rolling * 100).toFixed(1)}% / threshold{' '}
              {(THRESHOLD * 100).toFixed(0)}%
            </span>
          </div>
          <svg
            className="md__chart"
            viewBox={`0 -6 ${W} ${H + 18}`}
            role="img"
            aria-label="error rate over time for both versions against the threshold"
          >
            <line className="md__chart-grid" x1="0" y1={H} x2={W} y2={H} />
            <line
              className="md__chart-thr"
              x1="0"
              y1={thrY}
              x2={W}
              y2={thrY}
            />
            <text className="md__chart-axis" x="2" y={thrY - 4}>
              {(THRESHOLD * 100).toFixed(0)}% threshold
            </text>
            {path('stable') && (
              <path className="md__chart-line--stable" d={path('stable')} />
            )}
            {path('canary') && (
              <path className="md__chart-line--canary" d={path('canary')} />
            )}
            <text className="md__chart-axis" x="2" y={H + 11}>
              SSE-streamed metric tail, {points.length}/{WINDOW} points
            </text>
          </svg>
        </div>

        <motion.div
          className={`md__status ${statusClass}`}
          layout={!reduce}
          transition={{ duration: reduce ? 0 : 0.3, ease }}
        >
          <span className="md__status-badge">{badge}</span>
          <span className="md__status-text">{statusText}</span>
        </motion.div>

        <div className="md__sliderwrap">
          <label className="md__slider-label" htmlFor="md-canary-err">
            <span>Canary error rate</span>
            <b>{(canaryErr * 100).toFixed(1)}%</b>
          </label>
          <input
            id="md-canary-err"
            className="md__slider"
            type="range"
            min={0}
            max={120}
            value={Math.round(canaryErr * 1000)}
            disabled={running}
            onChange={(e) => setCanaryErr(Number(e.target.value) / 1000)}
            aria-label="canary error rate percent"
          />
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play}>
          {running ? 'Pause' : phase === 'canary' ? 'Start rollout' : 'Run again'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={restart}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {canaryErr > THRESHOLD
            ? 'above threshold: expect a rollback'
            : 'under threshold: expect a promotion'}
        </span>
      </div>
    </div>
  );
}
