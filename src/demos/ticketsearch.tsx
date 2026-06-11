import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './ticketsearch.css';

// Real mechanism: a hot availability cache decrements on every write before
// the store mutation, two concurrent orders for the same hold serialize via a
// monotone Version field so the second aborts on version drift, and a janitor
// goroutine sweeps active holds every 5 seconds and frees expired ones back to
// the map. Designed for about 5K transactions/day.

const SEATS = 24; // section A: 24 seats over 3 rows of 8
const JANITOR_INTERVAL_S = 5;

type SeatState = 'open' | 'held' | 'sold';
type LogKind = 'ok' | 'err' | 'sys';
type LogLine = { id: number; kind: LogKind; tag: string; text: string };

let logId = 0;

export default function TicketsearchDemo() {
  const reduce = useReducedMotion();
  const [seats, setSeats] = useState<SeatState[]>(() => Array(SEATS).fill('open'));
  const [available, setAvailable] = useState(SEATS);
  const [log, setLog] = useState<LogLine[]>([]);
  const [race, setRace] = useState<null | { winner: 'A' | 'B'; version: number }>(null);
  const [raceBusy, setRaceBusy] = useState(false);
  const [raceReveal, setRaceReveal] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function push(kind: LogKind, tag: string, text: string) {
    setLog((prev) => [{ id: logId++, kind, tag, text }, ...prev].slice(0, 8));
  }

  // Janitor: every 5s, free one expired hold back to the map and bump the
  // counter. Modeled here on a real interval so the sweep is observable.
  useEffect(() => {
    if (reduce) return;
    const iv = window.setInterval(() => {
      setSeats((prev) => {
        const heldIdx = prev.findIndex((s) => s === 'held');
        if (heldIdx === -1) return prev;
        const next = [...prev];
        next[heldIdx] = 'open';
        setAvailable((a) => a + 1);
        push('sys', 'janitor', `hold on seat ${heldIdx + 1} expired, freed to cache`);
        return next;
      });
    }, JANITOR_INTERVAL_S * 1000);
    return () => window.clearInterval(iv);
  }, [reduce]);

  function clickSeat(i: number) {
    const cur = seats[i];
    if (cur === 'sold') return;
    if (cur === 'open') {
      // hold decrements the hot cache counter before the store mutation
      setSeats((prev) => {
        const next = [...prev];
        next[i] = 'held';
        return next;
      });
      setAvailable((a) => a - 1);
      push('ok', 'POST hold', `seat ${i + 1} held, cache decremented to ${available - 1}`);
    } else {
      // confirm the order on a held seat (idempotent at the store layer)
      setSeats((prev) => {
        const next = [...prev];
        next[i] = 'sold';
        return next;
      });
      push('ok', 'POST order', `seat ${i + 1} committed, optimistic version bumped`);
    }
  }

  function reset() {
    clearTimers();
    setSeats(Array(SEATS).fill('open'));
    setAvailable(SEATS);
    setLog([]);
    setRace(null);
    setRaceReveal(false);
    setRaceBusy(false);
  }

  // Two concurrent orders for the same held seat. Both read Version=7; the
  // first to commit bumps it to 8, the second sees version drift and aborts.
  function runRace() {
    if (raceBusy) return;
    // ensure there is a held seat to contend over
    let target = seats.findIndex((s) => s === 'held');
    if (target === -1) {
      target = seats.findIndex((s) => s === 'open');
      if (target === -1) return;
      setSeats((prev) => {
        const next = [...prev];
        next[target] = 'held';
        return next;
      });
      setAvailable((a) => a - 1);
    }
    const seatNo = target + 1;
    setRaceBusy(true);
    setRaceReveal(false);
    const winner: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B';
    setRace({ winner, version: 7 });
    push('sys', 'race', `orders A and B both read seat ${seatNo} at version 7`);

    const finalize = () => {
      const loser = winner === 'A' ? 'B' : 'A';
      setSeats((prev) => {
        const next = [...prev];
        next[target] = 'sold';
        return next;
      });
      setRaceReveal(true);
      push('ok', `order ${winner}`, `committed seat ${seatNo}, version 7 to 8`);
      push('err', `order ${loser}`, `aborted: version drift, expected 7 saw 8`);
      setRaceBusy(false);
    };

    if (reduce) {
      finalize();
      return;
    }
    timers.current.push(window.setTimeout(finalize, 900));
  }

  const ease = [0.22, 1, 0.36, 1] as const;
  const loser = race ? (race.winner === 'A' ? 'B' : 'A') : null;
  const heldCount = seats.filter((s) => s === 'held').length;
  const soldCount = seats.filter((s) => s === 'sold').length;

  function laneClass(name: 'A' | 'B') {
    if (!raceReveal || !race) return 'ts__lane';
    return name === race.winner ? 'ts__lane ts__lane--win' : 'ts__lane ts__lane--abort';
  }

  return (
    <div className="demo" aria-label="ticketsearch seat inventory demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Hold, order, and the version race</h3>
      <p className="demo__lede">
        Click an open seat to place a hold, which decrements the hot cache
        counter before the store mutation. Click a held seat to commit the
        order. Run the race to send two concurrent orders at one held seat: the
        first bumps the seat version and the second aborts on version drift.
        The janitor frees an expired hold every {JANITOR_INTERVAL_S} seconds.
      </p>

      <div className="ts__stage">
        <div className="ts__top">
          <div className="ts__mapwrap">
            <div className="ts__map-head">
              <span className="ts__map-title">section A</span>
              <span className="ts__map-stage">stage this way</span>
            </div>
            <div className="ts__grid" role="group" aria-label="seat map">
              {seats.map((s, i) => (
                <button
                  key={i}
                  className={`ts__seat ts__seat--${s}`}
                  aria-label={`Seat ${i + 1}, ${s}`}
                  onClick={() => clickSeat(i)}
                >
                  {s === 'open' ? i + 1 : ''}
                </button>
              ))}
            </div>
            <div className="ts__legend">
              <span className="ts__legend-item">
                <span className="ts__swatch" /> open
              </span>
              <span className="ts__legend-item">
                <span className="ts__swatch ts__swatch--held" /> held
              </span>
              <span className="ts__legend-item">
                <span className="ts__swatch ts__swatch--sold" /> sold
              </span>
            </div>
          </div>

          <div className="ts__side">
            <div className="ts__counter">
              <div className="ts__counter-label">hot cache: available</div>
              <motion.div
                key={available}
                className="ts__counter-val"
                initial={{ scale: reduce ? 1 : 1.12, color: '#ff7d52' }}
                animate={{ scale: 1, color: 'var(--text-strong)' as string }}
                transition={{ duration: 0.3, ease }}
              >
                {available}
              </motion.div>
              <div className="ts__counter-meta">
                {heldCount} held · {soldCount} sold · live read source, decrement then commit
              </div>
            </div>

            <div className="ts__log">
              <div className="ts__log-head">request log</div>
              <ul className="ts__log-list">
                <AnimatePresence initial={false}>
                  {log.length === 0 && (
                    <li className="ts__log-empty">place a hold to start the flow</li>
                  )}
                  {log.map((l) => (
                    <motion.li
                      key={l.id}
                      className={`ts__log-line ts__log-line--${l.kind}`}
                      initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, ease }}
                    >
                      <span className="ts__log-tag">{l.tag}</span>
                      <span className="ts__log-text">{l.text}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          </div>
        </div>

        <div className="ts__race">
          <div className="ts__race-head">concurrent orders, optimistic version lock</div>
          <div className="ts__race-lanes">
            {(['A', 'B'] as const).map((name) => {
              const isWinner = raceReveal && race?.winner === name;
              const isLoser = raceReveal && loser === name;
              return (
                <div key={name} className={laneClass(name)}>
                  <div className="ts__lane-name">order {name}</div>
                  <div className="ts__lane-ver">
                    read version <b>{race ? race.version : 7}</b>
                  </div>
                  <div className="ts__lane-out">
                    {!race
                      ? 'idle'
                      : !raceReveal
                        ? 'committing…'
                        : isWinner
                          ? 'committed, version to 8'
                          : isLoser
                            ? 'aborted on version drift'
                            : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runRace} disabled={raceBusy}>
          {raceBusy ? 'Racing…' : 'Run concurrent orders'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={raceBusy}>
          Reset
        </button>
        <span className="demo__hint">about 5K transactions/day · janitor every {JANITOR_INTERVAL_S}s</span>
      </div>
    </div>
  );
}
