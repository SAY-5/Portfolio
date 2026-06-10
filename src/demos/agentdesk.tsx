import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';

// Real behavior from the project: confidence is the product of the provider's
// signal and tool-call completeness (fraction of tool calls that succeeded).
// At or above the default 0.7 threshold the request auto-resolves; below it,
// it escalates to a human. The pinned decision-table example: signal 0.9 with
// completeness 0.5 gives confidence 0.45, which escalates.
const SIGNAL = 0.9;
const DEFAULT_THRESHOLD = 0.7;

type Tool = { id: string; name: string; ok: boolean };

const initialTools: Tool[] = [
  { id: 't1', name: 'lookup_order', ok: true },
  { id: 't2', name: 'check_inventory', ok: true },
  { id: 't3', name: 'issue_refund', ok: true },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function AgentdeskDemo() {
  const reduce = useReducedMotion();
  const [tools, setTools] = useState<Tool[]>(initialTools);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  const passed = tools.filter((t) => t.ok).length;
  const completeness = passed / tools.length;
  const confidence = useMemo(
    () => +(SIGNAL * completeness).toFixed(3),
    [completeness],
  );
  const resolves = confidence >= threshold;

  function toggleTool(id: string) {
    setTools((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ok: !t.ok } : t)),
    );
  }

  function reset() {
    setTools(initialTools);
    setThreshold(DEFAULT_THRESHOLD);
  }

  return (
    <div className="demo" aria-label="AgentDesk confidence routing demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Resolve or escalate</h3>
      <p className="demo__lede">
        A request runs a tool-calling loop, then routes by confidence.
        Confidence is the provider signal times tool-call completeness. Toggle
        a tool to make it fail or drag the threshold to reroute the request
        live between auto-resolve and human review.
      </p>

      <div className="ad__stage">
        <div className="ad__tools">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`ad__tool ${t.ok ? 'ad__tool--ok' : 'ad__tool--err'}`}
              onClick={() => toggleTool(t.id)}
              aria-pressed={!t.ok}
              aria-label={`Tool ${t.name}, currently ${
                t.ok ? 'success' : 'error'
              }. Toggle to ${t.ok ? 'fail' : 'pass'}.`}
            >
              <span className="ad__tool-dot" aria-hidden="true" />
              <span className="ad__tool-name">{t.name}()</span>
              <span className="ad__tool-state">{t.ok ? 'success' : 'error'}</span>
            </button>
          ))}
        </div>

        <div className="ad__readout">
          <div className="ad__formula">
            signal <b>{SIGNAL.toFixed(2)}</b>{' '}
            <span className="ad__hi">x</span> completeness{' '}
            <b>
              {passed}/{tools.length} = {completeness.toFixed(2)}
            </b>{' '}
            <span className="ad__hi">=</span> confidence{' '}
            <b className="ad__hi">{confidence.toFixed(2)}</b>
          </div>

          <div className="ad__slider-row">
            <div className="ad__slider-label">
              <span>threshold</span>
              <b>{threshold.toFixed(2)}</b>
            </div>
            <input
              className="ad__slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(+e.target.value)}
              aria-label="Auto-resolve confidence threshold"
              aria-valuetext={threshold.toFixed(2)}
            />
          </div>
        </div>

        <div className="ad__lanes">
          <div
            className={`ad__lane ad__lane--resolve ${
              resolves ? 'ad__lane--active' : ''
            }`}
            aria-live="polite"
          >
            <div className="ad__lane-title">Resolved</div>
            {resolves && (
              <motion.span
                className="ad__chip ad__chip--resolve"
                layoutId="request-chip"
                initial={false}
                transition={{
                  duration: reduce ? 0 : 0.45,
                  ease,
                  layout: { duration: reduce ? 0 : 0.45, ease },
                }}
              >
                request #4815 auto-resolved
              </motion.span>
            )}
          </div>
          <div
            className={`ad__lane ad__lane--review ${
              !resolves ? 'ad__lane--active' : ''
            }`}
            aria-live="polite"
          >
            <div className="ad__lane-title">Human review</div>
            {!resolves && (
              <motion.span
                className="ad__chip"
                layoutId="request-chip"
                initial={false}
                transition={{
                  duration: reduce ? 0 : 0.45,
                  ease,
                  layout: { duration: reduce ? 0 : 0.45, ease },
                }}
              >
                request #4815 escalated
              </motion.span>
            )}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          confidence {confidence.toFixed(2)} {resolves ? '>=' : '<'} threshold{' '}
          {threshold.toFixed(2)} {'->'} {resolves ? 'resolve' : 'escalate'}
        </span>
      </div>
    </div>
  );
}
