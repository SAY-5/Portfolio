import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './equipfleet.css';

// equipfleet records equipment status changes as a step function over a day and
// rolls them up into utilization and uptime. Utilization is the fraction of the
// window an asset is IN_USE; uptime is the fraction it is not DOWN. Both stay in
// [0, 1]. The metric math is a pure interval calculator over status segments and
// a day window, so a status spanning midnight or out-of-order events stay
// testable in isolation. Here a scrubbable window recomputes both fractions live.

type Status = 'IN_USE' | 'IDLE' | 'DOWN';

type Segment = { status: Status; start: number; end: number }; // minutes [0, 1440)

const DAY = 1440; // minutes in a day

type Asset = {
  id: string;
  label: string;
  kind: string;
  // Events as raw (deliberately out of order) status changes; the calculator
  // sorts them into a clean timeline. The first segment carries over from the
  // prior day (a status spanning midnight).
  events: { at: number; status: Status }[];
  carryIn: Status; // status in effect at minute 0 (spanned midnight)
};

const assets: Asset[] = [
  {
    id: 'exc-01',
    label: 'Excavator 01',
    kind: 'earthmover',
    carryIn: 'IN_USE',
    events: [
      { at: 600, status: 'IDLE' },
      { at: 420, status: 'IN_USE' }, // out of order on purpose
      { at: 1080, status: 'IN_USE' },
      { at: 780, status: 'IN_USE' },
      { at: 1320, status: 'IDLE' },
    ],
  },
  {
    id: 'crn-02',
    label: 'Crane 02',
    kind: 'lifting',
    carryIn: 'DOWN',
    events: [
      { at: 300, status: 'IDLE' },
      { at: 540, status: 'IN_USE' },
      { at: 960, status: 'DOWN' },
      { at: 1140, status: 'IN_USE' },
    ],
  },
  {
    id: 'ldr-03',
    label: 'Loader 03',
    kind: 'earthmover',
    carryIn: 'IDLE',
    events: [
      { at: 480, status: 'IN_USE' },
      { at: 720, status: 'IN_USE' },
      { at: 900, status: 'IDLE' },
      { at: 1200, status: 'IN_USE' },
    ],
  },
];

const statusColor: Record<Status, string> = {
  IN_USE: '#4fd08a',
  IDLE: 'var(--paper-faint)',
  DOWN: 'var(--accent)',
};

// Pure interval calculator: build a clean status timeline from carry-in plus
// out-of-order events, then clip to the [winStart, winEnd] window.
function buildTimeline(asset: Asset): Segment[] {
  const sorted = [...asset.events].sort((a, b) => a.at - b.at);
  const points = [{ at: 0, status: asset.carryIn }, ...sorted];
  const segs: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i].at;
    const end = i + 1 < points.length ? points[i + 1].at : DAY;
    if (end <= start) continue; // skip degenerate or duplicate-time events
    // Merge with the previous segment if the status is unchanged.
    const last = segs[segs.length - 1];
    if (last && last.status === points[i].status && last.end === start) {
      last.end = end;
    } else {
      segs.push({ status: points[i].status, start, end });
    }
  }
  return segs;
}

function overlap(seg: Segment, a: number, b: number): number {
  return Math.max(0, Math.min(seg.end, b) - Math.max(seg.start, a));
}

