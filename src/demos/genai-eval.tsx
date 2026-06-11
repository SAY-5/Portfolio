import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './genai-eval.css';

// Real numbers from the project:
// - 5 task types x 3 languages, a 30-example matrix runs every push against a
//   deterministic FakeProvider; pass rates must match the committed baseline
//   within 1e-6.
// - Committed FakeProvider baseline: overall pass rate 66.7% over n=39.
// - Regression-flag heuristic: flag any (model, task, language) run whose pass
//   rate drops more than 5 points below the rolling 7-run mean.

const TASKS = ['summarize', 'classify', 'extract', 'translate', 'qa'] as const;
const LANGS = ['en', 'ja', 'es'] as const;
const REGRESSION_DROP = 5; // points below the rolling 7-run mean
const WINDOW = 7;

type Task = (typeof TASKS)[number];
type Lang = (typeof LANGS)[number];

// A deterministic synthetic run history: 12 runs. Each run holds a pass rate
// per (task, language) cell. The mean of run 0 lands near the committed 66.7%
// baseline. A scripted drop on (translate, ja) at run 8 trips the flag.
function buildHistory(): number[][][] {
  // base[task][lang] seed pass rates (percent)
  const base: Record<Task, Record<Lang, number>> = {
    summarize: { en: 82, ja: 71, es: 78 },
    classify: { en: 91, ja: 80, es: 85 },
    extract: { en: 64, ja: 55, es: 60 },
    translate: { en: 70, ja: 68, es: 74 },
    qa: { en: 58, ja: 47, es: 52 },
  };
  const runs: number[][][] = [];
  for (let r = 0; r < 12; r++) {
    const grid: number[][] = [];
    for (let ti = 0; ti < TASKS.length; ti++) {
      const row: number[] = [];
      for (let li = 0; li < LANGS.length; li++) {
        const t = TASKS[ti];
        const l = LANGS[li];
        // small deterministic wobble so the trend line breathes
        const wobble = Math.round(3 * Math.sin(r * 1.3 + ti * 0.7 + li * 1.1));
        let v = base[t][l] + wobble;
        // scripted regression: translate/ja falls off a cliff from run 8
        if (t === 'translate' && l === 'ja' && r >= 8) {
          v = base[t][l] - 14 + (r - 8);
        }
        row.push(Math.max(0, Math.min(100, v)));
      }
      grid.push(row);
    }
    runs.push(grid);
  }
  return runs;
}

const HISTORY = buildHistory();

function overall(grid: number[][]): number {
  let sum = 0;
  let n = 0;
  for (const row of grid) for (const v of row) { sum += v; n += 1; }
  return sum / n;
}

