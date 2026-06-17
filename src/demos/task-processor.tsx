import './task-processor.css';
import {
  enqueue,
  LIMITS,
  reset,
  runTicks,
  selectMetrics,
  setConcurrency,
  setFailRate,
  setMaxRetries,
  step,
  useSim,
} from './task-processor/store';
import type {
  Job,
  JobStatus,
  Metrics,
  SimState,
  TrendPoint,
  Worker,
} from './task-processor/types';

// Columns the queue board renders, left to right along a job's lifecycle.
const COLUMNS: { status: JobStatus; label: string }[] = [
  { status: 'queued', label: 'Queued' },
  { status: 'running', label: 'Running' },
  { status: 'done', label: 'Done' },
  { status: 'dead', label: 'Dead letter' },
];

function jobsByStatus(jobs: Job[], status: JobStatus): Job[] {
  return jobs
    .filter((j) => j.status === status)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function WorkerCard({ worker }: { worker: Worker }) {
  return (
    <li className={`tp-worker ${worker.busy ? 'tp-worker--busy' : 'tp-worker--idle'}`}>
      <span className="tp-worker__id">worker {worker.id}</span>
      <span className="tp-worker__state">
        {worker.busy ? (
          <>
            <span className="tp-worker__dot" aria-hidden="true" />
            running {worker.currentJob}
          </>
        ) : (
          'idle'
        )}
      </span>
    </li>
  );
}

function Controls({ sim }: { sim: SimState }) {
  const { config } = sim;
  return (
    <div className="tp__controls glass" aria-label="simulation configuration">
      <label className="tp__field">
        <span className="tp__field-label">
          Concurrency <b>{config.concurrency}</b>
        </span>
        <input
          type="range"
          min={LIMITS.concurrency.min}
          max={LIMITS.concurrency.max}
          step={1}
          value={config.concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value))}
          aria-label="worker concurrency"
        />
      </label>
      <label className="tp__field">
        <span className="tp__field-label">
          Max retries <b>{config.maxRetries}</b>
        </span>
        <input
          type="range"
          min={LIMITS.maxRetries.min}
          max={LIMITS.maxRetries.max}
          step={1}
          value={config.maxRetries}
          onChange={(e) => setMaxRetries(Number(e.target.value))}
          aria-label="max retries before dead-letter"
        />
      </label>
      <label className="tp__field">
        <span className="tp__field-label">
          Fail rate <b>{Math.round(config.failRate * 100)}%</b>
        </span>
        <input
          type="range"
          min={LIMITS.failRate.min}
          max={LIMITS.failRate.max}
          step={0.05}
          value={config.failRate}
          onChange={(e) => setFailRate(Number(e.target.value))}
          aria-label="per-attempt failure rate"
        />
      </label>
    </div>
  );
}

const METRIC_TILES: { key: keyof Metrics; label: string; tone?: string }[] = [
  { key: 'queued', label: 'queued' },
  { key: 'inFlight', label: 'in flight', tone: 'accent' },
  { key: 'done', label: 'done', tone: 'ok' },
  { key: 'dead', label: 'dead-letter', tone: 'magenta' },
  { key: 'throughput', label: 'throughput / tick' },
];

