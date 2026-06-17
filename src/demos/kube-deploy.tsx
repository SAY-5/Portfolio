import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './kube-deploy.css';
import { useSim } from './kube-deploy/state';
import {
  pause,
  reset,
  resume,
  rollback,
  setDesired,
  setFailureRate,
  setStrategy,
  startRollout,
  tick,
} from './kube-deploy/store';
import { availableCount, updatedCount } from './kube-deploy/engine';
import type { Pod, RolloutEvent, RolloutStatus } from './kube-deploy/types';

// In-browser rolling-deployment simulator. A deployment of N replicas runs a
// current image version; starting a rollout to a new version drives pods over
// tick by tick, honouring maxSurge (extra pods allowed) and maxUnavailable
// (available floor). New-version pods fail their readiness probe at the
// configured rate, and the rollout pauses when failures cross the threshold so
// you can resume or roll back to the previous version. Everything is
// deterministic for the seeded PRNG, persists in localStorage, and reads no
// clock, so a reload resumes the exact same rollout.

const STATUS_LABEL: Record<RolloutStatus, string> = {
  idle: 'Idle',
  progressing: 'Progressing',
  paused: 'Paused',
  complete: 'Complete',
  'rolled-back': 'Rolled back',
};

function describeEvent(e: RolloutEvent): string {
  switch (e.kind) {
    case 'started':
      return `Rollout started: ${e.from} to ${e.to}`;
    case 'pod-created':
      return `Pod ${e.podId} created (${e.version})`;
    case 'pod-ready':
      return `Pod ${e.podId} ready (${e.version})`;
    case 'pod-failed':
      return `Pod ${e.podId} failed probe (${e.version})`;
    case 'pod-terminating':
      return `Pod ${e.podId} terminating (${e.version})`;
    case 'paused':
      return `Rollout paused after ${e.failures} failures`;
    case 'resumed':
      return 'Rollout resumed';
    case 'rolled-back':
      return `Rolled back to ${e.to}`;
    case 'complete':
      return `Rollout complete: ${e.version}`;
  }
}

function eventTone(e: RolloutEvent): string {
  if (e.kind === 'pod-failed' || e.kind === 'paused') return 'kd-ev--fail';
  if (e.kind === 'pod-ready' || e.kind === 'complete') return 'kd-ev--ok';
  if (e.kind === 'rolled-back') return 'kd-ev--warn';
  return '';
}

export default function KubeDeployDemo() {
  const sim = useSim();
  const reduce = useReducedMotion();
  const { deployment, rollout, pods, history, events } = sim;

  // Draft version field for the rollout target, defaulting to the next version.
  const [targetDraft, setTargetDraft] = useState('v2');

  const target = rollout.targetVersion ?? deployment.currentVersion;
  const available = availableCount(pods);
  const updated = updatedCount(pods, target);
  const minAvailable = Math.max(
    0,
    deployment.desired - deployment.strategy.maxUnavailable,
  );
  const ceiling = deployment.desired + deployment.strategy.maxSurge;

  const progressing = rollout.status === 'progressing';
  const paused = rollout.status === 'paused';
  const inFlight = progressing || paused;

  // Whether the available floor was ever violated across recorded history.
  const floorHonoured = useMemo(
    () => history.every((h) => h.tick === 0 || h.available >= minAvailable),
    [history, minAvailable],
  );

  const ratePct = Math.round(deployment.newVersionFailureRate * 100);

  return (
    <div
      className="demo kd"
      aria-label="kube-deploy rolling deployment simulator"
    >
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Roll out a new version, tick by tick</h3>
      <p className="demo__lede">
        Configure a deployment, then roll a new image version across its replicas
        one tick at a time. The simulator honours maxSurge and maxUnavailable,
        brings up new pods that may fail their readiness probe, and pauses the
        rollout when failures cross the threshold so you can resume or roll back.
        Deterministic per seed and saved in your browser.
      </p>

      <DeploymentHeader
        name={deployment.name}
        desired={deployment.desired}
        available={available}
        updated={updated}
        version={deployment.currentVersion}
        target={rollout.targetVersion}
        status={rollout.status}
      />

      <PodGrid
        pods={pods}
        currentVersion={deployment.currentVersion}
        target={rollout.targetVersion}
        reduce={!!reduce}
      />

      <Controls
        desired={deployment.desired}
        strategy={deployment.strategy}
        ratePct={ratePct}
        targetDraft={targetDraft}
        setTargetDraft={setTargetDraft}
        inFlight={inFlight}
        progressing={progressing}
        paused={paused}
      />

      <Insights
        minAvailable={minAvailable}
        ceiling={ceiling}
        floorHonoured={floorHonoured}
        failureCount={rollout.failureCount}
        failureThreshold={rollout.failureThreshold}
        status={rollout.status}
      />

      <Timeline history={history} minAvailable={minAvailable} />

      <EventLog events={events} />
    </div>
  );
}

