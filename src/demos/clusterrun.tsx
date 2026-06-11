import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './clusterrun.css';

// ClusterRun: a controller matches jobs to workers via a declared requires
// block (node_class plus features like AVX2 and GPU), redrives a job to a new
// worker on worker loss, and resumes from the last S3 checkpoint instead of
// restarting. Numbers and behavior come from the project's capability-matched
// scheduling, mid-run redrive, and pending-capability set.

type Feature = 'avx2' | 'gpu';

type Worker = {
  id: string;
  nodeClass: string;
  cpu: number;
  memGb: number;
  features: Feature[];
};

type JobSpec = {
  id: string;
  label: string;
  nodeClass: string;
  features: Feature[];
  // total checkpoints the job writes before it finishes
  checkpoints: number;
};

const WORKERS: Worker[] = [
  { id: 'w-a1', nodeClass: 'compute', cpu: 8, memGb: 32, features: ['avx2'] },
  { id: 'w-b1', nodeClass: 'gpu', cpu: 16, memGb: 64, features: ['avx2', 'gpu'] },
  { id: 'w-c1', nodeClass: 'compute', cpu: 4, memGb: 16, features: [] },
];

const JOBS: JobSpec[] = [
  {
    id: 'j-embed',
    label: 'embed-shard',
    nodeClass: 'compute',
    features: ['avx2'],
    checkpoints: 4,
  },
  {
    id: 'j-train',
    label: 'train-step',
    nodeClass: 'gpu',
    features: ['gpu'],
    checkpoints: 4,
  },
];

type Phase =
  | 'idle'
  | 'matching'
  | 'running'
  | 'lost'
  | 'redriving'
  | 'resuming'
  | 'done';

type LogLine = { id: number; kind: 'sys' | 'ok' | 'warn'; text: string };

