import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './streamflow.css';

// Real numbers from the project: stated target of 40k events/sec at sub-15ms
// p99, with stateful operators, exactly-once delivery, and backpressure-aware
// routing. The slider drives the source rate; when it exceeds the slowest
// operator's drain rate, backpressure throttles the source and p99 climbs.
const TARGET_RATE = 40_000; // events/sec
const P99_TARGET = 15; // ms
// The windowed-aggregate operator drains slower than map/filter, so it is the
// bottleneck that triggers backpressure when the source pushes past it.
const DRAIN_CAPACITY = 40_000; // events/sec the slowest operator can clear

type OpDef = { id: string; label: string; sub: string; x: number };

const ops: OpDef[] = [
  { id: 'src', label: 'source', sub: 'Kafka ingest', x: 60 },
  { id: 'map', label: 'map', sub: 'parse + key', x: 190 },
  { id: 'filter', label: 'filter', sub: 'route by key', x: 320 },
  { id: 'agg', label: 'window', sub: 'stateful agg', x: 450 },
  { id: 'sink', label: 'sink', sub: 'exactly-once', x: 580 },
];

const OP_Y = 70;

export default function StreamflowDemo() {
  const reduce = useReducedMotion();
  const [rate, setRate] = useState(28); // thousands of events/sec
  const [exactlyOnce, setExactlyOnce] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [phase, setPhase] = useState(0); // drives the moving packets
  const [committed, setCommitted] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const raf = useRef<number | null>(null);
  const lastRetry = useRef(0);

  const ratePerSec = rate * 1000;
  // Backpressure engages when the source outruns the slowest operator's drain.
  const overCapacity = ratePerSec > DRAIN_CAPACITY;
  const throttled = overCapacity
    ? DRAIN_CAPACITY
    : ratePerSec;
  // p99 rises as we approach and exceed capacity; backpressure caps throughput
  // but the queueing latency still climbs past the 15ms target.
  const load = ratePerSec / DRAIN_CAPACITY;
  const p99 =
    load <= 1
      ? +(8 + load * 6).toFixed(1) // 8ms..14ms within budget
      : +(15 + (load - 1) * 28).toFixed(1); // climbs once saturated

  function stop() {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }
  useEffect(() => stop, []);

  // Animation loop: advance packet phase and tick the exactly-once counters.
  useEffect(() => {
    if (!playing || reduce) {
      stop();
      return;
    }
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      setPhase((p) => (p + dt * 0.0006 * (0.6 + load)) % 1);
      // A retry fires periodically. With exactly-once on, the dedup state
      // drops the replayed record; with it off, the side effect runs twice.
      lastRetry.current += dt;
      const interval = 1400;
      if (lastRetry.current >= interval) {
        lastRetry.current = 0;
        setCommitted((c) => c + 1);
        if (!exactlyOnce) setDuplicates((d) => d + 1);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return stop;
  }, [playing, reduce, load, exactlyOnce]);

  function resetCounters() {
    setCommitted(0);
    setDuplicates(0);
    lastRetry.current = 0;
  }

  // Packets move src -> sink. When backpressure is on, the segment feeding the
  // window operator slows and packets bunch up before it.
  const packetCount = 5;
  function packetX(i: number) {
    const local = (phase + i / packetCount) % 1;
    const start = ops[0].x;
    const end = ops[ops.length - 1].x;
    // compress the leg into the window operator when throttled
    let t = local;
    if (overCapacity) {
      // ease packets to crowd just before the window operator (4th node)
      const choke = (ops[3].x - start) / (end - start);
      if (local < choke) {
        t = (local / choke) * choke * 0.96;
      }
    }
    return start + t * (end - start);
  }

  const breach = p99 > P99_TARGET;

  return (
    <div className="demo" aria-label="StreamFlow backpressure and exactly-once demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Backpressure and exactly-once delivery</h3>
      <p className="demo__lede">
        Drag the source rate up. While the operators can drain it, p99 stays
        under the {P99_TARGET}ms budget. Push past the slowest operator and
        backpressure throttles the source, capping throughput while latency
        climbs. The exactly-once switch decides whether a replayed record
        commits once or fires its side effect twice.
      </p>

      <div className="sfl__stage">
        <div className="sfl__pipeline">
          <svg
            className="sfl__svg"
            viewBox="0 0 640 140"
            role="group"
            aria-label="event pipeline from source to sink"
          >
            <defs>
              <marker
                id="sfl-arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
              </marker>
            </defs>

            {/* connecting edges */}
            {ops.slice(0, -1).map((op, i) => {
              const next = ops[i + 1];
              const choke = overCapacity && i === 2; // edge into window op
              return (
                <line
                  key={`edge-${op.id}`}
                  x1={op.x + 30}
                  y1={OP_Y}
                  x2={next.x - 30}
                  y2={OP_Y}
                  stroke={choke ? 'var(--accent)' : 'var(--line)'}
                  strokeWidth={choke ? 2.4 : 1.4}
                  strokeOpacity={choke ? 0.9 : 0.6}
                  markerEnd="url(#sfl-arrow)"
                />
              );
            })}

            {/* moving packets */}
            {Array.from({ length: packetCount }).map((_, i) => (
              <motion.circle
                key={`pkt-${i}`}
                cx={reduce ? ops[2].x : packetX(i)}
                cy={OP_Y}
                r={4}
                fill="var(--accent)"
                opacity={0.85}
              />
            ))}

            {/* operator nodes */}
            {ops.map((op) => {
              const isAgg = op.id === 'agg';
              const isSink = op.id === 'sink';
              const choke = overCapacity && isAgg;
              return (
                <g key={op.id}>
                  <rect
                    x={op.x - 30}
                    y={OP_Y - 24}
                    width={60}
                    height={48}
                    rx={9}
                    fill={choke ? 'var(--accent-glow)' : 'var(--ink-700)'}
                    stroke={
                      choke
                        ? 'var(--accent)'
                        : isSink && exactlyOnce
                          ? 'rgba(79,208,138,0.6)'
                          : 'var(--line)'
                    }
                    strokeWidth={choke ? 2 : 1}
                  />
                  <text
                    x={op.x}
                    y={OP_Y - 2}
                    textAnchor="middle"
                    className="sfl__op-label"
                  >
                    {op.label}
                  </text>
                  <text
                    x={op.x}
                    y={OP_Y + 10}
                    textAnchor="middle"
                    className="sfl__op-sub"
                  >
                    {op.sub}
                  </text>
                  {choke && (
                    <text
                      x={op.x}
                      y={OP_Y - 32}
                      textAnchor="middle"
                      className="sfl__op-state"
                      fill="var(--accent)"
                    >
                      backpressure
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="sfl__gauges">
          <div className="sfl__gauge sfl__gauge--rate">
            <div className="sfl__gauge-name">source rate</div>
            <div className="sfl__gauge-val">
              {ratePerSec.toLocaleString()}
              <span className="sfl__gauge-unit">ev/s</span>
            </div>
          </div>
          <div className={`sfl__gauge${overCapacity ? ' sfl__gauge--warn' : ''}`}>
            <div className="sfl__gauge-name">throughput</div>
            <div className="sfl__gauge-val">
              {throttled.toLocaleString()}
              <span className="sfl__gauge-unit">ev/s</span>
            </div>
          </div>
          <div className={`sfl__gauge${breach ? ' sfl__gauge--warn' : ''}`}>
            <div className="sfl__gauge-name">p99</div>
            <div className="sfl__gauge-val">
              {p99}
              <span className="sfl__gauge-unit">ms</span>
            </div>
          </div>
          <div className="sfl__gauge">
            <div className="sfl__gauge-name">target</div>
            <div className="sfl__gauge-val">
              {(TARGET_RATE / 1000).toFixed(0)}k
              <span className="sfl__gauge-unit">@ &lt;{P99_TARGET}ms</span>
            </div>
          </div>
        </div>

        <div className="sfl__controls-inline">
          <div>
            <div className="sfl__slider-label">
              <span>source rate</span>
              <b>{ratePerSec.toLocaleString()} ev/s</b>
            </div>
            <input
              className="sfl__slider"
              type="range"
              min={8}
              max={64}
              step={1}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              aria-label="source event rate in thousands per second"
            />
          </div>
          <p className="sfl__note">
            {overCapacity ? (
              <>
                Source is past the window operator&apos;s drain rate.{' '}
                <b>Backpressure</b> throttles ingest to{' '}
                {throttled.toLocaleString()} ev/s so no operator is
                overwhelmed, but queued records push p99 to {p99}ms.
              </>
            ) : (
              <>
                Every operator keeps up. Throughput tracks the source and p99
                holds at {p99}ms, inside the {P99_TARGET}ms budget.
              </>
            )}
          </p>
        </div>

        <div
          className={`sfl__exactly ${exactlyOnce ? 'sfl__exactly--on' : 'sfl__exactly--dupe'}`}
        >
          <div>
            <div
              className="sfl__toggle"
              role="switch"
              tabIndex={0}
              aria-checked={exactlyOnce}
              aria-label="exactly-once delivery"
              onClick={() => {
                setExactlyOnce((v) => !v);
                resetCounters();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExactlyOnce((v) => !v);
                  resetCounters();
                }
              }}
            >
              <span className="sfl__switch" data-on={exactlyOnce}>
                <span className="sfl__switch-knob" />
              </span>
              exactly-once delivery {exactlyOnce ? 'on' : 'off'}
            </div>
            <p className="sfl__exactly-text" style={{ marginTop: 10 }}>
              {exactlyOnce ? (
                <>
                  A replayed record is recognized by the operator&apos;s dedup
                  state and <b>committed once</b>. The side effect at the sink
                  never doubles.
                </>
              ) : (
                <>
                  Without dedup, every replay re-runs the side effect, so the
                  sink <b>double-counts</b> retried records.
                </>
              )}
            </p>
          </div>
          <div className="sfl__sink">
            <span className="sfl__sink-count">{committed - duplicates}</span>
            <span className="sfl__sink-label">committed</span>
            {duplicates > 0 && (
              <span
                className="sfl__sink-label"
                style={{ color: 'var(--accent)' }}
              >
                +{duplicates} dupes
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={!!reduce}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            setRate(28);
            resetCounters();
          }}
        >
          Reset
        </button>
        <span className="demo__hint">
          {reduce
            ? 'reduced motion: drag the rate to see backpressure'
            : 'retries replay every ~1.4s'}
        </span>
      </div>
    </div>
  );
}
