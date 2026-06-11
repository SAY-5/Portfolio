import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import './convoengine.css';

// Real mechanism from the project: one conversation spans email (polled inbox)
// and chat (HTTP webhook), continued by sender identity. A per-conversation
// state machine moves over six states. Every model turn returns a validated
// {action, response_text, confidence, suggested_state}. Three consecutive
// low-confidence turns, or one very-low turn, flips the conversation to
// escalated and posts a structured summary to an operator queue.
const LOW = 0.55; // below this counts as a low-confidence turn
const VERY_LOW = 0.3; // a single turn this low escalates immediately
const STREAK_TO_ESCALATE = 3; // consecutive low turns that trip escalation

type StateId =
  | 'greeting'
  | 'clarifying'
  | 'answering'
  | 'escalated'
  | 'operator_active'
  | 'closed';

type Channel = 'email' | 'chat';

type Turn = {
  channel: Channel;
  text: string;
  confidence: number;
  // where the machine should head next on a normal (non-escalating) turn
  to: StateId;
};

// A scripted thread that continues across both channels by sender identity.
// Confidence values are what drive the action and the suggested state.
const SCRIPT: Turn[] = [
  { channel: 'email', text: 'Hi, my invoice total looks wrong this month.', confidence: 0.91, to: 'answering' },
  { channel: 'chat', text: 'It is the same account, just messaging here now.', confidence: 0.74, to: 'answering' },
  { channel: 'chat', text: 'Wait, which of my three projects is this charge on?', confidence: 0.48, to: 'clarifying' },
  { channel: 'email', text: 'And why did the per-seat rate change mid-cycle?', confidence: 0.41, to: 'clarifying' },
  { channel: 'chat', text: 'This contradicts the contract PDF you sent in March.', confidence: 0.37, to: 'clarifying' },
];

const STATES: { id: StateId; label: string; x: number; y: number }[] = [
  { id: 'greeting', label: 'greeting', x: 80, y: 60 },
  { id: 'clarifying', label: 'clarifying', x: 270, y: 60 },
  { id: 'answering', label: 'answering', x: 460, y: 60 },
  { id: 'escalated', label: 'escalated', x: 270, y: 170 },
  { id: 'operator_active', label: 'operator_active', x: 80, y: 170 },
  { id: 'closed', label: 'closed', x: 460, y: 170 },
];

const POS: Record<StateId, { x: number; y: number }> = STATES.reduce(
  (acc, s) => ((acc[s.id] = { x: s.x, y: s.y }), acc),
  {} as Record<StateId, { x: number; y: number }>,
);

// Directed edges of the machine, drawn as the static graph skeleton.
const EDGES: [StateId, StateId][] = [
  ['greeting', 'clarifying'],
  ['greeting', 'answering'],
  ['clarifying', 'answering'],
  ['answering', 'clarifying'],
  ['clarifying', 'escalated'],
  ['answering', 'escalated'],
  ['escalated', 'operator_active'],
  ['answering', 'closed'],
  ['operator_active', 'closed'],
];

type Action = 'respond' | 'template_fallback' | 'escalate';

type Result = {
  index: number;
  turn: Turn;
  from: StateId;
  to: StateId;
  action: Action;
  confidence: number;
  responseText: string;
  lowStreak: number;
};

