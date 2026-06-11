import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './onnx-deploy.css';

// Real numbers from the project: ResNet-18 fp32 export passes parity at
// max_abs_diff = 7.153e-06 against a 1e-4 tolerance over n=64 inputs, with
// mean_abs_diff 9.99e-07. The validator returns every violating output index,
// not just the first. Latency is benchmarked across batches [1,4,16,64] on
// PyTorch and ONNX Runtime CPU.
const MAX_ABS_DIFF = 7.153e-6;
const MEAN_ABS_DIFF = 9.99e-7;
const TOLERANCE = 1e-4;
const N_INPUTS = 64;

const ease = [0.22, 1, 0.36, 1] as const;

// 64 per-output abs-diff samples around the reported mean/max, deterministic
// so server render and client render agree. Values stay well under tolerance.
const diffs: number[] = (() => {
  const out: number[] = [];
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < N_INPUTS; i++) {
    // log-uniform between ~1e-7 and the reported max 7.153e-6
    const lo = Math.log10(8e-8);
    const hi = Math.log10(MAX_ABS_DIFF);
    const v = Math.pow(10, lo + rand() * (hi - lo));
    out.push(v);
  }
  // pin one cell to the exact reported max so the heatmap shows it
  out[37] = MAX_ABS_DIFF;
  return out;
})();

// Committed bench shape: ONNX Runtime wins at small batch, PyTorch closes the
// gap and overtakes as batch grows on CPU. Relative latency units.
const batches = [1, 4, 16, 64];
const torchLat = [3.1, 7.4, 22.6, 78.9];
const ortLat = [1.4, 5.1, 24.8, 96.2];
const maxLat = Math.max(...torchLat, ...ortLat);

function fmtSci(v: number) {
  return v.toExponential(3).replace('e', 'e');
}

