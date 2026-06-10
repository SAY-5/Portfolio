import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';

// Real numbers from the project: find-references p95 went from 915.3ms on an
// N+1 baseline to 17.6ms with a covering index on refs(symbol_id, file_id)
// and a single join, over roughly 10M reference rows.
const BASELINE_MS = 915.3;
const INDEXED_MS = 17.6;
const SPEEDUP = Math.round(BASELINE_MS / INDEXED_MS); // 52

type Sym = { id: string; label: string; sub: string; x: number; y: number };
type FileNode = { id: string; label: string; x: number; y: number };

const symbols: Sym[] = [
  { id: 's1', label: 'parseConfig', sub: 'config.go', x: 90, y: 70 },
  { id: 's2', label: 'Server.Start', sub: 'server.go', x: 90, y: 150 },
  { id: 's3', label: 'db.Query', sub: 'store.go', x: 90, y: 230 },
];

const files: FileNode[] = [
  { id: 'f1', label: 'main.go', x: 430, y: 50 },
  { id: 'f2', label: 'router.go', x: 430, y: 110 },
  { id: 'f3', label: 'worker.go', x: 430, y: 170 },
  { id: 'f4', label: 'cache.go', x: 430, y: 230 },
  { id: 'f5', label: 'admin.go', x: 430, y: 290 },
];

// Which file nodes each symbol references (the fan-out).
const refMap: Record<string, string[]> = {
  s1: ['f1', 'f2', 'f5'],
  s2: ['f1', 'f3'],
  s3: ['f2', 'f3', 'f4', 'f5'],
};

const DEF_X = 250; // x of the definition marker the jump edge lands on
const ease = [0.22, 1, 0.36, 1] as const;

