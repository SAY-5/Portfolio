import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './devops-pipeline.css';

// Real project facts from the most recent green run: lint, typecheck, and unit
// tests (47 across 5 suites) run in parallel with a coverage gate, then a
// Cypress e2e matrix across Chrome/Firefox/Edge plus a cypress-axe a11y stage,
// then a Docker build, then a single staging deploy gated on every job. The
// same shape is committed as a GitHub Actions workflow and an Azure DevOps
// mirror.
const COVERAGE = {
  lines: 100,
  statements: 100,
  functions: 100,
  branches: 89.47,
};
const BRANCH_GATE = 80; // the branches coverage gate the run clears

type JobId =
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'e2e'
  | 'a11y'
  | 'docker'
  | 'deploy';

type Job = {
  id: JobId;
  label: string;
  sub: string;
  x: number;
  y: number;
  deps: JobId[];
};

const W = 560;
const H = 260;
const BW = 116;
const BH = 44;

const jobs: Job[] = [
  { id: 'lint', label: 'lint', sub: 'eslint', x: 20, y: 24, deps: [] },
  { id: 'typecheck', label: 'typecheck', sub: 'tsc', x: 20, y: 108, deps: [] },
  { id: 'test', label: 'test', sub: '47 jest', x: 20, y: 192, deps: [] },
  {
    id: 'e2e',
    label: 'e2e matrix',
    sub: '10 cypress',
    x: 224,
    y: 66,
    deps: ['lint', 'typecheck', 'test'],
  },
  {
    id: 'a11y',
    label: 'a11y',
    sub: 'cypress-axe',
    x: 224,
    y: 150,
    deps: ['lint', 'typecheck', 'test'],
  },
  {
    id: 'docker',
    label: 'docker build',
    sub: 'image',
    x: 424,
    y: 66,
    deps: ['e2e', 'a11y'],
  },
  {
    id: 'deploy',
    label: 'deploy',
    sub: 'staging',
    x: 424,
    y: 150,
    deps: ['docker'],
  },
];

// Topological run order in stages so the animation fans out then converges.
const ORDER: JobId[] = [
  'lint',
  'typecheck',
  'test',
  'e2e',
  'a11y',
  'docker',
  'deploy',
];

const BROWSERS = ['Chrome', 'Firefox', 'Edge'];
const ease = [0.22, 1, 0.36, 1] as const;

function center(j: Job) {
  return { cx: j.x + BW / 2, cy: j.y + BH / 2 };
}

