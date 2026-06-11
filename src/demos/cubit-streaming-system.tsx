import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './cubit-streaming-system.css';

// Real numbers from the project. End-to-end latency holds 50-70ms at 60fps,
// 1920x1080. Per-stage budget: capture under 5ms, encode 8-10ms, with network
// and client decode filling the rest. Adaptive bitrate ranges 2-10 Mbps and
// uses hysteresis (3 consecutive readings the same direction) to stop
// oscillation. H.264 keyframes exceed the 1500-byte MTU, so frames are split
// into UDP fragments with a frameId/fragmentIndex/totalFragments header.

type StageDef = { id: string; label: string; ms: number; note: string };

// Latency budget per stage (ms). Sums to ~60ms, the middle of the 50-70 range.
const STAGES: StageDef[] = [
  { id: 'capture', label: 'Capture', ms: 4, note: 'V4L2, deep-copy frame' },
  { id: 'encode', label: 'Encode', ms: 9, note: 'NVENC H.264, CPU fallback' },
  { id: 'network', label: 'Network', ms: 32, note: 'UDP fragments over the wire' },
  { id: 'decode', label: 'Client decode', ms: 15, note: 'reassemble + present' },
];
const TOTAL_MS = STAGES.reduce((a, s) => a + s.ms, 0); // 60

const BITRATE_MIN = 2; // Mbps
const BITRATE_MAX = 10; // Mbps
const FRAME_W = 1920;
const FRAME_H = 1080;
const MTU = 1500;
const HEADER = 12; // frameId(4) + fragmentIndex(4) + totalFragments(4)
const PAYLOAD = MTU - HEADER; // bytes of H.264 per fragment
const HYSTERESIS = 3; // consecutive readings before bitrate moves

const ease = [0.22, 1, 0.36, 1] as const;

// Simulated GPU utilization curve the adaptation thread samples every 2s.
function gpuAt(t: number) {
  // Smooth wander between ~25% and ~95% so the dial visibly reacts.
  return 60 + 35 * Math.sin(t / 3.1) + 12 * Math.sin(t / 1.3);
}
function clampGpu(v: number) {
  return Math.max(18, Math.min(98, v));
}

// Map GPU headroom to a target bitrate: low GPU load leaves room for a higher
// bitrate, high load backs off toward the floor.
function targetBitrate(gpu: number) {
  const headroom = (100 - gpu) / 100; // 0..1
  return +(BITRATE_MIN + headroom * (BITRATE_MAX - BITRATE_MIN)).toFixed(1);
}

