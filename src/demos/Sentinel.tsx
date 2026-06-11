import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './Sentinel.css';

// Real numbers from the project. Verification Tax converts review hours to
// dollars at $150/hr: 100 hours/week of review is framed as $60k/month. The
// pipeline is webhook -> Redis queue -> worker -> daily metrics -> alert rules
// tiered across Slack only, Slack + email, and Slack + email + PagerDuty.
const RATE = 150; // dollars per review hour
const WEEKS_PER_MONTH = 4; // 100 hrs/week * 4 * $150 = $60k/month

type Tier = {
  id: 'T1' | 'T2' | 'T3' | 'T4';
  label: string;
  sample: string;
  // share of generated code that lands in this tier at the slider position
  weight: number;
};

// Risk tiers run from T1 (a generated test file) to T4 (generated
// payment-processing logic) to prioritize what matters.
const TIERS: Tier[] = [
  { id: 'T1', label: 'Test file', sample: 'fixtures.spec.ts', weight: 0.42 },
  { id: 'T2', label: 'Internal util', sample: 'format-date.ts', weight: 0.31 },
  { id: 'T3', label: 'Public API route', sample: 'routes/orders.ts', weight: 0.19 },
  { id: 'T4', label: 'Payment logic', sample: 'billing/charge.ts', weight: 0.08 },
];

// Webhook event the pipeline ingests.
type Stage = 'webhook' | 'queue' | 'worker' | 'metrics' | 'alert';
const STAGES: { id: Stage; label: string; sub: string }[] = [
  { id: 'webhook', label: 'Webhook', sub: 'push / pull_request / review' },
  { id: 'queue', label: 'Redis queue', sub: 'BullMQ, retry + dedup' },
  { id: 'worker', label: 'Worker', sub: 'detect generated code' },
  { id: 'metrics', label: 'Daily metrics', sub: 'percent, tax, saturation' },
  { id: 'alert', label: 'Alert rules', sub: '7 rules, 24h dedup' },
];

// Escalation tiers fire as reviewer saturation crosses thresholds.
const ESCALATION = [
  { at: 0, channels: 'Slack', cls: 'sn__esc--slack' },
  { at: 70, channels: 'Slack + email', cls: 'sn__esc--email' },
  { at: 90, channels: 'Slack + email + PagerDuty', cls: 'sn__esc--page' },
];

const ease = [0.22, 1, 0.36, 1] as const;

function escalationFor(saturation: number) {
  let active = ESCALATION[0];
  for (const e of ESCALATION) if (saturation >= e.at) active = e;
  return active;
}