export default function CodelensDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<string>('s3');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [baselineVal, setBaselineVal] = useState(0);
  const [indexedVal, setIndexedVal] = useState(0);
  const [baselineStep, setBaselineStep] = useState(0);
  const rafRef = useRef<number | null>(null);

  const refs = refMap[active];
  const activeSym = symbols.find((s) => s.id === active)!;
  const defY = activeSym.y;

  function stopAnim() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  useEffect(() => stopAnim, []);

  function reset() {
    stopAnim();
    setRunning(false);
    setDone(false);
    setBaselineVal(0);
    setIndexedVal(0);
    setBaselineStep(0);
  }

  function selectSymbol(id: string) {
    if (running) return;
    setActive(id);
    setDone(false);
    setBaselineVal(0);
    setIndexedVal(0);
    setBaselineStep(0);
  }

  function findReferences() {
    if (running) return;
    setRunning(true);
    setDone(false);
    setBaselineVal(0);
    setIndexedVal(0);
    setBaselineStep(0);

    if (reduce) {
      setBaselineVal(BASELINE_MS);
      setIndexedVal(INDEXED_MS);
      setBaselineStep(refs.length);
      setRunning(false);
      setDone(true);
      return;
    }

    // The indexed query snaps in fast: a single join over the covering index.
    const indexedDuration = 520;
    // The N+1 baseline visibly climbs, one query per referencing file.
    const baselineDuration = 2100;
    const start = performance.now();

    const tick = (now: number) => {
      const t = now - start;
      const ip = Math.min(1, t / indexedDuration);
      setIndexedVal(+(INDEXED_MS * easeOut(ip)).toFixed(1));

      const bp = Math.min(1, t / baselineDuration);
      setBaselineVal(+(BASELINE_MS * bp).toFixed(1));
      setBaselineStep(Math.min(refs.length, Math.ceil(bp * refs.length)));

      if (bp < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setBaselineVal(BASELINE_MS);
        setIndexedVal(INDEXED_MS);
        setBaselineStep(refs.length);
        setRunning(false);
        setDone(true);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="demo" aria-label="codelens find-references demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Find references, two ways</h3>
      <p className="demo__lede">
        Pick a symbol to jump to its definition and fan out its references.
        Then run find-references to watch the N+1 baseline climb query by query
        against the indexed query that resolves in one join.
      </p>

      <div className="cl__stage">
        <div className="cl__graph">
          <svg
            className="cl__svg"
            viewBox="0 0 540 340"
            role="group"
            aria-label="symbol and file reference graph"
          >
            <defs>
              <marker
                id="cl-arrow"
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

            {/* reference fan-out edges */}
            <AnimatePresence>
              {refs.map((fid, i) => {
                const f = files.find((n) => n.x && n.id === fid)!;
                return (
                  <motion.path
                    key={`${active}-${fid}`}
                    d={`M ${DEF_X} ${defY} C 330 ${defY}, 330 ${f.y}, ${f.x - 6} ${f.y}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1.4}
                    strokeOpacity={0.55}
                    markerEnd="url(#cl-arrow)"
                    initial={{ pathLength: reduce ? 1 : 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: reduce ? 0 : 0.5,
                      delay: reduce ? 0 : 0.12 + i * 0.08,
                      ease,
                    }}
                  />
                );
              })}
            </AnimatePresence>

            {/* jump-to-definition edge from the active symbol */}
            <motion.path
              key={`def-${active}`}
              d={`M ${130} ${defY} L ${DEF_X - 4} ${defY}`}
              fill="none"
              stroke="var(--accent-soft)"
              strokeWidth={2}
              strokeDasharray="5 4"
              markerEnd="url(#cl-arrow)"
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : 0.35, ease }}
            />
            <motion.circle
              key={`defdot-${active}`}
              cx={DEF_X}
              cy={defY}
              r={4}
              fill="var(--accent-soft)"
              initial={{ scale: reduce ? 1 : 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.3, delay: reduce ? 0 : 0.3 }}
            />
            <text x={DEF_X + 8} y={defY - 8} className="cl__node-sub">
              definition
            </text>

            {/* symbol nodes */}
            {symbols.map((s) => {
              const isActive = s.id === active;
              return (
                <g
                  key={s.id}
                  className="cl__sym"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  aria-label={`Select symbol ${s.label}`}
                  onClick={() => selectSymbol(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectSymbol(s.id);
                    }
                  }}
                >
                  <rect
                    x={s.x - 62}
                    y={s.y - 22}
                    width={132}
                    height={44}
                    rx={9}
                    fill={isActive ? 'var(--accent-glow)' : 'var(--ink-700)'}
                    stroke={isActive ? 'var(--accent)' : 'var(--line)'}
                    strokeWidth={isActive ? 2 : 1}
                  />
                  <text
                    x={s.x}
                    y={s.y - 1}
                    textAnchor="middle"
                    className="cl__node-label"
                  >
                    {s.label}
                  </text>
                  <text
                    x={s.x}
                    y={s.y + 12}
                    textAnchor="middle"
                    className="cl__node-sub"
                  >
                    {s.sub}
                  </text>
                </g>
              );
            })}

            {/* file nodes */}
            {files.map((f) => {
              const hit = refs.includes(f.id);
              return (
                <g key={f.id}>
                  <rect
                    x={f.x - 6}
                    y={f.y - 15}
                    width={92}
                    height={30}
                    rx={7}
                    fill={hit ? 'var(--ink-700)' : 'var(--ink-850)'}
                    stroke={hit ? 'var(--accent-line)' : 'var(--line)'}
                    strokeWidth={1}
                  />
                  <text
                    x={f.x + 40}
                    y={f.y + 4}
                    textAnchor="middle"
                    className="cl__node-label"
                  >
                    {f.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="cl__timers">
          <div className="cl__timer">
            <div className="cl__timer-name">N+1 baseline</div>
            <div className="cl__timer-val">
              {baselineVal.toFixed(1)}
              <span className="cl__timer-unit">ms p95</span>
            </div>
            <div className="cl__timer-meta">
              {running || done
                ? `query ${baselineStep} of ${refs.length} (one per file)`
                : 'one query per referencing file'}
            </div>
          </div>
          <div className="cl__timer cl__timer--fast">
            <div className="cl__timer-name">Covering index</div>
            <div className="cl__timer-val">
              {indexedVal.toFixed(1)}
              <span className="cl__timer-unit">ms p95</span>
            </div>
            <div className="cl__timer-meta">
              single join on refs(symbol_id, file_id)
            </div>
          </div>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="cl__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="cl__verdict-x">{SPEEDUP}x faster</span>
              <span className="cl__verdict-text">
                p95 dropped from {BASELINE_MS}ms to {INDEXED_MS}ms on the
                find-references hot path, measured over about 10M reference
                rows.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={findReferences}
          disabled={running}
        >
          {running ? 'Running…' : 'Find references'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {activeSym.label}: {refs.length} references
        </span>
      </div>
    </div>
  );
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
