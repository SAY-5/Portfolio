import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './mcp-agentlab.css';

// Real behavior from the project: a Go orchestrator runs a multi-step agent
// loop against eight Python tool servers that speak JSON-RPC 2.0 over stdio.
// Every tool declares a JSON Schema for its result; the orchestrator validates
// each response before passing it forward. Retries are bounded with a
// transient-vs-permanent classifier: network and JSON-RPC -32603 are transient
// (retried at 100/400/1600 ms); schema-validation and -32002 are permanent and
// are not retried. The demo run emits 17 spans across 8 steps with 0 retries on
// the happy path; the sum of step latencies is 41.8 ms.
const BACKOFF = [100, 400, 1600]; // ms
const HAPPY_SPANS = 17;
const HAPPY_STEPS = 8;
const HAPPY_LATENCY = 41.8; // ms

type Step = { tool: string; ms: number };

// Eight steps, each a tool subprocess call, with per-step latencies that sum to
// 41.8 ms (the recorded happy-path total).
const STEPS: Step[] = [
  { tool: 'fetch_url', ms: 8.2 },
  { tool: 'extract_text', ms: 3.1 },
  { tool: 'tokenize', ms: 2.4 },
  { tool: 'search_index', ms: 9.6 },
  { tool: 'rank_results', ms: 4.7 },
  { tool: 'summarize', ms: 6.3 },
  { tool: 'validate_json', ms: 2.9 },
  { tool: 'write_report', ms: 4.6 },
];

type Fault = 'none' | 'transient' | 'permanent';

type SpanState = 'pending' | 'calling' | 'retry' | 'ok' | 'failed';

type Span = {
  step: number;
  tool: string;
  state: SpanState;
  attempts: number;
  ms: number;
  note: string;
};

