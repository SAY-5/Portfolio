import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './osshell.css';

// Real numbers from the project: a four-level MLFQ (quantum doubling,
// demote-on-quantum, promote-on-IO) benchmarked against a round-robin
// baseline on the canonical mixed-bursty workload cuts context switches by
// 60.3%. MLFQ runs 4 levels; the demo replays the same workload through both
// schedulers tick by tick and tallies switches live.
const HEADLINE_REDUCTION = 60.3;
const MLFQ_LEVELS = 4;
// Quantum doubling per level: 1, 2, 4, 8 ticks.
const MLFQ_QUANTUM = [1, 2, 4, 8];

type Kind = 'cpu' | 'io';

type Job = {
  id: string;
  kind: Kind;
  // total CPU ticks the job needs to finish
  burst: number;
  // for io jobs, it blocks after this many ticks of a slice, then returns
  // ready a few ticks later. cpu jobs never voluntarily block.
  ioEvery: number;
};

// The canonical mixed-bursty workload: short interactive (io) jobs interleaved
// with long cpu-bound jobs. Interactive jobs block often and should stay high
// priority; cpu jobs should sink so they stop forcing switches.
const WORKLOAD: Job[] = [
  { id: 'sh', kind: 'io', burst: 4, ioEvery: 1 },
  { id: 'build', kind: 'cpu', burst: 23, ioEvery: 0 },
  { id: 'editor', kind: 'io', burst: 4, ioEvery: 1 },
  { id: 'pack', kind: 'cpu', burst: 21, ioEvery: 0 },
  { id: 'top', kind: 'io', burst: 4, ioEvery: 1 },
];

const IO_RETURN_DELAY = 2; // ticks a blocked job waits before becoming ready

type Frame = {
  tick: number;
  // job running this tick, or null for an idle slot
  running: string | null;
  // priority level (mlfq only); rr reports 0
  level: number;
  // true when this tick begins on a different job than the previous tick
  contextSwitch: boolean;
  switches: number;
  // remaining burst per job after this tick (for the lane render)
  remaining: Record<string, number>;
  blocked: Record<string, boolean>;
};

type Sim = { frames: Frame[]; switches: number };

// Round-robin: single ready queue, one quantum, rotate on every tick. A cpu
// job is preempted and sent to the back after its quantum, so a long compute
// job forces a switch on every slice. An io job blocks and returns after its
// delay. Every dispatch of a different job is a context switch.
function simulateRR(): Sim {
  const remaining: Record<string, number> = {};
  WORKLOAD.forEach((j) => {
    remaining[j.id] = j.burst;
  });
  const queue = WORKLOAD.map((j) => j.id);
  const blockedUntil: Record<string, number> = {};
  const frames: Frame[] = [];
  let prev: string | null = null;
  let switches = 0;
  let tick = 0;
  const total = () => Object.values(remaining).reduce((a, b) => a + b, 0);

  while (total() > 0 && tick < 200) {
    // wake jobs whose io delay elapsed
    WORKLOAD.forEach((j) => {
      if (blockedUntil[j.id] === tick) queue.push(j.id);
    });
    const cur = queue.length ? queue[0] : null;
    const cs = cur !== null && cur !== prev;
    if (cs) switches++;

    if (cur) {
      remaining[cur] -= 1;
      const job = WORKLOAD.find((j) => j.id === cur)!;
      if (remaining[cur] <= 0) {
        queue.shift();
      } else if (job.kind === 'io') {
        // blocks for io, leaves the cpu and returns after the delay
        queue.shift();
        blockedUntil[cur] = tick + 1 + IO_RETURN_DELAY;
      } else {
        // cpu job: quantum expired, rotate to the back of the queue
        queue.shift();
        queue.push(cur);
      }
    }

    const blocked: Record<string, boolean> = {};
    WORKLOAD.forEach((j) => {
      blocked[j.id] = blockedUntil[j.id] !== undefined && blockedUntil[j.id] > tick && remaining[j.id] > 0;
    });
    frames.push({
      tick,
      running: cur,
      level: 0,
      contextSwitch: cs,
      switches,
      remaining: { ...remaining },
      blocked,
    });
    prev = cur;
    tick++;
  }
  return { frames, switches };
}

