import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import './sigma-terminal.css';

// Sigma Terminal streams quotes over a Finnhub WebSocket and draws candlesticks
// straight to a canvas with no chart library, then layers 15+ technical
// indicators on top. This demo reproduces that path: a seeded random walk
// stands in for the live feed, candles are drawn by hand on a 2D context,
// SMA / EMA / Bollinger overlays toggle on, and a command-palette switches
// tickers the way Cmd+K does in the terminal.

type Candle = { o: number; h: number; l: number; c: number };
type Ticker = { sym: string; co: string; seed: number; base: number; vol: number };

const TICKERS: Ticker[] = [
  { sym: 'AAPL', co: 'Apple Inc', seed: 11, base: 188.4, vol: 1.7 },
  { sym: 'NVDA', co: 'NVIDIA Corp', seed: 29, base: 121.6, vol: 2.6 },
  { sym: 'TSLA', co: 'Tesla', seed: 7, base: 242.1, vol: 3.1 },
  { sym: 'MSFT', co: 'Microsoft', seed: 41, base: 415.2, vol: 1.9 },
];

const INDICATOR_COUNT = 15; // SMA, EMA, RSI, MACD, Bollinger, Stochastic, ADX, ATR, OBV, CCI, VWAP, ...
const CANDLE_COUNT = 48;
const VIEW_W = 720;
const VIEW_H = 300;
const PAD = 14;

// Deterministic pseudo-random so the server render and the client agree before
// the live stream starts mutating the series.
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function buildSeries(t: Ticker, count: number): Candle[] {
  const rng = makeRng(t.seed * 2654435761);
  const out: Candle[] = [];
  let price = t.base;
  for (let i = 0; i < count; i++) {
    const o = price;
    const drift = (rng() - 0.48) * t.vol;
    const c = Math.max(1, o + drift);
    const wick = (rng() * 0.6 + 0.2) * t.vol;
    const h = Math.max(o, c) + wick * rng();
    const l = Math.min(o, c) - wick * rng();
    out.push({ o, h, l, c });
    price = c;
  }
  return out;
}

function nextCandle(prev: Candle, t: Ticker, rng: () => number): Candle {
  const o = prev.c;
  const drift = (rng() - 0.48) * t.vol;
  const c = Math.max(1, o + drift);
  const wick = (rng() * 0.6 + 0.2) * t.vol;
  const h = Math.max(o, c) + wick * rng();
  const l = Math.min(o, c) - wick * rng();
  return { o, h, l, c };
}

function sma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

function ema(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < vals.length; i++) {
    if (prev === null) {
      prev = vals[i];
    } else {
      prev = vals[i] * k + prev * (1 - k);
    }
    out.push(i >= period - 1 ? prev : null);
  }
  return out;
}

