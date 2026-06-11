import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './convoagent.css';

// Real behavior from the project: each turn runs an intent classifier (9 classes
// plus OTHER), a lexicon-based sentiment scorer, and an escalation policy with
// three triggers: sentiment floor at score <= -0.5, consecutive-negative on a
// high-risk intent, and a turn budget of 8. The SSE endpoint streams intent,
// sentiment, action, and tokens. The eval suite gates >= 70% auto-resolve.
const SENTIMENT_FLOOR = -0.5;
const TURN_BUDGET = 8;
const RESOLVE_GATE = 70;

type Turn = {
  user: string;
  intent: string;
  highRisk: boolean;
  sentiment: number; // -1..1
  reply: string;
};

type Flow = {
  id: string;
  label: string;
  kind: 'cooperative' | 'angry';
  turns: Turn[];
};

// A cooperative flow resolves cleanly; an angry flow crosses the floor and
// escalates within a turn or two, matching the eval breakdown.
const FLOWS: Flow[] = [
  {
    id: 'coop',
    label: 'Cooperative: order status',
    kind: 'cooperative',
    turns: [
      {
        user: 'Hi, where is my order #4821?',
        intent: 'order_status',
        highRisk: false,
        sentiment: 0.2,
        reply: 'Order #4821 shipped today, arriving Thursday.',
      },
      {
        user: 'Great, can I change the address?',
        intent: 'update_address',
        highRisk: false,
        sentiment: 0.35,
        reply: 'Sure, send the new address and I will update it.',
      },
      {
        user: 'Perfect, thanks for the help!',
        intent: 'gratitude',
        highRisk: false,
        sentiment: 0.7,
        reply: 'Happy to help. Anything else?',
      },
    ],
  },
  {
    id: 'angry',
    label: 'Angry: billing dispute',
    kind: 'angry',
    turns: [
      {
        user: 'I was charged twice for one order.',
        intent: 'billing_dispute',
        highRisk: true,
        sentiment: -0.2,
        reply: 'I see two charges on #5530. Let me look into it.',
      },
      {
        user: 'This is the third time this happens, fix it now.',
        intent: 'billing_dispute',
        highRisk: true,
        sentiment: -0.55,
        reply: 'I understand the frustration. Routing you to a specialist.',
      },
    ],
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

// Mirror of the escalation policy: floor breach, or consecutive-negative on a
// high-risk intent, or hitting the turn budget.
function decide(turns: Turn[], idx: number): 'HANDLE' | 'ESCALATE' {
  const t = turns[idx];
  if (idx + 1 >= TURN_BUDGET) return 'ESCALATE';
  if (t.sentiment <= SENTIMENT_FLOOR) return 'ESCALATE';
  const prev = idx > 0 ? turns[idx - 1] : null;
  if (
    t.highRisk &&
    t.sentiment < 0 &&
    prev &&
    prev.highRisk &&
    prev.sentiment < 0
  ) {
    return 'ESCALATE';
  }
  return 'HANDLE';
}

export default function ConvoagentDemo() {
  const reduce = useReducedMotion();
  const [fid, setFid] = useState(FLOWS[0].id);
  const [step, setStep] = useState(0); // turns revealed
  const [playing, setPlaying] = useState(false);
  const timers = useRef<number[]>([]);

  const flow = FLOWS.find((f) => f.id === fid)!;
  const shown = flow.turns.slice(0, step);
  const last = step > 0 ? flow.turns[step - 1] : null;
  const action = last ? decide(flow.turns, step - 1) : null;
  const sentiment = last ? last.sentiment : 0;

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function selectFlow(id: string) {
    if (playing) return;
    clearTimers();
    setFid(id);
    setStep(0);
  }

  function play() {
    if (playing) return;
    clearTimers();
    setStep(0);
    const target = FLOWS.find((f) => f.id === fid)!;

    if (reduce) {
      setStep(target.turns.length);
      return;
    }

    setPlaying(true);
    target.turns.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setStep(i + 1);
          if (i === target.turns.length - 1) setPlaying(false);
        }, (i + 1) * 1000),
      );
    });
  }

  function reset() {
    clearTimers();
    setPlaying(false);
    setStep(0);
  }

  // Meter position: map -1..1 to 0..100; the floor marker sits at its mapped x.
  const meterPct = ((sentiment + 1) / 2) * 100;
  const floorPct = ((SENTIMENT_FLOOR + 1) / 2) * 100;
  const breached = sentiment <= SENTIMENT_FLOOR;

  return (
    <div className="demo" aria-label="convoagent live conversation demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Watch the policy decide</h3>
      <p className="demo__lede">
        Play a flow and the agent streams each turn: an intent label, a sentiment
        meter sliding toward the escalation floor at {SENTIMENT_FLOOR}, and the
        policy lighting up HANDLE or ESCALATE. The eval suite gates at least{' '}
        {RESOLVE_GATE}% auto-resolved across 500 cases.
      </p>

      <div className="ca__chips" role="group" aria-label="example flows">
        {FLOWS.map((f) => (
          <button
            key={f.id}
            className={`ca__chip${f.id === fid ? ' ca__chip--on' : ''}`}
            aria-pressed={f.id === fid}
            onClick={() => selectFlow(f.id)}
            disabled={playing}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="ca__stage">
        <div className="ca__convo" aria-live="polite">
          <AnimatePresence initial={false}>
            {shown.map((t, i) => (
              <motion.div
                key={`${fid}-${i}`}
                className="ca__turn"
                initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.32, ease }}
              >
                <div className="ca__msg ca__msg--user">{t.user}</div>
                <div className="ca__row">
                  <span className="ca__intent">{t.intent}</span>
                  {t.highRisk && <span className="ca__risk">high risk</span>}
                  <span
                    className={`ca__act ca__act--${decide(flow.turns, i).toLowerCase()}`}
                  >
                    {decide(flow.turns, i)}
                  </span>
                </div>
                <div className="ca__msg ca__msg--agent">{t.reply}</div>
              </motion.div>
            ))}
          </AnimatePresence>
          {step === 0 && (
            <p className="ca__empty">Press Play conversation to begin.</p>
          )}
        </div>

        <aside className="ca__panel" aria-label="policy signals">
          <div className="ca__metric">
            <div className="ca__metric-name">sentiment</div>
            <div className="ca__meter">
              <div className="ca__meter-track">
                <motion.div
                  className={`ca__meter-fill${breached ? ' ca__meter-fill--low' : ''}`}
                  animate={{ width: `${Math.max(0, meterPct)}%` }}
                  transition={{ duration: reduce ? 0 : 0.5, ease }}
                />
                <div
                  className="ca__meter-floor"
                  style={{ left: `${floorPct}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="ca__meter-scale">
                <span>-1.0</span>
                <span className="ca__meter-floor-label">floor {SENTIMENT_FLOOR}</span>
                <span>+1.0</span>
              </div>
            </div>
            <div className="ca__metric-val">
              {last ? sentiment.toFixed(2) : '0.00'}
            </div>
          </div>

          <div className="ca__metric">
            <div className="ca__metric-name">turn budget</div>
            <div className="ca__budget">
              {Array.from({ length: TURN_BUDGET }).map((_, i) => (
                <span
                  key={i}
                  className={`ca__pip${i < step ? ' ca__pip--used' : ''}`}
                />
              ))}
            </div>
            <div className="ca__metric-val">
              {step} / {TURN_BUDGET}
            </div>
          </div>

          <div
            className={`ca__verdict${action ? ` ca__verdict--${action.toLowerCase()}` : ''}`}
          >
            <span className="ca__verdict-label">policy</span>
            <span className="ca__verdict-val">{action ?? 'idle'}</span>
            {action === 'ESCALATE' && (
              <span className="ca__verdict-why">
                {breached
                  ? 'sentiment crossed the floor'
                  : step >= TURN_BUDGET
                    ? 'turn budget reached'
                    : 'consecutive negative on high-risk intent'}
              </span>
            )}
            {action === 'HANDLE' && (
              <span className="ca__verdict-why">canned response sent</span>
            )}
          </div>
        </aside>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={playing}>
          {playing ? 'Streaming…' : 'Play conversation'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={playing}
        >
          Reset
        </button>
        <span className="demo__hint">
          9 intent classes plus OTHER, lexicon sentiment
        </span>
      </div>
    </div>
  );
}