function DeploymentHeader(props: {
  name: string;
  desired: number;
  available: number;
  updated: number;
  version: string;
  target: string | null;
  status: RolloutStatus;
}) {
  const { name, desired, available, updated, version, target, status } = props;
  return (
    <header className="kd-head glass" aria-label="deployment status">
      <div className="kd-head__id">
        <span className="kd-head__name mono">deploy/{name}</span>
        <span className={`kd-badge kd-badge--${status}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <dl className="kd-head__stats">
        <div className="kd-stat">
          <dt>Desired</dt>
          <dd className="mono">{desired}</dd>
        </div>
        <div className="kd-stat">
          <dt>Available</dt>
          <dd className="mono">{available}</dd>
        </div>
        <div className="kd-stat">
          <dt>Updated</dt>
          <dd className="mono">
            {updated}
            {target ? ` / ${desired}` : ''}
          </dd>
        </div>
        <div className="kd-stat">
          <dt>Version</dt>
          <dd className="mono">
            {version}
            {target && target !== version ? ` to ${target}` : ''}
          </dd>
        </div>
      </dl>
    </header>
  );
}

function PodGrid(props: {
  pods: Pod[];
  currentVersion: string;
  target: string | null;
  reduce: boolean;
}) {
  const { pods, currentVersion, target } = props;
  return (
    <section className="kd-grid-wrap" aria-label="pods">
      <ul className="kd-grid" role="list">
        {pods.map((pod) => {
          const isNew = target
            ? pod.version === target
            : pod.version !== currentVersion;
          const tone = isNew ? 'kd-pod--new' : 'kd-pod--old';
          return (
            <li
              key={pod.id}
              className={`kd-pod ${tone} kd-pod--${pod.status}`}
              title={`${pod.id} | ${pod.version} | ${pod.status}`}
            >
              <span className="kd-pod__ver mono" aria-hidden="true">
                {pod.version}
              </span>
              <span className="kd-pod__status" aria-hidden="true">
                {pod.status}
              </span>
              <span className="kd-pod__sr">
                {pod.id} running {pod.version}, status {pod.status}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Controls(props: {
  desired: number;
  strategy: { maxSurge: number; maxUnavailable: number };
  ratePct: number;
  targetDraft: string;
  setTargetDraft: (v: string) => void;
  inFlight: boolean;
  progressing: boolean;
  paused: boolean;
}) {
  const {
    desired,
    strategy,
    ratePct,
    targetDraft,
    setTargetDraft,
    inFlight,
    progressing,
    paused,
  } = props;

  return (
    <section className="kd-controls glass" aria-label="rollout controls">
      <fieldset className="kd-fields" disabled={inFlight}>
        <legend>Deployment</legend>
        <label className="kd-field">
          <span>Replicas</span>
          <input
            type="number"
            min={1}
            max={12}
            value={desired}
            onChange={(e) => setDesired(Number(e.target.value))}
          />
        </label>
        <label className="kd-field">
          <span>maxSurge</span>
          <input
            type="number"
            min={0}
            max={6}
            value={strategy.maxSurge}
            onChange={(e) => setStrategy({ maxSurge: Number(e.target.value) })}
          />
        </label>
        <label className="kd-field">
          <span>maxUnavailable</span>
          <input
            type="number"
            min={0}
            max={desired}
            value={strategy.maxUnavailable}
            onChange={(e) =>
              setStrategy({ maxUnavailable: Number(e.target.value) })
            }
          />
        </label>
        <label className="kd-field kd-field--wide">
          <span>New-version failure rate: {ratePct}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={ratePct}
            onChange={(e) => setFailureRate(Number(e.target.value) / 100)}
          />
        </label>
      </fieldset>

      <div className="kd-rollout">
        <label className="kd-field">
          <span>Target version</span>
          <input
            type="text"
            value={targetDraft}
            spellCheck={false}
            onChange={(e) => setTargetDraft(e.target.value)}
            disabled={inFlight}
            aria-label="rollout target version"
          />
        </label>
        <div className="kd-actions">
          <button
            type="button"
            className="kd-btn kd-btn--primary"
            onClick={() => startRollout(targetDraft)}
            disabled={inFlight}
          >
            Start rollout
          </button>
          <button
            type="button"
            className="kd-btn"
            onClick={() => tick()}
            disabled={!inFlight}
          >
            Tick
          </button>
          {progressing ? (
            <button type="button" className="kd-btn" onClick={() => pause()}>
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="kd-btn"
              onClick={() => resume()}
              disabled={!paused}
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className="kd-btn kd-btn--warn"
            onClick={() => rollback()}
            disabled={!inFlight}
          >
            Rollback
          </button>
          <button
            type="button"
            className="kd-btn kd-btn--ghost"
            onClick={() => reset()}
          >
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}

function Insights(props: {
  minAvailable: number;
  ceiling: number;
  floorHonoured: boolean;
  failureCount: number;
  failureThreshold: number;
  status: RolloutStatus;
}) {
  const {
    minAvailable,
    ceiling,
    floorHonoured,
    failureCount,
    failureThreshold,
    status,
  } = props;
  return (
    <section className="kd-insights" aria-label="rollout insights">
      <p className="kd-insight">
        <span className="kd-insight__k">Available floor</span>
        <span className="kd-insight__v mono">{minAvailable} pods</span>
      </p>
      <p className="kd-insight">
        <span className="kd-insight__k">Surge ceiling</span>
        <span className="kd-insight__v mono">{ceiling} pods</span>
      </p>
      <p className="kd-insight">
        <span className="kd-insight__k">Failures</span>
        <span className="kd-insight__v mono">
          {failureCount} / {failureThreshold}
        </span>
      </p>
      <p
        className={`kd-insight kd-insight--check ${
          floorHonoured ? 'kd-insight--ok' : 'kd-insight--bad'
        }`}
        role="status"
      >
        <span className="kd-insight__k">maxUnavailable</span>
        <span className="kd-insight__v">
          {floorHonoured ? 'never violated' : 'violated'}
        </span>
      </p>
      {status === 'paused' && (
        <p className="kd-insight kd-insight--note" role="alert">
          Rollout paused: too many new-version pods failed. Resume to retry or
          roll back to the previous version.
        </p>
      )}
    </section>
  );
}

function Timeline(props: {
  history: {
    tick: number;
    available: number;
    updated: number;
    desired: number;
  }[];
  minAvailable: number;
}) {
  const { history, minAvailable } = props;
  const points = history.slice(-40);
  const maxY = Math.max(
    1,
    ...points.map((p) => Math.max(p.desired, p.available)),
  );
  return (
    <section className="kd-timeline glass" aria-label="rollout timeline">
      <h4 className="kd-timeline__title">Available and updated per tick</h4>
      <ol className="kd-bars" role="list">
        {points.map((p) => {
          const availH = Math.round((p.available / maxY) * 100);
          const updH = Math.round((p.updated / maxY) * 100);
          const below = p.available < minAvailable && p.tick > 0;
          return (
            <li className="kd-bar" key={p.tick}>
              <span
                className={`kd-bar__avail ${below ? 'kd-bar__avail--low' : ''}`}
                style={{ height: `${availH}%` }}
              />
              <span className="kd-bar__upd" style={{ height: `${updH}%` }} />
              <span className="kd-bar__sr">
                tick {p.tick}: {p.available} available, {p.updated} updated
              </span>
            </li>
          );
        })}
      </ol>
      <div className="kd-legend" aria-hidden="true">
        <span className="kd-legend__item">
          <i className="kd-swatch kd-swatch--avail" /> available
        </span>
        <span className="kd-legend__item">
          <i className="kd-swatch kd-swatch--upd" /> updated
        </span>
      </div>
    </section>
  );
}

function EventLog(props: { events: RolloutEvent[] }) {
  const recent = props.events.slice(-12).reverse();
  return (
    <section
      className="kd-log glass"
      aria-label="rollout events"
      aria-live="polite"
    >
      <h4 className="kd-log__title">Events</h4>
      {recent.length === 0 ? (
        <p className="kd-log__empty">No events yet. Start a rollout.</p>
      ) : (
        <ul className="kd-log__list" role="list">
          {recent.map((e, i) => (
            <li
              className={`kd-log__row ${eventTone(e)}`}
              key={`${i}-${e.kind}`}
            >
              {describeEvent(e)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
