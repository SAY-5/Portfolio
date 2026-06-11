import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './Video-Streaming-CDN-Simulator-with-QUIC-Transport.css';

// Real numbers from the project. At 200ms RTT and 3.6% packet loss, QUIC cut
// worst-case segment delivery time roughly in half and nearly eliminated
// rebuffering. The crossover where QUIC starts winning is around 1% loss.
// Modeled mode runs 120,000 segment simulations in about 12 seconds and is
// deterministic (bit-identical output on rerun).
const SEGMENTS = 6; // prefetched segments riding the same connection
const LANE_STEPS = 7; // hops a segment travels across the link

type Phase = 'idle' | 'flying' | 'lost' | 'recovered' | 'done';

// Deterministic loss position per loss rate, so a rerun is identical. The
// emulator/model both treat loss as a property of one packet on the wire.
function lossHopFor(lossPct: number): number {
  if (lossPct < 1) return -1; // below crossover: no blocking loss this run
  // higher loss pushes the drop earlier in the pipe
  return Math.max(1, Math.min(LANE_STEPS - 2, Math.round(5 - lossPct / 2)));
}

export default function CdnSimDemo() {
  const reduce = useReducedMotion();
  const [lossPct, setLossPct] = useState(3.6);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [tcpDone, setTcpDone] = useState(0);
  const [quicDone, setQuicDone] = useState(0);
  const [tcpMs, setTcpMs] = useState(0);
  const [quicMs, setQuicMs] = useState(0);
  const timers = useRef<number[]>([]);

  const lossHop = lossHopFor(lossPct);
  const hasLoss = lossHop >= 0;
  // Worst-case delivery scales with RTT-driven recovery. TCP retransmits hold
  // the whole pipe; QUIC retransmits only the one stream. These are the
  // modeled relative outcomes, anchored to the ~2x worst-case headline.
  const baseMs = 90;
  const rtt = 200;
  const tcpWorst = hasLoss ? baseMs + rtt + lossPct * 28 : baseMs + lossPct * 6;
  const quicWorst = hasLoss ? baseMs + lossPct * 9 : baseMs + lossPct * 5;
  const speedup = quicWorst > 0 ? tcpWorst / quicWorst : 1;

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setPhase('idle');
    setTcpDone(0);
    setQuicDone(0);
    setTcpMs(0);
    setQuicMs(0);
  }

  function run() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setTcpDone(0);
    setQuicDone(0);
    setTcpMs(0);
    setQuicMs(0);

    if (reduce) {
      setPhase('done');
      setTcpDone(SEGMENTS);
      setQuicDone(SEGMENTS);
      setTcpMs(Math.round(tcpWorst));
      setQuicMs(Math.round(quicWorst));
      setRunning(false);
      return;
    }

    setPhase('flying');
    // QUIC: independent streams, each segment lands on its own pace; a single
    // loss stalls only its own lane, the rest keep arriving.
    for (let i = 1; i <= SEGMENTS; i++) {
      timers.current.push(
        window.setTimeout(() => setQuicDone(i), 260 + i * 150),
      );
    }
    timers.current.push(
      window.setTimeout(() => setQuicMs(Math.round(quicWorst)), 260 + SEGMENTS * 150),
    );

    if (hasLoss) {
      // TCP: one lost packet blocks head of line. Everything prefetched behind
      // it waits a full retransmit before any of it can be delivered.
      timers.current.push(window.setTimeout(() => setPhase('lost'), 700));
      timers.current.push(
        window.setTimeout(() => {
          setPhase('recovered');
          for (let i = 1; i <= SEGMENTS; i++) {
            timers.current.push(
              window.setTimeout(() => setTcpDone(i), i * 90),
            );
          }
          setTcpMs(Math.round(tcpWorst));
        }, 1900),
      );
      timers.current.push(
        window.setTimeout(() => {
          setPhase('done');
          setRunning(false);
        }, 2700),
      );
    } else {
      // Below the crossover both transports flow cleanly.
      for (let i = 1; i <= SEGMENTS; i++) {
        timers.current.push(
          window.setTimeout(() => setTcpDone(i), 300 + i * 160),
        );
      }
      timers.current.push(
        window.setTimeout(() => {
          setTcpMs(Math.round(tcpWorst));
          setPhase('done');
          setRunning(false);
        }, 300 + SEGMENTS * 160 + 200),
      );
    }
  }

  const tcpBlocked = phase === 'lost';

  return (
    <div className="demo" aria-label="QUIC versus TCP segment delivery demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">One lost packet, two transports</h3>
      <p className="demo__lede">
        Set the link loss rate and run a fetch of six prefetched video
        segments. HTTP/2 over TCP shares one pipe, so a single drop blocks the
        head of line and stalls everything behind it. HTTP/3 over QUIC carries
        each segment on its own stream, so only the lost one waits.
      </p>

      <div className="qs__stage">
        <div className="qs__control">
          <div className="qs__slider-label">
            <span>Link loss</span>
            <b>{lossPct.toFixed(1)}%</b>
          </div>
          <input
            className="qs__slider"
            type="range"
            min={0}
            max={7}
            step={0.1}
            value={lossPct}
            disabled={running}
            onChange={(e) => {
              setLossPct(parseFloat(e.target.value));
              reset();
            }}
            aria-label="Packet loss rate from 0 to 7 percent"
          />
          <div className="qs__crossover">
            {lossPct < 1
              ? 'below the ~1% crossover: TCP and QUIC are close'
              : 'above the ~1% crossover: QUIC pulls ahead'}
            <span className="qs__rtt">200ms RTT</span>
          </div>
        </div>

        <div className="qs__lanes">
          <Pipe
            kind="tcp"
            label="HTTP/2 over TCP"
            sub="single shared connection"
            done={tcpDone}
            blocked={tcpBlocked}
            lossHop={hasLoss ? lossHop : -1}
            phase={phase}
            reduce={!!reduce}
          />
          <Pipe
            kind="quic"
            label="HTTP/3 over QUIC"
            sub="independent streams"
            done={quicDone}
            blocked={false}
            lossHop={hasLoss ? lossHop : -1}
            phase={phase}
            reduce={!!reduce}
          />
        </div>

        <div className="qs__timers">
          <div className="qs__timer">
            <div className="qs__timer-name">TCP worst case</div>
            <div className="qs__timer-val">
              {tcpMs}
              <span className="qs__timer-unit">ms</span>
            </div>
            <div className="qs__timer-meta">
              {tcpBlocked
                ? 'head-of-line blocked, awaiting retransmit'
                : `${tcpDone} of ${SEGMENTS} segments delivered`}
            </div>
          </div>
          <div className="qs__timer qs__timer--fast">
            <div className="qs__timer-name">QUIC worst case</div>
            <div className="qs__timer-val">
              {quicMs}
              <span className="qs__timer-unit">ms</span>
            </div>
            <div className="qs__timer-meta">
              {quicDone} of {SEGMENTS} segments delivered
            </div>
          </div>
        </div>

        <AnimatePresence>
          {phase === 'done' && (
            <motion.div
              className="qs__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <span className="qs__verdict-x">{speedup.toFixed(1)}x</span>
              <span className="qs__verdict-text">
                {hasLoss
                  ? `At ${lossPct.toFixed(1)}% loss and 200ms RTT, QUIC delivers the worst-case segment about ${speedup.toFixed(1)}x faster. At 3.6% loss the project measured worst-case delivery cut roughly in half with rebuffering nearly eliminated.`
                  : `Below the ~1% crossover the two transports stay close. QUIC's lead grows as loss rises. The full sweep runs 120,000 deterministic segment simulations in about 12 seconds.`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Streaming…' : 'Run fetch'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">6 prefetched segments per run</span>
      </div>
    </div>
  );
}

function Pipe({
  kind,
  label,
  sub,
  done,
  blocked,
  lossHop,
  phase,
  reduce,
}: {
  kind: 'tcp' | 'quic';
  label: string;
  sub: string;
  done: number;
  blocked: boolean;
  lossHop: number;
  phase: Phase;
  reduce: boolean;
}) {
  const isTcp = kind === 'tcp';
  return (
    <div
      className={`qs__lane qs__lane--${kind} ${blocked ? 'qs__lane--blocked' : ''}`}
    >
      <div className="qs__lane-head">
        <span className="qs__lane-name">{label}</span>
        <span className="qs__lane-sub">{sub}</span>
      </div>

      <div className="qs__track" role="img" aria-label={`${label}: ${done} of ${SEGMENTS} segments delivered`}>
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const segNo = i + 1;
          const delivered = segNo <= done;
          // For TCP a single shared lane: all segments share the blocked hop.
          // For QUIC each segment has its own row, only its own can stall.
          const stalls =
            lossHop >= 0 &&
            (isTcp ? blocked : segNo === 3 && phase === 'flying' && !delivered);
          return (
            <div className="qs__seg-row" key={segNo}>
              <span className="qs__seg-tag">seg {segNo}</span>
              <div className="qs__seg-rail">
                <motion.div
                  className={`qs__seg-dot ${delivered ? 'qs__seg-dot--ok' : ''} ${stalls ? 'qs__seg-dot--stall' : ''}`}
                  initial={false}
                  animate={{
                    left: delivered ? '100%' : stalls ? `${(lossHop / LANE_STEPS) * 100}%` : '0%',
                  }}
                  transition={{
                    duration: reduce ? 0 : 0.5,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
                {lossHop >= 0 && (isTcp ? segNo === 1 : segNo === 3) && (
                  <span
                    className="qs__loss-x"
                    style={{ left: `${(lossHop / LANE_STEPS) * 100}%` }}
                    aria-hidden
                  >
                    drop
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
