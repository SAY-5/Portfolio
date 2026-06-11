import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './word-scramble-cli.css';

// Real facts from the project:
// - Terminal word-scramble game: guess the unscrambled word.
// - Progressive hint reveal, each word's hint sourced from data/hints.json.
// - Profile tracks best score, streak, games, and accuracy, persisted to
//   data/save.json.
// - Terminal UI built with rich, arrow-key navigation across screens.
// - Input layer uses msvcrt, so it currently runs on Windows only.

type Round = {
  word: string;
  scrambled: string;
  hints: string[]; // progressive hints from hints.json
};

// A small word-to-hint map mirroring data/hints.json. Each scrambled string is
// a fixed permutation so the demo is deterministic and server-renders cleanly.
const ROUNDS: Round[] = [
  {
    word: 'planet',
    scrambled: 'tlpnae',
    hints: ['It orbits a star', 'There are eight in our system', 'Earth is one'],
  },
  {
    word: 'guitar',
    scrambled: 'ratiug',
    hints: ['You play it', 'It has six strings', 'Acoustic or electric'],
  },
  {
    word: 'harbor',
    scrambled: 'broarh',
    hints: ['Found by the sea', 'Boats dock here', 'Shelters ships'],
  },
];

type Profile = {
  games: number;
  best: number;
  streak: number;
  correct: number;
  attempts: number;
};

const START_PROFILE: Profile = { games: 0, best: 0, streak: 0, correct: 0, attempts: 0 };
// Fewer revealed hints scores higher; mirrors the progressive-hint scoring idea.
const POINTS_BY_HINTS = [100, 70, 40, 20];
const ease = [0.22, 1, 0.36, 1] as const;

