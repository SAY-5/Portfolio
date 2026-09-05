import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './modelgate.css';
import { Engine, DURATION_MS, RPS, type Response, type Snapshot } from './modelgate/loadgen';
import { VERSIONS } from './modelgate/model';
import { REASONS } from './modelgate/validate';

// Real mechanism from modelgate: every /predict body is validated before a
// tensor is built and rejected with a per-field reason, the shadow version
// runs on every accepted request while the client gets the primary answer,
// and promotion loads and warms the candidate off the request path before
// swapping the primary reference in one step. The load generator here is
// open-loop at 200 rps in simulated time from a seeded PRNG, so the request
// stream, the shadow report, and the per-second version split are identical
// on every run.
const ease = [0.22, 1, 0.36, 1] as const;
const TICK_MS = 50;

type Builder = {
  distance_km: string;
  hour_of_day: string;
  day_of_week: string;
  pickup_zone_id: string;
  traffic_index: string;
  is_raining: string;
  unknownField: boolean;
  omitTraffic: boolean;
};

const DEFAULT_BUILDER: Builder = {
  distance_km: '6.4',
  hour_of_day: '8',
  day_of_week: '2',
  pickup_zone_id: '4',
  traffic_index: '0.62',
  is_raining: 'false',
  unknownField: false,
  omitTraffic: false,
};

function parseNumber(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return '';
  if (s === 'nan') return NaN;
  if (s === 'inf' || s === 'infinity') return Infinity;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseBool(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '1') return 1;
  return raw;
}

function buildPayload(b: Builder): Record<string, unknown> {
  const p: Record<string, unknown> = {
    distance_km: parseNumber(b.distance_km),
    hour_of_day: parseNumber(b.hour_of_day),
    day_of_week: parseNumber(b.day_of_week),
    pickup_zone_id: parseNumber(b.pickup_zone_id),
    traffic_index: parseNumber(b.traffic_index),
    is_raining: parseBool(b.is_raining),
  };
  if (b.omitTraffic) delete p.traffic_index;
  if (b.unknownField) p.surge_multiplier = 1.4;
  return p;
}

