import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './live-events-spa.css';
import {
  removeFromAgenda,
  resetAll,
  schedule,
  toggleAgenda,
  useAgendaIds,
} from './live-events-spa/store';
import {
  agendaSessions,
  conflictingIds,
  filterSessions,
  findConflicts,
  formatMin,
  formatRange,
  groupByTrack,
  nowNext,
  tagsOf,
  tracksOf,
} from './live-events-spa/engine';
import type { PlacedSession, ScheduleFilter } from './live-events-spa/types';

// In-browser conference scheduler. The full schedule is a fixed seed; the only
// persisted, mutable state is a personal agenda of saved session ids kept in
// localStorage. Everything else, filtering, grouping by track, conflict
// detection, and the now/next strip, runs through the pure engine so render
// stays deterministic with no Date.now in the render path. The current minute
// is held in component state and driven by an explicit control rather than the
// live clock, which keeps the view a pure function of its inputs.

type View = 'schedule' | 'agenda';

// Stable per-track accent assignment so a track keeps the same colour across
// the timeline and the agenda. Indexes wrap if more tracks are ever added.
const TRACK_ACCENTS = [
  'var(--accent)',
  'var(--magenta)',
  '#ffcf5c',
  '#3ddc91',
] as const;

function useTrackColor(): (track: string) => string {
  const order = useMemo(() => tracksOf(schedule), []);
  return (track: string) => {
    const i = order.indexOf(track);
    return TRACK_ACCENTS[(i < 0 ? 0 : i) % TRACK_ACCENTS.length];
  };
}

export default function LiveEventsSpaDemo() {
  const reduce = useReducedMotion();
  const savedIds = useAgendaIds();
  const [view, setView] = useState<View>('schedule');
  const [filter, setFilter] = useState<ScheduleFilter>({
    query: '',
    track: 'all',
    tag: 'all',
  });
  // The current minute is owned by the component and moved by an explicit
  // control, so render never reads the wall clock. Defaults to mid-morning so
  // the now/next strip has something live on first paint.
  const [nowMin, setNowMin] = useState(615);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const trackColor = useTrackColor();
  const tracks = useMemo(() => tracksOf(schedule), []);
  const tags = useMemo(() => tagsOf(schedule), []);

  const visible = useMemo(() => filterSessions(schedule, filter), [filter]);
  const groups = useMemo(() => groupByTrack(visible), [visible]);
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);

  const agenda = useMemo(
    () => agendaSessions(schedule, savedIds),
    [savedIds],
  );
  const conflictSet = useMemo(() => conflictingIds(agenda), [agenda]);
  const conflicts = useMemo(() => findConflicts(agenda), [agenda]);

  const nn = useMemo(() => nowNext(schedule, nowMin), [nowMin]);
  const selected = useMemo(
    () => schedule.find((s) => s.id === selectedId) ?? null,
    [selectedId],
  );

  function handleReset() {
    resetAll();
    setSelectedId(null);
  }

  return (
    <div className="demo les" data-reduce={reduce ? 'true' : 'false'}>
      <span className="demo__tag">Conference Scheduler</span>
      <h3 className="demo__title">Live Events</h3>
      <p className="demo__lede">
        Browse the conference schedule by track, search and filter sessions,
        then build a personal agenda. Saved sessions persist in your browser and
        are checked for time conflicts.
      </p>

      <NowNextStrip
        nowMin={nowMin}
        current={nn.current}
        next={nn.next}
        onTimeChange={setNowMin}
        onPick={setSelectedId}
      />

      <div className="les__tabs" role="tablist" aria-label="Scheduler views">
        <button
          type="button"
          role="tab"
          id="les-tab-schedule"
          aria-selected={view === 'schedule'}
          aria-controls="les-panel-schedule"
          className={`les__tab${view === 'schedule' ? ' les__tab--on' : ''}`}
          onClick={() => setView('schedule')}
        >
          Schedule
        </button>
        <button
          type="button"
          role="tab"
          id="les-tab-agenda"
          aria-selected={view === 'agenda'}
          aria-controls="les-panel-agenda"
          className={`les__tab${view === 'agenda' ? ' les__tab--on' : ''}`}
          onClick={() => setView('agenda')}
        >
          My Agenda
          {savedIds.length > 0 && (
            <span className="les__badge" aria-hidden="true">
              {savedIds.length}
            </span>
          )}
        </button>
      </div>

      {view === 'schedule' && (
        <section
          id="les-panel-schedule"
          role="tabpanel"
          aria-labelledby="les-tab-schedule"
          className="les__panel"
        >
          <ScheduleFilters
            filter={filter}
            tracks={tracks}
            tags={tags}
            onChange={setFilter}
            resultCount={visible.length}
          />
          <ScheduleTimeline
            groups={groups}
            savedSet={savedSet}
            trackColor={trackColor}
            onOpen={setSelectedId}
          />
        </section>
      )}

      {view === 'agenda' && (
        <section
          id="les-panel-agenda"
          role="tabpanel"
          aria-labelledby="les-tab-agenda"
          className="les__panel"
        >
          <AgendaView
            agenda={agenda}
            conflictSet={conflictSet}
            conflictCount={conflicts.length}
            trackColor={trackColor}
            onOpen={setSelectedId}
          />
        </section>
      )}

      {selected && (
        <SessionDetail
          session={selected}
          saved={savedSet.has(selected.id)}
          accent={trackColor(selected.track)}
          onClose={() => setSelectedId(null)}
        />
      )}

      <div className="les__footer">
        <button type="button" className="les__reset" onClick={handleReset}>
          Reset saved agenda
        </button>
        <span className="les__hint">
          Saved sessions and the agenda are stored in this browser only.
        </span>
      </div>
    </div>
  );
}

