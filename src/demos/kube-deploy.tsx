import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import './kube-deploy.css';

// kdeploy up fans out to two halves at once: Terraform owns infrastructure
// (VPC, EKS, RDS, S3) and kdeploy owns the workload (namespace, manifests,
// monitoring). Both halves are idempotent: a second up is a no-op because
// apply uses server-side create-or-update with a stable FieldManager, and the
// Service clusterIP is preserved on update since it is an immutable field.

type Half = 'terraform' | 'workload';

type Resource = {
  id: string;
  half: Half;
  label: string;
  kind: string;
};

const RESOURCES: Resource[] = [
  { id: 'vpc', half: 'terraform', label: 'VPC', kind: 'aws_vpc' },
  { id: 'eks', half: 'terraform', label: 'EKS cluster', kind: 'aws_eks_cluster' },
  { id: 'rds', half: 'terraform', label: 'RDS instance', kind: 'aws_db_instance' },
  { id: 's3', half: 'terraform', label: 'S3 bucket', kind: 'aws_s3_bucket' },
  { id: 'ns', half: 'workload', label: 'Namespace', kind: 'v1/Namespace' },
  { id: 'deploy', half: 'workload', label: 'Deployment', kind: 'apps/v1/Deployment' },
  { id: 'svc', half: 'workload', label: 'Service', kind: 'v1/Service' },
  { id: 'sm', half: 'workload', label: 'ServiceMonitor', kind: 'monitoring/ServiceMonitor' },
  { id: 'dash', half: 'workload', label: 'Grafana dashboard', kind: 'v1/ConfigMap' },
];

type Status = 'pending' | 'running' | 'created' | 'noop';

type State = Record<string, Status>;

const ease = [0.22, 1, 0.36, 1] as const;

function freshState(): State {
  return Object.fromEntries(RESOURCES.map((r) => [r.id, 'pending'])) as State;
}