export default function WordScrambleDemo() {
  const reduce = useReducedMotion();
  const [roundIdx, setRoundIdx] = useState(0);
  const [guess, setGuess] = useState('');
  const [hintsShown, setHintsShown] = useState(1); // first hint is always shown
  const [status, setStatus] = useState<'playing' | 'won'>('playing');
  const [profile, setProfile] = useState<Profile>(START_PROFILE);
  const [solvedLetters, setSolvedLetters] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<number | null>(null);

  const round = ROUNDS[roundIdx];
  const accuracy = profile.attempts === 0 ? 0 : Math.round((profile.correct / profile.attempts) * 100);

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  const letters = useMemo(() => round.word.split(''), [round.word]);

  function revealHint() {
    if (status === 'won') return;
    setHintsShown((h) => Math.min(round.hints.length, h + 1));
  }

  function animateSolve() {
    if (reduce) {
      setSolvedLetters(letters.length);
      return;
    }
    setSolvedLetters(0);
    let i = 0;
    const step = () => {
      i += 1;
      setSolvedLetters(i);
      if (i < letters.length) timer.current = window.setTimeout(step, 90);
      else timer.current = null;
    };
    timer.current = window.setTimeout(step, 90);
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (status === 'won') return;
    const clean = guess.trim().toLowerCase();
    if (!clean) return;
    const correct = clean === round.word;
    setProfile((p) => {
      const attempts = p.attempts + 1;
      if (!correct) {
        return { ...p, attempts, streak: 0 };
      }
      const points = POINTS_BY_HINTS[Math.min(hintsShown - 1, POINTS_BY_HINTS.length - 1)];
      const streak = p.streak + 1;
      return {
        games: p.games + 1,
        best: Math.max(p.best, points),
        streak,
        correct: p.correct + 1,
        attempts,
      };
    });
    if (correct) {
      setStatus('won');
      animateSolve();
    } else {
      setGuess('');
    }
  }

  function nextRound() {
    clearTimer();
    setRoundIdx((i) => (i + 1) % ROUNDS.length);
    setGuess('');
    setHintsShown(1);
    setStatus('playing');
    setSolvedLetters(0);
    if (inputRef.current) inputRef.current.focus();
  }

  function revealAll() {
    // Convenience for the viewer: solve the current round to see the payoff.
    setGuess(round.word);
  }

  return (
    <div className="demo" aria-label="Word Scramble CLI demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Unscramble the word</h3>
      <p className="demo__lede">
        Type your guess to unscramble the word. Reveal hints one at a time, but
        each hint you spend lowers the round score. The profile panel updates
        streak and accuracy after every round, the way it persists to
        data/save.json.
      </p>

      <div className="ws__stage">
        <div className="ws__term" role="group" aria-label="game terminal">
          <div className="ws__term-bar">
            <span className="ws__dot" />
            <span className="ws__dot" />
            <span className="ws__dot" />
            <span className="ws__term-title">word-scramble</span>
          </div>

          <div className="ws__term-body">
            <div className="ws__prompt">round {roundIdx + 1} · scrambled</div>
            <div className="ws__tiles" aria-label="scrambled letters">
              {(status === 'won' ? letters : round.scrambled.split('')).map((ch, i) => {
                const solved = status === 'won' && i < solvedLetters;
                return (
                  <motion.span
                    key={`${roundIdx}-${i}`}
                    className={`ws__tile ${solved ? 'ws__tile--solved' : ''} ${
                      status === 'won' ? 'ws__tile--target' : ''
                    }`}
                    initial={false}
                    animate={
                      status === 'won' && !reduce
                        ? { y: solved ? 0 : -6, opacity: solved ? 1 : 0.5 }
                        : { y: 0, opacity: 1 }
                    }
                    transition={{ duration: reduce ? 0 : 0.22, ease }}
                  >
                    {ch.toUpperCase()}
                  </motion.span>
                );
              })}
            </div>

            <div className="ws__hints" aria-live="polite">
              {round.hints.map((h, i) => {
                const shown = i < hintsShown;
                return (
                  <AnimatePresence key={`${roundIdx}-hint-${i}`}>
                    {shown && (
                      <motion.div
                        className="ws__hint"
                        initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.25, ease }}
                      >
                        <span className="ws__hint-key">hint {i + 1}</span>
                        <span className="ws__hint-text">{h}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                );
              })}
            </div>

            <form className="ws__form" onSubmit={submit}>
              <label className="ws__caret" htmlFor="ws-guess">
                &gt;
              </label>
              <input
                id="ws-guess"
                ref={inputRef}
                className="ws__input"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="type your guess"
                autoComplete="off"
                spellCheck={false}
                disabled={status === 'won'}
                aria-label="your guess"
              />
            </form>

            <AnimatePresence>
              {status === 'won' && (
                <motion.div
                  className="ws__solved-line"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  solved with {hintsShown} hint{hintsShown === 1 ? '' : 's'} ·{' '}
                  {POINTS_BY_HINTS[Math.min(hintsShown - 1, POINTS_BY_HINTS.length - 1)]} pts
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="ws__profile" aria-label="player profile">
          <div className="ws__profile-head">data/save.json</div>
          <div className="ws__stat-grid">
            <ProfileStat label="streak" value={profile.streak} />
            <ProfileStat label="accuracy" value={`${accuracy}%`} />
            <ProfileStat label="games" value={profile.games} />
            <ProfileStat label="best" value={profile.best} />
          </div>
          <div className="ws__note">
            Input layer uses msvcrt, so the real CLI runs on Windows only for
            now.
          </div>
        </div>
      </div>

      <div className="demo__controls">
        {status === 'won' ? (
          <button className="demo__btn" onClick={nextRound}>
            Next word
          </button>
        ) : (
          <button className="demo__btn" onClick={() => submit()}>
            Submit guess
          </button>
        )}
        <button
          className="demo__btn demo__btn--ghost"
          onClick={revealHint}
          disabled={status === 'won' || hintsShown >= round.hints.length}
        >
          Reveal hint ({hintsShown}/{round.hints.length})
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={revealAll}
          disabled={status === 'won'}
        >
          Fill answer
        </button>
        <span className="demo__hint">{round.word.length} letters</span>
      </div>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="ws__stat">
      <div className="ws__stat-label">{label}</div>
      <motion.div
        key={String(value)}
        className="ws__stat-val"
        initial={{ scale: 1.18, color: 'var(--accent)' }}
        animate={{ scale: 1, color: 'var(--text-strong)' }}
        transition={{ duration: 0.3, ease }}
      >
        {value}
      </motion.div>
    </div>
  );
}
