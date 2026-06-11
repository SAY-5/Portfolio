import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './Netlat-Analyser.css';

// Real model from the project. RTT is sampled per flow; an EWMA tracks the mean
// and deviation, and a sample is flagged anomalous when it lands more than 3
// standard deviations out, once at least 10 samples have been seen. Samples
// from retransmitted packets are discarded per Karn's algorithm. Retransmits
// are classified by cause.
const SIGMA = 3; // default deviation threshold
const MIN_SAMPLES = 10; // need a baseline before flagging

type Cause = 'fast' | 'rto' | 'tail' | 'spurious' | 'none';

type Sample = {
  rtt: number; // ms
  retransmit: Cause; // none if a clean ack
};

// Three flows with hand-built sample streams that exercise the detector:
// a steady flow, one with a fast-retransmit dip plus a clean spike, and one
// that goes into an RTO timeout with a long tail.
type Flow = { id: string; peer: string; samples: Sample[] };

const flows: Flow[] = [
  {
    id: 'flow-1',
    peer: '10.0.4.18:443',
    samples: [
      { rtt: 41, retransmit: 'none' },
      { rtt: 43, retransmit: 'none' },
      { rtt: 40, retransmit: 'none' },
      { rtt: 44, retransmit: 'none' },
      { rtt: 42, retransmit: 'none' },
      { rtt: 41, retransmit: 'none' },
      { rtt: 45, retransmit: 'none' },
      { rtt: 43, retransmit: 'none' },
      { rtt: 42, retransmit: 'none' },
      { rtt: 44, retransmit: 'none' },
      { rtt: 43, retransmit: 'none' },
      { rtt: 41, retransmit: 'none' },
    ],
  },
  {
    id: 'flow-2',
    peer: '10.0.7.91:8443',
    samples: [
      { rtt: 58, retransmit: 'none' },
      { rtt: 60, retransmit: 'none' },
      { rtt: 57, retransmit: 'none' },
      { rtt: 61, retransmit: 'none' },
      { rtt: 59, retransmit: 'none' },
      { rtt: 62, retransmit: 'none' },
      { rtt: 58, retransmit: 'none' },
      { rtt: 60, retransmit: 'fast' },
      { rtt: 59, retransmit: 'none' },
      { rtt: 61, retransmit: 'none' },
      { rtt: 138, retransmit: 'none' },
      { rtt: 64, retransmit: 'none' },
    ],
  },
  {
    id: 'flow-3',
    peer: '10.0.2.33:443',
    samples: [
      { rtt: 72, retransmit: 'none' },
      { rtt: 75, retransmit: 'none' },
      { rtt: 71, retransmit: 'none' },
      { rtt: 74, retransmit: 'none' },
      { rtt: 73, retransmit: 'none' },
      { rtt: 76, retransmit: 'none' },
      { rtt: 72, retransmit: 'none' },
      { rtt: 75, retransmit: 'none' },
      { rtt: 74, retransmit: 'none' },
      { rtt: 73, retransmit: 'none' },
      { rtt: 290, retransmit: 'rto' },
      { rtt: 281, retransmit: 'tail' },
    ],
  },
];

const causeLabel: Record<Cause, string> = {
  fast: 'fast retransmit',
  rto: 'timeout (RTO)',
  tail: 'tail loss',
  spurious: 'spurious (D-SACK)',
  none: '',
};

const W = 540;
const H = 96; // per-lane plot height
const PAD = 8;
const RTT_MAX = 320;

// Walk the EWMA exactly the way the analyzer does: discard retransmitted
// samples from the RTT estimate (Karn), update mean and deviation, and flag a
// kept sample as anomalous past SIGMA once MIN_SAMPLES are in.
function analyze(samples: Sample[], upto: number) {
  const alpha = 0.25;
  let mean = 0;
  let dev = 0;
  let kept = 0;
  const points: {
    rtt: number;
    anomaly: boolean;
    retransmit: Cause;
    counted: boolean;
  }[] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (i > upto) break;
    const counted = s.retransmit === 'none';
    let anomaly = false;
    if (counted) {
      if (kept === 0) {
        mean = s.rtt;
        dev = s.rtt * 0.08;
      } else {
        if (kept >= MIN_SAMPLES) {
          anomaly = Math.abs(s.rtt - mean) > SIGMA * dev;
        }
        const diff = Math.abs(s.rtt - mean);
        mean = alpha * s.rtt + (1 - alpha) * mean;
        dev = alpha * diff + (1 - alpha) * dev;
      }
      if (!anomaly) kept++;
    }
    points.push({ rtt: s.rtt, anomaly, retransmit: s.retransmit, counted });
  }
  return points;
}

function x(i: number, n: number) {
  return PAD + (i / (n - 1)) * (W - PAD * 2);
}
function y(rtt: number) {
  return H - PAD - (Math.min(rtt, RTT_MAX) / RTT_MAX) * (H - PAD * 2);
}