function NowNextStrip({
  nowMin,
  current,
  next,
  onTimeChange,
  onPick,
}: {
  nowMin: number;
  current: PlacedSession[];
  next: PlacedSession | null;
  onTimeChange: (min: number) => void;
  onPick: (id: string) => void;
}) {
  return (
    <div className="les__now glass">
      <div className="les__nowclock">
        <label htmlFor="les-clock" className="les__label">
          Current time
        </label>
        <div className="les__nowrow">
          <input
            id="les-clock"
            type="range"
            className="les__range"
            min={480}
            max={1020}
            step={15}
            value={nowMin}
            onChange={(e) => onTimeChange(Number(e.target.value))}
            aria-valuetext={formatMin(nowMin)}
          />
          <output className="les__clockval" htmlFor="les-clock">
            {formatMin(nowMin)}
          </output>
        </div>
      </div>
      <div className="les__nowcols" aria-live="polite">
        <div className="les__nowcell">
          <p className="les__nowlabel">Now</p>
          {current.length === 0 ? (
            <p className="les__nowempty">Nothing scheduled</p>
          ) : (
            <ul className="les__nowlist">
              {current.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="les__nowlink"
                    onClick={() => onPick(s.id)}
                  >
                    {s.title}
                    <span className="les__nowmeta"> · {s.room}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="les__nowcell">
          <p className="les__nowlabel">Up next</p>
          {next ? (
            <button
              type="button"
              className="les__nowlink"
              onClick={() => onPick(next.id)}
            >
              {next.title}
              <span className="les__nowmeta">
                {' '}
                · {formatMin(next.startMin)}
              </span>
            </button>
          ) : (
            <p className="les__nowempty">Nothing later today</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionDetail({
  session,
  saved,
  accent,
  onClose,
}: {
  session: PlacedSession | (typeof schedule)[number];
  saved: boolean;
  accent: string;
  onClose: () => void;
}) {
  // Move focus to the detail region when it opens so keyboard users are taken
  // straight to the newly revealed content.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [session.id]);
  const placed = 'endMin' in session ? session : null;
  const range = placed
    ? formatRange(placed)
    : `${formatMin(session.startMin)} to ${formatMin(
        session.startMin + session.durationMin,
      )}`;
  return (
    <div
      className="les__detail glass"
      role="region"
      tabIndex={-1}
      ref={ref}
      aria-label={`Session details: ${session.title}`}
      style={{ borderTopColor: accent }}
    >
      <div className="les__detailhead">
        <p className="les__time">{range}</p>
        <button
          type="button"
          className="les__close"
          onClick={onClose}
          aria-label="Close session details"
        >
          Close
        </button>
      </div>
      <h4 className="les__detailtitle">{session.title}</h4>
      <p className="les__cmeta">
        {session.track} · {session.speaker} · {session.room}
      </p>
      <p className="les__abstract">{session.abstract}</p>
      <ul className="les__tags" aria-label="Tags">
        {session.tags.map((t) => (
          <li className="les__pill" key={t}>
            {t}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`les__add${saved ? ' les__add--on' : ''}`}
        aria-pressed={saved}
        onClick={() => toggleAgenda(session.id)}
      >
        {saved ? 'In my agenda' : 'Add to agenda'}
      </button>
    </div>
  );
}

function AgendaView({
  agenda,
  conflictSet,
  conflictCount,
  trackColor,
  onOpen,
}: {
  agenda: PlacedSession[];
  conflictSet: Set<string>;
  conflictCount: number;
  trackColor: (track: string) => string;
  onOpen: (id: string) => void;
}) {
  if (agenda.length === 0) {
    return (
      <p className="les__empty" role="status">
        Your agenda is empty. Add sessions from the schedule to build it.
      </p>
    );
  }
  return (
    <div className="les__agenda">
      {conflictCount > 0 ? (
        <p className="les__warn" role="alert">
          {conflictCount} time conflict{conflictCount === 1 ? '' : 's'} in your
          agenda. Overlapping sessions are flagged below.
        </p>
      ) : (
        <p className="les__ok" role="status">
          No conflicts. Every saved session fits without overlap.
        </p>
      )}
      <ol className="les__agendalist">
        {agenda.map((s) => (
          <li key={s.id}>
            <AgendaRow
              session={s}
              conflicted={conflictSet.has(s.id)}
              accent={trackColor(s.track)}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function AgendaRow({
  session,
  conflicted,
  accent,
  onOpen,
}: {
  session: PlacedSession;
  conflicted: boolean;
  accent: string;
  onOpen: (id: string) => void;
}) {
  return (
    <article
      className={`les__row glass${conflicted ? ' les__row--clash' : ''}`}
      style={{ borderLeftColor: conflicted ? 'var(--magenta)' : accent }}
    >
      <div className="les__rowmain">
        <p className="les__time">{formatRange(session)}</p>
        <h5 className="les__cardtitle">
          <button
            type="button"
            className="les__titlebtn"
            onClick={() => onOpen(session.id)}
          >
            {session.title}
          </button>
        </h5>
        <p className="les__cmeta">
          {session.track} · {session.speaker} · {session.room}
        </p>
        {conflicted && (
          <p className="les__clashtag">Overlaps another saved session</p>
        )}
      </div>
      <button
        type="button"
        className="les__remove"
        onClick={() => removeFromAgenda(session.id)}
      >
        Remove
        <span className="les__sr"> {session.title} from agenda</span>
      </button>
    </article>
  );
}

function ScheduleFilters({
  filter,
  tracks,
  tags,
  onChange,
  resultCount,
}: {
  filter: ScheduleFilter;
  tracks: string[];
  tags: string[];
  onChange: (f: ScheduleFilter) => void;
  resultCount: number;
}) {
  return (
    <div className="les__filters glass">
      <div className="les__field">
        <label htmlFor="les-search" className="les__label">
          Search
        </label>
        <input
          id="les-search"
          type="search"
          className="les__input"
          placeholder="title, speaker, room, tag"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
        />
      </div>
      <div className="les__field">
        <label htmlFor="les-track" className="les__label">
          Track
        </label>
        <select
          id="les-track"
          className="les__select"
          value={filter.track}
          onChange={(e) =>
            onChange({
              ...filter,
              track: e.target.value as ScheduleFilter['track'],
            })
          }
        >
          <option value="all">All tracks</option>
          {tracks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="les__field">
        <label htmlFor="les-tag" className="les__label">
          Tag
        </label>
        <select
          id="les-tag"
          className="les__select"
          value={filter.tag}
          onChange={(e) =>
            onChange({
              ...filter,
              tag: e.target.value as ScheduleFilter['tag'],
            })
          }
        >
          <option value="all">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <p className="les__count" aria-live="polite">
        {resultCount} session{resultCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function ScheduleTimeline({
  groups,
  savedSet,
  trackColor,
  onOpen,
}: {
  groups: { track: string; sessions: PlacedSession[] }[];
  savedSet: Set<string>;
  trackColor: (track: string) => string;
  onOpen: (id: string) => void;
}) {
  const hasResults = groups.some((g) => g.sessions.length > 0);
  if (!hasResults) {
    return (
      <p className="les__empty" role="status">
        No sessions match these filters.
      </p>
    );
  }
  return (
    <div className="les__grid">
      {groups.map((g) => (
        <div className="les__col" key={g.track}>
          <h4 className="les__coltitle" style={{ color: trackColor(g.track) }}>
            {g.track}
          </h4>
          <ul className="les__list">
            {g.sessions.map((s) => (
              <li key={s.id}>
                <SessionCard
                  session={s}
                  saved={savedSet.has(s.id)}
                  accent={trackColor(s.track)}
                  onOpen={onOpen}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SessionCard({
  session,
  saved,
  accent,
  onOpen,
}: {
  session: PlacedSession;
  saved: boolean;
  accent: string;
  onOpen: (id: string) => void;
}) {
  return (
    <article className="les__card glass" style={{ borderLeftColor: accent }}>
      <p className="les__time">{formatRange(session)}</p>
      <h5 className="les__cardtitle">
        <button
          type="button"
          className="les__titlebtn"
          onClick={() => onOpen(session.id)}
        >
          {session.title}
        </button>
      </h5>
      <p className="les__cmeta">
        {session.speaker} · {session.room}
      </p>
      <ul className="les__tags" aria-label="Tags">
        {session.tags.map((t) => (
          <li className="les__pill" key={t}>
            {t}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`les__add${saved ? ' les__add--on' : ''}`}
        aria-pressed={saved}
        onClick={() => toggleAgenda(session.id)}
      >
        {saved ? 'In my agenda' : 'Add to agenda'}
      </button>
    </article>
  );
}
