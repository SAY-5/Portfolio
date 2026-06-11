import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './sensorsim.css';

// Real numbers from the project. A C core models sensor drift, Gaussian noise,
// and ADC quantization, plus four fault-injection patterns: stuck-at, periodic
// spike, dropped samples, and range clamp. Per-sample latency on M-series is
// about 80 ns. An xorshift PRNG seeded from rdtsc / cntvct drives the noise.

const ease = [0.22, 1, 0.36, 1] as const;

const N = 96; // samples drawn across the trace
const W = 540;
const H = 200;
const MID = H / 2;
const AMP = 56; // ground-truth amplitude in svg units

type Faults = {
  stuck: boolean;
  spike: boolean;
  drop: boolean;
  clamp: boolean;
};

type Stages = {
  drift: boolean;
  noise: boolean;
  quant: boolean;
};

// xorshift32: the same PRNG family the C core seeds from a hardware counter.
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

// Deterministic per-index pseudo-noise so the trace is stable across renders
// (no Math.random, so server render and client render agree).
function noiseAt(i: number) {
  const r = makeRng(0x9e3779b1 ^ (i * 2654435761));
  // approximate a Gaussian by averaging a few uniforms
  return (r() + r() + r() + r() - 2) / 2;
}

function buildSamples(stages: Stages, faults: Faults) {
  const out: { v: number; dropped: boolean }[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    let v = Math.sin(t * Math.PI * 4) * AMP; // clean ground truth
    if (stages.drift) v += (t - 0.5) * 46; // slow linear drift
    if (stages.noise) v += noiseAt(i) * 16; // Gaussian-ish noise
    if (stages.quant) v = Math.round(v / 12) * 12; // ADC quantization steps

    let dropped = false;
    if (faults.stuck && i >= 40 && i < 58) v = Math.sin((40 / N) * Math.PI * 4) * AMP; // stuck-at
    if (faults.spike && i % 19 === 0 && i > 0) v += i % 38 === 0 ? 78 : -78; // periodic spike
    if (faults.drop && i % 11 === 5) dropped = true; // dropped samples
    if (faults.clamp) v = Math.max(-34, Math.min(34, v)); // range clamp

    out.push({ v, dropped });
  }
  return out;
}

