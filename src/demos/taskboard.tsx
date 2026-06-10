import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';

// Real mechanism from the project: the board lives in one document. Concurrent
// moves of the same card race on the document's optimistic @Version. One save
// wins and the version increments; the loser catches the conflict, re-reads,
// and rebases its move. A monotonic seq is the tie-break that decides the final
// column. Two invariants always hold afterward: the card id sits in exactly one
// column's cardOrder, and the card's columnId matches the column listing it.
// The FanoutBenchmark delivering one move to 500 subscriber queues sustains
// roughly 80,000 to 90,000 moves per second.
const FANOUT_LOW = 80_000;
const FANOUT_HIGH = 90_000;

type ColId = 'todo' | 'doing' | 'done';
const columns: { id: ColId; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

// User A moves the card to Doing, User B moves it to Done, at the same instant.
const A_TARGET: ColId = 'doing';
const B_TARGET: ColId = 'done';
// Higher seq wins the tie-break. B issues the later move, so B's seq is higher
// and the card settles in Done.
const A_SEQ = 7;
const B_SEQ = 8;
const WINNER: ColId = B_SEQ > A_SEQ ? B_TARGET : A_TARGET;

type LogLine = { id: number; who: 'A' | 'B' | 'sys'; text: string };
const ease = [0.22, 1, 0.36, 1] as const;

export default function TaskboardDemo() {
  const reduce = useReducedMotion();
  const [cardCol, setCardCol] = useState<ColId>('todo');
  const [version, setVersion] = useState(4);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [aActive, setAActive] = useState(false);
  const [bActive, setBActive] = useState(false);
  const timers = useRef<number[]>([]);
  const logId = useRef(0);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function addLog(who: LogLine['who'], text: string) {
    logId.current += 1;
    setLog((prev) => [...prev, { id: logId.current, who, text }]);
  }

  function reset() {
    clearTimers();
    setCardCol('todo');
    setVersion(4);
    setRunning(false);
    setDone(false);
    setAActive(false);
    setBActive(false);
    setLog([]);
    logId.current = 0;
  }

  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  }

  function bothMove() {
    if (running) return;
    reset();
    setRunning(true);
    const base = version; // both clients read this version

    // Both clients fire a move against the same base version.
    at(120, () => {
      setAActive(true);
      setBActive(true);
      addLog('A', `move card to Doing  (base @Version ${base}, seq ${A_SEQ})`);
      addLog('B', `move card to Done   (base @Version ${base}, seq ${B_SEQ})`);
    });

    // One save wins the optimistic lock. B commits first here; version bumps.
    at(900, () => {
      setCardCol(B_TARGET);
      setVersion(base + 1);
      setBActive(false);
      addLog('B', `save committed: @Version ${base} -> ${base + 1}`);
    });

    // A's save hits a stale version and is rejected.
    at(1500, () => {
      addLog(
        'sys',
        `A save rejected: stale @Version ${base}, document now @Version ${base + 1}`,
      );
    });

    // A re-reads, rebases its move onto the new state, seq tie-break decides.
    at(2150, () => {
      addLog('A', `re-read @Version ${base + 1}, rebase move`);
      addLog(
        'sys',
        `seq tie-break: A seq ${A_SEQ} < B seq ${B_SEQ}, card stays in Done`,
      );
    });

    at(2750, () => {
      setAActive(false);
      setVersion(base + 2);
      addLog('A', `rebase committed: @Version ${base + 1} -> ${base + 2}`);
      addLog(
        'sys',
        'invariant ok: card in exactly one column, columnId matches Done',
      );
      setRunning(false);
      setDone(true);
    });
  }

  return (
    <div className="demo" aria-label="TaskBoard concurrent move demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Two users, one card</h3>
      <p className="demo__lede">
        User A and User B grab the same card and drop it in different columns at
        the same instant. The board document is one optimistic-locked record:
        one save wins and bumps the @Version, the loser re-reads and rebases,
        and the monotonic seq is the tie-break for the final column. The card
        lands in exactly one place.
      </p>

      <div className="tb__stage">
        <div className="tb__presence" aria-label="Presence">
          <span className="tb__avatar tb__avatar--a" data-on={aActive}>
            A
          </span>
          <span className="tb__avatar tb__avatar--b" data-on={bActive}>
            B
          </span>
          <span className="tb__presence-label">User A and User B viewing</span>
          <span className="tb__version" aria-live="polite">
            board @Version {version}
          </span>
        </div>

        <div className="tb__board">
          {columns.map((col) => {
            const here = cardCol === col.id;
            const isWinner = done && col.id === WINNER;
            return (
              <div
                key={col.id}
                className={`tb__col ${isWinner ? 'tb__col--win' : ''}`}
              >
                <div className="tb__col-head">
                  <span className="tb__col-name">{col.label}</span>
                  {col.id === A_TARGET && (
                    <span className="tb__ghost tb__ghost--a">A</span>
                  )}
                  {col.id === B_TARGET && (
                    <span className="tb__ghost tb__ghost--b">B</span>
                  )}
                </div>
                <div className="tb__col-body">
                  <AnimatePresence>
                    {here && (
                      <motion.div
                        layoutId="tb-card"
                        className="tb__card"
                        initial={false}
                        transition={{
                          duration: reduce ? 0 : 0.5,
                          ease,
                          layout: { duration: reduce ? 0 : 0.5, ease },
                        }}
                      >
                        <span className="tb__card-id">card #c-203</span>
                        <span className="tb__card-title">
                          Wire STOMP reconnect
                        </span>
                        <span className="tb__card-col">columnId: {cardCol}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>

        <div className="tb__feed" aria-label="Activity feed" aria-live="polite">
          <div className="tb__feed-head">Activity</div>
          <ul className="tb__feed-list">
            <AnimatePresence initial={false}>
              {log.map((l) => (
                <motion.li
                  key={l.id}
                  className={`tb__feed-line tb__feed-line--${l.who}`}
                  initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.25, ease }}
                >
                  <span className="tb__feed-who">
                    {l.who === 'sys' ? 'sys' : `User ${l.who}`}
                  </span>
                  <span className="tb__feed-text">{l.text}</span>
                </motion.li>
              ))}
            </AnimatePresence>
            {log.length === 0 && (
              <li className="tb__feed-empty">
                No moves yet. Run both moves to see the conflict resolve.
              </li>
            )}
          </ul>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="tb__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="tb__verdict-head">One column, no loss</span>
              <span className="tb__verdict-text">
                The card resolved into a single column. The id appears in exactly
                one column's cardOrder and its columnId matches. Fan-out of one
                move to 500 subscriber queues sustains{' '}
                {FANOUT_LOW.toLocaleString()} to {FANOUT_HIGH.toLocaleString()}{' '}
                moves per second.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={bothMove} disabled={running}>
          {running ? 'Resolving…' : 'Both move at once'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          A {'->'} Doing, B {'->'} Done, seq tie-break wins
        </span>
      </div>
    </div>
  );
}
