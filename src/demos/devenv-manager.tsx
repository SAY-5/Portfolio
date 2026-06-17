import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './devenv-manager.css';
import { useStore } from './devenv-manager/state';
import {
  addDependency,
  addService,
  clearLastCycle,
  conflictIds,
  conflicts,
  deleteService,
  editService,
  removeDependency,
  resetAll,
  setCascadeStop,
  startAll,
  startChain,
  startService,
  stopAll,
  stopService,
  topoOrder,
  type Service,
} from './devenv-manager/store';

// In-browser local dev-services manager. Services, ports, commands, and the
// dependency graph all live client-side and persist in localStorage. The
// engine (devenv-manager/engine.ts) does the graph work: it computes a
// topological start order, starts a service's dependencies before the service,
// blocks a stop while a running dependent still needs the service (or cascades
// when the flag is on), rejects any dependency edge that would close a loop,
// and flags two services sharing a port. No eval, no clock, no randomness in
// the engine: the same inputs always produce the same start order.
const ease = [0.22, 1, 0.36, 1] as const;
const STEP_MS = 420;

type View = 'services' | 'graph' | 'conflicts';

type Toast = { id: number; text: string; tone: 'ok' | 'warn' };

const STATUS_LABEL: Record<Service['status'], string> = {
  stopped: 'stopped',
  starting: 'starting',
  running: 'running',
};

