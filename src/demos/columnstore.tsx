import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './columnstore.css';

// Real numbers from the project:
// AVX2 vs scalar speedup is filter 7.9x; the filter kernel hits 7.788 B
// values/sec at 1M rows cache-resident; the batch size is 4096 int32 = 16 KiB,
// half a typical Skylake L1d. Eight int32 lanes per AVX2 compare pack into a
// bitmap, which the scalar path builds one value at a time.
const SPEEDUP = 7.9;
const AVX_GVPS = 7.788; // billion values/sec
const SCALAR_GVPS = +(AVX_GVPS / SPEEDUP).toFixed(3); // ~0.986
const BATCH = 4096;
const LANES = 8;
const TOTAL_ROWS = 1_000_000;

// A fixed, deterministic 8-wide vector of int32 values (one AVX2 register).
const VEC = [37, 91, 12, 64, 8, 73, 50, 29];

export default function ColumnstoreDemo() {
  const reduce = useReducedMotion();
  const [threshold, setThreshold] = useState(50);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [batchesDone, setBatchesDone] = useState(0);
  const [avxRows, setAvxRows] = useState(0);
  const [scalarRows, setScalarRows] = useState(0);
  const [avxMs, setAvxMs] = useState(0);
  const [scalarMs, setScalarMs] = useState(0);
  const rafRef = useRef<number | null>(null);

  // The mask the AVX2 _mm256_cmpgt compare produces for this vector: value > threshold.
  const mask = useMemo<number[]>(
    () => VEC.map((v) => (v > threshold ? 1 : 0)),
    [threshold],
  );
  const passCount = mask.reduce((a, b) => a + b, 0);
  const totalBatches = Math.ceil(TOTAL_ROWS / BATCH);

  // Wall-clock the two paths get to in this animation, scaled from real GVPS.
  const avxTargetMs = +((TOTAL_ROWS / (AVX_GVPS * 1e9)) * 1e3).toFixed(3);
  const scalarTargetMs = +((TOTAL_ROWS / (SCALAR_GVPS * 1e9)) * 1e3).toFixed(3);

  function stop() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  useEffect(() => stop, []);

  function reset() {
    stop();
    setRunning(false);
    setDone(false);
    setBatchesDone(0);
    setAvxRows(0);
    setScalarRows(0);
    setAvxMs(0);
    setScalarMs(0);
  }

  function run() {
    if (running) return;
    setRunning(true);
    setDone(false);
    setBatchesDone(0);
    setAvxRows(0);
    setScalarRows(0);
    setAvxMs(0);
    setScalarMs(0);

    if (reduce) {
      setBatchesDone(totalBatches);
      setAvxRows(TOTAL_ROWS);
      setScalarRows(TOTAL_ROWS);
      setAvxMs(avxTargetMs);
      setScalarMs(scalarTargetMs);
      setRunning(false);
      setDone(true);
      return;
    }

    // The AVX2 path finishes 7.9x sooner; the scalar path keeps climbing.
    const avxDuration = 900;
    const scalarDuration = avxDuration * SPEEDUP;
    const start = performance.now();

    const tick = (now: number) => {
      const t = now - start;
      const ap = Math.min(1, t / avxDuration);
      const sp = Math.min(1, t / scalarDuration);

      setAvxRows(Math.round(TOTAL_ROWS * ap));
      setScalarRows(Math.round(TOTAL_ROWS * sp));
      setAvxMs(+(avxTargetMs * ap).toFixed(3));
      setScalarMs(+(scalarTargetMs * sp).toFixed(3));
      setBatchesDone(Math.min(totalBatches, Math.round(totalBatches * ap)));

      if (sp < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setAvxRows(TOTAL_ROWS);
        setScalarRows(TOTAL_ROWS);
        setAvxMs(avxTargetMs);
        setScalarMs(scalarTargetMs);
        setBatchesDone(totalBatches);
        setRunning(false);
        setDone(true);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const avxFrac = scalarTargetMs ? avxRows / TOTAL_ROWS : 0;
  const scalarFrac = scalarRows / TOTAL_ROWS;

  return (
    <div className="demo" aria-label="columnstore AVX2 filter demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">AVX2 filter, eight lanes at once</h3>
      <p className="demo__lede">
        One {LANES}-wide int32 vector running the filter compare value greater
        than threshold. Drag the threshold to repack the bitmap, then run the
        full {TOTAL_ROWS.toLocaleString()}-row scan in {BATCH.toLocaleString()}
        -value batches to see the AVX2 path pull away from the scalar reference.
      </p>

      <div className="cs__stage">
        <div className="cs__controls-inline">
          <div className="cs__thresh">
            <label className="cs__thresh-label" htmlFor="cs-threshold">
              <span>filter: value &gt; threshold</span>
              <b>{threshold}</b>
            </label>
            <input
              id="cs-threshold"
              className="cs__slider"
              type="range"
              min={0}
              max={99}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              aria-valuetext={`threshold ${threshold}`}
            />
          </div>
          <span className="cs__progress">
            this vector passes <b>{passCount}</b> of {LANES}
          </span>
        </div>

        <div className="cs__lanes">
          <div className="cs__lanes-head">
            AVX2 register, 8 int32 lanes
            <span className="cs__lanes-tag">_mm256_cmpgt_epi32</span>
          </div>
          <div className="cs__lane-grid">
            {VEC.map((v, i) => {
              const pass = mask[i] === 1;
              return (
                <div className="cs__lane" key={i}>
                  <motion.div
                    className={`cs__lane-cell ${pass ? 'cs__lane-cell--pass' : 'cs__lane-cell--fail'}`}
                    animate={
                      reduce
                        ? {}
                        : { scale: [1, 1.06, 1] }
                    }
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                    key={`${v}-${threshold}`}
                  >
                    {v}
                  </motion.div>
                  <span className={`cs__lane-bit cs__lane-bit--${mask[i]}`}>
                    {mask[i]}
                  </span>
                  <span className="cs__lane-idx">lane {i}</span>
                </div>
              );
            })}
          </div>
          <div className="cs__bitmap">
            <span>result bitmap</span>
            <span className="cs__bitmap-bits">{mask.join('')}</span>
            <span className="cs__bitmap-mask">
              0x{maskToHex(mask)} packed in one store
            </span>
          </div>
        </div>

        <div className="cs__race">
          <div className="cs__track cs__track--avx">
            <div className="cs__track-name">AVX2 kernel</div>
            <div className="cs__track-val">
              {avxMs.toFixed(3)}
              <span className="cs__track-unit">ms</span>
            </div>
            <div className="cs__track-bar" aria-hidden="true">
              <motion.div
                className="cs__track-fill"
                style={{ scaleX: avxFrac }}
                initial={false}
              />
            </div>
            <div className="cs__track-meta">
              {avxRows.toLocaleString()} rows, {AVX_GVPS} B values/sec
            </div>
          </div>
          <div className="cs__track cs__track--scalar">
            <div className="cs__track-name">scalar reference</div>
            <div className="cs__track-val">
              {scalarMs.toFixed(3)}
              <span className="cs__track-unit">ms</span>
            </div>
            <div className="cs__track-bar" aria-hidden="true">
              <motion.div
                className="cs__track-fill"
                style={{ scaleX: scalarFrac }}
                initial={false}
              />
            </div>
            <div className="cs__track-meta">
              {scalarRows.toLocaleString()} rows, one value at a time
            </div>
          </div>
        </div>

        <span className="cs__progress">
          batches: <b>{batchesDone}</b> of {totalBatches} ({BATCH.toLocaleString()} int32 = 16 KiB each)
        </span>

        <AnimatePresence>
          {done && (
            <motion.div
              className="cs__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <span className="cs__verdict-x">{SPEEDUP}x</span>
              <span className="cs__verdict-text">
                The AVX2 filter clears {TOTAL_ROWS.toLocaleString()} rows in{' '}
                {avxTargetMs.toFixed(3)} ms versus {scalarTargetMs.toFixed(3)} ms
                scalar, and every SIMD result is checked bit-exact against the
                scalar path.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Scanning column…' : 'Run filter scan'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          batch {BATCH.toLocaleString()} int32 fits half of L1d
        </span>
      </div>
    </div>
  );
}

function maskToHex(mask: number[]) {
  const bits = mask.reduce((acc, b, i) => acc | (b << i), 0);
  return bits.toString(16).toUpperCase().padStart(2, '0');
}