export default function NetlatDemo() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(flows[0].samples.length - 1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const total = flows[0].samples.length;

  function clear() {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(() => clear, []);

  function play() {
    if (playing) return;
    clear();
    setPlaying(true);
    setStep(0);
    if (reduce) {
      setStep(total - 1);
      setPlaying(false);
      return;
    }
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (s >= total - 1) {
          clear();
          setPlaying(false);
          return total - 1;
        }
        return s + 1;
      });
    }, 520);
  }

  const lanes = useMemo(
    () => flows.map((f) => ({ flow: f, pts: analyze(f.samples, step) })),
    [step],
  );

  const anomalyCount = lanes.reduce(
    (n, l) => n + l.pts.filter((p) => p.anomaly).length,
    0,
  );
  const retransCount = lanes.reduce(
    (n, l) => n + l.pts.filter((p) => p.retransmit !== 'none').length,
    0,
  );

  return (
    <div className="demo" aria-label="netlat TCP flow latency timeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">RTT timeline with anomaly flags</h3>
      <p className="demo__lede">
        Each lane is a TCP flow. Step through the capture and watch RTT plotted
        sample by sample. The EWMA detector flags a point red once it lands more
        than {SIGMA} standard deviations out, and only after {MIN_SAMPLES}{' '}
        samples set a baseline. Retransmitted samples are discarded from the RTT
        estimate per Karn and marked by cause.
      </p>

      <div className="nl__stage">
        <div className="nl__lanes">
          {lanes.map(({ flow, pts }) => {
            const path = pts
              .filter((p) => p.counted)
              .map((p, k, arr) => {
                const idx = pts.indexOf(p);
                return `${k === 0 ? 'M' : 'L'} ${x(idx, total).toFixed(1)} ${y(p.rtt).toFixed(1)}`;
              })
              .join(' ');
            const hasAnom = pts.some((p) => p.anomaly);
            return (
              <div
                className={`nl__lane ${hasAnom ? 'nl__lane--alert' : ''}`}
                key={flow.id}
              >
                <div className="nl__lane-head">
                  <span className="nl__lane-id">{flow.id}</span>
                  <span className="nl__lane-peer">{flow.peer}</span>
                </div>
                <svg
                  className="nl__plot"
                  viewBox={`0 0 ${W} ${H}`}
                  role="img"
                  aria-label={`${flow.id} round trip time over ${pts.length} samples`}
                >
                  <line
                    x1={PAD}
                    y1={H - PAD}
                    x2={W - PAD}
                    y2={H - PAD}
                    stroke="var(--line)"
                    strokeWidth={1}
                  />
                  <motion.path
                    d={path}
                    fill="none"
                    stroke={hasAnom ? 'var(--accent)' : '#4fd08a'}
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                  />
                  {pts.map((p, i) => {
                    if (p.retransmit !== 'none') {
                      return (
                        <g key={`r-${i}`}>
                          <rect
                            x={x(i, total) - 4}
                            y={y(p.rtt) - 4}
                            width={8}
                            height={8}
                            rx={1.5}
                            fill="var(--ink-900)"
                            stroke={causeColor(p.retransmit)}
                            strokeWidth={1.6}
                            transform={`rotate(45 ${x(i, total)} ${y(p.rtt)})`}
                          />
                        </g>
                      );
                    }
                    return (
                      <motion.circle
                        key={`p-${i}`}
                        cx={x(i, total)}
                        cy={y(p.rtt)}
                        r={p.anomaly ? 4.5 : 2.6}
                        fill={p.anomaly ? 'var(--accent)' : '#4fd08a'}
                        initial={false}
                        animate={
                          p.anomaly && !reduce
                            ? { scale: [1, 1.5, 1] }
                            : { scale: 1 }
                        }
                        transition={{ duration: 0.5 }}
                      />
                    );
                  })}
                </svg>
              </div>
            );
          })}
        </div>

        <div className="nl__readout">
          <div className="nl__stat">
            <span className="nl__stat-val">{step + 1}</span>
            <span className="nl__stat-unit">/ {total} samples</span>
          </div>
          <div className="nl__stat">
            <span className="nl__stat-val nl__stat-val--alert">
              {anomalyCount}
            </span>
            <span className="nl__stat-unit">EWMA spikes</span>
          </div>
          <div className="nl__stat">
            <span className="nl__stat-val">{retransCount}</span>
            <span className="nl__stat-unit">retransmits</span>
          </div>
        </div>

        <div className="nl__legend">
          {(['fast', 'rto', 'tail', 'spurious'] as Cause[]).map((c) => (
            <span className="nl__legend-item" key={c}>
              <span
                className="nl__legend-swatch"
                style={{ borderColor: causeColor(c) }}
              />
              {causeLabel[c]}
            </span>
          ))}
        </div>

        <AnimatePresence>
          {!playing && step === total - 1 && (
            <motion.div
              className="nl__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <span className="nl__verdict-head">{anomalyCount} spikes flagged</span>
              <span className="nl__verdict-text">
                flow-3 timed out into an RTO with a tail-loss follow-on, and
                flow-2 spiked after a fast retransmit. The same single-pass
                pipeline streams real captures with a 100k-flow cap and idle
                eviction, exporting these as Prometheus metrics.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={playing}>
          {playing ? 'Replaying…' : 'Replay capture'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            clear();
            setPlaying(false);
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={playing || step === 0}
        >
          Step back
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            clear();
            setPlaying(false);
            setStep((s) => Math.min(total - 1, s + 1));
          }}
          disabled={playing || step === total - 1}
        >
          Step
        </button>
        <span className="demo__hint">3 flows, {SIGMA} sigma threshold</span>
      </div>
    </div>
  );
}

function causeColor(c: Cause): string {
  switch (c) {
    case 'fast':
      return '#4fb0d0';
    case 'rto':
      return '#ff5b29';
    case 'tail':
      return '#e0a23a';
    case 'spurious':
      return '#9a7fe0';
    default:
      return 'var(--line)';
  }
}
