import { useState } from 'react';
import '../styles/demo.css';
import './pagerunner.css';
import {
  currentTier,
  onCallResponderAt,
  upcomingShifts,
} from './pagerunner/engine';
import {
  acknowledgeIncident,
  addTier,
  advanceClock,
  removeTier,
  resetAll,
  resolveIncident,
  resolveTarget,
  responderName,
  setNow,
  setTierTarget,
  setTierTimeout,
  triggerIncident,
  useStore,
  type State,
} from './pagerunner/store';
import { MINUTES_PER_WEEK } from './pagerunner/types';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Format an absolute clock minute as a readable day + HH:MM within its week.
function fmtClock(absolute: number): string {
  const m = ((absolute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  const week = Math.floor(absolute / MINUTES_PER_WEEK) + 1;
  const day = DAY[Math.floor(m / (24 * 60))];
  const hh = Math.floor((m % (24 * 60)) / 60);
  const mm = m % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `W${week} ${day} ${pad(hh)}:${pad(mm)}`;
}

function statusLabel(status: State['incidents'][number]['status']): string {
  if (status === 'triggered') return 'Triggered';
  if (status === 'acked') return 'Acknowledged';
  return 'Resolved';
}

export default function PagerunnerDemo() {
  const s = useStore();
  const [title, setTitle] = useState('');

  const onCallId = onCallResponderAt(s.rotation, s.nowMinute);
  const shifts = upcomingShifts(s.rotation, s.nowMinute, 4);

  return (
    <div className="demo">
      <span className="demo__tag">On-call console</span>
      <h3 className="demo__title">PageRunner</h3>
      <p className="demo__lede">
        Define a weekly rotation and an escalation policy, then trigger an
        incident and step the clock forward to watch it page up the tiers until
        someone acknowledges it. Everything runs in your browser against a single
        settable clock, so the run is fully deterministic.
      </p>

      <ClockControl now={s.nowMinute} />

      <div className="pr2__grid">
        <OnCallPanel state={s} onCallId={onCallId} shifts={shifts} />
        <PolicyEditor state={s} />
      </div>

      <IncidentPanel state={s} title={title} setTitle={setTitle} />

      <div className="demo__controls">
        <button type="button" className="demo__btn" onClick={() => resetAll()}>
          Reset all
        </button>
      </div>
    </div>
  );
}

// ---------- clock ----------

function ClockControl({ now }: { now: number }) {
  return (
    <section className="pr2__clock glass" aria-label="Simulation clock">
      <div className="pr2__clock-read">
        <span className="pr2__clock-label">Clock</span>
        <output className="pr2__clock-now">{fmtClock(now)}</output>
        <span className="pr2__clock-min">minute {now}</span>
      </div>
      <div className="pr2__clock-controls">
        <button type="button" className="pr2__step-btn" onClick={() => advanceClock(1)}>
          +1m
        </button>
        <button type="button" className="pr2__step-btn" onClick={() => advanceClock(5)}>
          +5m
        </button>
        <button type="button" className="pr2__step-btn" onClick={() => advanceClock(15)}>
          +15m
        </button>
        <button type="button" className="pr2__step-btn" onClick={() => advanceClock(60)}>
          +1h
        </button>
        <button
          type="button"
          className="pr2__step-btn"
          onClick={() => advanceClock(-5)}
          disabled={now <= 0}
        >
          &minus;5m
        </button>
        <label className="pr2__clock-set">
          <span className="pr2__visually-hidden">Set clock minute</span>
          <input
            type="number"
            min={0}
            value={now}
            onChange={(e) => setNow(Number(e.target.value))}
          />
        </label>
      </div>
    </section>
  );
}

// ---------- on-call ----------

function OnCallPanel({
  state,
  onCallId,
  shifts,
}: {
  state: State;
  onCallId: string | null;
  shifts: { atMinute: number; responderId: string }[];
}) {
  return (
    <section className="pr2__panel glass" aria-labelledby="pr2-oncall-h">
      <h4 className="pr2__panel-h" id="pr2-oncall-h">
        Who is on call now
      </h4>
      <div className="pr2__oncall-card">
        <span className="pr2__oncall-dot" aria-hidden="true" />
        <div>
          <div className="pr2__oncall-name">{responderName(state, onCallId)}</div>
          <div className="pr2__oncall-sub">
            primary rotation, as of {fmtClock(state.nowMinute)}
          </div>
        </div>
      </div>
      <h5 className="pr2__sub-h">Upcoming shifts</h5>
      <ol className="pr2__shifts">
        {shifts.map((shift, i) => (
          <li
            key={shift.atMinute}
            className={`pr2__shift${i === 0 ? ' pr2__shift--cur' : ''}`}
          >
            <span className="pr2__shift-when">{fmtClock(shift.atMinute)}</span>
            <span className="pr2__shift-who">
              {responderName(state, shift.responderId)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- policy editor ----------

function PolicyEditor({ state }: { state: State }) {
  return (
    <section className="pr2__panel glass" aria-labelledby="pr2-policy-h">
      <h4 className="pr2__panel-h" id="pr2-policy-h">
        Escalation policy
      </h4>
      <ol className="pr2__tiers">
        {state.policy.tiers.map((tier, i) => (
          <li key={i} className="pr2__tier">
            <span className="pr2__tier-n" aria-hidden="true">
              {i + 1}
            </span>
            <label className="pr2__field">
              <span className="pr2__field-label">Page</span>
              <select
                value={tier.target}
                onChange={(e) => setTierTarget(i, e.target.value)}
                aria-label={`Tier ${i + 1} responder`}
              >
                <option value="oncall">Current on-call</option>
                {state.responders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="pr2__field">
              <span className="pr2__field-label">Ack timeout (min)</span>
              <input
                type="number"
                min={1}
                value={tier.ackTimeoutMin}
                onChange={(e) => setTierTimeout(i, Number(e.target.value))}
                aria-label={`Tier ${i + 1} ack timeout in minutes`}
              />
            </label>
            <button
              type="button"
              className="pr2__tier-del"
              onClick={() => removeTier(i)}
              disabled={state.policy.tiers.length <= 1}
              aria-label={`Remove tier ${i + 1}`}
            >
              &times;
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="pr2__add" onClick={() => addTier()}>
        + Add tier
      </button>
    </section>
  );
}

// ---------- incidents ----------

function IncidentPanel({
  state,
  title,
  setTitle,
}: {
  state: State;
  title: string;
  setTitle: (v: string) => void;
}) {
  function onTrigger() {
    triggerIncident(title);
    setTitle('');
  }

  return (
    <section className="pr2__panel glass pr2__incidents" aria-labelledby="pr2-inc-h">
      <h4 className="pr2__panel-h" id="pr2-inc-h">
        Incidents
      </h4>
      <div className="pr2__trigger">
        <label className="pr2__field pr2__field--grow">
          <span className="pr2__field-label">New incident title</span>
          <input
            type="text"
            value={title}
            placeholder="API latency spike"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button type="button" className="pr2__trigger-btn" onClick={onTrigger}>
          Trigger incident
        </button>
      </div>

      {state.incidents.length === 0 ? (
        <p className="pr2__empty">No incidents yet. Trigger one to start paging.</p>
      ) : (
        <ul className="pr2__inc-list" aria-live="polite">
          {state.incidents.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} state={state} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentCard({
  incident,
  state,
}: {
  incident: State['incidents'][number];
  state: State;
}) {
  const tier = currentTier(incident, state.policy, state.nowMinute);
  const target = state.policy.tiers[tier]?.target ?? 'oncall';
  const pagedAt =
    incident.status === 'triggered'
      ? state.nowMinute
      : incident.ackedAtMinute ?? state.nowMinute;
  const pagedId = resolveTarget(state, target, pagedAt);
  const live = incident.status === 'triggered';

  return (
    <li className={`pr2__inc pr2__inc--${incident.status}`}>
      <div className="pr2__inc-head">
        <span className="pr2__inc-id">{incident.id}</span>
        <span className="pr2__inc-title">{incident.title}</span>
        <span className={`pr2__badge pr2__badge--${incident.status}`}>
          {statusLabel(incident.status)}
        </span>
      </div>

      {live && (
        <p className="pr2__inc-now" role="status">
          Currently paging <strong>{responderName(state, pagedId)}</strong> at
          tier {tier + 1} of {state.policy.tiers.length}.
        </p>
      )}

      <ol className="pr2__timeline">
        {incident.timeline.map((ev, i) => (
          <li key={i} className={`pr2__ev pr2__ev--${ev.kind}`}>
            <span className="pr2__ev-when">{fmtClock(ev.atMinute)}</span>
            <span className="pr2__ev-note">{ev.note}</span>
          </li>
        ))}
      </ol>

      <div className="pr2__inc-actions">
        <button
          type="button"
          className="pr2__act"
          onClick={() => acknowledgeIncident(incident.id)}
          disabled={incident.status !== 'triggered'}
        >
          Acknowledge
        </button>
        <button
          type="button"
          className="pr2__act"
          onClick={() => resolveIncident(incident.id)}
          disabled={incident.status === 'resolved'}
        >
          Resolve
        </button>
      </div>
    </li>
  );
}