function bollinger(vals: number[], period: number, mult: number) {
  const mid = sma(vals, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < vals.length; i++) {
    const m = mid[i];
    if (m === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (vals[j] - m) ** 2;
    const sd = Math.sqrt(acc / period);
    upper.push(m + sd * mult);
    lower.push(m - sd * mult);
  }
  return { mid, upper, lower };
}

type Overlay = 'sma' | 'ema' | 'boll';

export default function SigmaTerminalDemo() {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rngRef = useRef<() => number>(() => 0.5);
  const timerRef = useRef<number | null>(null);

  const [active, setActive] = useState(0);
  const [series, setSeries] = useState<Candle[]>(() =>
    buildSeries(TICKERS[0], CANDLE_COUNT),
  );
  const [streaming, setStreaming] = useState(false);
  const [overlays, setOverlays] = useState<Record<Overlay, boolean>>({
    sma: true,
    ema: false,
    boll: false,
  });

  const ticker = TICKERS[active];
  const last = series[series.length - 1];
  const first = series[0];
  const change = last.c - first.o;
  const changePct = (change / first.o) * 100;
  const up = change >= 0;

  // Switch ticker: rebuild the deterministic series and reseed the live walk.
  function selectTicker(idx: number) {
    setActive(idx);
    const next = buildSeries(TICKERS[idx], CANDLE_COUNT);
    setSeries(next);
    rngRef.current = makeRng(TICKERS[idx].seed * 40503 + 99);
  }

  function toggleOverlay(key: Overlay) {
    setOverlays((o) => ({ ...o, [key]: !o[key] }));
  }

  // Live stream: push a new candle on an interval and drop the oldest.
  useEffect(() => {
    if (!streaming || reduce) return;
    rngRef.current = makeRng(ticker.seed * 40503 + series.length);
    timerRef.current = window.setInterval(() => {
      setSeries((s) => {
        const c = nextCandle(s[s.length - 1], ticker, rngRef.current);
        return [...s.slice(1), c];
      });
    }, 700);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [streaming, active, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const closes = useMemo(() => series.map((c) => c.c), [series]);
  const smaLine = useMemo(() => sma(closes, 7), [closes]);
  const emaLine = useMemo(() => ema(closes, 12), [closes]);
  const boll = useMemo(() => bollinger(closes, 14, 2), [closes]);

  // Hand-rolled canvas render, redrawn whenever the series or overlays change.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const dpr =
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    cv.width = VIEW_W * dpr;
    cv.height = VIEW_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    let hi = -Infinity;
    let lo = Infinity;
    for (const c of series) {
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
    }
    if (overlays.boll) {
      for (let i = 0; i < boll.upper.length; i++) {
        const u = boll.upper[i];
        const l = boll.lower[i];
        if (u !== null && u > hi) hi = u;
        if (l !== null && l < lo) lo = l;
      }
    }
    const range = hi - lo || 1;
    const yOf = (v: number) =>
      PAD + (1 - (v - lo) / range) * (VIEW_H - PAD * 2);
    const plotW = VIEW_W - PAD * 2;
    const step = plotW / series.length;
    const xOf = (i: number) => PAD + i * step + step / 2;

    // gridlines
    ctx.strokeStyle = 'rgba(38, 38, 47, 0.7)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = PAD + (g / 4) * (VIEW_H - PAD * 2);
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(VIEW_W - PAD, y);
      ctx.stroke();
    }

    // Bollinger band fill + edges
    if (overlays.boll) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < boll.upper.length; i++) {
        const u = boll.upper[i];
        if (u === null) continue;
        const x = xOf(i);
        const y = yOf(u);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      for (let i = boll.lower.length - 1; i >= 0; i--) {
        const l = boll.lower[i];
        if (l === null) continue;
        ctx.lineTo(xOf(i), yOf(l));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(90, 169, 255, 0.10)';
      ctx.fill();
    }

    // candles
    const candleW = Math.max(2, step * 0.62);
    for (let i = 0; i < series.length; i++) {
      const c = series[i];
      const x = xOf(i);
      const bull = c.c >= c.o;
      const col = bull ? '#4fd08a' : '#ff5b29';
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();
      const yo = yOf(c.o);
      const yc = yOf(c.c);
      const top = Math.min(yo, yc);
      const h = Math.max(1.5, Math.abs(yc - yo));
      ctx.fillRect(x - candleW / 2, top, candleW, h);
    }

    const drawLine = (line: (number | null)[], color: string, w: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < line.length; i++) {
        const v = line[i];
        if (v === null) continue;
        const x = xOf(i);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    if (overlays.sma) drawLine(smaLine, '#ff7d52', 1.6);
    if (overlays.ema) drawLine(emaLine, '#f4f2ec', 1.4);
    if (overlays.boll) {
      drawLine(boll.upper, 'rgba(90, 169, 255, 0.85)', 1.2);
      drawLine(boll.lower, 'rgba(90, 169, 255, 0.85)', 1.2);
    }
  }, [series, overlays, smaLine, emaLine, boll]);

  return (
    <div className="demo" aria-label="Sigma Terminal live chart demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Streaming candles, drawn by hand</h3>
      <p className="demo__lede">
        Press play to stream quotes tick by tick. Candlesticks are painted
        straight to a canvas with no chart library, exactly like the terminal.
        Toggle indicator overlays and jump between tickers from the palette.
      </p>

      <div className="sg__stage">
        <div className="sg__bar">
          <span className="sg__ticker">{ticker.sym}</span>
          <span className="sg__price">{last.c.toFixed(2)}</span>
          <span className={`sg__chg sg__chg--${up ? 'up' : 'down'}`}>
            {up ? '+' : ''}
            {change.toFixed(2)} ({up ? '+' : ''}
            {changePct.toFixed(2)}%)
          </span>
          <span className="sg__live" data-on={streaming ? 'true' : 'false'}>
            <span className="sg__live-dot" />
            {streaming ? 'streaming' : 'paused'}
          </span>
        </div>

        <div className="sg__chartwrap">
          <div className="sg__legend" aria-hidden="true">
            {overlays.sma && (
              <span className="sg__legend-row">
                <span
                  className="sg__legend-swatch"
                  style={{ background: '#ff7d52' }}
                />
                SMA 7
              </span>
            )}
            {overlays.ema && (
              <span className="sg__legend-row">
                <span
                  className="sg__legend-swatch"
                  style={{ background: '#f4f2ec' }}
                />
                EMA 12
              </span>
            )}
            {overlays.boll && (
              <span className="sg__legend-row">
                <span
                  className="sg__legend-swatch"
                  style={{ background: '#5aa9ff' }}
                />
                Bollinger 14, 2
              </span>
            )}
          </div>
          <canvas
            ref={canvasRef}
            className="sg__canvas"
            style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
            role="img"
            aria-label={`${ticker.sym} candlestick chart, last close ${last.c.toFixed(
              2,
            )}`}
          />
        </div>

        <div
          className="sg__indicators"
          role="group"
          aria-label="Technical indicator overlays"
        >
          <button
            className="sg__ind"
            aria-pressed={overlays.sma}
            onClick={() => toggleOverlay('sma')}
          >
            SMA 7
          </button>
          <button
            className="sg__ind sg__ind--green"
            aria-pressed={overlays.ema}
            onClick={() => toggleOverlay('ema')}
          >
            EMA 12
          </button>
          <button
            className="sg__ind sg__ind--blue"
            aria-pressed={overlays.boll}
            onClick={() => toggleOverlay('boll')}
          >
            Bollinger
          </button>
        </div>

        <div className="sg__palette">
          <div className="sg__palette-head">
            <span className="sg__palette-key">Cmd K</span>
            <span className="sg__palette-label">jump to ticker</span>
          </div>
          <div className="sg__palette-list">
            {TICKERS.map((t, i) => (
              <button
                key={t.sym}
                className="sg__palette-item"
                aria-current={i === active}
                onClick={() => selectTicker(i)}
              >
                <span className="sg__palette-sym">{t.sym}</span>
                <span className="sg__palette-co">{t.co}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sg__readout">
          <div className="sg__stat">
            <div className="sg__stat-name">High</div>
            <div className="sg__stat-val">
              {Math.max(...series.map((c) => c.h)).toFixed(2)}
            </div>
          </div>
          <div className="sg__stat">
            <div className="sg__stat-name">Low</div>
            <div className="sg__stat-val">
              {Math.min(...series.map((c) => c.l)).toFixed(2)}
            </div>
          </div>
          <div className="sg__stat">
            <div className="sg__stat-name">Candles</div>
            <div className="sg__stat-val">{series.length}</div>
          </div>
          <div className="sg__stat">
            <div className="sg__stat-name">Indicators</div>
            <div className="sg__stat-val">{INDICATOR_COUNT}+</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setStreaming((s) => !s)}
          disabled={!!reduce}
        >
          {streaming ? 'Pause stream' : 'Play stream'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => selectTicker(active)}
        >
          Reset series
        </button>
        <span className="demo__hint">
          {reduce
            ? 'Static frame; reduced motion is on'
            : '15+ indicators, canvas candles, no chart library'}
        </span>
      </div>
    </div>
  );
}
