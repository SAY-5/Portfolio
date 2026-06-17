import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './taskboard.css';
import { COLUMN_LABELS, COLUMN_ORDER, type ColumnId } from './taskboard/data';
import { useStore } from './taskboard/state';
import {
  addCard,
  applyConflictStep,
  deleteCard,
  editCard,
  FANOUT_HIGH,
  FANOUT_LOW,
  FANOUT_QUEUES,
  invariantsHold,
  moveCard,
  planConflict,
  resetBoard,
  type LogLine,
} from './taskboard/store';
import { indexBefore, locate, step, type Dir } from './taskboard/dnd';

// In-browser TaskBoard. The whole board is one optimistic-locked document:
// columns own an ordered list of card ids and each card records its columnId.
// Cards persist in localStorage, so they survive a reload. Adding, editing,
// deleting, and moving a card all bump the document @Version. Concurrent moves
// of the same card race on that version: one save wins, the loser re-reads head
// and rebases, and a monotonic seq is the tie-break for the final column. Two
// invariants hold after any commit: a card id sits in exactly one column's
// cardOrder, and the card's columnId matches the column listing it.

type Draft = { title: string; note: string };
const EMPTY: Draft = { title: '', note: '' };

const ARROW_DIR: Record<string, Dir> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

export default function TaskboardDemo() {
  const state = useStore();
  const reduce = useReducedMotion();
  const { board, log, presence } = state;
  const [composer, setComposer] = useState<ColumnId | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);

  // Pointer drag state.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColumnId | null>(null);
  // Keyboard "grab" state: the card a keyboard user is currently moving.
  const [grabbed, setGrabbed] = useState<string | null>(null);
  // Polite status text for screen readers, announcing grab and move outcomes.
  const [status, setStatus] = useState('');

  // Conflict simulation state.
  const [conflictId, setConflictId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const handles = timers.current;
    return () => handles.forEach((t) => window.clearTimeout(t));
  }, []);

  const total = Object.keys(board.cards).length;
  const ok = invariantsHold(board);

  // Replay a two-user conflict on the chosen card. Each plan step is applied to
  // the live store on its own tick, so the board, log, and presence advance in
  // lockstep with the on-screen timeline. The card settles into exactly one
  // column decided by the seq tie-break.
  function simulateConflict(cardId: string) {
    if (conflictId) return;
    const plan = planConflict(cardId);
    if (!plan) return;
    setConflictId(cardId);
    const gap = reduce ? 0 : 620;
    plan.steps.forEach((s, i) => {
      const handle = window.setTimeout(
        () => {
          applyConflictStep(plan, s);
          if (i === plan.steps.length - 1) setConflictId(null);
        },
        reduce ? 0 : i * gap + 120,
      );
      timers.current.push(handle);
    });
  }

  function onReset() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setConflictId(null);
    resetBoard();
  }

  function openComposer(col: ColumnId) {
    setComposer(col);
    setDraft(EMPTY);
  }

  function submitComposer(col: ColumnId) {
    if (!draft.title.trim()) return;
    addCard(draft.title, draft.note, col);
    setDraft(EMPTY);
    setComposer(null);
  }

  function startEdit(id: string, title: string, note: string) {
    setEditing(id);
    setEditDraft({ title, note });
  }

  function submitEdit(id: string) {
    if (!editDraft.title.trim()) return;
    editCard(id, editDraft.title, editDraft.note);
    setEditing(null);
  }

  // ---------- pointer drag ----------
  function onDragStart(id: string) {
    setDragId(id);
    setGrabbed(null);
  }
  function onDragEnd() {
    setDragId(null);
    setOverCol(null);
  }
  function onDropBefore(column: ColumnId, beforeCardId: string | null) {
    if (!dragId) return;
    const index = indexBefore(board, column, beforeCardId);
    moveCard(dragId, column, index);
    onDragEnd();
  }

  // ---------- keyboard moves ----------
  // Space/Enter toggles grab. While grabbed, arrow keys move the card one step
  // and commit immediately, so the board reflects each press; Escape releases.
  function onCardKeyDown(e: React.KeyboardEvent, id: string) {
    const card = board.cards[id];
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setGrabbed((g) => {
        const next = g === id ? null : id;
        setStatus(
          next
            ? `Grabbed ${card?.title ?? id}. Use arrow keys to move.`
            : `Dropped ${card?.title ?? id}.`,
        );
        return next;
      });
      return;
    }
    if (e.key === 'Escape') {
      if (grabbed === id) setStatus(`Move cancelled for ${card?.title ?? id}.`);
      setGrabbed(null);
      return;
    }
    if (grabbed === id && ARROW_DIR[e.key]) {
      e.preventDefault();
      const target = step(board, id, ARROW_DIR[e.key]);
      if (target) {
        moveCard(id, target.column, target.index);
        setStatus(
          `${card?.title ?? id} moved to ${COLUMN_LABELS[target.column]}, position ${target.index + 1}.`,
        );
      } else {
        setStatus('Cannot move further in that direction.');
      }
    }
  }

  return (
    <div className="demo" aria-label="TaskBoard application">
      <span className="demo__tag">Interactive app</span>
      <h3 className="demo__title">TaskBoard</h3>
      <p className="demo__lede">
        A working Kanban board that runs fully in the browser. Add, edit,
        delete, and drag cards across three columns. The board is one
        optimistic-locked document and every change persists in localStorage, so
        it survives a reload. Keyboard users can grab a card with Space and move
        it with the arrow keys.
      </p>

      <div className="tbk">
        <div className="tbk__sr" role="status" aria-live="polite">
          {status}
        </div>
        <div className="tbk__bar">
          <span className="tbk__bar-meta" aria-live="polite">
            board @Version {board.version}
          </span>
          <span className="tbk__bar-meta">{total} cards</span>
          <span
            className={`tbk__inv ${ok ? 'tbk__inv--ok' : 'tbk__inv--bad'}`}
            aria-live="polite"
          >
            {ok ? 'invariants hold' : 'invariant broken'}
          </span>
        </div>

        <div className="tbk__board">
          {COLUMN_ORDER.map((colId) => {
            const col = board.columns.find((c) => c.id === colId);
            if (!col) return null;
            const isOver = overCol === col.id && dragId !== null;
            return (
              <section
                key={col.id}
                className={`tbk__col ${isOver ? 'tbk__col--over' : ''}`}
                aria-label={`${col.label} column`}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault();
                    setOverCol(col.id);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropBefore(col.id, null);
                }}
              >
                <header className="tbk__col-head">
                  <h4 className="tbk__col-name">{col.label}</h4>
                  <span className="tbk__col-count" aria-label="card count">
                    {col.cardOrder.length}
                  </span>
                </header>

                <ul className="tbk__list">
                  {col.cardOrder.map((cardId) => {
                    const card = board.cards[cardId];
                    if (!card) return null;
                    if (editing === card.id) {
                      return (
                        <li key={card.id} className="tbk__card tbk__card--edit">
                          <CardForm
                            draft={editDraft}
                            setDraft={setEditDraft}
                            onSubmit={() => submitEdit(card.id)}
                            onCancel={() => setEditing(null)}
                            submitLabel="Save"
                          />
                        </li>
                      );
                    }
                    const where = locate(board, card.id);
                    const posLabel = where
                      ? `${col.label}, position ${where.index + 1} of ${col.cardOrder.length}`
                      : col.label;
                    return (
                      <li
                        key={card.id}
                        className={`tbk__card ${dragId === card.id ? 'tbk__card--drag' : ''} ${grabbed === card.id ? 'tbk__card--grab' : ''}`}
                        draggable
                        tabIndex={0}
                        aria-roledescription="Draggable card"
                        data-grabbed={grabbed === card.id}
                        aria-label={`${card.title}. ${posLabel}. ${grabbed === card.id ? 'Grabbed. Arrow keys move it, Space drops, Escape cancels.' : 'Press Space to grab and move with arrow keys.'}`}
                        onDragStart={() => onDragStart(card.id)}
                        onDragEnd={onDragEnd}
                        onDragOver={(e) => {
                          if (dragId && dragId !== card.id) {
                            e.preventDefault();
                            setOverCol(col.id);
                          }
                        }}
                        onDrop={(e) => {
                          if (dragId && dragId !== card.id) {
                            e.preventDefault();
                            e.stopPropagation();
                            onDropBefore(col.id, card.id);
                          }
                        }}
                        onKeyDown={(e) => onCardKeyDown(e, card.id)}
                      >
                        <div className="tbk__card-main">
                          <span className="tbk__card-id">{card.id}</span>
                          <span className="tbk__card-title">{card.title}</span>
                          {card.note && (
                            <span className="tbk__card-note">{card.note}</span>
                          )}
                        </div>
                        <div className="tbk__card-actions">
                          <span className="tbk__card-grip" aria-hidden="true">
                            ⠿ drag
                          </span>
                          <button
                            type="button"
                            className="tbk__icon"
                            onClick={() =>
                              startEdit(card.id, card.title, card.note)
                            }
                            aria-label={`Edit ${card.title}`}
                          >
                            edit
                          </button>
                          <button
                            type="button"
                            className="tbk__icon tbk__icon--danger"
                            onClick={() => deleteCard(card.id)}
                            aria-label={`Delete ${card.title}`}
                          >
                            delete
                          </button>
                          <button
                            type="button"
                            className="tbk__icon tbk__icon--sim"
                            onClick={() => simulateConflict(card.id)}
                            disabled={conflictId !== null}
                            aria-label={`Simulate a second user moving ${card.title}`}
                          >
                            conflict
                          </button>
                        </div>
                      </li>
                    );
                  })}
                  {col.cardOrder.length === 0 && (
                    <li className="tbk__empty">Drop a card here</li>
                  )}
                </ul>

                {composer === col.id ? (
                  <div className="tbk__composer">
                    <CardForm
                      draft={draft}
                      setDraft={setDraft}
                      onSubmit={() => submitComposer(col.id)}
                      onCancel={() => setComposer(null)}
                      submitLabel="Add card"
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="tbk__add"
                    onClick={() => openComposer(col.id)}
                  >
                    + Add card
                  </button>
                )}
              </section>
            );
          })}
        </div>

        <div className="tbk__panel">
          <div className="tbk__presence" aria-label="Presence">
            <span
              className="tbk__avatar tbk__avatar--you"
              data-on="true"
              aria-hidden="true"
            >
              U
            </span>
            <span
              className={`tbk__avatar tbk__avatar--mate ${presence.mate ? '' : 'tbk__avatar--off'}`}
              data-on={presence.mate}
              aria-hidden="true"
            >
              M
            </span>
            <span className="tbk__presence-label" aria-live="polite">
              {presence.mate
                ? 'You and a second user are editing'
                : 'You are editing'}
            </span>
            <button
              type="button"
              className="tbk__btn tbk__btn--ghost tbk__reset"
              onClick={onReset}
            >
              Reset and seed
            </button>
          </div>

          <div
            className="tbk__feed"
            aria-label="Activity feed"
            aria-live="polite"
          >
            <div className="tbk__feed-head">Activity</div>
            <ul className="tbk__feed-list">
              {log.length === 0 && (
                <li className="tbk__feed-empty">
                  No activity yet. Add a card or run a conflict.
                </li>
              )}
              {[...log].reverse().map((l: LogLine) => (
                <li
                  key={l.id}
                  className={`tbk__feed-line tbk__feed-line--${l.who}`}
                >
                  <span className="tbk__feed-who">
                    {l.who === 'sys'
                      ? 'sys'
                      : l.who === 'mate'
                        ? 'user 2'
                        : 'you'}
                  </span>
                  <span className="tbk__feed-text">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="tbk__stat">
            <span className="tbk__stat-val">
              {FANOUT_LOW.toLocaleString()} to {FANOUT_HIGH.toLocaleString()}
            </span>
            <span className="tbk__stat-unit">
              moves per second fanned out to {FANOUT_QUEUES} subscriber queues
            </span>
          </div>

          <p className="tbk__hint">
            Use the conflict button on any card to replay two users moving it at
            once: one save wins and bumps the @Version, the loser re-reads head
            and rebases, and the higher seq is the tie-break. The card settles
            in exactly one column. Targets are{' '}
            {COLUMN_ORDER.map((id) => COLUMN_LABELS[id]).join(', ')}.
          </p>
        </div>
      </div>
    </div>
  );
}

type CardFormProps = {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  autoFocus?: boolean;
};

function CardForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  submitLabel,
  autoFocus,
}: CardFormProps) {
  return (
    <form
      className="tbk__form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        className="tbk__input"
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder="Card title"
        aria-label="Card title"
        autoFocus={autoFocus}
      />
      <input
        className="tbk__input"
        value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        placeholder="Note (optional)"
        aria-label="Card note"
      />
      <div className="tbk__form-actions">
        <button
          type="submit"
          className="tbk__btn"
          disabled={!draft.title.trim()}
        >
          {submitLabel}
        </button>
        <button
          type="button"
          className="tbk__btn tbk__btn--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
