import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './distributedkv.css';

// Three nodes in one Raft group. Writes go to the leader and replicate to
// followers. Linearizable GETs verify leadership and a barrier before serving;
// stale reads opt into a fast follower read. Kill the leader and a new one is
// elected, then a client GET still returns fresh data.

type NodeId = 'n1' | 'n2' | 'n3';
type Role = 'leader' | 'follower' | 'down';

type NodeState = {
  id: NodeId;
  label: string;
  x: number;
  y: number;
  role: Role;
  term: number;
};

type LogLine = { id: number; kind: 'write' | 'read' | 'raft'; tag: string; text: string };
type ReadMode = 'linearizable' | 'stale';

const INITIAL: NodeState[] = [
  { id: 'n1', label: 'node-1', x: 270, y: 70, role: 'leader', term: 1 },
  { id: 'n2', label: 'node-2', x: 130, y: 250, role: 'follower', term: 1 },
  { id: 'n3', label: 'node-3', x: 410, y: 250, role: 'follower', term: 1 },
];

const CLIENT = { x: 270, y: 320 };
const ease = [0.22, 1, 0.36, 1] as const;

let lineSeq = 0;
function line(kind: LogLine['kind'], tag: string, text: string): LogLine {
  lineSeq += 1;
  return { id: lineSeq, kind, tag, text };
}