// MLFQ: four priority levels with doubling quanta. A job that uses its whole
// quantum demotes a level (demote-on-quantum). A job that blocks for io
// returns at its current level and is treated as interactive, staying high
// (promote-on-io keeps it near the top). The scheduler always runs the
// highest non-empty level, so cpu-bound jobs sink and stop forcing switches.
function simulateMLFQ(): Sim {
  const remaining: Record<string, number> = {};
  const level: Record<string, number> = {};
  const sliceUsed: Record<string, number> = {};
  WORKLOAD.forEach((j) => {
    remaining[j.id] = j.burst;
    level[j.id] = 0;
    sliceUsed[j.id] = 0;
  });
  // queues per level
  const queues: string[][] = Array.from({ length: MLFQ_LEVELS }, () => []);
  WORKLOAD.forEach((j) => queues[0].push(j.id));
  const blockedUntil: Record<string, number> = {};
  const blockedLevel: Record<string, number> = {};
  const frames: Frame[] = [];
  let prev: string | null = null;
  let switches = 0;
  let tick = 0;
  const total = () => Object.values(remaining).reduce((a, b) => a + b, 0);
  const topLevel = () => queues.findIndex((q) => q.length > 0);

  while (total() > 0 && tick < 200) {
    WORKLOAD.forEach((j) => {
      if (blockedUntil[j.id] === tick) {
        // promote-on-io: interactive jobs come back near the top
        const lvl = Math.max(0, (blockedLevel[j.id] ?? 0) - 1);
        level[j.id] = lvl;
        sliceUsed[j.id] = 0;
        queues[lvl].push(j.id);
      }
    });
    const lvl = topLevel();
    const cur = lvl >= 0 ? queues[lvl][0] : null;
    const cs = cur !== null && cur !== prev;
    if (cs) switches++;

    if (cur) {
      remaining[cur] -= 1;
      sliceUsed[cur] += 1;
      const job = WORKLOAD.find((j) => j.id === cur)!;
      const quantum = MLFQ_QUANTUM[level[cur]];
      if (remaining[cur] <= 0) {
        queues[lvl].shift();
      } else if (job.kind === 'io' && sliceUsed[cur] >= job.ioEvery) {
        // blocks for io before exhausting quantum: stays interactive
        queues[lvl].shift();
        blockedUntil[cur] = tick + 1 + IO_RETURN_DELAY;
        blockedLevel[cur] = level[cur];
        sliceUsed[cur] = 0;
      } else if (sliceUsed[cur] >= quantum) {
        // demote-on-quantum: used the full slice, sink a level
        queues[lvl].shift();
        const next = Math.min(MLFQ_LEVELS - 1, level[cur] + 1);
        level[cur] = next;
        sliceUsed[cur] = 0;
        queues[next].push(cur);
      }
    }

    const blocked: Record<string, boolean> = {};
    WORKLOAD.forEach((j) => {
      blocked[j.id] = blockedUntil[j.id] !== undefined && blockedUntil[j.id] > tick && remaining[j.id] > 0;
    });
    frames.push({
      tick,
      running: cur,
      level: lvl >= 0 ? lvl : 0,
      contextSwitch: cs,
      switches,
      remaining: { ...remaining },
      blocked,
    });
    prev = cur;
    tick++;
  }
  return { frames, switches };
}

const ease = [0.22, 1, 0.36, 1] as const;

function jobColor(id: string): string {
  const j = WORKLOAD.find((w) => w.id === id);
  return j?.kind === 'io' ? 'var(--accent)' : 'var(--osh-cpu)';
}

