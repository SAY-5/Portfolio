import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './pluginforge.css';

// Real mechanism: a plugin runs inside a hardened Web Worker with no ambient
// authority. fetch, XHR, localStorage, indexedDB, WebSocket, document, window,
// SharedArrayBuffer and Atomics are killed in the worker and importScripts is
// disabled, so the only way out is an RPC to the host. The capability router
// gates each RPC against the manifest grant: net is held to a URL allow-list,
// shell to glob-matched commands, env to a per-key list. A call only passes if
// a matching grant is on. The sandbox is backed by 12 worker-escape tests, with
// 33 tests passing overall.
const ESCAPE_TESTS = 12;
const TESTS_TOTAL = 33;

type CapId = 'storage' | 'net' | 'shell' | 'clipboard';

type Grant = {
  id: CapId;
  name: string;
  scope: string;
};

const GRANTS: Grant[] = [
  { id: 'storage', name: 'storage:scoped', scope: 'plugin-scoped KV store' },
  { id: 'net', name: 'net:fetch', scope: 'allow-list: api.example.com/*' },
  { id: 'shell', name: 'shell:exec', scope: 'glob: git status, git log' },
  { id: 'clipboard', name: 'clipboard:read', scope: 'read host clipboard' },
];

// Each attempt is a call the plugin makes. Direct calls (fetch, localStorage)
// have no RPC path and are always killed in the worker. Routed calls go through
// the host and pass only if the matching grant is on AND the target is inside
// the declared scope.
type Attempt = {
  key: string;
  label: string;
  // 'direct' calls are blocked by the worker shim regardless of grants.
  // 'routed' calls are gated by the named capability.
  kind: 'direct' | 'routed';
  cap?: CapId;
  // target used to check scope for routed calls
  target: string;
  inScope: boolean;
};

const ATTEMPTS: Attempt[] = [
  {
    key: 'fetch',
    label: 'fetch()',
    kind: 'direct',
    target: 'global fetch',
    inScope: false,
  },
  {
    key: 'localStorage',
    label: 'localStorage',
    kind: 'direct',
    target: 'global localStorage',
    inScope: false,
  },
  {
    key: 'net-ok',
    label: 'host.net api.example.com',
    kind: 'routed',
    cap: 'net',
    target: 'api.example.com/v1',
    inScope: true,
  },
  {
    key: 'net-bad',
    label: 'host.net evil.test',
    kind: 'routed',
    cap: 'net',
    target: 'evil.test',
    inScope: false,
  },
  {
    key: 'shell-ok',
    label: 'host.shell git status',
    kind: 'routed',
    cap: 'shell',
    target: 'git status',
    inScope: true,
  },
  {
    key: 'shell-bad',
    label: 'host.shell rm -rf',
    kind: 'routed',
    cap: 'shell',
    target: 'rm -rf /',
    inScope: false,
  },
  {
    key: 'storage',
    label: 'host.storage.put',
    kind: 'routed',
    cap: 'storage',
    target: 'counter',
    inScope: true,
  },
];

