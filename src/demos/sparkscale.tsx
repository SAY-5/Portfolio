import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './sparkscale.css';

// Real numbers from the project: 65% total runtime cut on a 500 GB/day
// clickstream batch, 26m40s down to 10m37s on 12 m5.4xlarge nodes. Per-stage
// gains: read -56% (partition pruning), sessionize/aggregate -57% to -65%
// (custom partitioner), write -62% (column ordering).
const BASELINE_SEC = 26 * 60 + 40; // 1600s
const TUNED_SEC = 10 * 60 + 37; // 637s
const ease = [0.22, 1, 0.36, 1] as const;

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

// Each optimization is a toggle. Each carries the per-stage figure it earns and
// the fraction of the total cut it accounts for, so the runtime bar collapses
// toward the measured 10m37s as toggles turn on.
type Opt = {
  id: string;
  name: string;
  stage: string;
  detail: string;
  share: number; // fraction of total saved seconds this opt contributes
};

const SAVED = BASELINE_SEC - TUNED_SEC; // 963s

const opts: Opt[] = [
  {
    id: 'prune',
    name: 'Date partition pruning',
    stage: 'read',
    detail: 'read -56%',
    share: 0.3,
  },
  {
    id: 'partitioner',
    name: 'User-day partitioner',
    stage: 'sessionize + aggregate',
    detail: 'sessionize/aggregate -57% to -65%',
    share: 0.45,
  },
  {
    id: 'columns',
    name: 'Cardinality-aware column ordering',
    stage: 'write',
    detail: 'write -62%',
    share: 0.25,
  },
];

// Eight events, each tagged with a user and day. Under the hash partitioner
// they scatter across 4 partitions by a hash of the full key; under the custom
// partitioner they co-locate by user-day so a session never crosses a shuffle
// boundary.
type Ev = { id: number; user: string; day: string; color: string };
const palette = ['#ff5b29', '#4fd08a', '#5b9bff', '#e8c34a'];
const users = ['u1', 'u2', 'u3', 'u4'];
const events: Ev[] = Array.from({ length: 16 }, (_, i) => {
  const u = i % 4;
  return {
    id: i,
    user: users[u],
    day: i < 8 ? 'd1' : 'd2',
    color: palette[u],
  };
});

const PARTITIONS = 4;

function hashPart(ev: Ev) {
  // Scatter: a cheap hash over the whole record id spreads sessions everywhere.
  let h = 0;
  const s = `${ev.user}-${ev.day}-${ev.id}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % PARTITIONS;
}

function customPart(ev: Ev) {
  // Co-locate by user-day so each session lands in one partition.
  let h = 0;
  const s = `${ev.user}-${ev.day}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % PARTITIONS;
}