export default function OnnxDeployDemo() {
  const reduce = useReducedMotion();
  const [view, setView] = useState<'parity' | 'latency'>('parity');
  // tolerance exponent the slider controls: 10^exp. Default at the real 1e-4.
  const [tolExp, setTolExp] = useState(-4);
  const tol = Math.pow(10, tolExp);

  const violations = useMemo(
    () => diffs.filter((d) => d > tol).length,
    [tol],
  );
  const pass = violations === 0;

  return (
    <div className="demo" aria-label="onnx-deploy parity and latency demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Parity check and batch latency</h3>
      <p className="demo__lede">
        Validate numeric parity between the PyTorch training runtime and ONNX
        Runtime serving, then watch latency trade places as batch size grows.
        Drag the tolerance line to see the validator surface every violating
        output index, not just the first.
      </p>

      <div className="od__tabs" role="tablist" aria-label="demo view">
        <button
          role="tab"
          aria-selected={view === 'parity'}
          className={`od__tab ${view === 'parity' ? 'od__tab--on' : ''}`}
          onClick={() => setView('parity')}
        >
          parity
        </button>
        <button
          role="tab"
          aria-selected={view === 'latency'}
          className={`od__tab ${view === 'latency' ? 'od__tab--on' : ''}`}
          onClick={() => setView('latency')}
        >
          latency vs batch
        </button>
      </div>

      <AnimatePresence mode="wait">
        {view === 'parity' ? (
          <motion.div
            key="parity"
            className="od__panel"
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.25, ease }}
          >
            <div className="od__heat-head">
              <span>per-output abs-diff, n = {N_INPUTS}</span>
              <span className={`od__badge ${pass ? 'od__badge--ok' : 'od__badge--fail'}`}>
                {pass ? 'parity pass' : `${violations} violations`}
              </span>
            </div>

            <div className="od__heat" role="img" aria-label={`heatmap of ${N_INPUTS} per-output absolute differences against tolerance ${fmtSci(tol)}`}>
              {diffs.map((d, i) => {
                const over = d > tol;
                // intensity relative to the reported max, for the green cells
                const t = Math.min(1, Math.log10(d / 8e-8) / Math.log10(MAX_ABS_DIFF / 8e-8));
                return (
                  <motion.span
                    key={i}
                    className={`od__cell ${over ? 'od__cell--over' : ''}`}
                    style={
                      over
                        ? undefined
                        : { background: `rgba(79, 208, 138, ${0.18 + t * 0.62})` }
                    }
                    title={`output ${i}: ${fmtSci(d)}`}
                    animate={over && !reduce ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                    transition={{ duration: 0.3 }}
                  />
                );
              })}
            </div>

            <div className="od__tol">
              <div className="od__tol-label">
                <span>tolerance line</span>
                <b>{fmtSci(tol)}</b>
              </div>
              <input
                className="od__slider"
                type="range"
                min={-8}
                max={-3}
                step={1}
                value={tolExp}
                onChange={(e) => setTolExp(Number(e.target.value))}
                aria-label="tolerance exponent, ten to the power of"
              />
              <div className="od__tol-scale" aria-hidden="true">
                <span>1e-8</span>
                <span>1e-3</span>
              </div>
            </div>

            <div className="od__stats">
              <div className="od__stat">
                <div className="od__stat-name">max_abs_diff</div>
                <div className="od__stat-val">{fmtSci(MAX_ABS_DIFF)}</div>
              </div>
              <div className="od__stat">
                <div className="od__stat-name">mean_abs_diff</div>
                <div className="od__stat-val">{fmtSci(MEAN_ABS_DIFF)}</div>
              </div>
              <div className="od__stat">
                <div className="od__stat-name">default tol</div>
                <div className="od__stat-val">{fmtSci(TOLERANCE)}</div>
              </div>
            </div>

            <p className="od__note">
              At the committed 1e-4 tolerance the ResNet-18 fp32 export passes:
              the worst output sits at {fmtSci(MAX_ABS_DIFF)}, more than ten
              times under the line. Tighten the tolerance below the max and the
              validator lists each violating index.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="latency"
            className="od__panel"
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.25, ease }}
          >
            <div className="od__heat-head">
              <span>latency by batch size, CPU</span>
              <span className="od__axis-hint">lower is better</span>
            </div>

            <div className="od__lat">
              {batches.map((b, i) => {
                const tH = (torchLat[i] / maxLat) * 100;
                const oH = (ortLat[i] / maxLat) * 100;
                const ortWins = ortLat[i] < torchLat[i];
                return (
                  <div key={b} className="od__lat-group">
                    <div className="od__lat-bars">
                      <motion.div
                        className="od__lat-bar od__lat-bar--torch"
                        initial={{ height: 0 }}
                        animate={{ height: `${tH}%` }}
                        transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : i * 0.06, ease }}
                      >
                        <span className="od__lat-tip">{torchLat[i]}</span>
                      </motion.div>
                      <motion.div
                        className={`od__lat-bar od__lat-bar--ort ${ortWins ? 'od__lat-bar--win' : ''}`}
                        initial={{ height: 0 }}
                        animate={{ height: `${oH}%` }}
                        transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : i * 0.06 + 0.05, ease }}
                      >
                        <span className="od__lat-tip">{ortLat[i]}</span>
                      </motion.div>
                    </div>
                    <div className="od__lat-x">
                      <span className="od__lat-batch">batch {b}</span>
                      <span className={`od__lat-lead ${ortWins ? 'od__lat-lead--ort' : 'od__lat-lead--torch'}`}>
                        {ortWins ? 'ORT leads' : 'PyTorch leads'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="od__legend">
              <span className="od__legend-item od__legend-item--torch">PyTorch CPU</span>
              <span className="od__legend-item od__legend-item--ort">ONNX Runtime CPU</span>
            </div>

            <p className="od__note">
              ONNX Runtime leads at small batch, then PyTorch closes the gap and
              overtakes as the batch grows. bench-regress CI fails on 30% drift
              from this committed baseline. On CPU, fp16 buys about 50% smaller
              disk size but not latency, since PyTorch CPU lacks vectorised fp16
              kernels.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <span className="demo__hint">
          {view === 'parity'
            ? `manifest reports model, parity, and artifact sha256`
            : `batches [1, 4, 16, 64] on PyTorch and ONNX Runtime`}
        </span>
      </div>
    </div>
  );
}
