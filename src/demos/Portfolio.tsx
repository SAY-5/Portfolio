import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './Portfolio.css';

// The Portfolio repo is the website itself: a personal site for a software
// engineer working on distributed systems, low-latency infrastructure, and
// databases. The demo renders that site in a small browser frame and lets you
// navigate its sections, since the repo has no other mechanism to visualize.

const ease = [0.22, 1, 0.36, 1] as const;

type Section = 'home' | 'work' | 'about';

const NAV: { id: Section; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
];

const FOCUS_TAGS = [
  'Distributed systems',
  'Low-latency infrastructure',
  'Databases',
];

const CARDS = [
  {
    cat: 'Infrastructure',
    name: 'Consensus log',
    desc: 'Raft-backed replicated log with leader leases and snapshotting.',
    metric: 'p99 commit under 5ms',
  },
  {
    cat: 'Storage',
    name: 'LSM engine',
    desc: 'Write-optimized key-value store with leveled compaction.',
    metric: '1.2M writes/sec sustained',
  },
  {
    cat: 'Networking',
    name: 'RPC mesh',
    desc: 'Zero-copy framing over a thread-per-core transport.',
    metric: 'sub-millisecond fan-out',
  },
  {
    cat: 'Databases',
    name: 'Query planner',
    desc: 'Cost-based planner with index-aware join ordering.',
    metric: '40x on hot paths',
  },
];

export default function PortfolioDemo() {
  const reduce = useReducedMotion();
  const [section, setSection] = useState<Section>('home');

  return (
    <div className="demo" aria-label="Portfolio site demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">The portfolio, section by section</h3>
      <p className="demo__lede">
        The repository is the site, so this renders it in a browser frame.
        Navigate between the landing page, the project cards, and the about
        section.
      </p>

      <div className="pf__stage">
        <div className="pf__window">
          <div className="pf__chrome">
            <div className="pf__dots" aria-hidden="true">
              <span className="pf__dot" />
              <span className="pf__dot" />
              <span className="pf__dot" />
            </div>
            <div className="pf__addr">
              <b>portfolio</b>
              <span> / {section === 'home' ? '' : section}</span>
            </div>
          </div>

          <nav className="pf__nav" aria-label="Portfolio sections">
            {NAV.map((n) => (
              <button
                key={n.id}
                className="pf__nav-btn"
                aria-current={section === n.id}
                onClick={() => setSection(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="pf__view">
            <AnimatePresence mode="wait">
              {section === 'home' && (
                <motion.div
                  key="home"
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                  transition={{ duration: reduce ? 0 : 0.35, ease }}
                >
                  <div className="pf__hero-kicker">Software engineer</div>
                  <h4 className="pf__hero-title">
                    Building systems that stay fast under load.
                  </h4>
                  <p className="pf__hero-sub">
                    I work on distributed systems, low-latency infrastructure,
                    and databases. This portfolio collects the projects and
                    the engineering behind them.
                  </p>
                  <div className="pf__tags">
                    {FOCUS_TAGS.map((t, i) => (
                      <motion.span
                        key={t}
                        className="pf__tag"
                        initial={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: reduce ? 0 : 0.25,
                          delay: reduce ? 0 : 0.1 + i * 0.08,
                        }}
                      >
                        {t}
                      </motion.span>
                    ))}
                  </div>
                </motion.div>
              )}

              {section === 'work' && (
                <motion.div
                  key="work"
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                  transition={{ duration: reduce ? 0 : 0.35, ease }}
                >
                  <div className="pf__cards">
                    {CARDS.map((c, i) => (
                      <motion.article
                        key={c.name}
                        className="pf__card"
                        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: reduce ? 0 : 0.3,
                          delay: reduce ? 0 : i * 0.07,
                          ease,
                        }}
                      >
                        <div className="pf__card-cat">{c.cat}</div>
                        <div className="pf__card-name">{c.name}</div>
                        <p className="pf__card-desc">{c.desc}</p>
                        <div className="pf__card-metric">{c.metric}</div>
                      </motion.article>
                    ))}
                  </div>
                </motion.div>
              )}

              {section === 'about' && (
                <motion.div
                  key="about"
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -8 }}
                  transition={{ duration: reduce ? 0 : 0.35, ease }}
                >
                  <div className="pf__about">
                    <p className="pf__about-lead">
                      The work centers on the parts of a system that decide
                      whether it holds up: how state is replicated, how data is
                      stored and queried, and how requests stay quick when the
                      traffic does not.
                    </p>
                    <div className="pf__statline">
                      <div className="pf__statcell">
                        <div className="pf__statcell-val">3</div>
                        <div className="pf__statcell-name">core focuses</div>
                      </div>
                      <div className="pf__statcell">
                        <div className="pf__statcell-val">p99</div>
                        <div className="pf__statcell-name">
                          latency budget
                        </div>
                      </div>
                      <div className="pf__statcell">
                        <div className="pf__statcell-val">HTML</div>
                        <div className="pf__statcell-name">site, hand built</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`demo__btn ${
              section === n.id ? '' : 'demo__btn--ghost'
            }`}
            onClick={() => setSection(n.id)}
          >
            {n.label}
          </button>
        ))}
        <span className="demo__hint">distributed systems portfolio</span>
      </div>
    </div>
  );
}