// A worker satisfies a job when its node_class matches and it carries every
// required feature. Capacity (cpu/mem) is reported but the match key is the
// requires block, exactly as the controller decides.
function satisfies(w: Worker, j: JobSpec): boolean {
  if (w.nodeClass !== j.nodeClass) return false;
  return j.features.every((f) => w.features.includes(f));
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function ClusterrunDemo() {
  const reduce = useReducedMotion();
  const [jobId, setJobId] = useState<string>('j-train');
  const [phase, setPhase] = useState<Phase>('idle');
  const [assigned, setAssigned] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // checkpoints written so far
  const [resumeFrom, setResumeFrom] = useState(0); // checkpoint redrive resumes at
  const [lostWorker, setLostWorker] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const timers = useRef<number[]>([]);
  const logId = useRef(0);

  const job = JOBS.find((j) => j.id === jobId)!;
  const eligible = WORKERS.filter((w) => satisfies(w, job));
  const running = phase !== 'idle' && phase !== 'done';

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const after = useCallback(
    (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? 0 : ms);
      timers.current.push(t);
    },
    [reduce],
  );

  function push(kind: LogLine['kind'], text: string) {
    logId.current += 1;
    setLog((prev) => [...prev, { id: logId.current, kind, text }]);
  }

  function reset() {
    clearTimers();
    setPhase('idle');
    setAssigned(null);
    setProgress(0);
    setResumeFrom(0);
    setLostWorker(null);
    setLog([]);
  }

  function selectJob(id: string) {
    if (running) return;
    reset();
    setJobId(id);
  }

  // Drive the full lifecycle: match, run partway, lose the worker, redrive to a
  // surviving eligible worker, resume from the last checkpoint, finish.
  function run() {
    if (running) return;
    clearTimers();
    setAssigned(null);
    setProgress(0);
    setResumeFrom(0);
    setLostWorker(null);
    setLog([]);
    setPhase('matching');
    push('sys', `controller: matching ${job.label} requires ${job.nodeClass} + ${job.features.join(', ') || 'none'}`);

    const first = eligible[0];
    const failAt = 2; // checkpoints completed on first worker before loss
    const total = job.checkpoints;

    after(700, () => {
      setAssigned(first.id);
      setPhase('running');
      push('ok', `assigned to ${first.id} (${first.nodeClass}, ${first.features.join('/') || 'base'})`);
    });

    // first worker writes checkpoints 1..failAt
    for (let c = 1; c <= failAt; c += 1) {
      after(700 + c * 620, () => {
        setProgress(c);
        push('sys', `${first.id}: wrote checkpoint ${c}/${total} to s3`);
      });
    }

    // worker is lost mid-run
    const lostAt = 700 + failAt * 620 + 520;
    after(lostAt, () => {
      setPhase('lost');
      setLostWorker(first.id);
      push('warn', `${first.id} lost mid-run; redriving job`);
    });

    // redrive to a different surviving eligible worker
    const second = eligible[1] ?? eligible[0];
    after(lostAt + 720, () => {
      setPhase('redriving');
      setResumeFrom(failAt);
      push('sys', `controller: redrive with resume_from_checkpoint_s3=${failAt}`);
    });
    after(lostAt + 1320, () => {
      setAssigned(second.id);
      setPhase('resuming');
      push('ok', `${second.id}: resuming from checkpoint ${failAt}, not restarting`);
    });

    // second worker writes the remaining checkpoints
    for (let c = failAt + 1; c <= total; c += 1) {
      after(lostAt + 1320 + (c - failAt) * 620, () => {
        setProgress(c);
        push('sys', `${second.id}: wrote checkpoint ${c}/${total} to s3`);
      });
    }

    after(lostAt + 1320 + (total - failAt) * 620 + 400, () => {
      setPhase('done');
      push('ok', `${job.label} complete on ${second.id} from checkpoint ${failAt}`);
    });
  }

  const noWorker = eligible.length === 0;

  return (
    <div className="demo" aria-label="clusterrun scheduling and redrive demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Match, lose a worker, redrive from checkpoint</h3>
      <p className="demo__lede">
        Pick a job and run it. The controller matches it to a worker by its
        requires block, the worker is lost mid-run, and the job redrives to a
        surviving worker that resumes from the last checkpoint instead of
        restarting.
      </p>

      <div className="cr__jobs" role="group" aria-label="select a job">
        {JOBS.map((j) => {
          const on = j.id === jobId;
          return (
            <button
              key={j.id}
              className={`cr__job${on ? ' cr__job--on' : ''}`}
              aria-pressed={on}
              onClick={() => selectJob(j.id)}
              disabled={running}
            >
              <span className="cr__job-name">{j.label}</span>
              <span className="cr__job-req">
                requires {j.nodeClass}
                {j.features.length ? ` + ${j.features.join(', ')}` : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="cr__board">
        {WORKERS.map((w) => {
          const ok = satisfies(w, job);
          const isAssigned = assigned === w.id;
          const isLost = lostWorker === w.id;
          const cls = [
            'cr__worker',
            ok ? 'cr__worker--eligible' : 'cr__worker--blocked',
            isAssigned && !isLost ? 'cr__worker--active' : '',
            isLost ? 'cr__worker--lost' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <motion.div
              key={w.id}
              className={cls}
              animate={
                isLost && !reduce
                  ? { x: [0, -4, 4, -3, 0], opacity: 0.45 }
                  : { x: 0, opacity: 1 }
              }
              transition={{ duration: 0.4, ease }}
            >
              <div className="cr__worker-head">
                <span className="cr__worker-id">{w.id}</span>
                <span className="cr__worker-state">
                  {isLost
                    ? 'lost'
                    : isAssigned
                      ? phase === 'resuming' || phase === 'done'
                        ? 'resumed'
                        : 'running'
                      : ok
                        ? 'eligible'
                        : 'skipped'}
                </span>
              </div>
              <div className="cr__worker-class">{w.nodeClass} node</div>
              <div className="cr__caps">
                <span className="cr__cap">{w.cpu} cpu</span>
                <span className="cr__cap">{w.memGb} gb</span>
                {(['avx2', 'gpu'] as Feature[]).map((f) => {
                  const has = w.features.includes(f);
                  const need = job.features.includes(f);
                  return (
                    <span
                      key={f}
                      className={`cr__cap cr__cap--feat${has ? ' cr__cap--has' : ''}${
                        need && !has ? ' cr__cap--missing' : ''
                      }`}
                    >
                      {f}
                    </span>
                  );
                })}
              </div>

              {isAssigned && !isLost && (
                <div className="cr__ckpts" aria-hidden="true">
                  {Array.from({ length: job.checkpoints }).map((_, i) => {
                    const num = i + 1;
                    const written = num <= progress;
                    const carried = num <= resumeFrom;
                    return (
                      <span
                        key={num}
                        className={`cr__ckpt${written ? ' cr__ckpt--on' : ''}${
                          carried ? ' cr__ckpt--carried' : ''
                        }`}
                      />
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="cr__status">
        <div className="cr__status-item">
          <span className="cr__status-k">phase</span>
          <span className="cr__status-v">{phase}</span>
        </div>
        <div className="cr__status-item">
          <span className="cr__status-k">checkpoints</span>
          <span className="cr__status-v">
            {progress}/{job.checkpoints}
          </span>
        </div>
        <div className="cr__status-item">
          <span className="cr__status-k">resume_from</span>
          <span className="cr__status-v">{resumeFrom || '-'}</span>
        </div>
      </div>

      {noWorker && (
        <div className="cr__pending" role="status">
          no live worker satisfies this job; it would wait in the
          pending-capability set with a waiting_for reason
        </div>
      )}

      <div className="cr__log" role="log" aria-live="polite">
        <div className="cr__log-head">controller log</div>
        <ul className="cr__log-list">
          <AnimatePresence initial={false}>
            {log.map((l) => (
              <motion.li
                key={l.id}
                className={`cr__log-line cr__log-line--${l.kind}`}
                initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, ease }}
              >
                {l.text}
              </motion.li>
            ))}
          </AnimatePresence>
          {log.length === 0 && (
            <li className="cr__log-empty">run the job to drive the controller</li>
          )}
        </ul>
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className="cr__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="cr__verdict-head">resumed, not restarted</span>
            <span className="cr__verdict-text">
              {resumeFrom} of {job.checkpoints} checkpoints survived the lost
              worker. The redrive started the new worker at checkpoint{' '}
              {resumeFrom}, saving the work already written to S3.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running || noWorker}>
          {running ? 'Running…' : 'Run job'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {eligible.length} of {WORKERS.length} workers match this requires block
        </span>
      </div>
    </div>
  );
}