export default function CubitDemo() {
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [gpu, setGpu] = useState(() => clampGpu(gpuAt(0)));
  const [bitrate, setBitrate] = useState(6);
  const [streak, setStreak] = useState(0);
  const [streakDir, setStreakDir] = useState<1 | -1 | 0>(0);
  const [lastMove, setLastMove] = useState<string>('holding');
  const raf = useRef<number | null>(null);
  const loop = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (loop.current !== null) window.clearInterval(loop.current);
    loop.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // The adaptation thread: every 2s (compressed to 900ms here) it samples GPU
  // utilization and only changes bitrate after HYSTERESIS readings agree.
  useEffect(() => {
    if (!playing) return;
    if (reduce) return;
    loop.current = window.setInterval(() => {
      setTick((tk) => {
        const next = tk + 1;
        const g = clampGpu(gpuAt(next));
        setGpu(g);
        const target = targetBitrate(g);
        setBitrate((cur) => {
          const dir: 1 | -1 | 0 =
            target > cur + 0.4 ? 1 : target < cur - 0.4 ? -1 : 0;
          setStreakDir((prevDir) => {
            if (dir === 0) {
              setStreak(0);
              setLastMove('holding (within band)');
              return 0;
            }
            if (dir === prevDir) {
              setStreak((s) => {
                const ns = s + 1;
                if (ns >= HYSTERESIS) {
                  const step = dir * 1;
                  const moved = Math.max(
                    BITRATE_MIN,
                    Math.min(BITRATE_MAX, +(cur + step).toFixed(1)),
                  );
                  setBitrate(moved);
                  setLastMove(
                    dir > 0
                      ? 'stepped up after 3 readings'
                      : 'stepped down after 3 readings',
                  );
                  return 0;
                }
                setLastMove(
                  `${dir > 0 ? 'up' : 'down'} reading ${ns} of ${HYSTERESIS}`,
                );
                return ns;
              });
              return dir;
            }
            setStreak(1);
            setLastMove(`${dir > 0 ? 'up' : 'down'} reading 1 of ${HYSTERESIS}`);
            return dir;
          });
          return cur;
        });
        return next;
      });
    }, 900);
    return stop;
  }, [playing, reduce, stop]);

  function toggle() {
    if (playing) {
      setPlaying(false);
      stop();
    } else {
      setPlaying(true);
    }
  }

  function reset() {
    stop();
    setPlaying(false);
    setTick(0);
    setGpu(clampGpu(gpuAt(0)));
    setBitrate(6);
    setStreak(0);
    setStreakDir(0);
    setLastMove('holding');
  }

  // Fragment math for a keyframe at the current bitrate. A keyframe is far
  // larger than a P-frame; estimate its bytes from the bitrate.
  const keyframeBytes = Math.round((bitrate * 1_000_000) / 8 / 30); // ~1 frame
  const fragments = Math.max(1, Math.ceil(keyframeBytes / PAYLOAD));

  // Dial angle: -120deg at min bitrate to +120deg at max.
  const dialT = (bitrate - BITRATE_MIN) / (BITRATE_MAX - BITRATE_MIN);
  const dialAngle = -120 + dialT * 240;

  return (
    <div className="demo" aria-label="CUBIT streaming pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Four threads, one frame budget</h3>
      <p className="demo__lede">
        Capture, encode, network, and adaptation run as separate threads. Play
        the stream to watch a frame move through the latency budget while the
        adaptation thread samples a GPU curve and adjusts bitrate, holding each
        change until three readings agree.
      </p>

      <div className="cb__stage">
        {/* Pipeline + latency budget */}
        <div className="cb__pipe" aria-label="capture encode network decode pipeline">
          {STAGES.map((s, i) => {
            const active = playing && !reduce && tick % STAGES.length === i;
            const widthPct = (s.ms / TOTAL_MS) * 100;
            return (
              <div
                key={s.id}
                className={'cb__stagebox' + (active ? ' cb__stagebox--on' : '')}
                style={{ flexGrow: s.ms }}
              >
                <div className="cb__stage-top">
                  <span className="cb__stage-label">{s.label}</span>
                  <span className="cb__stage-ms">{s.ms}ms</span>
                </div>
                <div className="cb__stage-track">
                  <motion.span
                    className="cb__stage-fill"
                    initial={false}
                    animate={{ width: active ? '100%' : `${Math.min(100, widthPct * 1.2)}%` }}
                    transition={{ duration: reduce ? 0 : 0.5, ease }}
                  />
                </div>
                <span className="cb__stage-note">{s.note}</span>
              </div>
            );
          })}
        </div>
        <div className="cb__budget">
          <span className="cb__budget-label">End-to-end latency budget</span>
          <span className="cb__budget-val">~{TOTAL_MS}ms</span>
          <span className="cb__budget-sub">within the 50-70ms target at 60fps, {FRAME_W}x{FRAME_H}</span>
        </div>

        <div className="cb__lower">
          {/* Bitrate dial */}
          <div className="cb__dialwrap">
            <div className="cb__panel-name">Adaptive bitrate</div>
            <div className="cb__dial" role="img" aria-label={`bitrate ${bitrate} megabits per second`}>
              <svg viewBox="0 0 160 110" className="cb__dial-svg">
                <path
                  d="M 20 100 A 70 70 0 0 1 140 100"
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <motion.path
                  d="M 20 100 A 70 70 0 0 1 140 100"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray="220"
                  initial={false}
                  animate={{ strokeDashoffset: 220 - dialT * 220 }}
                  transition={{ duration: reduce ? 0 : 0.5, ease }}
                />
                <motion.line
                  x1="80"
                  y1="100"
                  x2="80"
                  y2="42"
                  stroke="var(--text-strong)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  style={{ originX: '80px', originY: '100px' }}
                  initial={false}
                  animate={{ rotate: dialAngle }}
                  transition={{ duration: reduce ? 0 : 0.5, ease }}
                />
                <circle cx="80" cy="100" r="5" fill="var(--accent)" />
              </svg>
              <div className="cb__dial-val">
                {bitrate.toFixed(1)}
                <span className="cb__dial-unit">Mbps</span>
              </div>
              <div className="cb__dial-range">{BITRATE_MIN}-{BITRATE_MAX} Mbps band</div>
            </div>
          </div>

          {/* GPU + hysteresis */}
          <div className="cb__panel">
            <div className="cb__panel-name">GPU utilization</div>
            <div className="cb__gpu-val">{Math.round(gpu)}%</div>
            <div className="cb__gpu-track">
              <motion.span
                className="cb__gpu-fill"
                animate={{ width: `${gpu}%` }}
                transition={{ duration: reduce ? 0 : 0.5, ease }}
              />
            </div>
            <div className="cb__hyst">
              <span className="cb__hyst-label">Hysteresis</span>
              <div className="cb__hyst-dots" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={
                      'cb__hyst-dot' +
                      (i < streak ? ' cb__hyst-dot--on' : '') +
                      (streakDir < 0 ? ' cb__hyst-dot--down' : '')
                    }
                  />
                ))}
              </div>
            </div>
            <div className="cb__hyst-note">{lastMove}</div>
          </div>

          {/* UDP fragmentation */}
          <div className="cb__panel">
            <div className="cb__panel-name">UDP fragmentation</div>
            <div className="cb__frag-stat">
              <b>{fragments}</b> fragments
            </div>
            <div className="cb__frag-sub">
              keyframe ~{(keyframeBytes / 1024).toFixed(1)}KB split over {PAYLOAD}-byte
              payloads ({MTU}-byte MTU minus {HEADER}-byte header)
            </div>
            <div className="cb__frag-strip" aria-hidden="true">
              <AnimatePresence initial={false}>
                {Array.from({ length: Math.min(fragments, 14) }).map((_, i) => (
                  <motion.span
                    key={i}
                    className="cb__frag-cell"
                    initial={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, delay: reduce ? 0 : i * 0.015, ease }}
                  />
                ))}
              </AnimatePresence>
              {fragments > 14 && <span className="cb__frag-more">+{fragments - 14}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={toggle}>
          {playing ? 'Pause stream' : 'Play stream'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">designed for 500+ clients over UDP</span>
      </div>
    </div>
  );
}
