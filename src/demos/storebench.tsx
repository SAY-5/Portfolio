import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './storebench.css';

// HDR-style histogram: log-bucketed latency counters with bounded memory.
// The real runner keeps 1024 counters (~8 KB) at ~6% relative error across
// nine orders of magnitude. Here we use a smaller bucket set for the chart
// but read percentiles back the same way: walk buckets until the cumulative
// count crosses each target fraction.
const BUCKETS = 26; // log-spaced latency buckets shown on the chart
const BUCKET_US = (b: number) => Math.round(8 * Math.pow(1.5, b)); // ~8us..~36ms

type Verdict = 'stable' | 'degrading' | 'bursty' | 'tail-heavy';

const VERDICTS: Record<Verdict, { label: string; note: string }> = {
  stable: { label: 'stable', note: 'tail tracks the median, drift ratio near 1' },
  degrading: { label: 'degrading', note: 'percentiles climbing run over run' },
  bursty: { label: 'bursty', note: 'IOPS swings wide between samples' },
  'tail-heavy': { label: 'tail-heavy', note: 'p999 far past p50, outliers piling up' },
};

// Four phases the run walks through, each shaping where samples land and
// what the classifier reads off the histogram.
const PHASES: { v: Verdict; centre: number; spread: number; tail: number; iops: number; jitter: number }[] = [
  { v: 'stable', centre: 7, spread: 2, tail: 0.01, iops: 1.05, jitter: 0.04 },
  { v: 'degrading', centre: 10, spread: 3, tail: 0.04, iops: 0.82, jitter: 0.06 },
  { v: 'bursty', centre: 9, spread: 3, tail: 0.05, iops: 0.6, jitter: 0.42 },
  { v: 'tail-heavy', centre: 8, spread: 2, tail: 0.16, iops: 0.74, jitter: 0.08 },
];

const PCTS: { key: string; frac: number }[] = [
  { key: 'p50', frac: 0.5 },
  { key: 'p95', frac: 0.95 },
  { key: 'p99', frac: 0.99 },
  { key: 'p999', frac: 0.999 },
];

const ease = [0.22, 1, 0.36, 1] as const;

function emptyHist() {
  return new Array<number>(BUCKETS).fill(0);
}

// Pick a bucket index from a phase profile: a body around centre plus a tail.
function sampleBucket(p: (typeof PHASES)[number]): number {
  if (Math.random() < p.tail) {
    return Math.min(BUCKETS - 1, p.centre + 6 + Math.floor(Math.random() * 8));
  }
  const g = (Math.random() + Math.random() + Math.random()) / 3 - 0.5; // ~normal
  return Math.max(0, Math.min(BUCKETS - 1, Math.round(p.centre + g * p.spread * 2)));
}

// Read a percentile back from cumulative counts, HDR-style.
function percentileBucket(hist: number[], total: number, frac: number): number {
  if (total === 0) return 0;
  const target = total * frac;
  let acc = 0;
  for (let b = 0; b < hist.length; b++) {
    acc += hist[b];
    if (acc >= target) return b;
  }
  return hist.length - 1;
}

