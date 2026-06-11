import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './govgate.css';

// Real mechanism. A submitted tool is scored against a weighted requirements
// checklist across categories. Each requirement carries a weight and a
// severity (low/medium/high/critical). A single failed critical requirement
// caps the overall band at high or worse, no matter the weighted score. The
// reviewed tool then lands in a queryable register.
type Severity = 'low' | 'medium' | 'high' | 'critical';

type Req = {
  id: string;
  category: string;
  label: string;
  weight: number;
  severity: Severity;
  pass: boolean;
};

const INITIAL: Req[] = [
  { id: 'r1', category: 'Data residency', label: 'data stays in approved regions', weight: 3, severity: 'high', pass: true },
  { id: 'r2', category: 'PII handling', label: 'no PII sent to the model', weight: 4, severity: 'critical', pass: true },
  { id: 'r3', category: 'Model provenance', label: 'model and version disclosed', weight: 2, severity: 'medium', pass: true },
  { id: 'r4', category: 'Retention', label: 'prompts purged within 30 days', weight: 2, severity: 'high', pass: true },
  { id: 'r5', category: 'Human oversight', label: 'human in the loop on actions', weight: 3, severity: 'high', pass: true },
  { id: 'r6', category: 'Security', label: 'SSO and audit logging', weight: 3, severity: 'critical', pass: true },
  { id: 'r7', category: 'Vendor stability', label: 'vendor passes financial check', weight: 1, severity: 'low', pass: true },
];

const BANDS = ['low', 'medium', 'high', 'critical'] as const;
type Band = (typeof BANDS)[number];

// Band ordering helper: a higher index is a worse band.
function bandIndex(b: Band) {
  return BANDS.indexOf(b);
}

const ease = [0.22, 1, 0.36, 1] as const;

type RegisterRow = { id: number; name: string; band: Band; status: string };

let nextToolId = 142;

export default function GovgateDemo() {
  const reduce = useReducedMotion();
  const [reqs, setReqs] = useState<Req[]>(INITIAL);
  const [register, setRegister] = useState<RegisterRow[]>([
    { id: 140, name: 'transcribe-svc', band: 'low', status: 'approved' },
    { id: 141, name: 'doc-summarizer', band: 'medium', status: 'needs-info' },
  ]);

  const totalWeight = useMemo(
    () => reqs.reduce((s, r) => s + r.weight, 0),
    [reqs],
  );
  const failedWeight = useMemo(
    () => reqs.filter((r) => !r.pass).reduce((s, r) => s + r.weight, 0),
    [reqs],
  );

  // Weighted risk score: share of failed weight, on a 0-100 scale.
  const riskScore = Math.round((failedWeight / totalWeight) * 100);

  const failedCritical = reqs.some((r) => !r.pass && r.severity === 'critical');

  // Score band before the critical cap is applied.
  const scoreBand: Band =
    riskScore === 0 ? 'low' : riskScore < 25 ? 'low' : riskScore < 50 ? 'medium' : riskScore < 75 ? 'high' : 'critical';

  // A failed critical requirement caps the overall band at high or worse.
  const cappedBand: Band =
    failedCritical && bandIndex(scoreBand) < bandIndex('high') ? 'high' : scoreBand;

  const capApplied = cappedBand !== scoreBand;

  // Per-category meter values: failed weight share within each category.
  const categories = useMemo(() => {
    const map = new Map<string, { failed: number; total: number; sev: Severity; failedAny: boolean }>();
    for (const r of reqs) {
      const cur = map.get(r.category) ?? { failed: 0, total: 0, sev: r.severity, failedAny: false };
      cur.total += r.weight;
      if (!r.pass) {
        cur.failed += r.weight;
        cur.failedAny = true;
      }
      map.set(r.category, cur);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      pct: Math.round((v.failed / v.total) * 100),
      sev: v.sev,
      failedAny: v.failedAny,
    }));
  }, [reqs]);

  function toggle(id: string) {
    setReqs((prev) => prev.map((r) => (r.id === id ? { ...r, pass: !r.pass } : r)));
  }

  function reset() {
    setReqs(INITIAL);
  }

  function fileToRegister() {
    const status =
      cappedBand === 'low'
        ? 'approved'
        : cappedBand === 'medium'
          ? 'needs-info'
          : 'rejected';
    setRegister((prev) =>
      [{ id: nextToolId++, name: 'new-tool-intake', band: cappedBand, status }, ...prev].slice(0, 5),
    );
  }

  return (
    <div className="demo" aria-label="GovGate risk assessment demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Score a tool, set its band</h3>
      <p className="demo__lede">
        A submitted tool runs the weighted requirements checklist. Toggle a
        requirement to fail it and watch its category meter fill and the overall
        band shift. Fail a critical requirement and the band is capped at high
        or worse, whatever the weighted score says. File the result into the
        register when you are done.
      </p>

      <div className="gg__stage">
        <div className="gg__checklist">
          {reqs.map((r) => (
            <button
              key={r.id}
              className={`gg__req ${r.pass ? 'is-pass' : 'is-fail'}`}
              onClick={() => toggle(r.id)}
              aria-pressed={!r.pass}
              aria-label={`${r.category}: ${r.label}, ${r.severity} severity, currently ${
                r.pass ? 'passing' : 'failing'
              }. Toggle.`}
            >
              <span className="gg__req-box" aria-hidden="true">
                {r.pass ? '✓' : '✕'}
              </span>
              <span className="gg__req-body">
                <span className="gg__req-cat">{r.category}</span>
                <span className="gg__req-label">{r.label}</span>
              </span>
              <span className={`gg__sev gg__sev--${r.severity}`}>{r.severity}</span>
              <span className="gg__req-w">w{r.weight}</span>
            </button>
          ))}
        </div>

        <div className="gg__side">
          <div className="gg__meters">
            {categories.map((c) => (
              <div key={c.name} className="gg__meter-row">
                <span className="gg__meter-name">{c.name}</span>
                <span className="gg__meter-track" aria-hidden="true">
                  <motion.span
                    className={`gg__meter-fill ${c.failedAny ? 'is-hot' : ''}`}
                    animate={{ width: `${c.pct}%` }}
                    transition={{ duration: reduce ? 0 : 0.45, ease }}
                  />
                </span>
                <span className="gg__meter-pct">{c.pct}</span>
              </div>
            ))}
          </div>

          <div className={`gg__band gg__band--${cappedBand}`} aria-live="polite">
            <div className="gg__band-name">overall risk band</div>
            <div className="gg__band-val">{cappedBand}</div>
            <div className="gg__band-meta">
              weighted score {riskScore} / 100
              <AnimatePresence>
                {capApplied && (
                  <motion.span
                    className="gg__cap"
                    initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    critical failure caps band from {scoreBand} to {cappedBand}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="gg__register">
          <div className="gg__register-head">
            <span>register</span>
            <span className="gg__register-sub">every reviewed tool</span>
          </div>
          <AnimatePresence initial={false}>
            {register.map((row) => (
              <motion.div
                key={row.id}
                className="gg__reg-row"
                initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <span className="gg__reg-id">#{row.id}</span>
                <span className="gg__reg-name">{row.name}</span>
                <span className={`gg__reg-band gg__band--${row.band}`}>{row.band}</span>
                <span className={`gg__reg-status status--${row.status}`}>{row.status}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={fileToRegister}>
          File to register
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset checklist
        </button>
        <span className="demo__hint">
          {failedCritical ? 'critical requirement failing' : 'all critical requirements pass'}
        </span>
      </div>
    </div>
  );
}
