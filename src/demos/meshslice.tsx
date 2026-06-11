import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './meshslice.css';

// Real mechanism: a triangle mesh is partitioned into a disjoint spatial cover
// (each triangle owned by the cell containing its centroid), processed on a
// bounded-memory thread pool, then merged by partition index so output is
// bit-identical across thread counts {1, 2, 4, 8}. Embarrassingly-parallel
// operators scale near-linearly across cores; bench-regress fails on >30% drift.

const GRID = 4; // 4 x 4 = 16 spatial cells
const CELL_COUNT = GRID * GRID;
const CORE_OPTS = [1, 2, 4, 8] as const;
const MAX_UNIT_BYTES = 512; // KB per work unit (illustrative bound, shown as-is)

const ease = [0.22, 1, 0.36, 1] as const;

// Deterministic per-cell triangle counts so the canonical hash is stable.
// Seeded so the demo renders identically on server and client.
const cellTris = Array.from({ length: CELL_COUNT }, (_, i) => 40 + ((i * 37) % 90));
const TOTAL_TRIS = cellTris.reduce((a, b) => a + b, 0);

// A canonical digest folded over the partition indices in order. The point is
// that it does not depend on thread count: merge happens by partition index.
function canonicalHash(): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < CELL_COUNT; i++) {
    h ^= (i + 1) * 0x9e3779b1;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= cellTris[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const DIGEST = canonicalHash();

// Near-linear scaling with a small fixed merge cost that does not parallelize.
// efficiency = speedup / cores, reported as a percentage.
const SERIAL_FRACTION = 0.06; // ~6% canonical merge stays serial
function speedup(cores: number): number {
  // Amdahl with the serial merge fraction.
  return 1 / (SERIAL_FRACTION + (1 - SERIAL_FRACTION) / cores);
}
function efficiency(cores: number): number {
  return (speedup(cores) / cores) * 100;
}

type Phase = 'idle' | 'partition' | 'process' | 'merge' | 'done';

export default function MeshsliceDemo() {
  const reduce = useReducedMotion();
  const [cores, setCores] = useState<number>(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [doneCells, setDoneCells] = useState<number>(0);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  const peakKb = cores * MAX_UNIT_BYTES;

  function run() {
    clearTimers();
    setPhase('partition');
    setDoneCells(0);

    if (reduce) {
      setDoneCells(CELL_COUNT);
      setPhase('done');
      return;
    }

    const at = (ms: number, fn: () => void) =>
      timers.current.push(window.setTimeout(fn, ms));

    at(650, () => setPhase('process'));

    // Cells finish in waves sized by the worker count: with more workers,
    // more cells clear per tick, so the whole pass finishes sooner.
    const perTick = cores;
    const tickMs = 360;
    let cleared = 0;
    let tick = 1;
    while (cleared < CELL_COUNT) {
      cleared = Math.min(CELL_COUNT, cleared + perTick);
      const snapshot = cleared;
      at(650 + tick * tickMs, () => setDoneCells(snapshot));
      tick++;
    }
    const processEnd = 650 + tick * tickMs;
    at(processEnd, () => setPhase('merge'));
    at(processEnd + 700, () => setPhase('done'));
  }

  function reset() {
    clearTimers();
    setPhase('idle');
    setDoneCells(0);
  }

  const eff = efficiency(cores);
  const sp = speedup(cores);
  const running = phase === 'partition' || phase === 'process' || phase === 'merge';

  const phaseLabel: Record<Phase, string> = {
    idle: 'ready',
    partition: 'partitioning into a disjoint spatial cover',
    process: 'processing units on a bounded thread pool',
    merge: 'merging by partition index',
    done: 'bit-identical output committed',
  };

  return (
    <div className="demo" aria-label="meshslice parallel pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Partition, process, merge in canonical order</h3>
      <p className="demo__lede">
        The mesh splits into a 4 by 4 spatial grid where every triangle is owned
        by exactly one cell. Pick a worker count and run the pass: units flow
        through a bounded thread pool and reassemble by partition index, so the
        digest stays the same no matter how many threads ran.
      </p>

      <div className="ms__stage">
        <div className="ms__gridwrap">
          <div className="ms__grid" role="img" aria-label="spatial partition grid">
            {Array.from({ length: CELL_COUNT }, (_, i) => {
              const isDone = i < doneCells;
              const inFlight =
                phase === 'process' && i >= doneCells && i < doneCells + cores;
              return (
                <motion.div
                  key={i}
                  className={
                    'ms__cell' +
                    (isDone ? ' ms__cell--done' : '') +
                    (inFlight ? ' ms__cell--flight' : '')
                  }
                  initial={false}
                  animate={
                    reduce
                      ? {}
                      : {
                          scale: inFlight ? 1.06 : 1,
                          opacity: phase === 'idle' ? 0.85 : 1,
                        }
                  }
                  transition={{ duration: 0.3, ease }}
                >
                  <span className="ms__cell-idx">{i}</span>
                  <span className="ms__cell-tris">{cellTris[i]}</span>
                </motion.div>
              );
            })}
          </div>
          <div className="ms__grid-meta">
            <span>
              {TOTAL_TRIS.toLocaleString()} triangles across {CELL_COUNT} cells
            </span>
            <span>
              {doneCells} / {CELL_COUNT} units merged
            </span>
          </div>
        </div>

        <div className="ms__panel">
          <div className="ms__phase" data-phase={phase}>
            <span className="ms__phase-dot" />
            <span className="ms__phase-text">{phaseLabel[phase]}</span>
          </div>

          <div className="ms__pool" aria-label="bounded thread pool">
            <div className="ms__pool-head">
              <span>Thread pool</span>
              <span className="ms__pool-count">{cores} workers</span>
            </div>
            <div className="ms__workers">
              {Array.from({ length: cores }, (_, w) => {
                const active = phase === 'process';
                return (
                  <motion.div
                    key={w}
                    className={'ms__worker' + (active ? ' ms__worker--busy' : '')}
                    animate={
                      reduce || !active
                        ? { opacity: 1 }
                        : { opacity: [0.5, 1, 0.5] }
                    }
                    transition={
                      reduce || !active
                        ? { duration: 0 }
                        : { duration: 0.9, repeat: Infinity, delay: w * 0.1 }
                    }
                  >
                    w{w}
                  </motion.div>
                );
              })}
            </div>
            <div className="ms__pool-meta">
              peak working set capped at {cores} x {MAX_UNIT_BYTES}KB ={' '}
              <b>{peakKb.toLocaleString()}KB</b>, not the whole mesh
            </div>
          </div>

          <div className="ms__digest">
            <span className="ms__digest-label">canonical digest</span>
            <span className="ms__digest-val">0x{DIGEST}</span>
            <span className="ms__digest-note">
              {phase === 'done'
                ? 'identical across {1, 2, 4, 8} threads'
                : 'fold over partition index, thread-count independent'}
            </span>
          </div>
        </div>
      </div>

      <div className="ms__scaling">
        <div className="ms__scaling-head">
          <span>Scaling efficiency</span>
          <span className="ms__scaling-sub">speedup / cores</span>
        </div>
        <div className="ms__bars">
          {CORE_OPTS.map((c) => {
            const e = efficiency(c);
            const isSel = c === cores;
            return (
              <button
                key={c}
                type="button"
                className={'ms__bar' + (isSel ? ' ms__bar--sel' : '')}
                onClick={() => !running && setCores(c)}
                disabled={running}
                aria-pressed={isSel}
                aria-label={`${c} cores, ${e.toFixed(0)} percent efficiency`}
              >
                <div className="ms__bar-track">
                  <motion.div
                    className="ms__bar-fill"
                    initial={false}
                    animate={{ height: `${e}%` }}
                    transition={{ duration: reduce ? 0 : 0.5, ease }}
                  />
                </div>
                <span className="ms__bar-eff">{e.toFixed(0)}%</span>
                <span className="ms__bar-cores">{c}c</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className="ms__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="ms__verdict-x">{sp.toFixed(1)}x</span>
            <span className="ms__verdict-text">
              {cores} workers ran at {eff.toFixed(0)}% efficiency and produced
              digest 0x{DIGEST}, the same value every thread count yields. The
              bench-regress gate fails on more than 30% throughput drift.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run pass'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {cores} workers, {eff.toFixed(0)}% efficiency
        </span>
      </div>
    </div>
  );
}
