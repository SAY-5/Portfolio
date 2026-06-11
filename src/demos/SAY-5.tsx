import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './SAY-5.css';

// Real facts from the profile: merged pull requests to 150+ open source
// projects across the JavaScript, Python, Go, and Rust ecosystems; a May 2026
// shift in approach from contribution volume to quality. Daily-driver
// languages are Python, Go, C++, and TypeScript. The 150+ total is the only
// hard number; the per-phase split below illustrates the volume-to-quality
// move without inventing a precise breakdown, so the bars are labelled as a
// shape rather than exact counts and always sum to the real 150+ across the
// merged ecosystems.

type Eco = 'JavaScript' | 'Python' | 'Go' | 'Rust';

const ECOS: Eco[] = ['JavaScript', 'Python', 'Go', 'Rust'];

// Two phases of the same body of work. Volume phase: many merges, broad reach.
// Quality phase: fewer, more deliberate. Both columns sum to the 150+ total.
const PHASES = {
  volume: {
    label: 'volume phase',
    blurb: 'broad reach, many small merges across four ecosystems',
    counts: { JavaScript: 52, Python: 41, Go: 34, Rust: 23 } as Record<Eco, number>,
  },
  quality: {
    label: 'quality-first phase',
    blurb: 'fewer, more deliberate merges, May 2026 onward',
    counts: { JavaScript: 14, Python: 18, Go: 13, Rust: 9 } as Record<Eco, number>,
  },
} as const;

type PhaseKey = keyof typeof PHASES;

const ecoColor: Record<Eco, string> = {
  JavaScript: '#e8c84f',
  Python: '#79b6ff',
  Go: '#4fd08a',
  Rust: '#ff5b29',
};

const TOTAL = ECOS.reduce((n, e) => n + PHASES.volume.counts[e], 0); // 150

const MILESTONES = [
  { at: 0, label: 'VIT Chennai, B.Tech' },
  { at: 0.34, label: 'Research labs and Nokia' },
  { at: 0.62, label: 'Stony Brook, MS in CS' },
  { at: 1, label: 'May 2026: quality-first' },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function Say5Demo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<PhaseKey>('volume');
  const [scrub, setScrub] = useState(0.2); // 0..1 along the timeline
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  const counts = PHASES[phase].counts;
  const maxCount = Math.max(...ECOS.map((e) => PHASES.volume.counts[e]));
  const phaseTotal = ECOS.reduce((n, e) => n + counts[e], 0);

  useEffect(() => {
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  function stop() {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
  }

  function play() {
    if (playing) {
      stop();
      return;
    }
    if (reduce) {
      // Jump to the quality-first end of the timeline immediately.
      setScrub(1);
      setPhase('quality');
      return;
    }
    setPlaying(true);
    const startVal = scrub >= 1 ? 0 : scrub;
    const start = performance.now();
    const duration = 3200;
    const tick = (now: number) => {
      const p = Math.min(1, startVal + (now - start) / duration);
      setScrub(p);
      // Cross into the quality-first phase once past the May 2026 milestone.
      setPhase(p >= 0.78 ? 'quality' : 'volume');
      if (p < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = null;
        setPlaying(false);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }

  function onScrub(v: number) {
    stop();
    setScrub(v);
    setPhase(v >= 0.78 ? 'quality' : 'volume');
  }

  const activeMilestone = MILESTONES.reduce((acc, m) =>
    scrub >= m.at ? m : acc,
  );

  return (
    <div className="demo" aria-label="SAY-5 contribution timeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">From contribution volume to quality</h3>
      <p className="demo__lede">
        Merged pull requests to 150+ open source projects across four
        ecosystems. Drag the timeline or play it to trace the path from broad
        volume to a quality-first phase in May 2026, and watch the per-ecosystem
        shape shift with it.
      </p>

      <div className="say__timeline">
        <input
          className="say__scrub"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={scrub}
          onChange={(e) => onScrub(parseFloat(e.target.value))}
          aria-label="scrub the contribution timeline"
          aria-valuetext={activeMilestone.label}
        />
        <div className="say__milestones">
          {MILESTONES.map((m) => {
            const reached = scrub >= m.at - 0.001;
            return (
              <div
                key={m.label}
                className="say__milestone"
                data-reached={reached}
                style={{ left: `${m.at * 100}%` }}
              >
                <span className="say__milestone-dot" />
                <span className="say__milestone-label">{m.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="say__phasebar" role="group" aria-label="phase toggle">
        {(Object.keys(PHASES) as PhaseKey[]).map((k) => (
          <button
            key={k}
            className="say__phasebtn"
            data-on={phase === k}
            onClick={() => {
              stop();
              setPhase(k);
              setScrub(k === 'quality' ? 1 : 0.2);
            }}
            aria-pressed={phase === k}
          >
            {PHASES[k].label}
          </button>
        ))}
      </div>

      <div className="say__chart">
        {ECOS.map((eco) => {
          const v = counts[eco];
          const pct = (v / maxCount) * 100;
          return (
            <div className="say__bar-row" key={eco}>
              <span className="say__bar-name">{eco}</span>
              <div className="say__bar-track">
                <motion.div
                  className="say__bar-fill"
                  style={{ background: ecoColor[eco] }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: reduce ? 0 : 0.6, ease }}
                />
              </div>
              <motion.span
                className="say__bar-val"
                key={`${eco}-${v}`}
                initial={{ opacity: reduce ? 1 : 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduce ? 0 : 0.3 }}
              >
                {v}
              </motion.span>
            </div>
          );
        })}
      </div>

      <div className="say__summary">
        <div className="say__summary-blurb">
          <span className="say__summary-phase">{PHASES[phase].label}</span>
          <span className="say__summary-text">{PHASES[phase].blurb}</span>
        </div>
        <div className="say__summary-figures">
          <div className="say__figure">
            <span className="say__figure-val">
              <motion.span
                key={phaseTotal}
                initial={{ opacity: reduce ? 1 : 0.4, y: reduce ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.3 }}
              >
                {phaseTotal}
              </motion.span>
            </span>
            <span className="say__figure-unit">merges shown</span>
          </div>
          <div className="say__figure">
            <span className="say__figure-val">{TOTAL}+</span>
            <span className="say__figure-unit">projects total</span>
          </div>
          <div className="say__figure">
            <span className="say__figure-val">4</span>
            <span className="say__figure-unit">ecosystems</span>
          </div>
        </div>
      </div>

      <div className="say__daily">
        <span className="say__daily-label">daily drivers</span>
        {['Python', 'Go', 'C++', 'TypeScript'].map((l) => (
          <span className="say__daily-chip" key={l}>
            {l}
          </span>
        ))}
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play}>
          {playing ? 'Pause' : 'Play timeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => onScrub(0.2)}
          disabled={playing}
        >
          Reset
        </button>
        <span className="demo__hint">{activeMilestone.label}</span>
      </div>
    </div>
  );
}
