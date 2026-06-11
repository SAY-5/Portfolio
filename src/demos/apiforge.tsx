import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './apiforge.css';

// Real numbers from the project. The breaking-change classifier flags removed
// paths, removed 2xx responses, and new or newly-required parameters as
// breaking, while added paths and removed optional params are not. Five default
// lint rules ship, two of them errors. A severity-weighted gate blocks merge on
// errors and only notifies on warnings.

type ChangeKind = 'removed-path' | 'removed-2xx' | 'new-required' | 'added-path' | 'removed-optional';

type Change = {
  id: string;
  method: string;
  path: string;
  detail: string;
  kind: ChangeKind;
  breaking: boolean;
};

const ease = [0.22, 1, 0.36, 1] as const;

const CHANGES: Change[] = [
  {
    id: 'c1',
    method: 'GET',
    path: '/v1/orders',
    detail: 'response 200 removed',
    kind: 'removed-2xx',
    breaking: true,
  },
  {
    id: 'c2',
    method: 'POST',
    path: '/v1/orders',
    detail: 'new required param customer_id',
    kind: 'new-required',
    breaking: true,
  },
  {
    id: 'c3',
    method: 'DELETE',
    path: '/v1/carts/{id}',
    detail: 'path removed',
    kind: 'removed-path',
    breaking: true,
  },
  {
    id: 'c4',
    method: 'GET',
    path: '/v1/shipments',
    detail: 'path added',
    kind: 'added-path',
    breaking: false,
  },
  {
    id: 'c5',
    method: 'GET',
    path: '/v1/orders/{id}',
    detail: 'optional param fields removed',
    kind: 'removed-optional',
    breaking: false,
  },
];

// Severity-tagged lint findings streamed into the gate. The two errors map to
// real default rules; the operation-id-present rule is a warning.
type Severity = 'error' | 'warn';
type Finding = {
  id: string;
  rule: string;
  severity: Severity;
  where: string;
};

const FINDINGS: Finding[] = [
  { id: 'f1', rule: 'path-lowercase-kebab', severity: 'error', where: '/v1/Carts/{id}' },
  { id: 'f2', rule: 'success-response-required', severity: 'error', where: 'GET /v1/orders' },
  { id: 'f3', rule: 'operation-id-present', severity: 'warn', where: 'POST /v1/orders' },
];

const KIND_LABEL: Record<ChangeKind, string> = {
  'removed-path': 'removed path',
  'removed-2xx': 'removed 2xx',
  'new-required': 'new required param',
  'added-path': 'added path',
  'removed-optional': 'removed optional param',
};