export default function McpAgentlabDemo() {
  const reduce = useReducedMotion();
  const [faultStep, setFaultStep] = useState(3); // 0-indexed step to fault
  const [fault, setFault] = useState<Fault>('none');
  const [spans, setSpans] = useState<Span[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => () => clearTimers(), []);

  function reset() {
    clearTimers();
    setSpans([]);
    setRunning(false);
    setDone(false);
  }

  function pushSpan(s: Span) {
    setSpans((prev) => [...prev.filter((p) => p.step !== s.step), s].sort((a, b) => a.step - b.step));
  }

  function run() {
    if (running) return;
    clearTimers();
    setSpans([]);
    setDone(false);
    setRunning(true);

    // Walk the step loop. Each step is a tool call: calling -> schema gate ->
    // ok, unless a fault is injected on faultStep.
    let clock = 0; // animation ms
    const stepGap = reduce ? 0 : 360;

    const schedule = (delay: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? 0 : delay);
      timers.current.push(t);
    };

    let stoppedEarly = false;

    STEPS.forEach((step, i) => {
      if (stoppedEarly) return;
      const isFault = fault !== 'none' && i === faultStep;

      schedule(clock, () =>
        pushSpan({
          step: i,
          tool: step.tool,
          state: 'calling',
          attempts: 1,
          ms: step.ms,
          note: 'tools/call over stdio',
        }),
      );
      clock += stepGap;

      if (!isFault) {
        schedule(clock, () =>
          pushSpan({
            step: i,
            tool: step.tool,
            state: 'ok',
            attempts: 1,
            ms: step.ms,
            note: 'schema valid, result forwarded',
          }),
        );
        clock += stepGap;
        return;
      }

      if (fault === 'transient') {
        // JSON-RPC -32603 / network: retried at 100/400/1600 ms, then succeeds.
        BACKOFF.forEach((b, r) => {
          schedule(clock, () =>
            pushSpan({
              step: i,
              tool: step.tool,
              state: 'retry',
              attempts: r + 2,
              ms: step.ms,
              note: `transient -32603, backoff ${b} ms`,
            }),
          );
          clock += stepGap;
        });
        schedule(clock, () =>
          pushSpan({
            step: i,
            tool: step.tool,
            state: 'ok',
            attempts: BACKOFF.length + 1,
            ms: step.ms,
            note: `recovered after ${BACKOFF.length} retries`,
          }),
        );
        clock += stepGap;
      } else {
        // Permanent: schema-validation / -32002. Not retried; loop halts.
        stoppedEarly = true;
        schedule(clock, () =>
          pushSpan({
            step: i,
            tool: step.tool,
            state: 'failed',
            attempts: 1,
            ms: step.ms,
            note: 'permanent -32002, not retried',
          }),
        );
        clock += stepGap;
      }
    });

    schedule(clock + 60, () => {
      setRunning(false);
      setDone(true);
    });
  }

  // Live totals over the spans rendered so far.
  const completed = spans.filter((s) => s.state === 'ok' || s.state === 'failed').length;
  const retries = spans.reduce((n, s) => n + Math.max(0, s.attempts - 1), 0);
  const halted = spans.some((s) => s.state === 'failed');

  return (
    <div className="demo" aria-label="AgentLab span tree demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">An agent loop as a growing span tree</h3>
      <p className="demo__lede">
        Run the loop and each step spawns a tool subprocess called over JSON-RPC.
        Every result passes a JSON Schema gate before moving forward. Inject a
        fault on a step to watch the classifier split it: a transient error
        retries at {BACKOFF.join('/')} ms, a permanent error halts the loop with
        no retry.
      </p>

      <div className="ml__faults" role="group" aria-label="fault injection">
        <span className="ml__faults-label">inject on step {faultStep + 1}:</span>
        {(['none', 'transient', 'permanent'] as Fault[]).map((f) => (
          <button
            key={f}
            className={`ml__fault-btn${fault === f ? ' ml__fault-btn--active' : ''}`}
            aria-pressed={fault === f}
            onClick={() => {
              setFault(f);
              reset();
            }}
            disabled={running}
          >
            {f}
          </button>
        ))}
        <label className="ml__step-pick">
          step
          <input
            type="range"
            min={1}
            max={STEPS.length}
            value={faultStep + 1}
            onChange={(e) => {
              setFaultStep(Number(e.target.value) - 1);
              reset();
            }}
            disabled={running || fault === 'none'}
            aria-label="fault step"
          />
        </label>
      </div>

      <div className="ml__stage">
        <ol className="ml__tree">
          {STEPS.map((step, i) => {
            const span = spans.find((s) => s.step === i);
            const state: SpanState = span ? span.state : 'pending';
            return (
              <li
                key={i}
                className={`ml__span ml__span--${state}`}
              >
                <span className="ml__span-rail" aria-hidden="true" />
                <AnimatePresence>
                  {span && (
                    <motion.div
                      className="ml__span-body"
                      initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: reduce ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <span className="ml__span-dot" aria-hidden="true" />
                      <span className="ml__span-tool">{step.tool}</span>
                      <span className="ml__span-note">{span.note}</span>
                      <span className="ml__span-meta">
                        {span.attempts > 1 && (
                          <em className="ml__span-att">x{span.attempts}</em>
                        )}
                        <em className="ml__span-ms">{step.ms} ms</em>
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
                {!span && (
                  <div className="ml__span-body ml__span-body--pending">
                    <span className="ml__span-dot" aria-hidden="true" />
                    <span className="ml__span-tool">{step.tool}</span>
                    <span className="ml__span-note">queued</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="ml__metrics" aria-live="polite">
          <Metric
            label="spans"
            value={done && fault === 'none' ? String(HAPPY_SPANS) : String(Math.max(spans.length, completed))}
            note={fault === 'none' ? `${HAPPY_SPANS} on happy path` : 'live'}
          />
          <Metric
            label="steps done"
            value={`${completed} / ${HAPPY_STEPS}`}
            note={halted ? 'loop halted' : 'of 8 steps'}
          />
          <Metric
            label="retries"
            value={String(retries)}
            note={fault === 'none' ? '0 on happy path' : 'bounded backoff'}
          />
          <Metric
            label="sum latency"
            value={fault === 'none' && done ? `${HAPPY_LATENCY} ms` : `${liveLatency(spans, STEPS)} ms`}
            note="sum of step latencies"
            accent
          />
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="ml__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {fault === 'none' &&
                `Clean run: ${HAPPY_SPANS} spans across ${HAPPY_STEPS} steps, 0 retries, ${HAPPY_LATENCY} ms total.`}
              {fault === 'transient' &&
                `Step ${faultStep + 1} hit a transient -32603 and recovered after ${BACKOFF.length} retries at ${BACKOFF.join('/')} ms. The loop finished.`}
              {fault === 'permanent' &&
                `Step ${faultStep + 1} returned a permanent -32002. The classifier did not retry, so the loop halted at ${completed} of ${HAPPY_STEPS} steps.`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run agent loop'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          8 tools, JSON-RPC 2.0 over stdio
        </span>
      </div>
    </div>
  );
}

function liveLatency(spans: Span[], steps: Step[]) {
  const sum = spans
    .filter((s) => s.state === 'ok' || s.state === 'failed')
    .reduce((n, s) => n + steps[s.step].ms, 0);
  return sum.toFixed(1);
}

function Metric({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={`ml__metric${accent ? ' ml__metric--accent' : ''}`}>
      <div className="ml__metric-label">{label}</div>
      <div className="ml__metric-val">{value}</div>
      <div className="ml__metric-note">{note}</div>
    </div>
  );
}
