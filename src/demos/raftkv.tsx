import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './raftkv.css';

// Real numbers from the project:
// chaos suite ran 184/184 scenarios passed within a 540 s budget; property
// tests check the four Figure-2 invariants after every op; scaling bench is
// 956.6 Puts/sec at 3 nodes. The 3-node demo mirrors the chaos flow:
// replicate committed Puts, kill the leader, re-elect, keep committed state.
const CHAOS_PASS = 184;
const PUTS_PER_SEC = 956.6;
const INVARIANTS = 4;

type Role = 'leader' | 'follower' | 'candidate';
type NodeState = {
  id: string;
  role: Role;
  down: boolean;
};
type Entry = { idx: number; cmd: string; committed: boolean };
type Line = { id: number; kind: 'elect' | 'repl' | 'fault' | 'info'; tag: string; text: string };

const NODE_IDS = ['n1', 'n2', 'n3'];

function freshNodes(leader: string): NodeState[] {
  return NODE_IDS.map((id) => ({
    id,
    role: id === leader ? 'leader' : 'follower',
    down: false,
  }));
}

export default function RaftkvDemo() {
  const reduce = useReducedMotion();
  const [term, setTerm] = useState(1);
  const [nodes, setNodes] = useState<NodeState[]>(() => freshNodes('n1'));
  const [log, setLog] = useState<Entry[]>([]);
  const [feed, setFeed] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [electing, setElecting] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const lineId = useRef(0);
  const idxRef = useRef(0);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  function after(ms: number, fn: () => void) {
    const t = window.setTimeout(fn, reduce ? 0 : ms);
    timers.current.push(t);
  }
  useEffect(() => clearTimers, []);

  function say(kind: Line['kind'], tag: string, text: string) {
    lineId.current += 1;
    setFeed((prev) => [{ id: lineId.current, kind, tag, text }, ...prev].slice(0, 8));
  }

  const leaderId = nodes.find((n) => n.role === 'leader' && !n.down)?.id ?? null;

  function reset() {
    clearTimers();
    idxRef.current = 0;
    lineId.current = 0;
    setTerm(1);
    setNodes(freshNodes('n1'));
    setLog([]);
    setFeed([]);
    setRunning(false);
    setElecting(null);
  }

  // Append a Put: leader writes pending, replicates, commits on majority ack.
  function putEntry(cmd: string, baseDelay: number) {
    idxRef.current += 1;
    const idx = idxRef.current;
    after(baseDelay, () => {
      setLog((prev) => [...prev, { idx, cmd, committed: false }]);
      say('repl', 'AppendEntries', `leader replicates ${cmd} to followers`);
    });
    after(baseDelay + 500, () => {
      setLog((prev) =>
        prev.map((e) => (e.idx === idx ? { ...e, committed: true } : e)),
      );
      say('repl', 'commit', `${cmd} acked by majority, committed at index ${idx}`);
    });
  }

  function run() {
    if (running) return;
    reset();
    setRunning(true);
    say('info', 'cluster', '3 nodes up, n1 elected leader in term 1');

    // Two committed Puts replicate cleanly under the term-1 leader.
    putEntry('put k=a', 350);
    putEntry('put k=b', 1450);

    // Inject a fault: kill the leader n1. Followers stop hearing heartbeats.
    after(2700, () => {
      setNodes((prev) =>
        prev.map((n) => (n.id === 'n1' ? { ...n, down: true, role: 'follower' } : n)),
      );
      say('fault', 'kill', 'leader n1 killed, heartbeats stop');
    });

    // An election timeout fires on n2, which becomes a candidate.
    after(3500, () => {
      setElecting('n2');
      setNodes((prev) =>
        prev.map((n) => (n.id === 'n2' ? { ...n, role: 'candidate' } : n)),
      );
      say('elect', 'timeout', 'n2 election timeout fires, starts term 2');
    });

    // n2 wins the vote from n3 and becomes leader for term 2.
    after(4300, () => {
      setTerm(2);
      setElecting(null);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === 'n2'
            ? { ...n, role: 'leader' }
            : n.id === 'n3'
              ? { ...n, role: 'follower' }
              : n,
        ),
      );
      say('elect', 'leader', 'n2 wins majority vote, leads term 2');
    });

    // The committed Puts survive the leader change; a new Put commits under n2.
    after(5100, () => {
      say('info', 'invariant', 'committed entries a and b preserved across the fault');
    });
    putEntry('put k=c', 5500);
    after(6600, () => {
      say('info', 'safety', 'four Figure-2 invariants hold after every step');
      setRunning(false);
    });
  }

  return (
    <div className="demo" aria-label="raftkv consensus demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Raft election and replication</h3>
      <p className="demo__lede">
        A 3-node Raft cluster. Run the scenario to replicate committed Puts under
        the leader, then kill the leader and watch a follower time out, win the
        vote, and lead the next term while the committed entries survive the
        fault.
      </p>

      <div className="rk__stage">
        <div className="rk__topbar">
          <span className="rk__term">
            term <b>{term}</b>
          </span>
          <span className="rk__term">
            committed <b>{log.filter((e) => e.committed).length}</b>
          </span>
          <span className="rk__leader">
            leader <b>{leaderId ?? 'electing'}</b>
          </span>
        </div>

        <div className="rk__nodes">
          {nodes.map((n) => {
            const roleClass = n.down
              ? 'rk__node--down'
              : n.role === 'leader'
                ? 'rk__node--leader'
                : n.role === 'candidate'
                  ? 'rk__node--candidate'
                  : 'rk__node--follower';
            return (
              <motion.div
                key={n.id}
                className={`rk__node ${roleClass}`}
                animate={
                  electing === n.id && !reduce
                    ? { scale: [1, 1.02, 1] }
                    : { scale: 1 }
                }
                transition={{ duration: 0.6, repeat: electing === n.id ? Infinity : 0 }}
              >
                <div className="rk__node-top">
                  <span className="rk__node-name">{n.id}</span>
                  <span className="rk__node-role">
                    {n.down ? 'down' : n.role}
                  </span>
                </div>
                <div className="rk__timeout" aria-hidden="true">
                  {n.role === 'follower' && !n.down && leaderId && (
                    <motion.div
                      className="rk__timeout-fill"
                      key={`${n.id}-${term}-${leaderId}`}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: reduce ? 1 : [0, 1] }}
                      transition={{
                        duration: reduce ? 0 : 1.2,
                        repeat: reduce ? 0 : Infinity,
                        ease: 'linear',
                      }}
                    />
                  )}
                </div>
                <div className="rk__log">
                  {n.down ? (
                    <span className="rk__down-badge">offline</span>
                  ) : log.length === 0 ? (
                    <span className="rk__entry-empty">empty log</span>
                  ) : (
                    <AnimatePresence initial={false}>
                      {log.map((e) => (
                        <motion.div
                          key={e.idx}
                          className={`rk__entry ${
                            e.committed ? 'rk__entry--committed' : 'rk__entry--pending'
                          }`}
                          initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: reduce ? 0 : 0.2 }}
                        >
                          <span className="rk__entry-idx">{e.idx}</span>
                          <span className="rk__entry-cmd">{e.cmd}</span>
                          <span style={{ marginLeft: 'auto' }}>
                            {e.committed ? 'committed' : 'pending'}
                          </span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="rk__feed">
          <div className="rk__feed-head">cluster events</div>
          <ul className="rk__feed-list">
            {feed.length === 0 ? (
              <li className="rk__feed-empty">run the scenario to drive the cluster</li>
            ) : (
              feed.map((l) => (
                <li key={l.id} className={`rk__feed-line rk__feed-line--${l.kind}`}>
                  <span className="rk__feed-tag">{l.tag}</span>
                  <span className="rk__feed-text">{l.text}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rk__stats">
          <div className="rk__stat">
            <span className="rk__stat-val">{CHAOS_PASS}/{CHAOS_PASS}</span>
            <span className="rk__stat-unit">chaos scenarios passed</span>
          </div>
          <div className="rk__stat">
            <span className="rk__stat-val">{PUTS_PER_SEC.toFixed(0)}</span>
            <span className="rk__stat-unit">Puts/sec at 3 nodes</span>
          </div>
          <div className="rk__stat">
            <span className="rk__stat-val">{INVARIANTS}</span>
            <span className="rk__stat-unit">Figure-2 invariants checked</span>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running scenario…' : 'Run election + kill leader'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {electing
            ? `${electing} is a candidate, gathering votes`
            : `term ${term}, leader ${leaderId ?? 'pending'}`}
        </span>
      </div>
    </div>
  );
}