type Log = {
  id: number;
  kind: 'call' | 'allow' | 'block';
  text: string;
  reason?: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function PluginforgeDemo() {
  const reduce = useReducedMotion();
  const [grants, setGrants] = useState<Record<CapId, boolean>>({
    storage: true,
    net: false,
    shell: false,
    clipboard: false,
  });
  const [logs, setLogs] = useState<Log[]>([]);
  const [allowed, setAllowed] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const idRef = useRef(0);

  function toggle(id: CapId) {
    setGrants((g) => ({ ...g, [id]: !g[id] }));
  }

  function push(entries: Omit<Log, 'id'>[]) {
    setLogs((prev) => {
      const next = [...prev];
      for (const e of entries) {
        idRef.current += 1;
        next.push({ id: idRef.current, ...e });
      }
      return next.slice(-7);
    });
  }

  function evaluate(a: Attempt): { ok: boolean; reason: string } {
    if (a.kind === 'direct') {
      return { ok: false, reason: 'killed in worker, no ambient authority' };
    }
    const cap = a.cap!;
    if (!grants[cap]) {
      return { ok: false, reason: `no ${GRANTS.find((g) => g.id === cap)!.name} grant` };
    }
    if (!a.inScope) {
      return { ok: false, reason: 'outside declared scope' };
    }
    return { ok: true, reason: 'manifest grant matched at RPC boundary' };
  }

  function attempt(a: Attempt) {
    const res = evaluate(a);
    push([
      { kind: 'call', text: `plugin calls ${a.label}` },
      res.ok
        ? { kind: 'allow', text: a.label, reason: res.reason }
        : { kind: 'block', text: a.label, reason: res.reason },
    ]);
    if (res.ok) setAllowed((n) => n + 1);
    else setBlocked((n) => n + 1);
  }

  function reset() {
    setLogs([]);
    setAllowed(0);
    setBlocked(0);
    idRef.current = 0;
  }

  // keep refs to timers? none needed; all sync. cleanup noop for symmetry.
  useEffect(() => () => {}, []);

  return (
    <div className="demo" aria-label="pluginforge capability sandbox demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Every call is gated at the RPC boundary</h3>
      <p className="demo__lede">
        The plugin runs in a hardened worker with no ambient authority. Direct
        web calls are killed outright; host calls pass only when a matching
        capability grant is on and the target sits inside its declared scope.
        Toggle grants, fire the calls, and watch each one land allow or block.
      </p>

      <div className="pf__stage">
        <div className="pf__split">
          <div className="pf__pane">
            <div className="pf__pane-head">
              capability grants
              <span className="pf__pane-badge">manifest</span>
            </div>
            <div className="pf__grants">
              {GRANTS.map((g) => {
                const on = grants[g.id];
                return (
                  <button
                    key={g.id}
                    className={`pf__grant${on ? ' pf__grant--on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={`${g.name} grant`}
                    onClick={() => toggle(g.id)}
                  >
                    <span className="pf__switch">
                      <span className="pf__knob" />
                    </span>
                    <span>
                      <span className="pf__grant-name">{g.name}</span>
                      <span className="pf__grant-scope">{g.scope}</span>
                    </span>
                    <span className="pf__grant-state">{on ? 'granted' : 'denied'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pf__pane">
            <div className="pf__pane-head">
              log console
              <span className="pf__pane-badge pf__pane-badge--worker">worker</span>
            </div>
            <ul className="pf__console">
              {logs.length === 0 && (
                <li className="pf__console-empty">
                  Fire a call below to route it through the host.
                </li>
              )}
              <AnimatePresence initial={false}>
                {logs.map((l) => (
                  <motion.li
                    key={l.id}
                    className={`pf__log pf__log--${l.kind}`}
                    initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.26, ease }}
                  >
                    <span className="pf__log-tag">
                      {l.kind === 'call' ? 'rpc' : l.kind === 'allow' ? 'allow' : 'block'}
                    </span>
                    <span className="pf__log-text">
                      <b>{l.text}</b>
                      {l.reason ? `: ${l.reason}` : ''}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </div>

        <div className="pf__calls">
          {ATTEMPTS.map((a) => (
            <button
              key={a.key}
              className="pf__call-btn"
              onClick={() => attempt(a)}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="pf__stats">
          <div className="pf__stat">
            <div className="pf__stat-val">{allowed}</div>
            <div className="pf__stat-label">calls allowed</div>
          </div>
          <div className="pf__stat">
            <div className="pf__stat-val pf__stat-val--blocked">{blocked}</div>
            <div className="pf__stat-label">calls blocked</div>
          </div>
          <div className="pf__stat">
            <div className="pf__stat-val">{ESCAPE_TESTS}</div>
            <div className="pf__stat-label">
              worker-escape tests ({TESTS_TOTAL} total)
            </div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Clear console
        </button>
        <span className="demo__hint">
          direct calls never reach the host; routed calls need a grant in scope
        </span>
      </div>
    </div>
  );
}