export default function SparkScaleDemo() {
  const reduce = useReducedMotion();
  const [custom, setCustom] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>({
    prune: false,
    partitioner: false,
    columns: false,
  });

  // The partitioner toggle in the optimization list mirrors the layout toggle
  // so the two views stay consistent.
  function toggleOpt(id: string) {
    setOn((p) => {
      const next = { ...p, [id]: !p[id] };
      if (id === 'partitioner') setCustom(next.partitioner);
      return next;
    });
  }

  const layout = useMemo(() => {
    const buckets: Ev[][] = Array.from({ length: PARTITIONS }, () => []);
    events.forEach((ev) => {
      const p = custom ? customPart(ev) : hashPart(ev);
      buckets[p].push(ev);
    });
    return buckets;
  }, [custom]);

  // Shuffle bytes: how many events cross a partition boundary relative to their
  // session home. With the custom partitioner, sessions stay put so shuffle
  // drops sharply. Expressed as a share of a fixed baseline for the bar.
  const crossings = useMemo(() => {
    if (custom) return 0;
    // Count events whose session is split across more than one partition.
    const homes: Record<string, Set<number>> = {};
    events.forEach((ev) => {
      const key = `${ev.user}-${ev.day}`;
      (homes[key] ||= new Set()).add(hashPart(ev));
    });
    return Object.values(homes).reduce(
      (acc, set) => acc + (set.size > 1 ? set.size : 0),
      0,
    );
  }, [custom]);
  const maxCrossings = 18; // rough baseline scatter for the bar scale
  const shufflePct = Math.round((crossings / maxCrossings) * 100);

  const savedSec = opts.reduce(
    (acc, o) => acc + (on[o.id] ? o.share * SAVED : 0),
    0,
  );
  const runtime = Math.round(BASELINE_SEC - savedSec);
  const cutPct = Math.round(((BASELINE_SEC - runtime) / BASELINE_SEC) * 100);
  const allOn = opts.every((o) => on[o.id]);

  return (
    <div className="demo" aria-label="sparkscale partitioner demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Where the shuffle goes</h3>
      <p className="demo__lede">
        The same clickstream events under the default hash partitioner versus
        the user-day partitioner. Co-locating each session in one partition
        drops the shuffle. Turn on the three workload-shape wins to collapse the
        runtime toward the measured 10m37s.
      </p>

      <div className="ss__toggle" role="group" aria-label="partitioner choice">
        <button
          className={`ss__seg${!custom ? ' ss__seg--on' : ''}`}
          aria-pressed={!custom}
          onClick={() => {
            setCustom(false);
            setOn((p) => ({ ...p, partitioner: false }));
          }}
        >
          HashPartitioner
        </button>
        <button
          className={`ss__seg${custom ? ' ss__seg--on' : ''}`}
          aria-pressed={custom}
          onClick={() => {
            setCustom(true);
            setOn((p) => ({ ...p, partitioner: true }));
          }}
        >
          User-day partitioner
        </button>
      </div>

      <div className="ss__grid" aria-label="partition layout">
        {layout.map((bucket, pi) => (
          <div className="ss__part" key={pi}>
            <div className="ss__part-head">partition {pi}</div>
            <div className="ss__part-body">
              <AnimatePresence initial={false}>
                {bucket.map((ev) => (
                  <motion.span
                    key={ev.id}
                    layout={!reduce}
                    className="ss__ev"
                    style={{ background: ev.color }}
                    title={`${ev.user} ${ev.day}`}
                    initial={{ opacity: 0, scale: reduce ? 1 : 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease }}
                  >
                    {ev.user}
                    <small>{ev.day}</small>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>

      <div className="ss__shuffle">
        <div className="ss__shuffle-label">
          <span>Shuffle volume</span>
          <b>{custom ? 'sessions co-located' : `${shufflePct}% scatter`}</b>
        </div>
        <div className="ss__bar">
          <motion.div
            className="ss__bar-fill ss__bar-fill--shuffle"
            initial={false}
            animate={{ width: `${custom ? 6 : shufflePct}%` }}
            transition={{ duration: reduce ? 0 : 0.6, ease }}
          />
        </div>
      </div>

      <div className="ss__opts" role="group" aria-label="optimizations">
        {opts.map((o) => (
          <button
            key={o.id}
            className={`ss__opt${on[o.id] ? ' ss__opt--on' : ''}`}
            aria-pressed={!!on[o.id]}
            onClick={() => toggleOpt(o.id)}
          >
            <span className="ss__opt-check" aria-hidden="true">
              {on[o.id] ? '✓' : ''}
            </span>
            <span className="ss__opt-body">
              <span className="ss__opt-name">{o.name}</span>
              <span className="ss__opt-detail">
                {o.stage} &middot; {o.detail}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="ss__runtime">
        <div className="ss__rt-row">
          <span className="ss__rt-name">Baseline</span>
          <div className="ss__bar">
            <div className="ss__bar-fill ss__bar-fill--base" style={{ width: '100%' }} />
          </div>
          <span className="ss__rt-val">{fmt(BASELINE_SEC)}</span>
        </div>
        <div className="ss__rt-row">
          <span className="ss__rt-name">Tuned</span>
          <div className="ss__bar">
            <motion.div
              className="ss__bar-fill ss__bar-fill--tuned"
              initial={false}
              animate={{ width: `${(runtime / BASELINE_SEC) * 100}%` }}
              transition={{ duration: reduce ? 0 : 0.7, ease }}
            />
          </div>
          <span className="ss__rt-val ss__rt-val--accent">{fmt(runtime)}</span>
        </div>
      </div>

      <AnimatePresence>
        {allOn && (
          <motion.div
            className="ss__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="ss__verdict-x">{cutPct}% cut</span>
            <span className="ss__verdict-text">
              {fmt(BASELINE_SEC)} down to {fmt(TUNED_SEC)} on a 500 GB/day batch,
              measured on 12 m5.4xlarge nodes. These are workload-shape wins, so
              the cut holds at 6 and 24 nodes too.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => {
            setCustom(true);
            setOn({ prune: true, partitioner: true, columns: true });
          }}
        >
          Turn on all three
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            setCustom(false);
            setOn({ prune: false, partitioner: false, columns: false });
          }}
        >
          Reset
        </button>
        <span className="demo__hint">
          runtime {fmt(runtime)} &middot; {cutPct}% cut
        </span>
      </div>
    </div>
  );
}