function MetricTiles({ metrics }: { metrics: Metrics }) {
  return (
    <dl className="tp__metrics" aria-label="live metrics" aria-live="polite">
      {METRIC_TILES.map((tile) => (
        <div
          key={tile.key}
          className={`tp__metric ${tile.tone ? `tp__metric--${tile.tone}` : ''}`}
        >
          <dt className="tp__metric-name">{tile.label}</dt>
          <dd className="tp__metric-val">{metrics[tile.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

// Compact dual-series trend: queue depth and throughput across recent ticks.
function Trend({ trend }: { trend: TrendPoint[] }) {
  const points = trend.slice(-40);
  const maxDepth = Math.max(1, ...points.map((p) => p.queueDepth));
  const maxThru = Math.max(1, ...points.map((p) => p.throughput));
  const w = 100;
  const h = 36;
  const path = (key: 'queueDepth' | 'throughput', max: number): string => {
    if (points.length === 0) return '';
    return points
      .map((p, i) => {
        const x = points.length === 1 ? 0 : (i / (points.length - 1)) * w;
        const y = h - (p[key] / max) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  };
  return (
    <div className="tp__trend glass" aria-label="queue depth and throughput trend">
      <div className="tp__trend-head">
        <h4 className="tp__col-name">Trend over ticks</h4>
        <span className="tp__trend-legend">
          <span className="tp__trend-key tp__trend-key--depth">queue depth</span>
          <span className="tp__trend-key tp__trend-key--thru">throughput</span>
        </span>
      </div>
      <svg
        className="tp__trend-svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`queue depth peaks at ${maxDepth}, throughput peaks at ${maxThru}`}
      >
        <path className="tp__trend-line tp__trend-line--depth" d={path('queueDepth', maxDepth)} />
        <path className="tp__trend-line tp__trend-line--thru" d={path('throughput', maxThru)} />
      </svg>
    </div>
  );
}

function DeadLetter({ jobs }: { jobs: Job[] }) {
  const dead = jobs.filter((j) => j.status === 'dead');
  return (
    <div className="tp__dlq glass" aria-label="dead-letter queue">
      <div className="tp__workers-head">
        <h4 className="tp__col-name">Dead-letter queue</h4>
        <span className="tp__col-count">{dead.length}</span>
      </div>
      {dead.length === 0 ? (
        <p className="tp__dlq-empty">No jobs have exhausted their retries.</p>
      ) : (
        <ul className="tp__dlq-list">
          {dead.map((j) => (
            <li key={j.id} className="tp__dlq-item">
              <span className="tp-chip__id">{j.id}</span>
              <span className="tp-chip__meta">{j.attempts} attempts, exhausted</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunControls() {
  return (
    <div className="tp__run" role="group" aria-label="run controls">
      <button className="tp__btn tp__btn--primary" onClick={() => step()}>
        Tick
      </button>
      <button className="tp__btn" onClick={() => runTicks(5)}>
        Run 5
      </button>
      <button className="tp__btn" onClick={() => runTicks(20)}>
        Run 20
      </button>
      <button className="tp__btn" onClick={() => enqueue(4)}>
        Enqueue 4
      </button>
      <button className="tp__btn tp__btn--ghost" onClick={() => reset()}>
        Reset
      </button>
    </div>
  );
}

function JobChip({ job }: { job: Job }) {
  return (
    <li className={`tp-chip tp-chip--${job.status}`}>
      <span className="tp-chip__id">{job.id}</span>
      <span className="tp-chip__meta">
        {job.attempts > 0 ? `${job.attempts} att` : 'new'}
        {job.workerId !== null ? ` · w${job.workerId}` : ''}
      </span>
    </li>
  );
}

export default function TaskProcessorDemo() {
  const sim = useSim();
  const metrics = selectMetrics(sim);
  const queueDepth = metrics.queued;

  return (
    <section className="tp" aria-label="task-processor queue and worker simulator">
      <header className="tp__head">
        <span className="tp__tag">Interactive simulator</span>
        <h3 className="tp__title">Job queue and worker pool</h3>
        <p className="tp__lede">
          A queue of jobs drained by a pool of concurrent workers. Each tick,
          workers pull queued jobs up to the concurrency limit, running jobs
          resolve, and failures retry until they exhaust their budget and fall to
          the dead-letter queue. Deterministic for a fixed seed.
        </p>
      </header>

      <div className="tp__depth glass" role="status" aria-live="polite">
        <span className="tp__depth-label">Queue depth</span>
        <span className="tp__depth-val">{queueDepth}</span>
        <span className="tp__depth-sub">tick {sim.tick}</span>
      </div>

      <RunControls />

      <MetricTiles metrics={metrics} />

      <Controls sim={sim} />

      <Trend trend={sim.trend} />

      <div className="tp__workers glass" aria-label="worker pool">
        <div className="tp__workers-head">
          <h4 className="tp__col-name">Worker pool</h4>
          <span className="tp__col-count">{sim.workers.length}</span>
        </div>
        <ul className="tp__workers-list">
          {sim.workers.map((w) => (
            <WorkerCard key={w.id} worker={w} />
          ))}
        </ul>
      </div>

      <div className="tp__board" role="list" aria-label="jobs by status">
        {COLUMNS.map((col) => {
          const jobs = jobsByStatus(sim.jobs, col.status);
          return (
            <div
              key={col.status}
              className={`tp__col glass tp__col--${col.status}`}
              role="listitem"
            >
              <div className="tp__col-head">
                <span className="tp__col-name">{col.label}</span>
                <span className="tp__col-count">{jobs.length}</span>
              </div>
              <ul className="tp__col-list" aria-label={`${col.label} jobs`}>
                {jobs.map((job) => (
                  <JobChip key={job.id} job={job} />
                ))}
                {jobs.length === 0 && <li className="tp__col-empty">empty</li>}
              </ul>
            </div>
          );
        })}
      </div>

      <DeadLetter jobs={sim.jobs} />
    </section>
  );
}
