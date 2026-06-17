import { useMemo, useState } from 'react';
import './sigma-terminal.css';
import { universe } from './sigma-terminal/data';
import { sparklinePath } from './sigma-terminal/engine';
import { useStore } from './sigma-terminal/state';
import {
  addAlert,
  addTicker,
  clearTriggered,
  quoteFor,
  removeAlert,
  removeTicker,
  resetAll,
  selectTicker,
  seriesFor,
  step,
  stepAll,
} from './sigma-terminal/store';
import type { AlertDirection, Bar } from './sigma-terminal/types';

const CHART_W = 460;
const CHART_H = 180;

// A compact inline sparkline drawn from an instrument's close prices. The line
// is coloured by net direction over the window so a glance reads the trend.
function Sparkline({
  series,
  width,
  height,
  up,
}: {
  series: Bar[];
  width: number;
  height: number;
  up: boolean;
}) {
  const d = sparklinePath(series, width, height);
  if (!d) return <span className="st__spark-empty" aria-hidden="true" />;
  return (
    <svg
      className="st__spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        d={d}
        fill="none"
        stroke={up ? 'var(--ok)' : 'var(--magenta)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// In-browser Sigma Terminal. The watchlist, price alerts, and per-instrument
// tick counts live in a small external store backed by localStorage, while the
// price series for each instrument is rebuilt deterministically from its seed
// through the engine, so the same instrument always charts the same way. There
// is no network and no eval: advancing the series appends one deterministic bar
// and re-evaluates alerts by plain numeric comparison. A captured clock value
// keeps render pure while still timestamping triggered alerts.

// A larger area chart for the selected instrument: the close-price line with a
// soft fill beneath it, drawn purely from the deterministic series.
function AreaChart({ series, up }: { series: Bar[]; up: boolean }) {
  const line = sparklinePath(series, CHART_W, CHART_H);
  if (!line) {
    return <div className="st__chart" style={{ height: CHART_H }} />;
  }
  const fill = `${line}L${CHART_W} ${CHART_H}L0 ${CHART_H}Z`;
  const stroke = up ? 'var(--ok)' : 'var(--magenta)';
  return (
    <svg
      className="st__chart"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label="Close price over the current series"
      preserveAspectRatio="none"
    >
      <path d={fill} fill={up ? 'var(--accent-soft)' : 'var(--magenta-soft)'} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// The detail panel: selected instrument, area chart, OHLC and high/low/change
// statistics, and the alerts editor for that instrument.
function DetailPanel({ ticker }: { ticker: string }) {
  const inst = universe.find((i) => i.ticker === ticker);
  const series = seriesFor(ticker);
  const q = quoteFor(ticker);
  const up = q.change >= 0;
  const state = useStore();
  const alerts = state.alerts.filter((a) => a.ticker === ticker);
  const firedIds = new Set(state.triggered.map((t) => t.alert.id));

  const [dir, setDir] = useState<AlertDirection>('above');
  const [threshold, setThreshold] = useState('');

  if (!inst) {
    return (
      <section className="st__detail glass" aria-label="Instrument detail">
        <p className="st__empty">Select an instrument to view its detail.</p>
      </section>
    );
  }

  const stats: { label: string; value: string }[] = [
    { label: 'Open', value: q.open.toFixed(2) },
    { label: 'High', value: q.high.toFixed(2) },
    { label: 'Low', value: q.low.toFixed(2) },
    { label: 'Close', value: q.close.toFixed(2) },
  ];

  function onAddAlert(e: React.FormEvent) {
    e.preventDefault();
    const value = Number.parseFloat(threshold);
    if (!Number.isFinite(value) || value <= 0) return;
    addAlert(ticker, dir, value);
    setThreshold('');
  }

  return (
    <section className="st__detail glass" aria-label={`${ticker} detail`}>
      <div className="st__detail-head">
        <div>
          <span className="st__detail-sym">{ticker}</span>{' '}
          <span className="st__detail-name">{inst.name}</span>
        </div>
        <div>
          <span className="st__detail-price">{q.last.toFixed(2)}</span>{' '}
          <span className={`st__chg ${up ? 'is-up' : 'is-down'}`}>
            {up ? '+' : ''}
            {q.change.toFixed(2)} ({up ? '+' : ''}
            {q.changePct.toFixed(2)}%)
          </span>
        </div>
      </div>

      <AreaChart series={series} up={up} />

      <dl className="st__stats">
        {stats.map((s) => (
          <div className="st__stat" key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="st__alerts">
        <h3 className="st__panel-title">Price alerts</h3>
        <form className="st__alertform" onSubmit={onAddAlert}>
          <div className="st__field">
            <label className="st__label" htmlFor={`st-dir-${ticker}`}>
              Trigger when price
            </label>
            <select
              id={`st-dir-${ticker}`}
              className="st__select"
              value={dir}
              onChange={(e) => setDir(e.target.value as AlertDirection)}
            >
              <option value="above">is at or above</option>
              <option value="below">is at or below</option>
            </select>
          </div>
          <div className="st__field">
            <label className="st__label" htmlFor={`st-thr-${ticker}`}>
              Threshold
            </label>
            <input
              id={`st-thr-${ticker}`}
              className="st__input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={q.last.toFixed(2)}
            />
          </div>
          <button type="submit" className="st__btn" disabled={!threshold}>
            Add alert
          </button>
        </form>

        {alerts.length === 0 ? (
          <p className="st__empty">No alerts on {ticker} yet.</p>
        ) : (
          <ul className="st__alertlist">
            {alerts.map((a) => {
              const fired = firedIds.has(a.id);
              return (
                <li
                  key={a.id}
                  className={`st__alertitem${fired ? ' is-fired' : ''}`}
                >
                  <span className="st__alertmeta">
                    {a.ticker} {a.direction === 'above' ? '>=' : '<='}{' '}
                    {a.threshold.toFixed(2)}
                    {fired ? <span className="st__badge">Fired</span> : null}
                  </span>
                  <button
                    type="button"
                    className="st__remove"
                    aria-label={`Remove alert on ${a.ticker} at ${a.threshold}`}
                    onClick={() => removeAlert(a.id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function SigmaTerminalDemo() {
  const state = useStore();

  // Tickers in the universe not yet on the watchlist, for the add control.
  const addable = useMemo(
    () => universe.filter((i) => !state.watchlist.includes(i.ticker)),
    [state.watchlist],
  );
  const [addPick, setAddPick] = useState('');

  function onStep() {
    stepAll(Date.now());
  }

  return (
    <div className="st">
      <header className="st__head">
        <div>
          <h2 className="st__title">Sigma Terminal</h2>
          <p className="st__sub">
            Seeded in-browser markets watchlist. Deterministic series, no
            network.
          </p>
        </div>
        <div className="st__actions">
          <button type="button" className="st__btn" onClick={onStep}>
            Advance series
          </button>
          <button
            type="button"
            className="st__btn st__btn--ghost"
            onClick={resetAll}
          >
            Reset
          </button>
        </div>
      </header>

      <div className="st__grid">
        <section className="st__watch glass" aria-label="Watchlist">
          <h3 className="st__panel-title">Watchlist</h3>
        <div className="st__addrow">
          <div className="st__field">
            <label className="st__label" htmlFor="st-add">
              Add instrument
            </label>
            <select
              id="st-add"
              className="st__select"
              value={addPick}
              onChange={(e) => setAddPick(e.target.value)}
            >
              <option value="">Choose a ticker</option>
              {addable.map((i) => (
                <option key={i.ticker} value={i.ticker}>
                  {i.ticker} - {i.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="st__btn"
            disabled={!addPick}
            onClick={() => {
              if (addPick) {
                addTicker(addPick);
                setAddPick('');
              }
            }}
          >
            Add
          </button>
        </div>

        {state.watchlist.length === 0 ? (
          <p className="st__empty">
            Watchlist is empty. Add an instrument above to begin.
          </p>
        ) : (
          <table className="st__table">
            <caption className="st__caption">
              Watchlist quotes and trend
            </caption>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="st__num">
                  Last
                </th>
                <th scope="col" className="st__num">
                  Change
                </th>
                <th scope="col">Trend</th>
                <th scope="col">
                  <span className="st__sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.watchlist.map((ticker) => {
                const series = seriesFor(ticker);
                const q = quoteFor(ticker);
                const up = q.change >= 0;
                const selected = ticker === state.selected;
                return (
                  <tr
                    key={ticker}
                    className={selected ? 'is-selected' : undefined}
                    aria-current={selected ? 'true' : undefined}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        className="st__symbtn"
                        onClick={() => selectTicker(ticker)}
                      >
                        {ticker}
                      </button>
                    </th>
                    <td className="st__num st__last">{q.last.toFixed(2)}</td>
                    <td className="st__num">
                      <span className={`st__chg ${up ? 'is-up' : 'is-down'}`}>
                        {up ? '+' : ''}
                        {q.change.toFixed(2)} ({up ? '+' : ''}
                        {q.changePct.toFixed(2)}%)
                      </span>
                    </td>
                    <td>
                      <Sparkline
                        series={series}
                        width={96}
                        height={28}
                        up={up}
                      />
                    </td>
                    <td className="st__rowactions">
                      <button
                        type="button"
                        className="st__remove"
                        aria-label={`Advance ${ticker} one tick`}
                        onClick={() => step(ticker, Date.now())}
                      >
                        Tick
                      </button>
                      <button
                        type="button"
                        className="st__remove"
                        aria-label={`Remove ${ticker} from watchlist`}
                        onClick={() => removeTicker(ticker)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </section>

        {state.selected ? (
          <DetailPanel ticker={state.selected} />
        ) : (
          <section className="st__detail glass" aria-label="Instrument detail">
            <p className="st__empty">
              Select an instrument from the watchlist.
            </p>
          </section>
        )}
      </div>

      {state.triggered.length > 0 ? (
        <section
          className="st__triggered glass"
          aria-label="Triggered alerts"
          aria-live="polite"
        >
          <div className="st__detail-head">
            <h3 className="st__panel-title">
              Triggered on last advance ({state.triggered.length})
            </h3>
            <button
              type="button"
              className="st__remove"
              onClick={clearTriggered}
            >
              Dismiss
            </button>
          </div>
          <ul className="st__triggered-list">
            {state.triggered.map((t) => (
              <li className="st__triggered-item" key={t.alert.id}>
                <span className="st__dot" aria-hidden="true" />
                {t.alert.ticker} {t.alert.direction === 'above' ? '>=' : '<='}{' '}
                {t.alert.threshold.toFixed(2)} hit at {t.price.toFixed(2)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
