import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './infra-monitor.css';

// Real project facts: a metric stream walks an OK -> ARMING -> FIRING ->
// COOLDOWN state machine. A breach must hold for duration_seconds before
// ARMING promotes to FIRING; FIRING dispatches one HMAC-signed webhook and
// drops exactly one remediation audit row, then COOLDOWN suppresses re-fires
// until it clears. The rule below mirrors a CPU saturation alert.
const RULE_ID = 'cpu-saturation';
const HOST_ID = 'web-01';
const SCRIPT = 'scripts/drain_and_restart.sh';
const THRESHOLD = 85; // percent
const ARM_TICKS = 3; // breach must hold this many samples (duration_seconds knob)
const COOLDOWN_TICKS = 6; // suppress re-fires for this many samples

type Phase = 'OK' | 'ARMING' | 'FIRING' | 'COOLDOWN';

type AuditRow = {
  id: number;
  rule: string;
  script: string;
  exit: number;
  ms: number;
};

const W = 540;
const H = 180;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const WINDOW = 40; // samples visible

const ease = [0.22, 1, 0.36, 1] as const;

const states: { name: Phase; tone: 'ok' | 'hot'; sub: string }[] = [
  { name: 'OK', tone: 'ok', sub: 'below threshold' },
  { name: 'ARMING', tone: 'hot', sub: 'breach holding' },
  { name: 'FIRING', tone: 'hot', sub: 'webhook + audit' },
  { name: 'COOLDOWN', tone: 'hot', sub: 'suppressed' },
];

function yFor(v: number) {
  // metric in 0..120 mapped to plot height (inverted)
  const clamped = Math.max(0, Math.min(120, v));
  return PAD_T + PLOT_H * (1 - clamped / 120);
}

function fakeSig(v: number, n: number) {
  // Deterministic stand-in hex for the X-InfraMonitor-Signature header. This
  // is presentational only; the real header signs a sort_keys body with HMAC.
  let h = (Math.round(v * 100) ^ (n * 2654435761)) >>> 0;
  let out = '';
  for (let i = 0; i < 16; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out += (h & 0xf).toString(16);
  }
  return out;
}