function toPath(samples: { v: number; dropped: boolean }[]) {
  let d = '';
  let started = false;
  samples.forEach((s, i) => {
    if (s.dropped) {
      started = false;
      return;
    }
    const x = (i / (N - 1)) * W;
    const y = MID - s.v;
    d += `${started ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    started = true;
  });
  return d.trim();
}

const FAULT_DEFS: { key: keyof Faults; name: string; note: string }[] = [
  { key: 'stuck', name: 'stuck-at', note: 'output frozen at one value' },
  { key: 'spike', name: 'periodic spike', note: 'recurring out-of-band jumps' },
  { key: 'drop', name: 'dropped samples', note: 'gaps in the sample stream' },
  { key: 'clamp', name: 'range clamp', note: 'signal pinned to a band' },
];

const STAGE_DEFS: { key: keyof Stages; name: string }[] = [
  { key: 'drift', name: 'drift' },
  { key: 'noise', name: 'noise' },
  { key: 'quant', name: 'adc quantize' },
];

export default function SensorsimDemo() {
  const reduce = useReducedMotion();
  const [stages, setStages] = useState<Stages>({ drift: true, noise: true, quant: true });
  const [faults, setFaults] = useState<Faults>({
    stuck: false,
    spike: false,
    drop: false,
    clamp: false,
  });
  const [sweep, setSweep] = useState(0); // 0..1 animated playhead
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef<number | null>(null);

  const clean = buildSamples({ drift: false, noise: false, quant: false }, {
    stuck: false,
    spike: false,
    drop: false,
    clamp: false,
  });
  const samples = buildSamples(stages, faults);
  const cleanPath = toPath(clean);
  const outPath = toPath(samples);
  const dropMarks = samples
    .map((s, i) => (s.dropped ? i : -1))
    .filter((i) => i >= 0);

  // Animated sweep playhead. Lives in useEffect so it never runs during SSR.
  useEffect(() => {
    if (reduce || !playing) {
      return;
    }
    let start: number | null = null;
    const dur = 2600;
    const tick = (now: number) => {
      if (start === null) start = now;
      const p = ((now - start) % dur) / dur;
      setSweep(p);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [reduce, playing]);

  const activeFaults = FAULT_DEFS.filter((f) => faults[f.key]);
  const activeStages = STAGE_DEFS.filter((s) => stages[s.key]).length;
  // When the sweep is not animating the playhead rests at the end of the trace.
  const effectiveSweep = reduce || !playing ? 1 : sweep;
  const playX = effectiveSweep * W;

  function toggleFault(k: keyof Faults) {
    setFaults((f) => ({ ...f, [k]: !f[k] }));
  }
  function toggleStage(k: keyof Stages) {
    setStages((s) => ({ ...s, [k]: !s[k] }));
  }

  return (
    <div className="demo" aria-label="sensorsim signal pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Drive a software sensor</h3>
      <p className="demo__lede">
        A clean ground-truth waveform passes through drift, noise, and ADC
        quantization. Toggle the pipeline stages or inject one of four fault
        patterns and watch the output sample stream distort against the
        reference trace.
      </p>

      <div className="ss__scope">
        <svg
          className="ss__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="sensor output waveform against the clean reference"
        >
          <line key="axis" x1="0" y1={MID} x2={W} y2={MID} className="ss__axis" />
          {/* clean ground truth reference */}
          <path key="clean" d={cleanPath} className="ss__clean" fill="none" />
          {/* dropped-sample gap markers */}
          {dropMarks.map((i) => {
            const x = (i / (N - 1)) * W;
            return <line key={`drop-${i}`} x1={x} y1={MID - 64} x2={x} y2={MID + 64} className="ss__drop" />;
          })}
          {/* live output trace */}
          <motion.path
            key="out"
            d={outPath}
            className="ss__out"
            fill="none"
            initial={false}
            animate={{ opacity: 1, d: outPath }}
            transition={{ duration: reduce ? 0 : 0.35, ease }}
          />
          {/* sweep playhead */}
          {!reduce && playing && (
            <line key="play" x1={playX} y1={0} x2={playX} y2={H} className="ss__play" />
          )}
        </svg>
        <div className="ss__legend">
          <span className="ss__legend-item ss__legend-item--clean">ground truth</span>
          <span className="ss__legend-item ss__legend-item--out">sensor output</span>
          <span className="ss__latency">~80 ns / sample on M-series</span>
        </div>
      </div>

      <div className="ss__panels">
        <fieldset className="ss__panel">
          <legend className="ss__panel-title">pipeline stages</legend>
          <div className="ss__toggles">
            {STAGE_DEFS.map((s) => (
              <button
                key={s.key}
                className={'ss__toggle' + (stages[s.key] ? ' ss__toggle--on' : '')}
                onClick={() => toggleStage(s.key)}
                aria-pressed={stages[s.key]}
              >
                <span className="ss__toggle-dot" aria-hidden="true" />
                {s.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="ss__panel">
          <legend className="ss__panel-title">fault injection</legend>
          <div className="ss__toggles">
            {FAULT_DEFS.map((f) => (
              <button
                key={f.key}
                className={'ss__toggle ss__toggle--fault' + (faults[f.key] ? ' ss__toggle--on' : '')}
                onClick={() => toggleFault(f.key)}
                aria-pressed={faults[f.key]}
                title={f.note}
              >
                <span className="ss__toggle-dot" aria-hidden="true" />
                {f.name}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <AnimatePresence>
        {activeFaults.length > 0 && (
          <motion.div
            key="verdict"
            className="ss__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            <span className="ss__verdict-head">
              {activeFaults.length} fault{activeFaults.length > 1 ? 's' : ''} injected
            </span>
            <span className="ss__verdict-text">
              {activeFaults.map((f) => f.name).join(', ')} active over {activeStages} pipeline
              stage{activeStages === 1 ? '' : 's'}. The xorshift PRNG is seeded from a hardware
              counter, so a golden trace replays identically in CI to catch behavioral drift, run
              under 20 tests on both clang and gcc.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
        >
          {playing ? 'Pause sweep' : 'Play sweep'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() =>
            setFaults({ stuck: false, spike: false, drop: false, clamp: false })
          }
        >
          Clear faults
        </button>
        <span className="demo__hint">
          {activeStages} stage{activeStages === 1 ? '' : 's'}, {activeFaults.length} fault
          {activeFaults.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