export default function DevenvManagerDemo() {
  const state = useStore();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>('services');
  const [editing, setEditing] = useState<string | null>(null);

  // A transient set of ids the UI is "lighting up" in start order, so the user
  // sees dependencies coming online before the service that needed them.
  const [igniting, setIgniting] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const timers = useRef<number[]>([]);
  const toastId = useRef(0);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function notify(text: string, tone: Toast['tone']) {
    toastId.current += 1;
    const id = toastId.current;
    setToast({ id, text, tone });
    const t = window.setTimeout(() => {
      setToast((cur) => (cur && cur.id === id ? null : cur));
    }, 3200);
    timers.current.push(t);
  }

  // Animate a chain of ids coming up one at a time, then commit the start to
  // the store. With reduced motion the start is applied immediately.
  function igniteChain(chain: string[], commit: () => void) {
    if (chain.length === 0) {
      commit();
      return;
    }
    if (reduce) {
      commit();
      return;
    }
    clearTimers();
    setIgniting([]);
    chain.forEach((id, i) => {
      const t = window.setTimeout(() => {
        setIgniting((prev) => [...prev, id]);
      }, i * STEP_MS);
      timers.current.push(t);
    });
    const done = window.setTimeout(() => {
      commit();
      setIgniting([]);
    }, chain.length * STEP_MS);
    timers.current.push(done);
  }

  const conflictSet = useMemo(() => conflictIds(state), [state]);
  const portConflicts = useMemo(() => conflicts(state), [state]);
  const order = useMemo(() => topoOrder(state.services), [state.services]);
  const byId = useMemo(() => {
    const m = new Map<string, Service>();
    for (const s of state.services) m.set(s.id, s);
    return m;
  }, [state.services]);

  function handleStart(id: string) {
    const chain = startChain(state.services, id).filter(
      (sid) => byId.get(sid)?.status !== 'running',
    );
    const svc = byId.get(id);
    igniteChain(chain, () => {
      startService(id);
      if (chain.length > 1 && svc) {
        notify(`Started ${chain.length} services so ${svc.name} could run`, 'ok');
      }
    });
  }

  function handleStop(id: string) {
    const res = stopService(id);
    if (!res.ok) {
      const names = res.blockedBy
        .map((d) => byId.get(d)?.name ?? d)
        .join(', ');
      notify(`Blocked: ${names} still depend on this service`, 'warn');
      return;
    }
    if (res.stopped.length > 1) {
      notify(`Stopped ${res.stopped.length} services (cascade)`, 'ok');
    }
  }

  function handleStartAll() {
    const chain = topoOrder(state.services).filter(
      (sid) => byId.get(sid)?.status !== 'running',
    );
    igniteChain(chain, () => {
      startAll();
      if (chain.length > 0) notify(`Started ${chain.length} services in order`, 'ok');
    });
  }

  const runningCount = state.services.filter((s) => s.status === 'running').length;

  return (
    <div className="demo" aria-label="local dev-services manager">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Local dev-services manager</h3>
      <p className="demo__lede">
        Define local services with ports, commands, and dependencies. Starting a
        service brings its dependencies up first in topological order; stopping
        one is blocked while a running dependent still needs it. A dependency
        that would close a loop is rejected, and two services on the same port
        are flagged. Everything persists in your browser.
      </p>

      <nav className="dm__tabs" aria-label="views">
        {(['services', 'graph', 'conflicts'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            className={view === v ? 'dm__tab dm__tab--on' : 'dm__tab'}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === 'services' ? 'Services' : v === 'graph' ? 'Start order' : 'Conflicts'}
            {v === 'conflicts' && portConflicts.length > 0 && (
              <span className="dm__tab-badge" aria-label={`${portConflicts.length} conflicts`}>
                {portConflicts.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {view === 'services' && (
        <ServicesView
          services={state.services}
          order={order}
          conflictSet={conflictSet}
          igniting={igniting}
          editing={editing}
          setEditing={setEditing}
          onStart={handleStart}
          onStop={handleStop}
          reduce={!!reduce}
        />
      )}

      {view === 'graph' && (
        <GraphView services={state.services} order={order} byId={byId} />
      )}

      {view === 'conflicts' && (
        <ConflictsView
          state={state}
          portConflicts={portConflicts}
          byId={byId}
        />
      )}

      <div className="demo__controls">
        <button type="button" className="demo__btn" onClick={handleStartAll}>
          Start all in order
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            stopAll();
            notify('Stopped all services', 'ok');
          }}
        >
          Stop all
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            resetAll();
            setEditing(null);
            setIgniting([]);
            notify('Reset to seed services', 'ok');
          }}
        >
          Reset
        </button>
        <span className="demo__hint">
          {runningCount} of {state.services.length} running
        </span>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={
              toast.tone === 'warn' ? 'dm__toast dm__toast--warn' : 'dm__toast'
            }
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- services view ----------

function ServicesView({
  services,
  order,
  conflictSet,
  igniting,
  editing,
  setEditing,
  onStart,
  onStop,
  reduce,
}: {
  services: Service[];
  order: string[];
  conflictSet: Set<string>;
  igniting: string[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  reduce: boolean;
}) {
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const sorted = [...services].sort(
    (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
  );
  const igniteSet = new Set(igniting);

  return (
    <div className="dm__panel glass">
      <ul className="dm__grid" aria-label="services">
        {sorted.map((s) => {
          const conflicted = conflictSet.has(s.id);
          const lighting = igniteSet.has(s.id);
          const status = lighting ? 'starting' : s.status;
          return (
            <li key={s.id}>
              <motion.article
                className={`dm__card dm__card--${status}${
                  conflicted ? ' dm__card--conflict' : ''
                }`}
                animate={reduce ? {} : { scale: lighting ? 1.015 : 1 }}
                transition={{ duration: 0.3, ease }}
              >
                <header className="dm__card-head">
                  <span className="dm__card-name">{s.name}</span>
                  <span
                    className={`dm__status dm__status--${status}`}
                    role="status"
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </header>
                <dl className="dm__meta">
                  <div className="dm__meta-row">
                    <dt>port</dt>
                    <dd className={conflicted ? 'dm__port dm__port--bad' : 'dm__port'}>
                      {s.port}
                      {conflicted && (
                        <span className="dm__port-flag" title="port conflict">
                          conflict
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="dm__meta-row">
                    <dt>command</dt>
                    <dd className="dm__cmd">{s.command || '(none)'}</dd>
                  </div>
                  <div className="dm__meta-row">
                    <dt>depends on</dt>
                    <dd className="dm__deps">
                      {s.dependsOn.length === 0 ? (
                        <span className="dm__dep dm__dep--none">none</span>
                      ) : (
                        s.dependsOn.map((d) => (
                          <span key={d} className="dm__dep">
                            {d}
                          </span>
                        ))
                      )}
                    </dd>
                  </div>
                </dl>
                <footer className="dm__card-foot">
                  {s.status === 'running' ? (
                    <button
                      type="button"
                      className="dm__btn dm__btn--stop"
                      onClick={() => onStop(s.id)}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dm__btn dm__btn--start"
                      onClick={() => onStart(s.id)}
                    >
                      Start
                    </button>
                  )}
                  <button
                    type="button"
                    className="dm__btn dm__btn--ghost"
                    aria-expanded={editing === s.id}
                    onClick={() => setEditing(editing === s.id ? null : s.id)}
                  >
                    Edit
                  </button>
                </footer>
                {editing === s.id && (
                  <EditPanel
                    service={s}
                    services={services}
                    onDone={() => setEditing(null)}
                  />
                )}
              </motion.article>
            </li>
          );
        })}
        <li>
          <AddCard services={services} />
        </li>
      </ul>
    </div>
  );
}

// ---------- edit panel ----------

function EditPanel({
  service,
  services,
  onDone,
}: {
  service: Service;
  services: Service[];
  onDone: () => void;
}) {
  const [name, setName] = useState(service.name);
  const [port, setPort] = useState(String(service.port));
  const [command, setCommand] = useState(service.command);
  const [dep, setDep] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const candidates = services.filter(
    (s) => s.id !== service.id && !service.dependsOn.includes(s.id),
  );

  return (
    <div className="dm__edit" role="group" aria-label={`edit ${service.name}`}>
      <label className="dm__field">
        <span>name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => editService(service.id, { name })}
        />
      </label>
      <label className="dm__field">
        <span>port</span>
        <input
          inputMode="numeric"
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => editService(service.id, { port: Number(port) || 0 })}
        />
      </label>
      <label className="dm__field">
        <span>command</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onBlur={() => editService(service.id, { command })}
        />
      </label>

      <div className="dm__field">
        <span>dependencies</span>
        <div className="dm__dep-edit">
          {service.dependsOn.map((d) => (
            <button
              key={d}
              type="button"
              className="dm__dep dm__dep--removable"
              onClick={() => removeDependency(service.id, d)}
              aria-label={`remove dependency ${d}`}
            >
              {d} <span aria-hidden="true">×</span>
            </button>
          ))}
          <select
            value={dep}
            onChange={(e) => {
              const to = e.target.value;
              setDep('');
              if (!to) return;
              const cycle = addDependency(service.id, to);
              if (cycle) {
                setErr(
                  `Rejected: ${to} already depends on ${service.id} (would create a cycle)`,
                );
              } else {
                setErr(null);
              }
            }}
            aria-label="add a dependency"
          >
            <option value="">add dependency…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </div>
        {err && <p className="dm__edit-err">{err}</p>}
      </div>

      <div className="dm__edit-foot">
        <button
          type="button"
          className="dm__btn dm__btn--danger"
          onClick={() => {
            deleteService(service.id);
            onDone();
          }}
        >
          Delete service
        </button>
        <button type="button" className="dm__btn dm__btn--ghost" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---------- add card ----------

function AddCard({ services }: { services: Service[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [command, setCommand] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        className="dm__add-trigger glass"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">+</span> Add service
      </button>
    );
  }

  const dupPort = services.some((s) => String(s.port) === port && port !== '');

  return (
    <form
      className="dm__card dm__card--add glass"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        addService({
          name: name.trim(),
          port: Number(port) || 0,
          command: command.trim(),
        });
        setName('');
        setPort('');
        setCommand('');
        setOpen(false);
      }}
    >
      <label className="dm__field">
        <span>name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="dm__field">
        <span>port</span>
        <input
          inputMode="numeric"
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
          aria-describedby={dupPort ? 'dm-dup-port' : undefined}
        />
        {dupPort && (
          <span id="dm-dup-port" className="dm__edit-err">
            another service already uses this port
          </span>
        )}
      </label>
      <label className="dm__field">
        <span>command</span>
        <input value={command} onChange={(e) => setCommand(e.target.value)} />
      </label>
      <div className="dm__edit-foot">
        <button type="submit" className="dm__btn dm__btn--start">
          Create
        </button>
        <button
          type="button"
          className="dm__btn dm__btn--ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- graph / start-order view ----------

function GraphView({
  services,
  order,
  byId,
}: {
  services: Service[];
  order: string[];
  byId: Map<string, Service>;
}) {
  // Depth of a service = longest dependency chain below it, so the indented
  // tree reads as the order things come up: depth 0 first.
  const depth = useMemo(() => {
    const d = new Map<string, number>();
    const visit = (id: string, stack: Set<string>): number => {
      if (d.has(id)) return d.get(id) as number;
      if (stack.has(id)) return 0;
      stack.add(id);
      const svc = byId.get(id);
      let max = 0;
      if (svc) {
        for (const dep of svc.dependsOn) {
          if (byId.has(dep)) max = Math.max(max, visit(dep, stack) + 1);
        }
      }
      stack.delete(id);
      d.set(id, max);
      return max;
    };
    for (const s of services) visit(s.id, new Set());
    return d;
  }, [services, byId]);

  return (
    <div className="dm__panel glass">
      <p className="dm__panel-lede">
        Topological start order. Each service appears after every service it
        depends on, so starting from the top brings dependencies up first.
      </p>
      <ol className="dm__order" aria-label="start order">
        {order.map((id, i) => {
          const svc = byId.get(id);
          if (!svc) return null;
          const indent = depth.get(id) ?? 0;
          return (
            <li
              key={id}
              className="dm__order-row"
              style={{ marginInlineStart: `${indent * 22}px` }}
            >
              <span className="dm__order-idx" aria-hidden="true">
                {i + 1}
              </span>
              <span className={`dm__order-dot dm__order-dot--${svc.status}`} aria-hidden="true" />
              <span className="dm__order-name">{svc.name}</span>
              <span className="dm__order-port">:{svc.port}</span>
              {svc.dependsOn.length > 0 && (
                <span className="dm__order-deps">
                  after {svc.dependsOn.join(', ')}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- conflicts view ----------

function ConflictsView({
  state,
  portConflicts,
  byId,
}: {
  state: ReturnType<typeof useStore>;
  portConflicts: ReturnType<typeof conflicts>;
  byId: Map<string, Service>;
}) {
  return (
    <div className="dm__panel glass">
      <section aria-labelledby="dm-ports-head">
        <h4 id="dm-ports-head" className="dm__section-head">
          Port conflicts
        </h4>
        {portConflicts.length === 0 ? (
          <p className="dm__empty">No two services share a port.</p>
        ) : (
          <ul className="dm__conflicts">
            {portConflicts.map((c) => (
              <li key={c.port} className="dm__conflict">
                <span className="dm__conflict-port">port {c.port}</span>
                <span className="dm__conflict-svcs">
                  {c.serviceIds.map((id) => byId.get(id)?.name ?? id).join(' and ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dm-cycle-head">
        <h4 id="dm-cycle-head" className="dm__section-head">
          Last rejected dependency
        </h4>
        {state.lastCycle ? (
          <div className="dm__cycle" role="alert">
            <p>
              Adding <code>{state.lastCycle.from}</code> depends-on{' '}
              <code>{state.lastCycle.to}</code> was rejected: it would close the
              loop {state.lastCycle.path.join(' → ')} → {state.lastCycle.from}.
            </p>
            <button
              type="button"
              className="dm__btn dm__btn--ghost"
              onClick={clearLastCycle}
            >
              Dismiss
            </button>
          </div>
        ) : (
          <p className="dm__empty">
            No dependency has been rejected. Try adding a dependency in Edit that
            points back into a service that already depends on it.
          </p>
        )}
      </section>

      <section aria-labelledby="dm-stop-head">
        <h4 id="dm-stop-head" className="dm__section-head">
          Stop behaviour
        </h4>
        <label className="dm__toggle">
          <input
            type="checkbox"
            checked={state.cascadeStop}
            onChange={(e) => setCascadeStop(e.target.checked)}
          />
          <span>
            Cascade stop: also stop running dependents (off blocks the stop
            instead)
          </span>
        </label>
      </section>
    </div>
  );
}
