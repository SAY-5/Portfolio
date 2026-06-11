import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './export-validator.css';

// Real project facts. The validator walks a model leaf by leaf, exports each
// leaf as a named ONNX output, runs PyTorch and ONNX Runtime on the same
// bytes, and flags the first layer whose max-abs diff exceeds the tolerance as
// the drift origin, then propagates downstream.
//   ResNet-18 fp32: 60 layers, 0 over 1e-4, worst 9.537e-06 at layer4.1.relu,
//   drift origin none.
//   ViT-B/16: the only swept model with layers over 1e-4 (12 layers), drift
//   originating at encoder layer 5's MLP block.
const TOL = 1e-4;
const TOL_EXP = -4; // log10 tolerance, the reference line on the plot

type Model = {
  id: string;
  label: string;
  layerCount: number;
  worst: number; // worst max-abs diff
  worstLayer: string;
  overCount: number;
  originIndex: number | null; // index of first bar over tolerance
  originLabel: string;
};

const MODELS: Record<string, Model> = {
  resnet: {
    id: 'resnet',
    label: 'ResNet-18 fp32',
    layerCount: 60,
    worst: 9.537e-6,
    worstLayer: 'layer4.1.relu',
    overCount: 0,
    originIndex: null,
    originLabel: 'none',
  },
  vit: {
    id: 'vit',
    label: 'ViT-B/16',
    layerCount: 48,
    worst: 6.2e-3,
    worstLayer: 'encoder.layer.5.mlp',
    overCount: 12,
    originIndex: 22, // drift origin around encoder layer 5's MLP block
    originLabel: 'encoder.layer.5.mlp',
  },
};

// log10 magnitude range shown on the plot: 1e-8 (floor) to 1e-2 (ceil)
const LOG_FLOOR = -8;
const LOG_CEIL = -2;

function logToPct(diff: number) {
  if (diff <= 0) return 0;
  const l = Math.log10(diff);
  const clamped = Math.max(LOG_FLOOR, Math.min(LOG_CEIL, l));
  return ((clamped - LOG_FLOOR) / (LOG_CEIL - LOG_FLOOR)) * 100;
}