export default function ApiforgeDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(0); // how many changes are classified
  const [findingsIn, setFindingsIn] = useState(0); // how many findings streamed in
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setRevealed(0);
    setFindingsIn(0);
    setDone(false);
  }

  function run() {
    if (running) return;
    clearTimers();
    setRevealed(0);
    setFindingsIn(0);
    setDone(false);
    setRunning(true);

    if (reduce) {
      setRevealed(CHANGES.length);
      setFindingsIn(FINDINGS.length);
      setRunning(false);
      setDone(true);
      return;
    }

    const step = 360;
    CHANGES.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => setRevealed(i + 1), step * (i + 1)),
      );
    });
    const afterChanges = step * (CHANGES.length + 1);
    FINDINGS.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => setFindingsIn(i + 1), afterChanges + step * i),
      );
    });
    timers.current.push(
      window.setTimeout(
        () => {
          setRunning(false);
          setDone(true);
        },
        afterChanges + step * FINDINGS.length + 200,
      ),
    );
  }

  const breakingCount = CHANGES.slice(0, revealed).filter((c) => c.breaking).length;
  const errorCount = FINDINGS.slice(0, findingsIn).filter((f) => f.severity === 'error').length;
  const warnCount = FINDINGS.slice(0, findingsIn).filter((f) => f.severity === 'warn').length;
  // The severity-weighted gate blocks on any error or any breaking change.
  const blocked = done && (errorCount > 0 || breakingCount > 0);

  return (
    <div className="demo" aria-label="apiforge spec diff demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Diff two specs, gate the merge</h3>
      <p className="demo__lede">
        Run the diff to compare v1 against v2. Each endpoint change is classified
        as breaking or safe, then the linter streams severity-tagged findings
        into a merge gate that blocks on errors and only notifies on warnings.
      </p>

      <div className="af__stage">
        <div className="af__diff">
          <div className="af__diff-head">
            <span className="af__spec af__spec--old">orders-api v1.0</span>
            <span className="af__arrow" aria-hidden="true">to</span>
            <span className="af__spec af__spec--new">orders-api v2.0</span>
          </div>
          <ul className="af__changes">
            {CHANGES.map((c, i) => {
              const shown = i < revealed;
              return (
                <li
                  key={c.id}
                  className={
                    'af__change' +
                    (shown ? (c.breaking ? ' af__change--break' : ' af__change--safe') : '')
                  }
                >
                  <span className="af__method" data-m={c.method}>
                    {c.method}
                  </span>
                  <span className="af__path">{c.path}</span>
                  <span className="af__detail">{c.detail}</span>
                  <span className="af__flag" aria-hidden={!shown}>
                    <AnimatePresence>
                      {shown && (
                        <motion.span
                          key="flag"
                          className={
                            'af__flag-pill ' +
                            (c.breaking ? 'af__flag-pill--break' : 'af__flag-pill--safe')
                          }
                          initial={{ opacity: 0, scale: reduce ? 1 : 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: reduce ? 0 : 0.3, ease }}
                        >
                          {c.breaking ? 'breaking' : 'safe'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <span className="af__kind">{shown ? KIND_LABEL[c.kind] : ''}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="af__side">
          <div className="af__lint">
            <div className="af__lint-head">
              <span>lint stream</span>
              <span className="af__lint-count">
                {errorCount} err / {warnCount} warn
              </span>
            </div>
            <ul className="af__lint-list">
              {FINDINGS.length === 0 ? null : findingsIn === 0 ? (
                <li className="af__lint-empty">no findings yet</li>
              ) : (
                FINDINGS.slice(0, findingsIn).map((f) => (
                  <motion.li
                    key={f.id}
                    className={'af__finding af__finding--' + f.severity}
                    initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.28, ease }}
                  >
                    <span className="af__sev">{f.severity}</span>
                    <span className="af__rule">{f.rule}</span>
                    <span className="af__where">{f.where}</span>
                  </motion.li>
                ))
              )}
            </ul>
          </div>

          <div
            className={
              'af__gate' +
              (done ? (blocked ? ' af__gate--blocked' : ' af__gate--pass') : '')
            }
            role="status"
            aria-live="polite"
          >
            <div className="af__gate-label">merge gate</div>
            <div className="af__gate-state">
              {!done
                ? running
                  ? 'evaluating'
                  : 'idle'
                : blocked
                  ? 'blocked'
                  : 'allowed'}
            </div>
            <div className="af__gate-meta">
              {done
                ? `${breakingCount} breaking, ${errorCount} error, ${warnCount} warning`
                : 'errors block, warnings notify'}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            key="verdict"
            className="af__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="af__verdict-head">
              {breakingCount} breaking changes, merge {blocked ? 'blocked' : 'allowed'}
            </span>
            <span className="af__verdict-text">
              Removed paths, removed 2xx responses, and new or newly-required
              params count as breaking; added paths and removed optional params
              do not. The same severity-weighted gate runs across 15 Go tests in
              the spec, lint, diff, and mock packages and catches 30+ contract
              violations before production.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running diff...' : 'Run diff'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">5 lint rules, 2 errors and 3 warnings</span>
      </div>
    </div>
  );
}