function classify(turn: Turn, lowStreakBefore: number, fromState: StateId): Result {
  const low = turn.confidence < LOW;
  const veryLow = turn.confidence < VERY_LOW;
  const lowStreak = low ? lowStreakBefore + 1 : 0;
  const trip = veryLow || lowStreak >= STREAK_TO_ESCALATE;

  if (trip) {
    return {
      index: 0,
      turn,
      from: fromState,
      to: 'escalated',
      action: 'escalate',
      confidence: turn.confidence,
      responseText: 'Summary posted to operator queue. A person will take this over.',
      lowStreak,
    };
  }
  if (low) {
    return {
      index: 0,
      turn,
      from: fromState,
      to: turn.to,
      action: 'template_fallback',
      confidence: turn.confidence,
      responseText: 'Confidence below threshold, sending a safe template and asking to confirm.',
      lowStreak,
    };
  }
  return {
    index: 0,
    turn,
    from: fromState,
    to: turn.to,
    action: 'respond',
    confidence: turn.confidence,
    responseText: 'Model answer validated against the schema and returned.',
    lowStreak,
  };
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function ConvoengineDemo() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0); // how many turns have been processed
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLOListElement | null>(null);

  // Replay the whole script up to `step` so state and streaks are derived,
  // never stored ad hoc. This keeps the machine a pure function of inputs.
  const { results, current, lowStreak } = useMemo(() => {
    let state: StateId = 'greeting';
    let streak = 0;
    const out: Result[] = [];
    for (let i = 0; i < step; i++) {
      const r = classify(SCRIPT[i], streak, state);
      r.index = i;
      state = r.to;
      streak = r.action === 'escalate' ? 0 : r.lowStreak;
      out.push(r);
      if (r.to === 'escalated') break;
    }
    const last = out[out.length - 1];
    const cur: StateId = last ? last.to : 'greeting';
    return { results: out, current: cur, lowStreak: streak };
  }, [step]);

  const escalated = current === 'escalated' || current === 'operator_active';
  const atEnd = step >= SCRIPT.length || escalated;

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [results.length]);

  function next() {
    setStep((s) => Math.min(SCRIPT.length, s + 1));
  }

  function play() {
    if (atEnd) {
      reset();
      // restart from a clean slate on the next frame
      setPlaying(true);
      schedule(0);
      return;
    }
    setPlaying(true);
    schedule(step);
  }

  function schedule(from: number) {
    clearTimer();
    const run = (i: number) => {
      if (i >= SCRIPT.length) {
        setPlaying(false);
        return;
      }
      setStep(i + 1);
      // Stop the autoplay the moment the machine escalates.
      const wouldEscalate = simulateTo(i + 1).escalated;
      if (wouldEscalate) {
        setPlaying(false);
        return;
      }
      timer.current = setTimeout(() => run(i + 1), reduce ? 0 : 1150);
    };
    timer.current = setTimeout(() => run(from), reduce ? 0 : 200);
  }

  function pause() {
    clearTimer();
    setPlaying(false);
  }

  function reset() {
    clearTimer();
    setPlaying(false);
    setStep(0);
  }

  const meterConf = results.length ? results[results.length - 1].confidence : 1;
  const lastAction = results.length ? results[results.length - 1].action : null;

  return (
    <div className="demo" aria-label="convoengine state machine demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">One conversation, two channels, six states</h3>
      <p className="demo__lede">
        Step through a thread that moves between email and chat for the same
        sender. Each turn returns a validated action and confidence; watch the
        token walk the state machine, and watch a low-confidence run flip it to
        the operator queue.
      </p>

      <div className="ce__stage">
        <div className="ce__graph">
          <svg
            className="ce__svg"
            viewBox="0 0 600 240"
            role="group"
            aria-label="conversation state machine"
          >
            <defs>
              <marker
                id="ce-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
              </marker>
              <marker
                id="ce-arrow-hot"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
              </marker>
            </defs>

            {EDGES.map(([a, b]) => {
              const pa = POS[a];
              const pb = POS[b];
              const lastResult = results[results.length - 1];
              const hot =
                lastResult && lastResult.from === a && lastResult.to === b;
              return (
                <line
                  key={`${a}-${b}`}
                  x1={pa.x + 56}
                  y1={pa.y + 16}
                  x2={pb.x + (pb.x > pa.x ? -4 : 56)}
                  y2={pb.y + 16}
                  stroke={hot ? 'var(--accent)' : 'var(--line)'}
                  strokeWidth={hot ? 2 : 1}
                  strokeOpacity={hot ? 0.9 : 0.55}
                  markerEnd={hot ? 'url(#ce-arrow-hot)' : 'url(#ce-arrow)'}
                />
              );
            })}

            {STATES.map((s) => {
              const isCur = s.id === current;
              const isEsc = s.id === 'escalated' || s.id === 'operator_active';
              return (
                <g key={s.id}>
                  <rect
                    x={s.x}
                    y={s.y}
                    width={112}
                    height={32}
                    rx={8}
                    fill={
                      isCur
                        ? isEsc
                          ? 'var(--accent-glow)'
                          : 'var(--ink-700)'
                        : 'var(--ink-850)'
                    }
                    stroke={
                      isCur
                        ? 'var(--accent)'
                        : isEsc
                          ? 'var(--accent-line)'
                          : 'var(--line)'
                    }
                    strokeWidth={isCur ? 2 : 1}
                  />
                  <text
                    x={s.x + 56}
                    y={s.y + 20}
                    textAnchor="middle"
                    className="ce__node-label"
                  >
                    {s.label}
                  </text>
                </g>
              );
            })}

            {/* the conversation token sitting on the current state */}
            <motion.circle
              r={7}
              fill="var(--accent)"
              stroke="var(--ink-900)"
              strokeWidth={2}
              animate={{ cx: POS[current].x + 56, cy: POS[current].y - 2 }}
              transition={{ duration: reduce ? 0 : 0.5, ease }}
            />
          </svg>
        </div>

        <div className="ce__panel">
          <div className="ce__meter">
            <div className="ce__meter-head">
              <span className="ce__meter-name">turn confidence</span>
              <span className="ce__meter-val">{meterConf.toFixed(2)}</span>
            </div>
            <div className="ce__meter-track" aria-hidden="true">
              <span
                className="ce__meter-mark ce__meter-mark--low"
                style={{ left: `${LOW * 100}%` }}
              />
              <span
                className="ce__meter-mark ce__meter-mark--vlow"
                style={{ left: `${VERY_LOW * 100}%` }}
              />
              <motion.span
                className="ce__meter-fill"
                data-band={
                  meterConf < VERY_LOW ? 'vlow' : meterConf < LOW ? 'low' : 'ok'
                }
                animate={{ width: `${meterConf * 100}%` }}
                transition={{ duration: reduce ? 0 : 0.45, ease }}
              />
            </div>
            <div className="ce__meter-legend">
              <span>
                template below <b>{LOW.toFixed(2)}</b>
              </span>
              <span>
                escalate below <b>{VERY_LOW.toFixed(2)}</b> or {STREAK_TO_ESCALATE} in a row
              </span>
            </div>
            <div className="ce__streak" aria-live="polite">
              low-confidence streak
              <span className="ce__streak-dots">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="ce__streak-dot"
                    data-on={i < lowStreak}
                  />
                ))}
              </span>
              <span className="ce__streak-num">
                {lowStreak} / {STREAK_TO_ESCALATE}
              </span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {lastAction && (
              <motion.div
                key={results.length}
                className="ce__payload"
                data-action={lastAction}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <div className="ce__payload-head">validated payload</div>
                <pre className="ce__payload-body">
{`{
  "action": "${lastAction}",
  "confidence": ${meterConf.toFixed(2)},
  "suggested_state": "${current}"
}`}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="ce__feedwrap">
        <div className="ce__feed-head">
          conversation thread
          <span className="ce__feed-meta">
            {step} of {SCRIPT.length} turns
          </span>
        </div>
        <ol className="ce__feed" ref={feedRef}>
          {results.length === 0 && (
            <li className="ce__feed-empty">
              Step or play to receive the first turn.
            </li>
          )}
          {results.map((r) => (
            <motion.li
              key={r.index}
              className="ce__feed-line"
              data-channel={r.turn.channel}
              data-action={r.action}
              initial={{ opacity: 0, x: reduce ? 0 : -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : 0.3, ease }}
            >
              <span className="ce__feed-channel">{r.turn.channel}</span>
              <span className="ce__feed-text">{r.turn.text}</span>
              <span className="ce__feed-tag" data-action={r.action}>
                {r.action === 'respond'
                  ? 'respond'
                  : r.action === 'template_fallback'
                    ? 'template'
                    : 'escalate'}
                <em>{r.confidence.toFixed(2)}</em>
              </span>
            </motion.li>
          ))}
        </ol>
      </div>

      <AnimatePresence>
        {escalated && (
          <motion.div
            className="ce__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.4, ease }}
          >
            <span className="ce__verdict-head">escalated to operator queue</span>
            <span className="ce__verdict-text">
              Three consecutive low-confidence turns tripped the threshold, so
              the machine flipped to escalated and posted a structured summary
              for a person to pick up. The thread stayed one conversation across
              email and chat the whole time.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={playing ? pause : play}
          aria-label={playing ? 'Pause autoplay' : 'Play the conversation'}
        >
          {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={next}
          disabled={playing || atEnd}
        >
          Step turn
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={playing}
        >
          Reset
        </button>
        <span className="demo__hint">
          state: {current}
        </span>
      </div>
    </div>
  );
}

// Lightweight re-simulation used only to peek whether the next step escalates,
// so autoplay can stop on the handoff.
function simulateTo(stepCount: number): { escalated: boolean } {
  let state: StateId = 'greeting';
  let streak = 0;
  for (let i = 0; i < stepCount; i++) {
    const r = classify(SCRIPT[i], streak, state);
    state = r.to;
    streak = r.action === 'escalate' ? 0 : r.lowStreak;
    if (r.to === 'escalated') return { escalated: true };
  }
  return { escalated: false };
}