function metrics(timeline: Segment[], a: number, b: number) {
  const span = Math.max(1, b - a);
  let inUse = 0;
  let down = 0;
  for (const seg of timeline) {
    const o = overlap(seg, a, b);
    if (seg.status === 'IN_USE') inUse += o;
    if (seg.status === 'DOWN') down += o;
  }
  const utilization = inUse / span;
  const uptime = (span - down) / span;
  // Both clamp to [0, 1] by construction.
  return { utilization, uptime };
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function EquipfleetDemo() {
  const reduce = useReducedMotion();
  const [winStart, setWinStart] = useState(0);
  const [winEnd, setWinEnd] = useState(DAY);

  const timelines = useMemo(() => assets.map((a) => ({ asset: a, timeline: buildTimeline(a) })), []);

  const rows = useMemo(
    () => timelines.map(({ asset, timeline }) => ({ asset, timeline, ...metrics(timeline, winStart, winEnd) })),
    [timelines, winStart, winEnd],
  );

  const fleet = useMemo(() => {
    const u = rows.reduce((s, r) => s + r.utilization, 0) / rows.length;
    const up = rows.reduce((s, r) => s + r.uptime, 0) / rows.length;
    return { utilization: u, uptime: up };
  }, [rows]);

  function onStart(v: number) {
    setWinStart(Math.min(v, winEnd - 30));
  }
  function onEnd(v: number) {
    setWinEnd(Math.max(v, winStart + 30));
  }
  function resetWindow() {
    setWinStart(0);
    setWinEnd(DAY);
  }

  const leftPct = (winStart / DAY) * 100;
  const widthPct = ((winEnd - winStart) / DAY) * 100;

  return (
    <div className="demo" aria-label="equipfleet utilization demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Scrub the day, read the metrics</h3>
      <p className="demo__lede">
        Each asset's status renders as a step function across the day. Slide the
        window edges and the pure interval calculator recomputes utilization (the
        fraction IN_USE) and uptime (the fraction not DOWN) live, clipping cleanly
        through statuses that span midnight and events that arrive out of order.
      </p>

      <div className="ef__stage">
        <div className="ef__timeline-head">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>

        <div className="ef__rows">
          {rows.map((r) => (
            <div key={r.asset.id} className="ef__row">
              <div className="ef__row-label">
                <span className="ef__row-name">{r.asset.label}</span>
                <span className="ef__row-kind">{r.asset.kind}</span>
              </div>
              <div className="ef__track" role="img" aria-label={`${r.asset.label} status timeline`}>
                {r.timeline.map((seg, i) => (
                  <span
                    key={i}
                    className="ef__seg"
                    style={{
                      left: `${(seg.start / DAY) * 100}%`,
                      width: `${((seg.end - seg.start) / DAY) * 100}%`,
                      background: statusColor[seg.status],
                    }}
                    title={`${seg.status} ${fmtTime(seg.start)} to ${fmtTime(seg.end)}`}
                  />
                ))}
                {/* dim mask outside the active window */}
                <span className="ef__mask" style={{ left: 0, width: `${leftPct}%` }} aria-hidden />
                <span className="ef__mask" style={{ left: `${leftPct + widthPct}%`, right: 0 }} aria-hidden />
                <span
                  className="ef__window"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  aria-hidden
                />
              </div>
              <div className="ef__row-metrics">
                <span className="ef__chip ef__chip--util">{(r.utilization * 100).toFixed(0)}%</span>
                <span className="ef__chip ef__chip--up">{(r.uptime * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="ef__scrubber">
          <div className="ef__scrub-row">
            <label className="ef__scrub-label" htmlFor="ef-start">
              window start
            </label>
            <input
              id="ef-start"
              className="ef__range"
              type="range"
              min={0}
              max={DAY}
              step={15}
              value={winStart}
              onChange={(e) => onStart(Number(e.target.value))}
            />
            <span className="ef__scrub-val">{fmtTime(winStart)}</span>
          </div>
          <div className="ef__scrub-row">
            <label className="ef__scrub-label" htmlFor="ef-end">
              window end
            </label>
            <input
              id="ef-end"
              className="ef__range"
              type="range"
              min={0}
              max={DAY}
              step={15}
              value={winEnd}
              onChange={(e) => onEnd(Number(e.target.value))}
            />
            <span className="ef__scrub-val">{fmtTime(winEnd)}</span>
          </div>
        </div>

        <div className="ef__fleet">
          <div className="ef__fleet-card ef__fleet-card--util">
            <span className="ef__fleet-name">fleet utilization</span>
            <span className="ef__fleet-val">{(fleet.utilization * 100).toFixed(1)}%</span>
            <span className="ef__fleet-sub">mean fraction IN_USE over the window</span>
          </div>
          <div className="ef__fleet-card ef__fleet-card--up">
            <span className="ef__fleet-name">fleet uptime</span>
            <span className="ef__fleet-val">{(fleet.uptime * 100).toFixed(1)}%</span>
            <span className="ef__fleet-sub">mean fraction not DOWN over the window</span>
          </div>
        </div>

        <div className="ef__legend">
          <span className="ef__legend-item">
            <span className="ef__legend-dot" style={{ background: statusColor.IN_USE }} /> IN_USE
          </span>
          <span className="ef__legend-item">
            <span className="ef__legend-dot" style={{ background: statusColor.IDLE }} /> IDLE
          </span>
          <span className="ef__legend-item">
            <span className="ef__legend-dot" style={{ background: statusColor.DOWN }} /> DOWN
          </span>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={resetWindow}>
          Full day
        </button>
        <span className="demo__hint">
          {reduce ? 'reduced motion' : 'drag a window edge'} · utilization and uptime always in [0, 1]
        </span>
      </div>
    </div>
  );
}