// rolling 7-run mean for a cell up to (and excluding) run index r
function rollingMean(task: number, lang: number, r: number): number | null {
  const lo = Math.max(0, r - WINDOW);
  if (r - lo < 2) return null; // need some history before flagging
  let sum = 0;
  for (let i = lo; i < r; i++) sum += HISTORY[i][task][lang];
  return sum / (r - lo);
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function GenaiEvalDemo() {
  const reduce = useReducedMotion();
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const grid = HISTORY[run];

  // which cells are flagged at this run: dropped > 5 pts below rolling mean
  const flags = useMemo(() => {
    const f: boolean[][] = [];
    for (let t = 0; t < TASKS.length; t++) {
      const row: boolean[] = [];
      for (let l = 0; l < LANGS.length; l++) {
        const mean = rollingMean(t, l, run);
        row.push(mean !== null && grid[t][l] < mean - REGRESSION_DROP);
      }
      f.push(row);
    }
    return f;
  }, [run, grid]);

  const flaggedCount = flags.flat().filter(Boolean).length;
  const overallNow = overall(grid);

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function play() {
    if (playing) { stop(); return; }
    if (reduce) { setRun(HISTORY.length - 1); return; }
    setPlaying(true);
    if (run >= HISTORY.length - 1) setRun(0);
    timer.current = setInterval(() => {
      setRun((r) => {
        if (r >= HISTORY.length - 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          setPlaying(false);
          return r;
        }
        return r + 1;
      });
    }, 700);
  }

  // sparkline points for the overall pass rate up to current run
  const spark = useMemo(() => {
    const w = 100;
    const h = 36;
    const pts = HISTORY.map((g, i) => {
      const x = (i / (HISTORY.length - 1)) * w;
      const y = h - (overall(g) / 100) * h;
      return { x, y, i };
    });
    return { w, h, pts };
  }, []);

  const sparkPath = spark.pts.slice(0, run + 1)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  return (
    <div className="demo" aria-label="genai-eval pass-rate grid demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Replay the eval matrix</h3>
      <p className="demo__lede">
        Five task types by three languages run against a deterministic provider,
        with pass rates pinned to a committed baseline within 1e-6. Drag the run
        slider or press play to replay history. When a cell drops more than five
        points below its rolling 7-run mean, the regression flag trips.
      </p>

      <div className="ge__top">
        <div className="ge__stat">
          <span className="ge__stat-label">overall pass rate</span>
          <span className="ge__stat-val">{overallNow.toFixed(1)}%</span>
          <span className="ge__stat-sub">run {run + 1} of {HISTORY.length}</span>
        </div>
        <div className="ge__trend" aria-label="overall pass-rate trend">
          <svg viewBox={`0 0 ${spark.w} ${spark.h}`} className="ge__spark" preserveAspectRatio="none">
            <line x1="0" y1={spark.h - (66.7 / 100) * spark.h} x2={spark.w} y2={spark.h - (66.7 / 100) * spark.h} className="ge__baseline" />
            <motion.path
              d={sparkPath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
              initial={false}
            />
            {run < HISTORY.length && (
              <circle
                cx={spark.pts[run].x}
                cy={spark.pts[run].y}
                r="2.4"
                fill="var(--accent-soft)"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <span className="ge__trend-note">baseline 66.7% over n=39</span>
        </div>
        <div className={`ge__flagcount${flaggedCount ? ' ge__flagcount--on' : ''}`}>
          <span className="ge__flagcount-n">{flaggedCount}</span>
          <span className="ge__flagcount-label">
            {flaggedCount === 1 ? 'cell flagged' : 'cells flagged'}
          </span>
        </div>
      </div>

      <div className="ge__grid-wrap">
        <div className="ge__grid" role="table" aria-label="pass-rate grid by task and language">
          <div className="ge__grow ge__grow--head" role="row">
            <span className="ge__corner" role="columnheader" />
            {LANGS.map((l) => (
              <span key={l} className="ge__colhead" role="columnheader">{l}</span>
            ))}
          </div>
          {TASKS.map((t, ti) => (
            <div key={t} className="ge__grow" role="row">
              <span className="ge__rowhead" role="rowheader">{t}</span>
              {LANGS.map((l, li) => {
                const v = grid[ti][li];
                const flagged = flags[ti][li];
                const hue = v / 100; // 0..1, drives green vs red blend
                return (
                  <motion.span
                    key={l}
                    role="cell"
                    className={`ge__cell${flagged ? ' ge__cell--flag' : ''}`}
                    style={{
                      // green at high pass, red at low; flagged cells override
                      background: flagged
                        ? 'var(--accent)'
                        : `rgba(${Math.round(255 - hue * 176)}, ${Math.round(79 + hue * 129)}, ${Math.round(41 + hue * 97)}, ${0.18 + hue * 0.32})`,
                    }}
                    animate={{ scale: flagged && !reduce ? [1, 1.06, 1] : 1 }}
                    transition={{ duration: reduce ? 0 : 0.5, ease }}
                    aria-label={`${t} ${l}: ${v.toFixed(0)} percent${flagged ? ', regression flagged' : ''}`}
                  >
                    <span className="ge__cell-v">{v.toFixed(0)}</span>
                    {flagged && <span className="ge__cell-flag" aria-hidden="true">drop</span>}
                  </motion.span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="ge__slider-row">
        <label htmlFor="ge-run" className="ge__slider-label">
          run history
          <b>{run + 1} / {HISTORY.length}</b>
        </label>
        <input
          id="ge-run"
          className="ge__slider"
          type="range"
          min={0}
          max={HISTORY.length - 1}
          value={run}
          onChange={(e) => { stop(); setRun(Number(e.target.value)); }}
          aria-valuetext={`run ${run + 1} of ${HISTORY.length}`}
        />
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play}>
          {playing ? 'Pause' : 'Play history'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => { stop(); setRun(0); }}
        >
          Reset
        </button>
        <span className="demo__hint">
          flag fires below rolling 7-run mean minus {REGRESSION_DROP} points
        </span>
      </div>
    </div>
  );
}
