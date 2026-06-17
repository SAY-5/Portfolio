import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './pulseroute.css';
import { useStore } from './pulseroute/state';
import {
  addBackend,
  previewBatch,
  removeBackend,
  resetAll,
  route,
  setStrategy,
  setWeight,
  toggleHealth,
} from './pulseroute/store';
import { STRATEGIES, STRATEGY_LABELS } from './pulseroute/types';
import type { Backend, BatchResult, Strategy } from './pulseroute/types';

// How many requests a single batch routes. Fixed so the distribution maths is
// easy to read against the weights.
const BATCH_SIZE = 120;

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

// A backend card: weight steppers, a health toggle, and a live count plus a
// percentage bar driven by the most recent batch.
function BackendCard({
  backend,
  routed,
  total,
  removable,
  reducedMotion,
}: {
  backend: Backend;
  routed: number;
  total: number;
  removable: boolean;
  reducedMotion: boolean;
}) {
  const share = pct(routed, total);
  const off = !backend.healthy;
  return (
    <li className={`pr-card${off ? ' pr-card--off' : ''}`}>
      <div className="pr-card__head">
        <span className="pr-card__label">{backend.label}</span>
        <span
          className={`pr-card__badge${off ? ' pr-card__badge--off' : ''}`}
          aria-hidden="true"
        >
          {off ? 'drained' : 'healthy'}
        </span>
      </div>

      <div className="pr-card__row">
        <span className="pr-card__key" id={`w-${backend.id}`}>
          weight
        </span>
        <div className="pr-stepper" role="group" aria-labelledby={`w-${backend.id}`}>
          <button
            type="button"
            className="pr-stepper__btn"
            onClick={() => setWeight(backend.id, backend.weight - 1)}
            disabled={backend.weight <= 1}
            aria-label={`Decrease ${backend.label} weight`}
          >
            -
          </button>
          <span className="pr-stepper__val" aria-live="polite">
            {backend.weight}
          </span>
          <button
            type="button"
            className="pr-stepper__btn"
            onClick={() => setWeight(backend.id, backend.weight + 1)}
            disabled={backend.weight >= 99}
            aria-label={`Increase ${backend.label} weight`}
          >
            +
          </button>
        </div>
      </div>

      <div className="pr-card__meter">
        <div className="pr-card__meter-head">
          <span>{routed} req</span>
          <span aria-hidden="true">{share}%</span>
        </div>
        <div
          className="pr-bar"
          role="meter"
          aria-valuenow={share}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${backend.label} received ${share} percent of routed traffic`}
        >
          <motion.span
            className="pr-bar__fill"
            initial={false}
            animate={{ width: `${share}%` }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.45, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="pr-card__actions">
        <button
          type="button"
          className="pr-toggle"
          role="switch"
          aria-checked={backend.healthy}
          onClick={() => toggleHealth(backend.id)}
        >
          <span className="pr-toggle__track" aria-hidden="true">
            <span className="pr-toggle__thumb" />
          </span>
          {backend.healthy ? 'In rotation' : 'Out of rotation'}
        </button>
        <button
          type="button"
          className="pr-card__remove"
          onClick={() => removeBackend(backend.id)}
          disabled={!removable}
          aria-label={`Remove ${backend.label}`}
        >
          remove
        </button>
      </div>
    </li>
  );
}

// The compare grid: every strategy's split over the current pool, recomputed
// live so switching weights or health updates all rows at once.
function CompareGrid({
  backends,
  active,
}: {
  backends: Backend[];
  active: Strategy;
}) {
  // previewBatch reads the live pool, so this recomputes on every render the
  // parent triggers (a weight, health, or strategy change). The work is a few
  // strategies over a small fixed batch, so it stays cheap without memoising.
  const rows = STRATEGIES.map((s) => ({
    strategy: s,
    result: previewBatch(s, BATCH_SIZE),
  }));

  return (
    <table className="pr-compare">
      <caption className="pr-compare__cap">
        Distribution of {BATCH_SIZE} requests per strategy over the current pool
      </caption>
      <thead>
        <tr>
          <th scope="col">strategy</th>
          {backends.map((b) => (
            <th scope="col" key={b.id}>
              {b.label}
            </th>
          ))}
          <th scope="col">dropped</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ strategy, result }) => (
          <tr key={strategy} className={strategy === active ? 'pr-compare__active' : ''}>
            <th scope="row">{STRATEGY_LABELS[strategy]}</th>
            {backends.map((b) => (
              <td key={b.id}>
                {b.healthy ? `${pct(result.distribution[b.id] ?? 0, result.total)}%` : 'off'}
              </td>
            ))}
            <td>{result.dropped > 0 ? result.dropped : '0'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PulserouteDemo() {
  const reduced = useReducedMotion() ?? false;
  const { backends, strategy, lastBatch } = useStore();
  const [drained, setDrained] = useState<BatchResult | null>(null);

  const healthyCount = backends.filter((b) => b.healthy).length;
  const total = lastBatch?.total ?? 0;

  function runBatch() {
    const result = route(BATCH_SIZE);
    // Note when every backend is out of rotation so the UI can explain the drop.
    setDrained(result.dropped === result.total && result.total > 0 ? result : null);
  }

  function onReset() {
    resetAll();
    setDrained(null);
  }

  return (
    <div className="demo">
      <span className="demo__tag">load balancer</span>
      <h3 className="demo__title">PulseRoute</h3>
      <p className="demo__lede">
        Define a backend pool, pick a routing strategy, then route a batch and
        watch the split. Drained backends are skipped by every strategy, and the
        random strategy is seeded so a given pool always lands the same way.
      </p>

      <section aria-label="Routing strategy" className="pr-strategy">
        <span className="pr-strategy__label" id="pr-strat-label">
          strategy
        </span>
        <div className="pr-strategy__opts" role="radiogroup" aria-labelledby="pr-strat-label">
          {STRATEGIES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={strategy === s}
              className={`pr-chip${strategy === s ? ' pr-chip--on' : ''}`}
              onClick={() => setStrategy(s)}
            >
              {STRATEGY_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Backend pool">
        <ul className="pr-pool">
          {backends.map((b) => (
            <BackendCard
              key={b.id}
              backend={b}
              routed={lastBatch?.distribution[b.id] ?? 0}
              total={total}
              removable={backends.length > 1}
              reducedMotion={reduced}
            />
          ))}
        </ul>
      </section>

      <AnimatePresence>
        {drained && (
          <motion.div
            className="pr-note pr-note--warn"
            role="status"
            initial={reduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0 }}
          >
            No healthy backend in the pool. All {drained.total} requests were dropped.
          </motion.div>
        )}
      </AnimatePresence>

      <section aria-label="Strategy comparison" className="pr-section">
        <CompareGrid backends={backends} active={strategy} />
      </section>

      <div className="demo__controls">
        <button type="button" className="demo__btn" onClick={runBatch}>
          Route {BATCH_SIZE} requests
        </button>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={addBackend}>
          Add backend
        </button>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={onReset}>
          Reset
        </button>
        <span className="demo__hint">
          {healthyCount} of {backends.length} backends in rotation
        </span>
      </div>
    </div>
  );
}