export default function OsshellDemo() {
  const reduce = useReducedMotion();
  const mlfq = useMemo(() => simulateMLFQ(), []);
  const rr = useMemo(() => simulateRR(), []);
  const maxLen = Math.max(mlfq.frames.length, rr.frames.length);

  const [step, setStep] = useState(0); // 0..maxLen, how many ticks revealed
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const done = step >= maxLen;

  function clearTimer() {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }
  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!playing) return;
    if (reduce) {
      setStep(maxLen);
      setPlaying(false);
      return;
    }
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (s + 1 >= maxLen) {
          clearTimer();
          setPlaying(false);
          return maxLen;
        }
        return s + 1;
      });
    }, 360);
    return clearTimer;
  }, [playing, reduce, maxLen]);

  function play() {
    if (done) setStep(0);
    setPlaying(true);
  }
  function pause() {
    setPlaying(false);
    clearTimer();
  }
  function reset() {
    pause();
    setStep(0);
  }
  function stepOnce() {
    pause();
    setStep((s) => Math.min(maxLen, s + 1));
  }

  // switch counts up to the revealed tick
  const mlfqSwitches = step > 0 ? mlfq.frames[Math.min(step, mlfq.frames.length) - 1].switches : 0;
  const rrSwitches = step > 0 ? rr.frames[Math.min(step, rr.frames.length) - 1].switches : 0;
  const liveReduction = rrSwitches > 0 ? ((rrSwitches - mlfqSwitches) / rrSwitches) * 100 : 0;

  return (
    <div className="demo" aria-label="osshell scheduler race demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">MLFQ versus round-robin, same workload</h3>
      <p className="demo__lede">
        Step the same mixed-bursty workload through both schedulers. Round-robin
        rotates a single queue on a fixed quantum. The {MLFQ_LEVELS}-level MLFQ
        doubles the quantum per level, demotes a job when it burns a full slice,
        and keeps a job that blocks for I/O near the top, so CPU-bound work sinks
        and stops forcing switches.
      </p>

      <div className="osh__stage">
        <div className="osh__lanes">
          <SchedulerLane
            title="MLFQ (4 levels)"
            accent
            frame={step > 0 ? mlfq.frames[Math.min(step, mlfq.frames.length) - 1] : null}
            showLevel
            reduce={reduce}
          />
          <SchedulerLane
            title="Round-robin baseline"
            accent={false}
            frame={step > 0 ? rr.frames[Math.min(step, rr.frames.length) - 1] : null}
            showLevel={false}
            reduce={reduce}
          />
        </div>

        <div className="osh__timeline" role="group" aria-label="execution timeline">
          <TimelineStrip label="MLFQ" frames={mlfq.frames} step={step} reduce={reduce} />
          <TimelineStrip label="RR" frames={rr.frames} step={step} reduce={reduce} />
        </div>

        <div className="osh__counters">
          <div className="osh__counter osh__counter--accent">
            <div className="osh__counter-name">MLFQ switches</div>
            <div className="osh__counter-val">{mlfqSwitches}</div>
            <div className="osh__counter-meta">tick {Math.min(step, mlfq.frames.length)} of {mlfq.frames.length}</div>
          </div>
          <div className="osh__counter">
            <div className="osh__counter-name">RR switches</div>
            <div className="osh__counter-val">{rrSwitches}</div>
            <div className="osh__counter-meta">tick {Math.min(step, rr.frames.length)} of {rr.frames.length}</div>
          </div>
          <div className="osh__counter osh__counter--metric">
            <div className="osh__counter-name">Live reduction</div>
            <div className="osh__counter-val">
              {liveReduction.toFixed(1)}
              <span className="osh__counter-unit">%</span>
            </div>
            <div className="osh__counter-meta">switches avoided so far</div>
          </div>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="osh__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="osh__verdict-x">{HEADLINE_REDUCTION}%</span>
              <span className="osh__verdict-text">
                fewer context switches on the canonical mixed-bursty workload.
                The benchmark in the repo reports a {HEADLINE_REDUCTION}% reduction
                for MLFQ against the round-robin baseline.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        {playing ? (
          <button className="demo__btn" onClick={pause}>
            Pause
          </button>
        ) : (
          <button className="demo__btn" onClick={play}>
            {done ? 'Replay' : step === 0 ? 'Run' : 'Resume'}
          </button>
        )}
        <button className="demo__btn demo__btn--ghost" onClick={stepOnce} disabled={done}>
          Step
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={step === 0}>
          Reset
        </button>
        <span className="demo__hint">io = interactive, cpu = compute-bound</span>
      </div>
    </div>
  );
}

function SchedulerLane({
  title,
  accent,
  frame,
  showLevel,
  reduce,
}: {
  title: string;
  accent: boolean;
  frame: Frame | null;
  showLevel: boolean;
  reduce: boolean | null;
}) {
  return (
    <div className={`osh__lane${accent ? ' osh__lane--accent' : ''}`}>
      <div className="osh__lane-head">
        <span className="osh__lane-title">{title}</span>
        {frame && (
          <span className="osh__lane-running" data-cs={frame.contextSwitch}>
            {frame.running ? (
              <>
                cpu &rarr; <b style={{ color: jobColor(frame.running) }}>{frame.running}</b>
                {showLevel ? ` · L${frame.level}` : ''}
                {frame.contextSwitch ? ' · switch' : ''}
              </>
            ) : (
              'idle'
            )}
          </span>
        )}
      </div>
      <div className="osh__procs">
        {WORKLOAD.map((j) => {
          const rem = frame ? frame.remaining[j.id] : j.burst;
          const running = frame?.running === j.id;
          const blocked = frame?.blocked[j.id] ?? false;
          const doneJob = rem <= 0;
          const pct = Math.max(0, Math.min(100, (rem / j.burst) * 100));
          const state = doneJob ? 'done' : running ? 'run' : blocked ? 'io' : 'ready';
          return (
            <div key={j.id} className="osh__proc" data-state={state} data-kind={j.kind}>
              <span className="osh__proc-id">{j.id}</span>
              <div className="osh__proc-bar">
                <motion.div
                  className="osh__proc-fill"
                  style={{ background: jobColor(j.id) }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: reduce ? 0 : 0.32, ease }}
                />
              </div>
              <span className="osh__proc-state">
                {doneJob ? 'done' : running ? 'run' : blocked ? 'i/o' : 'rdy'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineStrip({
  label,
  frames,
  step,
  reduce,
}: {
  label: string;
  frames: Frame[];
  step: number;
  reduce: boolean | null;
}) {
  return (
    <div className="osh__strip">
      <span className="osh__strip-label">{label}</span>
      <div className="osh__strip-cells">
        {frames.map((f, i) => {
          const shown = i < step;
          return (
            <motion.span
              key={i}
              className="osh__cell"
              data-cs={f.contextSwitch && shown}
              data-shown={shown}
              title={`tick ${f.tick}: ${f.running ?? 'idle'}`}
              initial={false}
              animate={{
                opacity: shown ? 1 : 0.18,
                background: shown && f.running ? jobColor(f.running) : 'var(--ink-700)',
              }}
              transition={{ duration: reduce ? 0 : 0.2 }}
            />
          );
        })}
      </div>
    </div>
  );
}