export default function ModelgateDemo() {
  const reduce = useReducedMotion();
  const [engine, setEngine] = useState(() => new Engine());
  const [snap, setSnap] = useState<Snapshot>(() => engine.snapshot());
  const [builder, setBuilder] = useState<Builder>(DEFAULT_BUILDER);
  const [response, setResponse] = useState<Response | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const engineRef = useRef(engine);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  function stopTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  useEffect(() => stopTimer, []);

  function step() {
    const e = engineRef.current;
    e.tick(TICK_MS);
    setSnap(e.snapshot());
    if (!e.snapshot().running) stopTimer();
  }

  function start() {
    if (snap.finished) return;
    engine.start();
    if (reduce) {
      engine.tick(DURATION_MS);
      setSnap(engine.snapshot());
      return;
    }
    if (timerRef.current === null) timerRef.current = setInterval(step, TICK_MS);
    setSnap(engine.snapshot());
  }

  function pause() {
    engine.pause();
    stopTimer();
    setSnap(engine.snapshot());
  }

  function promote() {
    engine.promote();
    setSnap(engine.snapshot());
  }

  function rollback() {
    engine.rollback();
    setSnap(engine.snapshot());
  }

  function reset() {
    stopTimer();
    const next = new Engine();
    setEngine(next);
    setSnap(next.snapshot());
    setResponse(null);
    setBuilder(DEFAULT_BUILDER);
  }

  function send() {
    const res = engine.handle(buildPayload(builder));
    setResponse(res);
    setSnap(engine.snapshot());
  }

  const report = engine.shadow.report();
  const reg = engine.registry;
  const buckets = snap.buckets.slice(-20);
  const swapPending = reg.loadState === 'loading';
  const secs = (snap.now / 1000).toFixed(2);
  const field = (k: keyof Builder, v: string | boolean) => setBuilder((b) => ({ ...b, [k]: v }));

  return (
    <div className="demo" aria-label="modelgate model serving demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Validate, shadow, swap with zero drops</h3>
      <p className="demo__lede">
        Build a request and watch the strict schema reject it field by field,
        read the shadow divergence of v2 against the serving v1, then drive
        {' '}{RPS} rps and promote v2 mid-run: the primary flips inside one
        second bucket and the dropped counter never leaves 0.
      </p>

      <div className="mg__roles mono" aria-live="polite">
        {reg.roles().map((r) => (
          <span key={r.role} className={'mg__role mg__role--' + r.role}>
            <b>{r.role}</b> {r.version} <i>{VERSIONS[r.version].arch}</i>
          </span>
        ))}
        {reg.candidate && (
          <span className="mg__role mg__role--loading">
            <b>{reg.loadState}</b> {reg.candidate} off the request path
          </span>
        )}
      </div>

      <div className="mg__stage">
        <div className="mg__panel">
          <div className="mg__panel-head">
            <span className="mg__panel-title">POST /predict</span>
            <span className="mg__panel-meta">strict schema, 422 with reasons</span>
          </div>
          <div className="mg__form">
            <label>distance_km<input value={builder.distance_km} onChange={(e) => field('distance_km', e.target.value)} /></label>
            <label>hour_of_day<input value={builder.hour_of_day} onChange={(e) => field('hour_of_day', e.target.value)} /></label>
            <label>day_of_week<input value={builder.day_of_week} onChange={(e) => field('day_of_week', e.target.value)} /></label>
            <label>pickup_zone_id
              <select value={builder.pickup_zone_id} onChange={(e) => field('pickup_zone_id', e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 27].map((z) => (
                  <option key={z} value={String(z)}>{z}{z > 12 ? ' (not in manifest)' : ''}</option>
                ))}
              </select>
            </label>
            <label>traffic_index<input value={builder.traffic_index} onChange={(e) => field('traffic_index', e.target.value)} disabled={builder.omitTraffic} /></label>
            <label>is_raining
              <select value={builder.is_raining} onChange={(e) => field('is_raining', e.target.value)}>
                <option value="true">true</option>
                <option value="false">false</option>
                <option value="1">1 (int)</option>
                <option value="yes">"yes"</option>
              </select>
            </label>
          </div>
          <div className="mg__toggles mono">
            <label><input type="checkbox" checked={builder.unknownField} onChange={(e) => field('unknownField', e.target.checked)} /> add surge_multiplier</label>
            <label><input type="checkbox" checked={builder.omitTraffic} onChange={(e) => field('omitTraffic', e.target.checked)} /> omit traffic_index</label>
            <span className="mg__hint">try 600, nan, inf, or abc</span>
          </div>
          <div className="mg__send">
            <button className="demo__btn" onClick={send}>Send request</button>
          </div>
          <pre className={'mg__body mono' + (response?.status === 422 ? ' mg__body--rej' : '')}>
            {response === null
              ? 'no request sent yet'
              : response.status === 200
                ? `200 OK\n{ "eta_minutes": ${response.body.eta_minutes.toFixed(2)},\n  "model_version": "${response.body.model_version}",\n  "request_id": "${response.body.request_id}" }` +
                  (response.shadowEta !== null ? `\nshadow ${reg.shadow ?? ''}: ${response.shadowEta.toFixed(2)} min (d = ${(response.shadowEta - response.body.eta_minutes).toFixed(2)})` : '')
                : `422 Unprocessable Entity\n{ "error": "invalid input", "rejections": [\n` +
                  response.body.rejections.map((r) => `  { "field": "${r.field}", "reason": "${r.reason}",\n    "message": "${r.message}" }`).join(',\n') +
                  '\n] }'}
          </pre>
          <ul className="mg__reasons mono">
            {REASONS.map((r) => (
              <li key={r} className={snap.rejections[r] > 0 ? 'mg__reason--hit' : ''}>
                <span>{r}</span>
                <b>{snap.rejections[r]}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="mg__panel">
          <div className="mg__panel-head">
            <span className="mg__panel-title">shadow report</span>
            <span className="mg__panel-meta">
              {reg.shadow ? `${reg.shadow} shadowing ${reg.primary}, window ${report.n}` : 'no shadow version'}
            </span>
          </div>
          <div className="mg__stats">
            <div className="mg__stat"><span>mean |d|</span><b>{report.meanAbs.toFixed(2)}</b><i>min</i></div>
            <div className="mg__stat"><span>p95 |d|</span><b>{report.p95Abs.toFixed(2)}</b><i>min</i></div>
            <div className="mg__stat"><span>beyond 2.0</span><b>{(report.beyond * 100).toFixed(1)}</b><i>%</i></div>
            <div className="mg__stat"><span>bias</span><b>{report.bias >= 0 ? '+' : ''}{report.bias.toFixed(2)}</b><i>min</i></div>
          </div>
          <div className="mg__bar">
            <motion.span
              className="mg__bar-fill"
              initial={false}
              animate={{ width: `${Math.min(100, report.beyond * 100)}%` }}
              transition={{ duration: reduce ? 0 : 0.3, ease }}
            />
            <span className="mg__bar-mark" />
          </div>
          <p className="mg__note mono">
            the client always receives the primary answer; the shadow only
            fills modelgate_shadow_divergence_minutes. measured run: n=1000
            mean 2.29, p95 6.35, beyond 40.1%.
          </p>
          <p className="mg__note mono">
            v1 {VERSIONS.v1.arch}, {VERSIONS.v1.epochs} epochs, held-out MAE {VERSIONS.v1.mae} min.
            v2 {VERSIONS.v2.arch}, {VERSIONS.v2.epochs} epochs, MAE {VERSIONS.v2.mae} min.
          </p>
        </div>

        <div className="mg__panel mg__panel--wide">
          <div className="mg__panel-head">
            <span className="mg__panel-title">version swap under load</span>
            <span className="mg__panel-meta">{RPS} rps open-loop, t+{secs}s of {DURATION_MS / 1000}s</span>
          </div>
          <div className="mg__stats mg__stats--row">
            <div className="mg__stat"><span>total</span><b>{snap.total}</b></div>
            <div className="mg__stat"><span>2xx</span><b>{snap.ok}</b></div>
            <div className="mg__stat"><span>422</span><b>{snap.rejected}</b></div>
            <div className="mg__stat mg__stat--pinned"><span>dropped</span><b>{snap.dropped}</b></div>
            <div className="mg__stat"><span>v1</span><b>{snap.byVersion.v1}</b></div>
            <div className="mg__stat"><span>v2</span><b>{snap.byVersion.v2}</b></div>
          </div>
          <div className="mg__buckets">
            {buckets.length === 0 && <span className="mg__empty mono">press Start to open the stream</span>}
            {buckets.map((b) => {
              const n = Math.max(1, b.v1 + b.v2);
              return (
                <div key={b.second} className={'mg__bucket' + (b.second === snap.swapBucket ? ' mg__bucket--swap' : '')}>
                  <span className="mg__bucket-sec mono">{b.second}s</span>
                  <span className="mg__bucket-bar">
                    <i className="mg__bucket-v1" style={{ width: `${(b.v1 / n) * 100}%` }} />
                    <i className="mg__bucket-v2" style={{ width: `${(b.v2 / n) * 100}%` }} />
                  </span>
                  <span className="mg__bucket-split mono">
                    {b.v1 > 0 && `v1 ${b.v1}`}{b.v1 > 0 && b.v2 > 0 && ' '}{b.v2 > 0 && `v2 ${b.v2}`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mg__swap-row">
            <button className="demo__btn" onClick={snap.running ? pause : start} disabled={snap.finished}>
              {snap.running ? 'Pause' : snap.now > 0 ? 'Resume' : 'Start 200 rps'}
            </button>
            <button className="demo__btn demo__btn--ghost" onClick={promote} disabled={swapPending || reg.primary === 'v2'}>
              {swapPending ? 'loading v2…' : 'Promote v2'}
            </button>
            <button className="demo__btn demo__btn--ghost" onClick={rollback} disabled={reg.previous === null || swapPending}>
              Rollback
            </button>
            <span className="mg__swap-label mono">
              {snap.swapLabel ?? (swapPending ? 'candidate loading and warming, primary still serving' : 'no swap yet')}
            </span>
          </div>
        </div>

        <div className="mg__panel mg__panel--wide">
          <div className="mg__panel-head">
            <span className="mg__panel-title">GET /metrics</span>
            <span className="mg__panel-meta">Prometheus exposition</span>
          </div>
          <ul className="mg__metrics mono">
            <li><span>modelgate_requests_total{'{'}version="v1",outcome="ok"{'}'}</span><b>{snap.byVersion.v1}</b></li>
            <li><span>modelgate_requests_total{'{'}version="v2",outcome="ok"{'}'}</span><b>{snap.byVersion.v2}</b></li>
            <li><span>modelgate_requests_total{'{'}outcome="rejected"{'}'}</span><b>{snap.rejected}</b></li>
            {REASONS.filter((r) => snap.rejections[r] > 0).map((r) => (
              <li key={r}><span>modelgate_input_rejections_total{'{'}reason="{r}"{'}'}</span><b>{snap.rejections[r]}</b></li>
            ))}
            <li><span>modelgate_shadow_requests_total{'{'}outcome="ok"{'}'}</span><b>{snap.shadowRequests}</b></li>
            <li><span>modelgate_shadow_divergence_minutes_sum / _count</span><b>{(report.meanAbs * report.n).toFixed(1)} / {report.n}</b></li>
            <li><span>modelgate_version_swaps_total{'{'}kind="promote"{'}'}</span><b>{reg.swaps.filter((s) => s.kind === 'promote').length}</b></li>
            <li><span>modelgate_version_swaps_total{'{'}kind="rollback"{'}'}</span><b>{reg.swaps.filter((s) => s.kind === 'rollback').length}</b></li>
            {reg.roles().map((r) => (
              <li key={r.role}><span>modelgate_model_version_info{'{'}version="{r.version}",role="{r.role}"{'}'}</span><b>1</b></li>
            ))}
            <li className="mg__metric--pinned"><span>modelgate_dropped_requests_total</span><b>{snap.dropped}</b></li>
          </ul>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={snap.now === 0 && response === null}>
          Reset
        </button>
        <span className="demo__hint">
          {snap.finished
            ? `${snap.ok}/${snap.total} succeeded, ${snap.dropped} dropped across ${reg.swaps.length} swap${reg.swaps.length === 1 ? '' : 's'}`
            : 'seeded stream: same requests, same split, every run'}
        </span>
      </div>
    </div>
  );
}