export default function KubeDeployDemo() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<State>(freshState);
  const [running, setRunning] = useState(false);
  // applied tracks whether the environment already exists, which is what makes
  // the second up a no-op.
  const [applied, setApplied] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setState(freshState());
    setRunning(false);
    setApplied(false);
    setRunCount(0);
    setLog([]);
  }

  function runUp() {
    if (running) return;
    clearTimers();
    setRunning(true);
    const isNoop = applied;
    const result: Status = isNoop ? 'noop' : 'created';
    const count = runCount + 1;
    setRunCount(count);
    setState(freshState());
    setLog([
      isNoop
        ? `kdeploy up (run ${count}): environment exists, reconciling`
        : `kdeploy up (run ${count}): provisioning environment`,
    ]);

    // The two halves run in parallel; resources within each half settle in a
    // short stagger so the fan-out reads clearly.
    const tfResources = RESOURCES.filter((r) => r.half === 'terraform');
    const wlResources = RESOURCES.filter((r) => r.half === 'workload');
    const stepBase = reduce ? 0 : 360;

    function schedule(resList: Resource[]) {
      resList.forEach((r, i) => {
        const startAt = reduce ? 0 : 120 + i * stepBase;
        const endAt = reduce ? 0 : startAt + stepBase - 60;
        timers.current.push(
          setTimeout(() => {
            setState((s) => ({ ...s, [r.id]: 'running' }));
          }, startAt),
        );
        timers.current.push(
          setTimeout(() => {
            setState((s) => ({ ...s, [r.id]: result }));
            setLog((prev) => [
              isNoop
                ? `${r.kind} ${r.label.toLowerCase()}: no change`
                : `${r.kind} ${r.label.toLowerCase()}: created`,
              ...prev,
            ]);
          }, endAt),
        );
      });
    }

    schedule(tfResources);
    schedule(wlResources);

    const total = reduce
      ? 0
      : 120 + Math.max(tfResources.length, wlResources.length) * stepBase + 80;
    timers.current.push(
      setTimeout(() => {
        setApplied(true);
        setRunning(false);
        setLog((prev) => [
          isNoop
            ? 'apply complete: 0 changed, all resources already in desired state'
            : 'apply complete: 9 created, clusterIP assigned to Service',
          ...prev,
        ]);
      }, total),
    );
  }

  const tfResources = RESOURCES.filter((r) => r.half === 'terraform');
  const wlResources = RESOURCES.filter((r) => r.half === 'workload');
  const allNoop =
    applied && !running && RESOURCES.every((r) => state[r.id] === 'noop');

  return (
    <div className="demo kd" aria-label="kube-deploy idempotent provisioning demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">One up, two idempotent halves</h3>
      <p className="demo__lede">
        Run kdeploy up to fan out to Terraform infrastructure and the workload
        deploy in parallel. Run it again on the existing environment: server-side
        apply with a stable FieldManager makes every resource a no-op, and the
        Service clusterIP is preserved because it is immutable.
      </p>

      <div className="kd__stage">
        <div className="kd__cmd" aria-hidden="true">
          <span className="kd__cmd-prompt">$</span>
          <span className="kd__cmd-text">kdeploy up --env staging</span>
          {applied && !running && (
            <span
              className={`kd__cmd-badge${allNoop ? ' kd__cmd-badge--noop' : ''}`}
            >
              {allNoop ? 'no-op' : 'applied'}
            </span>
          )}
        </div>

        <div className="kd__halves">
          {(['terraform', 'workload'] as Half[]).map((half) => {
            const list = half === 'terraform' ? tfResources : wlResources;
            return (
              <section
                key={half}
                className={`kd__half kd__half--${half}`}
                aria-label={half === 'terraform' ? 'Terraform infrastructure' : 'Workload deploy'}
              >
                <header className="kd__half-head">
                  <span className="kd__half-name">
                    {half === 'terraform' ? 'Terraform' : 'kdeploy workload'}
                  </span>
                  <span className="kd__half-sub">
                    {half === 'terraform' ? 'AWS infrastructure' : 'K8s API server'}
                  </span>
                </header>
                <ul className="kd__res-list">
                  {list.map((r) => {
                    const st = state[r.id];
                    return (
                      <li
                        key={r.id}
                        className={`kd__res kd__res--${st}`}
                        aria-label={`${r.label}: ${st}`}
                      >
                        <span className="kd__res-icon">
                          <AnimatePresence mode="wait" initial={false}>
                            {st === 'running' ? (
                              <motion.span
                                key="run"
                                className="kd__spinner"
                                aria-hidden="true"
                                animate={reduce ? {} : { rotate: 360 }}
                                transition={{
                                  repeat: Infinity,
                                  duration: 0.9,
                                  ease: 'linear',
                                }}
                              />
                            ) : (
                              <motion.span
                                key={st}
                                className="kd__res-mark"
                                initial={{ scale: reduce ? 1 : 0 }}
                                animate={{ scale: 1 }}
                                transition={{ duration: reduce ? 0 : 0.25, ease }}
                              >
                                {st === 'created' ? '+' : st === 'noop' ? '=' : ''}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </span>
                        <span className="kd__res-body">
                          <span className="kd__res-label">{r.label}</span>
                          <span className="kd__res-kind">{r.kind}</span>
                        </span>
                        <span className="kd__res-state">
                          {st === 'created'
                            ? 'created'
                            : st === 'noop'
                              ? 'no change'
                              : st === 'running'
                                ? 'applying'
                                : 'pending'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="kd__console" aria-live="polite">
          <div className="kd__console-head">apply log</div>
          <ul className="kd__console-list">
            {log.length === 0 && (
              <li className="kd__console-empty">run up to see the plan apply</li>
            )}
            <AnimatePresence initial={false}>
              {log.slice(0, 6).map((line, i) => (
                <motion.li
                  key={`${runCount}-${log.length - i}`}
                  className="kd__console-line"
                  initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.2, ease }}
                >
                  {line}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>

        <AnimatePresence>
          {allNoop && (
            <motion.div
              className="kd__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="kd__verdict-head">re-run is a no-op</span>
              <span className="kd__verdict-text">
                All 9 resources matched desired state, so up changed nothing. The
                hermetic end-to-end tests prove this against a real kind cluster
                and a localstack container, with no cloud credentials touched.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runUp} disabled={running}>
          {running ? 'Applying…' : applied ? 'Run up again' : 'Run kdeploy up'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {applied
            ? `run ${runCount}: ${allNoop ? 'no changes' : 'environment provisioned'}`
            : 'Terraform owns infra, kdeploy owns workload'}
        </span>
      </div>
    </div>
  );
}