export default function InfraMonitorDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [pushed, setPushed] = useState(false); // user pushed metric high
  const [samples, setSamples] = useState<number[]>(() =>
    Array.from({ length: WINDOW }, () => 30 + Math.random() * 12),
  );
  const [phase, setPhase] = useState<Phase>('OK');
  const [armCount, setArmCount] = useState(0);
  const [coolCount, setCoolCount] = useState(0);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [fireCount, setFireCount] = useState(0);
  const [lastSig, setLastSig] = useState<string | null>(null);

  // refs so the interval closure reads live state
  const phaseRef = useRef(phase);
  const armRef = useRef(armCount);
  const coolRef = useRef(coolCount);
  const pushedRef = useRef(pushed);
  const tickRef = useRef(0);
  const fireRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    phaseRef.current = phase;
    armRef.current = armCount;
    coolRef.current = coolCount;
    pushedRef.current = pushed;
  }, [phase, armCount, coolCount, pushed]);

  const current = samples[samples.length - 1] ?? 0;

  function stopTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => stopTimer, []);

  function nextSample(): number {
    const base = pushedRef.current ? 96 : 34;
    const jitter = (Math.random() - 0.5) * 10;
    return Math.max(2, Math.min(118, base + jitter));
  }

  function step() {
    const v = nextSample();
    tickRef.current += 1;
    const n = tickRef.current;

    setSamples((s) => {
      const next = [...s, v];
      return next.length > WINDOW ? next.slice(next.length - WINDOW) : next;
    });

    const breach = v >= THRESHOLD;
    let ph = phaseRef.current;

    if (ph === 'COOLDOWN') {
      const c = coolRef.current + 1;
      if (c >= COOLDOWN_TICKS) {
        setCoolCount(0);
        coolRef.current = 0;
        ph = breach ? 'ARMING' : 'OK';
        if (ph === 'ARMING') {
          setArmCount(1);
          armRef.current = 1;
        }
      } else {
        setCoolCount(c);
        coolRef.current = c;
      }
    } else if (ph === 'FIRING') {
      // one-shot: immediately enter cooldown after firing
      ph = 'COOLDOWN';
      setCoolCount(0);
      coolRef.current = 0;
    } else if (breach) {
      if (ph === 'OK') {
        ph = 'ARMING';
        setArmCount(1);
        armRef.current = 1;
      } else if (ph === 'ARMING') {
        const a = armRef.current + 1;
        if (a >= ARM_TICKS) {
          // promote to FIRING: dispatch webhook + drop one audit row
          ph = 'FIRING';
          fireRef.current += 1;
          setFireCount(fireRef.current);
          setLastSig(fakeSig(v, n));
          setAudit((rows) => {
            const row: AuditRow = {
              id: fireRef.current,
              rule: RULE_ID,
              script: SCRIPT,
              exit: 0,
              ms: 180 + Math.round(Math.random() * 240),
            };
            return [row, ...rows].slice(0, 6);
          });
          setArmCount(0);
          armRef.current = 0;
        } else {
          setArmCount(a);
          armRef.current = a;
        }
      }
    } else {
      // no breach
      if (ph === 'ARMING') {
        ph = 'OK';
        setArmCount(0);
        armRef.current = 0;
      } else {
        ph = 'OK';
      }
    }

    if (ph !== phaseRef.current) {
      phaseRef.current = ph;
      setPhase(ph);
    }
  }

  function start() {
    if (running) return;
    setRunning(true);
    if (reduce) {
      // Reduced motion: run a deterministic burst that produces one fire.
      pushedRef.current = true;
      setPushed(true);
      for (let i = 0; i < ARM_TICKS + 1; i++) step();
      pushedRef.current = false;
      setPushed(false);
      step();
      setRunning(false);
      return;
    }
    timerRef.current = setInterval(step, 420);
  }

  function pause() {
    stopTimer();
    setRunning(false);
  }

  function reset() {
    stopTimer();
    setRunning(false);
    setPushed(false);
    pushedRef.current = false;
    setPhase('OK');
    phaseRef.current = 'OK';
    setArmCount(0);
    armRef.current = 0;
    setCoolCount(0);
    coolRef.current = 0;
    setAudit([]);
    setFireCount(0);
    fireRef.current = 0;
    setLastSig(null);
    tickRef.current = 0;
    setSamples(Array.from({ length: WINDOW }, () => 30 + Math.random() * 12));
  }

  function togglePush() {
    setPushed((p) => {
      pushedRef.current = !p;
      return !p;
    });
  }

  const points = samples
    .map((v, i) => {
      const x = PAD_L + (PLOT_W * i) / (WINDOW - 1);
      return `${x.toFixed(1)},${yFor(v).toFixed(1)}`;
    })
    .join(' ');

  const threshY = yFor(THRESHOLD);
  const phaseSub =
    phase === 'ARMING'
      ? `${armCount} of ${ARM_TICKS} samples`
      : phase === 'COOLDOWN'
        ? `${coolCount} of ${COOLDOWN_TICKS} clear`
        : undefined;

  return (
    <div className="demo" aria-label="infra-monitor alert state machine demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Arm, fire, cool down</h3>
      <p className="demo__lede">
        Push the metric stream past its {THRESHOLD}% threshold and watch the
        alert walk OK to ARMING to FIRING to COOLDOWN. A breach must hold for{' '}
        {ARM_TICKS} samples before it fires, and firing dispatches one signed
        webhook and drops one audit row, then cooldown suppresses re-fires.
      </p>

      <div className="im__stage">
        <div className="im__chartwrap">
          <svg
            className="im__chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`metric at ${Math.round(current)} percent, threshold ${THRESHOLD} percent, state ${phase}`}
          >
            <line
              x1={PAD_L}
              y1={threshY}
              x2={W - PAD_R}
              y2={threshY}
              stroke="var(--accent)"
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.8}
            />
            <text x={PAD_L + 2} y={threshY - 5} className="im__thresh-label">
              threshold {THRESHOLD}%
            </text>
            <text x={4} y={PAD_T + 6} className="im__axis-label">
              120
            </text>
            <text x={10} y={H - PAD_B + 14} className="im__axis-label">
              0
            </text>
            <motion.polyline
              points={points}
              fill="none"
              stroke={
                phase === 'FIRING' || phase === 'ARMING'
                  ? 'var(--accent)'
                  : '#4fd08a'
              }
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              animate={{ stroke: undefined }}
            />
            <circle
              cx={PAD_L + PLOT_W}
              cy={yFor(current)}
              r={4}
              fill={phase === 'OK' ? '#4fd08a' : 'var(--accent)'}
            />
          </svg>
        </div>

        <div className="im__machine" role="group" aria-label="alert state machine">
          {states.map((s) => (
            <div
              key={s.name}
              className="im__state"
              data-on={phase === s.name}
              data-tone={s.tone}
              aria-current={phase === s.name ? 'step' : undefined}
            >
              <div className="im__state-name">{s.name}</div>
              <div className="im__state-sub">
                {phase === s.name && phaseSub ? phaseSub : s.sub}
              </div>
            </div>
          ))}
        </div>

        <div className="im__readout">
          <div className="im__metric">
            <div className="im__metric-val">
              {Math.round(current)}
              <span className="im__metric-unit">%</span>
            </div>
            <div className="im__metric-name">cpu, {HOST_ID}</div>
          </div>
          <div className="im__metric">
            <div className="im__metric-val">{fireCount}</div>
            <div className="im__metric-name">fires</div>
          </div>
          <div className="im__metric">
            <div className="im__metric-val">{audit.length}</div>
            <div className="im__metric-name">audit rows</div>
          </div>
        </div>

        <div className="im__grid">
          <div className="im__panel">
            <div className="im__panel-head">
              <span>Remediation audit log</span>
              <span className="im__panel-count">{audit.length}</span>
            </div>
            {audit.length === 0 ? (
              <p className="im__audit-empty">No remediation runs yet.</p>
            ) : (
              <ul className="im__audit">
                <AnimatePresence initial={false}>
                  {audit.map((r) => (
                    <motion.li
                      key={r.id}
                      className="im__audit-row"
                      initial={{ opacity: 0, y: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.3, ease }}
                    >
                      <span className="im__audit-rule">{r.rule}</span>
                      <span className="im__audit-script">
                        {r.script} ({r.ms}ms)
                      </span>
                      <span className="im__audit-exit">exit {r.exit}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          <div className="im__panel">
            <div className="im__panel-head">
              <span>Signed webhook</span>
            </div>
            <div className="im__webhook">
              POST <b>/hooks/alert</b>
              <br />
              rule_id: <b>{RULE_ID}</b>
              <br />
              host_id: <b>{HOST_ID}</b>
              <br />
              X-InfraMonitor-Signature:
              <br />
              {lastSig ? (
                <span className="im__sig">sha256={lastSig}</span>
              ) : (
                <span style={{ color: 'var(--text-faint)' }}>
                  (none dispatched yet)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        {running ? (
          <button className="demo__btn" onClick={pause}>
            Pause
          </button>
        ) : (
          <button className="demo__btn" onClick={start}>
            Run stream
          </button>
        )}
        <button
          className="demo__btn demo__btn--ghost"
          onClick={togglePush}
          aria-pressed={pushed}
        >
          {pushed ? 'Release load' : 'Push CPU high'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          state: {phase}
          {phaseSub ? ` (${phaseSub})` : ''}
        </span>
      </div>
    </div>
  );
}