export default function SentinelDemo() {
  const reduce = useReducedMotion();
  // Generated-code percentage drives the whole readout. Default mid-range.
  const [generatedPct, setGeneratedPct] = useState(38);
  // Weekly review hours feeds the verification tax. Anchored on the 100hr case.
  const [reviewHours, setReviewHours] = useState(100);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [fired, setFired] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Verification tax: review hours -> dollars per month. The 100hr case lands
  // on the project's stated $60k/month figure.
  const monthlyTax = reviewHours * RATE * WEEKS_PER_MONTH;
  // Reviewer saturation rises with both how much is generated and how heavy
  // the review load is, capped at 100.
  const saturation = Math.min(
    100,
    Math.round(generatedPct * 0.7 + (reviewHours / 160) * 60),
  );
  const esc = escalationFor(saturation);

  function runPipeline() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setFired(false);
    setStage(null);

    if (reduce) {
      setStage('alert');
      setFired(saturation >= 70);
      setRunning(false);
      return;
    }

    const order: Stage[] = ['webhook', 'queue', 'worker', 'metrics', 'alert'];
    order.forEach((s, i) => {
      const t = window.setTimeout(() => {
        setStage(s);
        if (s === 'alert') {
          setFired(saturation >= 70);
          const end = window.setTimeout(() => setRunning(false), 700);
          timers.current.push(end);
        }
      }, 520 * i);
      timers.current.push(t);
    });
  }

  function reset() {
    clearTimers();
    setRunning(false);
    setStage(null);
    setFired(false);
  }

  return (
    <div className="demo" aria-label="Sentinel pipeline and metrics demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">From webhook to alert</h3>
      <p className="demo__lede">
        Set how much of the codebase is machine-generated and how many review
        hours it costs, then run the pipeline. A push event flows through the
        Redis queue and a worker to daily metrics, and the saturation meter
        decides which escalation tier fires.
      </p>

      <div className="sn__stage">
        {/* Pipeline track */}
        <ol className="sn__pipe" aria-label="webhook to worker to alert pipeline">
          {STAGES.map((s, i) => {
            const idx = STAGES.findIndex((x) => x.id === stage);
            const reached = stage != null && i <= idx;
            const isCurrent = stage === s.id;
            return (
              <li
                key={s.id}
                className={
                  'sn__node' +
                  (reached ? ' sn__node--on' : '') +
                  (isCurrent ? ' sn__node--cur' : '')
                }
              >
                <span className="sn__node-label">{s.label}</span>
                <span className="sn__node-sub">{s.sub}</span>
                {i < STAGES.length - 1 && (
                  <span className="sn__node-arrow" aria-hidden="true">
                    <motion.span
                      className="sn__node-pulse"
                      initial={false}
                      animate={
                        isCurrent && !reduce
                          ? { x: ['0%', '100%'], opacity: [0, 1, 0] }
                          : { opacity: 0 }
                      }
                      transition={{ duration: 0.5, ease }}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {/* Live gauges */}
        <div className="sn__gauges">
          <Gauge
            name="Generated code"
            value={generatedPct}
            unit="%"
            fill={generatedPct}
          />
          <div className="sn__gauge sn__gauge--tax">
            <div className="sn__gauge-name">Verification tax</div>
            <div className="sn__gauge-val">
              ${Math.round(monthlyTax / 1000)}
              <span className="sn__gauge-unit">k / month</span>
            </div>
            <div className="sn__gauge-meta">
              {reviewHours} hrs/wk at ${RATE}/hr
            </div>
          </div>
          <div
            className={
              'sn__gauge sn__gauge--sat' +
              (saturation >= 90
                ? ' sn__gauge--page'
                : saturation >= 70
                  ? ' sn__gauge--warn'
                  : '')
            }
          >
            <div className="sn__gauge-name">Reviewer saturation</div>
            <div className="sn__gauge-val">
              {saturation}
              <span className="sn__gauge-unit">%</span>
            </div>
            <div className="sn__meter" role="img" aria-label={`saturation ${saturation} percent`}>
              <div className="sn__meter-track">
                <span className="sn__meter-mark" style={{ left: '70%' }} />
                <span className="sn__meter-mark sn__meter-mark--page" style={{ left: '90%' }} />
                <motion.span
                  className="sn__meter-fill"
                  animate={{ width: `${saturation}%` }}
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                />
              </div>
            </div>
            <div className="sn__gauge-meta">{esc.channels}</div>
          </div>
        </div>

        {/* Risk tier split of the generated code */}
        <div className="sn__tiers" aria-label="risk tier breakdown of generated code">
          {TIERS.map((t) => {
            const share = Math.round(generatedPct * t.weight);
            return (
              <div key={t.id} className={'sn__tier sn__tier--' + t.id.toLowerCase()}>
                <div className="sn__tier-head">
                  <span className="sn__tier-id">{t.id}</span>
                  <span className="sn__tier-share">{share}%</span>
                </div>
                <div className="sn__tier-label">{t.label}</div>
                <div className="sn__tier-sample">{t.sample}</div>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {stage === 'alert' && (
            <motion.div
              className={'sn__alert' + (fired ? ' sn__alert--fired' : ' sn__alert--quiet')}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className={'sn__alert-dot ' + esc.cls} aria-hidden="true" />
              <span className="sn__alert-text">
                {fired ? (
                  <>
                    Saturation at {saturation}% crossed the threshold. Alert
                    routed to <b>{esc.channels}</b>, deduplicated for 24 hours.
                  </>
                ) : (
                  <>
                    Saturation at {saturation}% is below the 70% threshold. No
                    rule fired; metrics recorded and dashboard updated.
                  </>
                )}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="sn__sliders">
        <label className="sn__slider-row">
          <span className="sn__slider-label">
            Generated code <b>{generatedPct}%</b>
          </span>
          <input
            className="sn__slider"
            type="range"
            min={0}
            max={100}
            value={generatedPct}
            onChange={(e) => setGeneratedPct(Number(e.target.value))}
            aria-label="Generated code percentage"
          />
        </label>
        <label className="sn__slider-row">
          <span className="sn__slider-label">
            Review load <b>{reviewHours} hrs/wk</b>
          </span>
          <input
            className="sn__slider"
            type="range"
            min={20}
            max={160}
            step={10}
            value={reviewHours}
            onChange={(e) => setReviewHours(Number(e.target.value))}
            aria-label="Weekly review hours"
          />
        </label>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runPipeline} disabled={running}>
          {running ? 'Running…' : 'Run pipeline'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          7 alert rules, tiered Slack to PagerDuty
        </span>
      </div>
    </div>
  );
}

function Gauge({
  name,
  value,
  unit,
  fill,
}: {
  name: string;
  value: number;
  unit: string;
  fill: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="sn__gauge sn__gauge--pct">
      <div className="sn__gauge-name">{name}</div>
      <div className="sn__gauge-val">
        {value}
        <span className="sn__gauge-unit">{unit}</span>
      </div>
      <div className="sn__bar" aria-hidden="true">
        <motion.span
          className="sn__bar-fill"
          animate={{ width: `${fill}%` }}
          transition={{ duration: reduce ? 0 : 0.4, ease }}
        />
      </div>
    </div>
  );
}