export default function StorebenchDemo() {
  const reduce = useReducedMotion();
  const [hist, setHist] = useState<number[]>(emptyHist);
  const [total, setTotal] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [running, setRunning] = useState(true);
  const [iops, setIops] = useState(1.0);
  const [outliers, setOutliers] = useState(0);

  const histRef = useRef<number[]>(emptyHist());
  const totalRef = useRef(0);
  const tickRef = useRef(0);
  const timer = useRef<number | null>(null);

  function tick() {
    const t = tickRef.current++;
    const idx = Math.floor(t / 22) % PHASES.length;
    const phase = PHASES[idx];
    setPhaseIdx(idx);

    const h = histRef.current;
    const batch = 60;
    let newOutliers = 0;
    for (let i = 0; i < batch; i++) {
      const b = sampleBucket(phase);
      h[b] += 1;
      if (b >= BUCKETS - 6) newOutliers += 1;
    }
    totalRef.current += batch;

    const wobble = phase.iops * (1 + (Math.random() - 0.5) * phase.jitter);
    setIops(+(wobble * 1.18).toFixed(2)); // scaled so peaks read past 1.0M
    if (newOutliers) setOutliers((n) => n + newOutliers);
    setHist([...h]);
    setTotal(totalRef.current);
  }

  useEffect(() => {
    if (!running) {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      return;
    }
    const ms = reduce ? 360 : 140;
    timer.current = window.setInterval(tick, ms);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, reduce]);

  function reset() {
    histRef.current = emptyHist();
    totalRef.current = 0;
    tickRef.current = 0;
    setHist(emptyHist());
    setTotal(0);
    setPhaseIdx(0);
    setOutliers(0);
    setIops(1.0);
  }

  const maxCount = Math.max(1, ...hist);
  const pcts = useMemo(
    () => PCTS.map((p) => ({ ...p, b: percentileBucket(hist, total, p.frac) })),
    [hist, total]
  );
  const phase = PHASES[phaseIdx];
  const verdict = VERDICTS[phase.v];

  const p50 = pcts.find((p) => p.key === 'p50')!.b;
  const p999 = pcts.find((p) => p.key === 'p999')!.b;
  const driftRatio = p50 > 0 ? +(BUCKET_US(p999) / BUCKET_US(p50)).toFixed(1) : 1;

  return (
    <div className="demo" aria-label="storebench latency benchmark demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Tail latency, live</h3>
      <p className="demo__lede">
        Samples land in a log-bucketed HDR histogram while the run walks through
        phases. Percentile markers are read back from cumulative counts and
        slide along the tail; the verdict flips between stable, degrading,
        bursty, and tail-heavy as the shape changes.
      </p>

      <div className="stb__stage">
        <div className="stb__top">
          <div className="stb__iops">
            <div className="stb__iops-val">
              {iops.toFixed(2)}
              <span className="stb__iops-unit">M IOPS</span>
            </div>
            <div className="stb__iops-meta">per-second throughput</div>
          </div>
          <motion.div
            key={phase.v}
            className={`stb__verdict stb__verdict--${phase.v}`}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease }}
          >
            <div className="stb__verdict-badge">{verdict.label}</div>
            <div className="stb__verdict-note">{verdict.note}</div>
          </motion.div>
        </div>

        <div className="stb__chart" role="img" aria-label="latency histogram with percentile markers">
          <div className="stb__bars">
            {hist.map((c, b) => {
              const isP = pcts.some((p) => p.b === b);
              return (
                <div className="stb__col" key={b}>
                  <motion.div
                    className={`stb__bar${isP ? ' stb__bar--pct' : ''}`}
                    animate={{ height: `${(c / maxCount) * 100}%` }}
                    transition={{ duration: reduce ? 0 : 0.18, ease }}
                  />
                </div>
              );
            })}
          </div>
          <div className="stb__markers">
            {pcts.map((p) => {
              const left = (p.b / (BUCKETS - 1)) * 100;
              return (
                <motion.div
                  key={p.key}
                  className={`stb__marker stb__marker--${p.key}`}
                  animate={{ left: `${left}%` }}
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                >
                  <span className="stb__marker-tick" />
                  <span className="stb__marker-label">
                    {p.key}
                    <em>{BUCKET_US(p.b) >= 1000 ? `${(BUCKET_US(p.b) / 1000).toFixed(1)}ms` : `${BUCKET_US(p.b)}us`}</em>
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="stb__stats">
          <div className="stb__stat">
            <div className="stb__stat-val">{(total / 1000).toFixed(1)}k</div>
            <div className="stb__stat-unit">samples recorded</div>
          </div>
          <div className="stb__stat">
            <div className="stb__stat-val">{driftRatio}x</div>
            <div className="stb__stat-unit">drift ratio p999 / p50</div>
          </div>
          <div className="stb__stat">
            <div className="stb__stat-val">{outliers}</div>
            <div className="stb__stat-unit">tail outliers</div>
          </div>
          <div className="stb__stat">
            <div className="stb__stat-val">~8</div>
            <div className="stb__stat-unit">KB, 1024 counters</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause run' : 'Resume run'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          ~6% relative error across 9 orders of magnitude
        </span>
      </div>
    </div>
  );
}