export default function DevopsPipelineDemo() {
  const reduce = useReducedMotion();
  const [variant, setVariant] = useState<'gha' | 'azure'>('gha');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Set<JobId>>(new Set());
  const [activeIdx, setActiveIdx] = useState(-1);
  const [coverage, setCoverage] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  function clearTimers() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    rafRef.current = null;
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setDone(new Set());
    setActiveIdx(-1);
    setCoverage(0);
  }

  function animateCoverage() {
    const target = COVERAGE.branches;
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setCoverage(+(target * eased).toFixed(2));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setCoverage(target);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function run() {
    if (running) return;
    reset();
    setRunning(true);

    if (reduce) {
      setDone(new Set(ORDER));
      setActiveIdx(ORDER.length - 1);
      setCoverage(COVERAGE.branches);
      setRunning(false);
      return;
    }

    let i = 0;
    const advance = () => {
      if (i >= ORDER.length) {
        setRunning(false);
        timerRef.current = null;
        return;
      }
      const id = ORDER[i];
      setActiveIdx(i);
      if (id === 'test') animateCoverage();
      // mark complete after a beat, then move on
      timerRef.current = setTimeout(() => {
        setDone((d) => new Set(d).add(id));
        i += 1;
        advance();
      }, 620);
    };
    advance();
  }

  const deployDone = done.has('deploy');
  const e2eRunningOrDone =
    done.has('e2e') || ORDER[activeIdx] === 'e2e' || activeIdx > ORDER.indexOf('e2e');

  function jobState(id: JobId): 'idle' | 'running' | 'done' {
    if (done.has(id)) return 'done';
    if (activeIdx >= 0 && ORDER[activeIdx] === id) return 'running';
    return 'idle';
  }

  function edgeOn(from: JobId, to: JobId) {
    // edge is lit once the source job is done and target is running or done
    return done.has(from) && (done.has(to) || ORDER[activeIdx] === to);
  }

  return (
    <div className="demo" aria-label="devops-pipeline CI/CD DAG demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Push a commit through the pipeline</h3>
      <p className="demo__lede">
        Lint, typecheck, and unit tests run in parallel with a coverage gate,
        fan into the Cypress browser matrix and a cypress-axe a11y stage, then
        a Docker build, then one staging deploy gated on every preceding job.
        The same shape ships as a GitHub Actions workflow and an Azure DevOps
        mirror.
      </p>

      <div
        className="dp__toggle"
        role="tablist"
        aria-label="pipeline expression"
      >
        <button
          role="tab"
          aria-selected={variant === 'gha'}
          className={`dp__toggle-btn ${variant === 'gha' ? 'dp__toggle-btn--on' : ''}`}
          onClick={() => setVariant('gha')}
        >
          GitHub Actions
        </button>
        <button
          role="tab"
          aria-selected={variant === 'azure'}
          className={`dp__toggle-btn ${variant === 'azure' ? 'dp__toggle-btn--on' : ''}`}
          onClick={() => setVariant('azure')}
        >
          Azure DevOps
        </button>
      </div>

      <div className="dp__stage">
        <div className="dp__dagwrap">
          <svg
            className="dp__dag"
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            aria-label={`pipeline graph, ${variant === 'gha' ? 'GitHub Actions' : 'Azure DevOps'} expression`}
          >
            <defs>
              <marker
                id="dp-arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
              </marker>
            </defs>

            {/* edges */}
            {jobs.flatMap((j) =>
              j.deps.map((dep) => {
                const src = jobs.find((x) => x.id === dep)!;
                const a = center(src);
                const b = center(j);
                const on = edgeOn(dep, j.id);
                const x1 = src.x + BW;
                const y1 = a.cy;
                const x2 = j.x;
                const y2 = b.cy;
                const mx = (x1 + x2) / 2;
                return (
                  <motion.path
                    key={`${dep}-${j.id}`}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 4} ${y2}`}
                    fill="none"
                    stroke={on ? 'var(--accent)' : 'var(--line)'}
                    strokeWidth={on ? 1.8 : 1.2}
                    markerEnd={on ? 'url(#dp-arrow)' : undefined}
                    initial={false}
                    animate={{ opacity: on ? 1 : 0.5 }}
                    transition={{ duration: 0.3 }}
                  />
                );
              }),
            )}

            {/* nodes */}
            {jobs.map((j) => {
              const st = jobState(j.id);
              const stroke =
                st === 'done'
                  ? '#4fd08a'
                  : st === 'running'
                    ? 'var(--accent)'
                    : 'var(--line)';
              const fill =
                st === 'running' ? 'var(--accent-glow)' : 'var(--ink-800)';
              return (
                <g key={j.id} className="dp__job">
                  <motion.rect
                    x={j.x}
                    y={j.y}
                    width={BW}
                    height={BH}
                    rx={9}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={st === 'idle' ? 1 : 2}
                    animate={
                      st === 'running' && !reduce
                        ? { scale: [1, 1.04, 1] }
                        : { scale: 1 }
                    }
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    transition={{
                      duration: 0.6,
                      repeat: st === 'running' && !reduce ? Infinity : 0,
                    }}
                  />
                  <text
                    x={j.x + BW / 2}
                    y={j.y + 19}
                    textAnchor="middle"
                    className="dp__job-label"
                  >
                    {j.label}
                  </text>
                  <text
                    x={j.x + BW / 2}
                    y={j.y + 33}
                    textAnchor="middle"
                    className="dp__job-sub"
                  >
                    {st === 'done' ? 'passed' : j.sub}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="dp__grid">
          <div className="dp__panel dp__panel--gate">
            <div className="dp__panel-head">
              <span>Coverage gate</span>
              <span className="dp__gate-val">{coverage.toFixed(2)}%</span>
            </div>
            <div className="dp__bar">
              <motion.div
                className="dp__bar-fill"
                animate={{ width: `${coverage}%` }}
                transition={{ duration: reduce ? 0 : 0.2, ease }}
              />
              <div
                className="dp__bar-gateline"
                style={{ left: `${BRANCH_GATE}%` }}
                aria-hidden
              />
            </div>
            <div className="dp__bar-meta">
              <span>branches</span>
              <span>
                gate <b>{BRANCH_GATE}%</b>
              </span>
            </div>
            <div className="dp__covgrid">
              <div className="dp__cov">
                <div className="dp__cov-val">{COVERAGE.lines}%</div>
                <div className="dp__cov-name">lines 99/99</div>
              </div>
              <div className="dp__cov">
                <div className="dp__cov-val">{COVERAGE.statements}%</div>
                <div className="dp__cov-name">statements</div>
              </div>
              <div className="dp__cov">
                <div className="dp__cov-val">{COVERAGE.functions}%</div>
                <div className="dp__cov-name">functions</div>
              </div>
              <div className="dp__cov">
                <div className="dp__cov-val">89.47%</div>
                <div className="dp__cov-name">branches 17/19</div>
              </div>
            </div>
          </div>

          <div className="dp__panel">
            <div className="dp__panel-head">
              <span>Browser matrix and deploy</span>
            </div>
            <div className="dp__matrix">
              {BROWSERS.map((b) => (
                <span
                  key={b}
                  className="dp__browser"
                  data-on={e2eRunningOrDone}
                >
                  <span className="dp__browser-dot" />
                  {b}
                </span>
              ))}
            </div>
            <div className="dp__deploy" style={{ marginTop: 16 }}>
              <span className="dp__deploy-state" data-on={deployDone}>
                {deployDone ? 'staging deployed' : 'staging locked'}
              </span>
              <span className="dp__deploy-text">
                {deployDone
                  ? 'Every preceding job passed, so the single staging deploy unlocked.'
                  : 'The deploy stays gated until lint, typecheck, tests, the browser matrix, the a11y stage, and the Docker build all pass.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running...' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {variant === 'gha' ? 'github actions' : 'azure devops'} mirror, 7 jobs
        </span>
      </div>
    </div>
  );
}
