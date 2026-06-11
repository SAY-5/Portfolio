import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './reviewmate.css';

// Real mechanism: reviewmate walks a unified diff hunk by hunk and ranks risky
// changes with a deterministic score built from authentication touch, test
// removal, concurrency keywords, hunk size, and file criticality. The score is
// advisory; it never approves or merges. Every provider call is wrapped in
// guardrails (input size cap, secret redaction, output schema validation,
// tool-call allowlist, deterministic refusal path).
const ease = [0.22, 1, 0.36, 1] as const;

type Factor = { label: string; points: number };
type Hunk = {
  id: string;
  file: string;
  added: number;
  removed: number;
  preview: { sign: '+' | '-' | ' '; text: string }[];
  factors: Factor[];
};

// Deterministic factor weights, mirroring the project's scoring inputs.
const hunks: Hunk[] = [
  {
    id: 'h1',
    file: 'auth/session.go',
    added: 31,
    removed: 12,
    preview: [
      { sign: '-', text: 'if token.Valid() {' },
      { sign: '+', text: 'if token.Valid() || cfg.SkipAuth {' },
    ],
    factors: [
      { label: 'auth touch', points: 5 },
      { label: 'file criticality', points: 3 },
      { label: 'hunk size', points: 2 },
    ],
  },
  {
    id: 'h2',
    file: 'worker/pool.go',
    added: 24,
    removed: 6,
    preview: [
      { sign: '+', text: 'go func() { mu.Lock()' },
      { sign: '+', text: '  cache[k] = v // no defer' },
    ],
    factors: [
      { label: 'concurrency keyword', points: 4 },
      { label: 'hunk size', points: 2 },
    ],
  },
  {
    id: 'h3',
    file: 'billing/charge_test.go',
    added: 0,
    removed: 38,
    preview: [
      { sign: '-', text: 'func TestRefundPath(t *T) {' },
      { sign: '-', text: '  assertRefunded(t, order)' },
    ],
    factors: [
      { label: 'test removal', points: 4 },
      { label: 'file criticality', points: 2 },
      { label: 'hunk size', points: 2 },
    ],
  },
  {
    id: 'h4',
    file: 'ui/Button.tsx',
    added: 9,
    removed: 3,
    preview: [
      { sign: '-', text: 'padding: 8px;' },
      { sign: '+', text: 'padding: 10px;' },
    ],
    factors: [{ label: 'hunk size', points: 1 }],
  },
  {
    id: 'h5',
    file: 'api/handlers.go',
    added: 18,
    removed: 14,
    preview: [
      { sign: '-', text: 'limiter.Allow(ip)' },
      { sign: '+', text: '// limiter.Allow(ip)' },
    ],
    factors: [
      { label: 'file criticality', points: 3 },
      { label: 'concurrency keyword', points: 2 },
      { label: 'hunk size', points: 1 },
    ],
  },
];

const guards = [
  'input size cap',
  'secret redaction',
  'schema validation',
  'tool-call allowlist',
  'refusal path',
];

function scoreOf(h: Hunk) {
  return h.factors.reduce((s, f) => s + f.points, 0);
}
const MAX_SCORE = Math.max(...hunks.map(scoreOf));

function severity(score: number): 'high' | 'med' | 'low' {
  if (score >= 8) return 'high';
  if (score >= 4) return 'med';
  return 'low';
}

export default function ReviewmateDemo() {
  const reduce = useReducedMotion();
  const [revealed, setRevealed] = useState(reduce ? hunks.length : 0);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  function streamDiff() {
    if (timer.current) clearInterval(timer.current);
    setSelected(null);
    if (reduce) {
      setRevealed(hunks.length);
      return;
    }
    setRevealed(0);
    setRunning(true);
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= hunks.length) {
        if (timer.current) clearInterval(timer.current);
        setRunning(false);
      }
    }, 520);
  }

  const reviewed = hunks.slice(0, revealed);
  const ranked = [...reviewed].sort((a, b) => scoreOf(b) - scoreOf(a));
  const totalHunks = hunks.length;

  return (
    <div className="demo" aria-label="reviewmate risk ranking demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Rank the risky changes</h3>
      <p className="demo__lede">
        Stream a diff and each hunk is scored by a deterministic rule:
        authentication touch, test removal, concurrency keywords, hunk size, and
        file criticality. The leaderboard reorders live as scores land. Advisory
        only: it never approves or merges.
      </p>

      <div className="rm__stage">
        <div className="rm__diff">
          <div className="rm__diff-head">
            <span>incoming diff</span>
            <span className="rm__diff-count">
              {revealed}/{totalHunks} hunks
            </span>
          </div>
          <div className="rm__hunks">
            {reviewed.map((h) => {
              const sc = scoreOf(h);
              const sev = severity(sc);
              const on = selected === h.id;
              return (
                <motion.button
                  key={h.id}
                  type="button"
                  className={`rm__hunk${on ? ' rm__hunk--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setSelected(on ? null : h.id)}
                  initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.35, ease }}
                >
                  <div className="rm__hunk-top">
                    <span className="rm__hunk-file">{h.file}</span>
                    <span className={`rm__sev rm__sev--${sev}`}>{sev}</span>
                  </div>
                  <div className="rm__hunk-body">
                    {h.preview.map((l, i) => (
                      <div
                        key={i}
                        className={
                          l.sign === '+'
                            ? 'rm__line-add'
                            : l.sign === '-'
                              ? 'rm__line-del'
                              : undefined
                        }
                      >
                        {l.sign} {l.text}
                      </div>
                    ))}
                  </div>
                  {on && (
                    <div className="rm__factors">
                      {h.factors.map((f) => (
                        <span key={f.label} className="rm__factor">
                          {f.label} <b>+{f.points}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </motion.button>
              );
            })}
            {reviewed.length === 0 && (
              <div className="rm__hunk-body" style={{ padding: '14px 4px' }}>
                Press stream diff to walk the hunks.
              </div>
            )}
          </div>
        </div>

        <div className="rm__board">
          <div className="rm__board-head">
            <span>risk ranking</span>
          </div>
          <div className="rm__rows">
            {ranked.map((h, i) => {
              const sc = scoreOf(h);
              return (
                <motion.div
                  key={h.id}
                  layout={!reduce}
                  className={`rm__row${i === 0 && ranked.length > 0 ? ' rm__row--top' : ''}`}
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                >
                  <span className="rm__rank">{i + 1}</span>
                  <div>
                    <div className="rm__row-name">{h.file}</div>
                    <div className="rm__row-bar">
                      <motion.div
                        className="rm__row-bar-fill"
                        initial={false}
                        animate={{ width: `${(sc / MAX_SCORE) * 100}%` }}
                        transition={{ duration: reduce ? 0 : 0.5, ease }}
                      />
                    </div>
                  </div>
                  <span className="rm__score">{sc}</span>
                </motion.div>
              );
            })}
            {ranked.length === 0 && (
              <div className="rm__hunk-body" style={{ padding: '10px 2px' }}>
                Scored hunks land here, highest risk first.
              </div>
            )}
          </div>
          <div className="rm__guard">
            {guards.map((g) => (
              <span key={g} className="rm__guard-chip">
                {g}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={streamDiff} disabled={running}>
          {running ? 'Streaming…' : 'Stream diff'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            if (timer.current) clearInterval(timer.current);
            setRevealed(0);
            setSelected(null);
            setRunning(false);
          }}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          click a hunk to see its factor breakdown
        </span>
      </div>
    </div>
  );
}