// Deterministic per-layer diffs so the SSR and client agree and the demo is
// reproducible. Below-origin layers sit near float32 noise; at and past the
// drift origin they jump over tolerance and stay elevated.
function buildDiffs(m: Model): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.layerCount; i++) {
    // pseudo-random but stable per (model, index)
    const seed = (i * 2654435761 + m.layerCount * 40503) >>> 0;
    const r = ((seed % 1000) / 1000) * 0.6 + 0.2; // 0.2..0.8
    if (m.originIndex !== null && i >= m.originIndex) {
      // over tolerance: between ~1.2e-4 and ~6e-3, peaking at the origin
      const dist = i - m.originIndex;
      const peak = m.worst * Math.pow(0.86, dist) * (0.7 + r * 0.6);
      out.push(Math.max(1.2e-4, peak));
    } else {
      // below tolerance noise floor, with the worst clean layer near the end
      let v = 1e-7 * (1 + r * 80); // up to ~8e-6
      if (m.originIndex === null && i === m.layerCount - 4) v = m.worst;
      out.push(v);
    }
  }
  return out;
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function ExportValidatorDemo() {
  const reduce = useReducedMotion();
  const [modelId, setModelId] = useState<'resnet' | 'vit'>('vit');
  const model = MODELS[modelId];
  const diffs = useMemo(() => buildDiffs(model), [model]);

  const [revealed, setRevealed] = useState(0); // how many bars are checked
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // Reset the reveal when switching models. React's adjust-state-on-input
  // pattern: compare against the last seen model during render and reset in
  // place, with the interval torn down by the effect below.
  const [lastModelId, setLastModelId] = useState(modelId);
  if (modelId !== lastModelId) {
    setLastModelId(modelId);
    setRunning(false);
    setRevealed(0);
  }
  useEffect(() => clearTimer, [modelId, clearTimer]);

  function run() {
    if (running) return;
    clearTimer();
    setRevealed(0);
    setRunning(true);

    if (reduce) {
      setRevealed(model.layerCount);
      setRunning(false);
      return;
    }

    let i = 0;
    timerRef.current = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= model.layerCount) {
        clearTimer();
        setRunning(false);
      }
    }, 38);
  }

  function reset() {
    clearTimer();
    setRunning(false);
    setRevealed(0);
  }

  const finished = revealed >= model.layerCount;
  const driftFound =
    model.originIndex !== null && revealed > model.originIndex;
  const tolPct = logToPct(TOL);

  // which layer the cursor is currently on
  const cursorLabel =
    revealed === 0
      ? 'not started'
      : finished
        ? `${model.layerCount} layers checked`
        : `checking leaf ${revealed} of ${model.layerCount}`;

  return (
    <div className="demo" aria-label="export-validator per-layer parity demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Find the layer where exports diverge</h3>
      <p className="demo__lede">
        Trace a model leaf by leaf as per-layer max-abs diff bars rise between
        PyTorch and ONNX Runtime. The first bar to cross the 1e-4 tolerance line
        is flagged as the drift origin and the divergence propagates downstream.
      </p>

      <div className="ev__tabs" role="tablist" aria-label="model to validate">
        {Object.values(MODELS).map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={modelId === m.id}
            className={`ev__tab ${modelId === m.id ? 'ev__tab--on' : ''}`}
            onClick={() => setModelId(m.id as 'resnet' | 'vit')}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="ev__stage">
        <div className="ev__plotwrap">
          <div className="ev__tolrow">
            <span>
              max-abs diff per leaf, log scale 1e{LOG_FLOOR} to 1e{LOG_CEIL}
            </span>
            <span>
              tolerance <b>1e{TOL_EXP}</b>
            </span>
          </div>
          <div
            className="ev__bars"
            role="img"
            aria-label={`per-layer diff bars for ${model.label}, ${model.overCount} over tolerance`}
          >
            <div
              className="ev__tolline"
              style={{ bottom: `${tolPct}%` }}
              aria-hidden
            />
            {diffs.map((d, i) => {
              const checked = i < revealed;
              const over = d > TOL;
              const isOrigin = model.originIndex === i;
              const cls = !checked
                ? 'ev__bar ev__bar--pending'
                : isOrigin && checked
                  ? 'ev__bar ev__bar--origin'
                  : over
                    ? 'ev__bar ev__bar--over'
                    : 'ev__bar';
              const heightPct = checked ? logToPct(d) : 0;
              const flash =
                isOrigin && checked && !reduce
                  ? { opacity: [1, 0.45, 1] }
                  : {};
              return (
                <motion.div
                  key={i}
                  className={cls}
                  initial={false}
                  animate={{ height: `${Math.max(checked ? 2 : 0, heightPct)}%`, ...flash }}
                  transition={{
                    height: { duration: reduce ? 0 : 0.18, ease },
                    opacity: { duration: 0.5, repeat: isOrigin ? 2 : 0 },
                  }}
                  title={`layer ${i + 1}: ${d.toExponential(2)}`}
                />
              );
            })}
          </div>
          <div className="ev__layerlabel">
            {driftFound ? (
              <>
                drift origin: <b>{model.originLabel}</b>, propagating downstream
              </>
            ) : (
              cursorLabel
            )}
          </div>
        </div>

        <div className="ev__readout">
          <div className="ev__stat">
            <div className="ev__stat-val">{model.layerCount}</div>
            <div className="ev__stat-name">layers checked</div>
          </div>
          <div className="ev__stat">
            <div className="ev__stat-val">
              {finished ? model.overCount : driftFound ? '...' : 0}
            </div>
            <div className="ev__stat-name">over 1e-4</div>
          </div>
          <div
            className={`ev__stat ${model.originIndex !== null && finished ? 'ev__stat--origin' : ''}`}
          >
            <div className="ev__stat-val" style={{ fontSize: '15px' }}>
              {finished
                ? model.worst.toExponential(3)
                : revealed > 0
                  ? diffs
                      .slice(0, revealed)
                      .reduce((a, b) => Math.max(a, b), 0)
                      .toExponential(2)
                  : '0'}
            </div>
            <div className="ev__stat-name">worst max-abs diff</div>
          </div>
        </div>

        <AnimatePresence>
          {finished && (
            <motion.div
              className={`ev__verdict ${model.originIndex !== null ? 'ev__verdict--drift' : ''}`}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="ev__verdict-head">
                {model.originIndex !== null
                  ? `drift origin: ${model.originLabel}`
                  : 'no drift'}
              </span>
              <span className="ev__verdict-text">
                {model.originIndex !== null
                  ? `${model.overCount} layers exceed 1e-4, first at ${model.originLabel}. Worst max-abs diff ${model.worst.toExponential(3)}. The C++ and Python comparators emit byte-identical JSON for this report.`
                  : `${model.layerCount} layers checked, 0 exceeding 1e-4. Worst max-abs diff ${model.worst.toExponential(3)} at ${model.worstLayer}, so PyTorch and ONNX Runtime agree end to end.`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Tracing...' : 'Trace layers'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">{cursorLabel}</span>
      </div>
    </div>
  );
}