export default function DistributedkvDemo() {
  const reduce = useReducedMotion();
  const [nodes, setNodes] = useState<NodeState[]>(INITIAL);
  const [version, setVersion] = useState(7);
  const [value, setValue] = useState('A');
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [readMode, setReadMode] = useState<ReadMode>('linearizable');
  const [pulse, setPulse] = useState<{ from: NodeId; to: NodeId; key: number } | null>(null);
  const [electedDuring, setElectedDuring] = useState(false);
  const timers = useRef<number[]>([]);

  const leader = nodes.find((n) => n.role === 'leader') ?? null;

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      const id = window.setTimeout(resolve, reduce ? 0 : ms);
      timers.current.push(id);
    });
  }

  function clearTimers() {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setNodes(INITIAL);
    setVersion(7);
    setValue('A');
    setLog([]);
    setBusy(false);
    setReadMode('linearizable');
    setPulse(null);
    setElectedDuring(false);
  }

  async function write() {
    if (busy || !leader) return;
    setBusy(true);
    const nextVal = String.fromCharCode(value.charCodeAt(0) + 1);
    const nextVer = version + 1;
    setLog((l) => [line('write', 'WRITE', `set key=user/42 to "${nextVal}" sent to ${leader.label}`), ...l]);
    const followers = nodes.filter((n) => n.role === 'follower');
    for (const f of followers) {
      setPulse({ from: leader.id, to: f.id, key: lineSeq + Math.random() });
      await wait(420);
    }
    setPulse(null);
    setValue(nextVal);
    setVersion(nextVer);
    setLog((l) => [
      line('raft', 'COMMIT', `entry replicated to majority, version ${nextVer}`),
      ...l,
    ]);
    setBusy(false);
  }

  async function read() {
    if (busy || !leader) return;
    setBusy(true);
    if (readMode === 'linearizable') {
      setLog((l) => [line('read', 'GET', `linearizable read routed to leader ${leader.label}`), ...l]);
      await wait(320);
      setLog((l) => [line('raft', 'VERIFY', 'VerifyLeader passes, Barrier returns'), ...l]);
      await wait(320);
      setLog((l) => [
        line('read', 'RESULT', `user/42 = "${value}" at version ${version} (fresh)`),
        ...l,
      ]);
    } else {
      const followers = nodes.filter((n) => n.role === 'follower');
      const f = followers[0] ?? leader;
      setLog((l) => [line('read', 'GET', `stale read (?stale=1) served by follower ${f.label}`), ...l]);
      await wait(280);
      setLog((l) => [
        line('read', 'RESULT', `user/42 = "${value}" at version ${version} (no barrier, may lag)`),
        ...l,
      ]);
    }
    setBusy(false);
  }

  async function killLeader() {
    if (busy || !leader) return;
    setBusy(true);
    setElectedDuring(false);
    const oldLeader = leader;
    setLog((l) => [line('raft', 'CHAOS', `faultctl kills leader ${oldLeader.label}`), ...l]);
    setNodes((ns) => ns.map((n) => (n.id === oldLeader.id ? { ...n, role: 'down' } : n)));
    await wait(500);

    // Election: surviving followers move to a new term and one wins.
    const survivors = nodes.filter((n) => n.id !== oldLeader.id);
    const winner = survivors[0];
    const newTerm = Math.max(...nodes.map((n) => n.term)) + 1;
    setLog((l) => [line('raft', 'ELECT', `term ${newTerm}: ${survivors.map((s) => s.label).join(' and ')} request votes`), ...l]);
    await wait(520);

    setNodes((ns) =>
      ns.map((n) => {
        if (n.id === oldLeader.id) return { ...n, term: newTerm };
        if (n.id === winner.id) return { ...n, role: 'leader', term: newTerm };
        return { ...n, role: 'follower', term: newTerm };
      }),
    );
    setElectedDuring(true);
    setLog((l) => [line('raft', 'ELECT', `${winner.label} wins, becomes leader for term ${newTerm}`), ...l]);
    await wait(440);

    // Client GET redirected to the new leader still returns fresh data.
    setLog((l) => [line('read', 'GET', `client GET redirected to new leader ${winner.label}`), ...l]);
    await wait(360);
    setLog((l) => [
      line('read', 'RESULT', `user/42 = "${value}" at version ${version} (still fresh)`),
      ...l,
    ]);
    setBusy(false);
  }

  return (
    <div className="demo" aria-label="distributedkv raft demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Raft replication and leader loss</h3>
      <p className="demo__lede">
        Three nodes in one Raft group. Write to replicate across the majority,
        read linearizable or stale, then kill the leader and watch a new one win
        the election while a client GET still returns fresh data.
      </p>

      <div className="dkv__stage">
        <div className="dkv__ringwrap">
          <svg
            className="dkv__svg"
            viewBox="0 0 540 370"
            role="group"
            aria-label="three node raft ring"
          >
            <defs>
              <marker
                id="dkv-arrow"
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

            {/* ring edges between the three nodes */}
            {[
              ['n1', 'n2'],
              ['n2', 'n3'],
              ['n3', 'n1'],
            ].map(([a, b]) => {
              const na = nodes.find((n) => n.id === a)!;
              const nb = nodes.find((n) => n.id === b)!;
              return (
                <line
                  key={`${a}-${b}`}
                  x1={na.x}
                  y1={na.y}
                  x2={nb.x}
                  y2={nb.y}
                  stroke="var(--line)"
                  strokeWidth={1.2}
                />
              );
            })}

            {/* replication pulse from leader to a follower */}
            <AnimatePresence>
              {pulse && (
                <motion.circle
                  key={pulse.key}
                  r={5}
                  fill="var(--accent)"
                  initial={{
                    cx: nodes.find((n) => n.id === pulse.from)!.x,
                    cy: nodes.find((n) => n.id === pulse.from)!.y,
                    opacity: 0,
                  }}
                  animate={{
                    cx: nodes.find((n) => n.id === pulse.to)!.x,
                    cy: nodes.find((n) => n.id === pulse.to)!.y,
                    opacity: 1,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                />
              )}
            </AnimatePresence>

            {/* nodes */}
            {nodes.map((n) => {
              const isLeader = n.role === 'leader';
              const isDown = n.role === 'down';
              const stroke = isDown
                ? 'var(--line)'
                : isLeader
                  ? 'var(--accent)'
                  : 'var(--accent-line)';
              const fill = isLeader ? 'var(--accent-glow)' : 'var(--ink-700)';
              return (
                <g key={n.id} opacity={isDown ? 0.4 : 1}>
                  <motion.circle
                    cx={n.x}
                    cy={n.y}
                    r={isLeader ? 38 : 32}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isLeader ? 2.4 : 1.4}
                    strokeDasharray={isDown ? '4 4' : undefined}
                    animate={{ r: isLeader ? 38 : 32 }}
                    transition={{ duration: reduce ? 0 : 0.35, ease }}
                  />
                  <text x={n.x} y={n.y - 6} textAnchor="middle" className="dkv__node-label">
                    {n.label}
                  </text>
                  <text
                    x={n.x}
                    y={n.y + 8}
                    textAnchor="middle"
                    className="dkv__node-role"
                    style={{ fill: isLeader ? 'var(--accent)' : isDown ? 'var(--paper-faint)' : '#4fd08a' }}
                  >
                    {isDown ? 'down' : n.role}
                  </text>
                  <text x={n.x} y={n.y + 22} textAnchor="middle" className="dkv__node-term">
                    term {n.term}
                  </text>
                </g>
              );
            })}

            {/* client */}
            <circle cx={CLIENT.x} cy={CLIENT.y} r={10} fill="var(--ink-700)" stroke="var(--line)" />
            <text x={CLIENT.x} y={CLIENT.y + 26} textAnchor="middle" className="dkv__client-label">
              client
            </text>
            {leader && (
              <line
                x1={CLIENT.x}
                y1={CLIENT.y - 10}
                x2={leader.x}
                y2={leader.y + (leader.role === 'leader' ? 38 : 32)}
                stroke="var(--accent-line)"
                strokeWidth={1.4}
                strokeDasharray="5 4"
                markerEnd="url(#dkv-arrow)"
              />
            )}
          </svg>
        </div>

        <div className="dkv__panels">
          <div className="dkv__panel">
            <div className="dkv__panel-head">Replicated state</div>
            <div className="dkv__kv">
              <div className="dkv__kv-row">
                <span className="dkv__kv-key">user/42</span>
                <span className="dkv__kv-val">{value}</span>
                <span className="dkv__kv-ver">v{version}</span>
              </div>
              <div className="dkv__kv-row">
                <span className="dkv__kv-key">region</span>
                <span className="dkv__kv-val">eu-west</span>
                <span className="dkv__kv-ver">v3</span>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="dkv__panel-head" style={{ marginBottom: 8 }}>
                Read mode
              </div>
              <div className="dkv__readmode" role="group" aria-label="read mode">
                <button
                  type="button"
                  className={`dkv__readmode-btn${readMode === 'linearizable' ? ' dkv__readmode-btn--on' : ''}`}
                  onClick={() => setReadMode('linearizable')}
                  aria-pressed={readMode === 'linearizable'}
                  disabled={busy}
                >
                  linearizable
                </button>
                <button
                  type="button"
                  className={`dkv__readmode-btn${readMode === 'stale' ? ' dkv__readmode-btn--on' : ''}`}
                  onClick={() => setReadMode('stale')}
                  aria-pressed={readMode === 'stale'}
                  disabled={busy}
                >
                  stale=1
                </button>
              </div>
            </div>
          </div>

          <div className="dkv__panel">
            <div className="dkv__panel-head">Cluster log</div>
            {log.length === 0 ? (
              <p className="dkv__log-empty">Write, read, or kill the leader to drive the cluster.</p>
            ) : (
              <ul className="dkv__log">
                <AnimatePresence initial={false}>
                  {log.slice(0, 8).map((l) => (
                    <motion.li
                      key={l.id}
                      className={`dkv__log-line dkv__log-line--${l.kind}`}
                      initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: reduce ? 0 : 0.3, ease }}
                    >
                      <span className="dkv__log-tag">{l.tag}</span>
                      <span className="dkv__log-text">{l.text}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>

        <AnimatePresence>
          {electedDuring && (
            <motion.div
              className="dkv__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="dkv__verdict-head">Re-elected within the deadline</span>
              <span className="dkv__verdict-text">
                The chaos harness kills the leader and asserts a new one is
                elected before the deadline. A redirected GET still returns the
                committed value, since the entry was replicated to a majority
                before the failure.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={write} disabled={busy}>
          Write
        </button>
        <button className="demo__btn" onClick={read} disabled={busy}>
          Read
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={killLeader} disabled={busy || !leader}>
          Kill leader
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={busy}>
          Reset
        </button>
        <span className="demo__hint">
          {leader ? `leader ${leader.label}, term ${leader.term}` : 'electing leader'}
        </span>
      </div>
    </div>
  );
}
