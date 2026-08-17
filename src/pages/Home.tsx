import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import ProjectRow from "../components/ProjectRow";
import ClusterPoster from "../components/ClusterPoster";
import GitHubIcon from "../components/GitHubIcon";
import Arrow from "../components/Arrow";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { flagshipProjects, projects } from "../data/projects";
import { totalProjects, categoryBuckets } from "../data/stats";
import type { ClusterCell } from "../lib/cluster";
import "../styles/home.css";

const ClusterObject = lazy(() => import("../components/ClusterObject"));

const ease = [0.22, 1, 0.36, 1] as const;
const indexOf = new Map(projects.map((p, i) => [p.name, i + 1]));
const maxCount = Math.max(...categoryBuckets.map((b) => b.count));

type Hover = { cell: ClusterCell; x: number; y: number } | null;

function useScrollProgress(limitPx: number) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const next = Math.min(1, Math.max(0, window.scrollY / limitPx));
      setP((prev) => (Math.abs(prev - next) > 0.02 ? next : prev));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [limitPx]);
  return p;
}

export default function Home() {
  useDocumentTitle();
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [hover, setHover] = useState<Hover>(null);
  const scroll = useScrollProgress(900);

  const onHover = useCallback(
    (cell: ClusterCell | null, x: number, y: number) => {
      setHover(cell ? { cell, x, y } : null);
    },
    [],
  );
  const onSelect = useCallback(
    (name: string) => navigate(`/p/${name}`),
    [navigate],
  );

  const stagger = {
    hidden: {},
    show: {
      transition: { staggerChildren: reduce ? 0 : 0.09, delayChildren: 0.1 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: reduce ? 0 : 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease } },
  };

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__stage" aria-hidden="true">
          <Suspense fallback={<ClusterPoster className="hero__poster" />}>
            <ClusterObject
              className="hero__object"
              reducedMotion={Boolean(reduce)}
              scrollProgress={scroll}
              onHover={onHover}
              onSelect={onSelect}
            />
          </Suspense>
        </div>

        <motion.div
          className="wrap hero__inner"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          <motion.p className="hero__intro" variants={item}>
            Sai Asish Y <span className="hero__sep">/</span> software engineer
            <span className="hero__sep">/</span> distributed systems, low
            latency infrastructure, databases
          </motion.p>

          <motion.h1 id="hero-title" className="hero__title" variants={item}>
            <span className="hero__title-a">
              I build
              <br />
              infrastructure
            </span>
            <span className="hero__title-b">
              and keep it
              <br />
              <em>running.</em>
            </span>
          </motion.h1>

          <motion.p className="hero__lede" variants={item}>
            One block per public repo, {totalProjects} in all. The lit ones are
            the {flagshipProjects.length} I picked. Hover for the name, click to
            open.
          </motion.p>

          <motion.p className="hero__metric" variants={item}>
            <span className="metric hero__count">{totalProjects}</span>
            <span className="hero__metric-cap">
              public
              <br />
              repos
            </span>
          </motion.p>

          <motion.div className="hero__cta" variants={item}>
            <Link to="/work" className="btn btn--solid">
              Open the index <Arrow className="btn__arrow" />
            </Link>
            <a
              className="tlink hero__gh"
              href="https://github.com/SAY-5"
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon size={13} /> github.com/SAY-5
            </a>
          </motion.div>
        </motion.div>

        {hover && (
          <div
            className="hero__tip"
            role="status"
            style={{ left: hover.x, top: hover.y }}
          >
            <span className="hero__tip-idx mono num">
              {String(indexOf.get(hover.cell.name) ?? 0).padStart(3, "0")}
            </span>
            <span className="hero__tip-title">{hover.cell.title}</span>
            <span className="hero__tip-meta">
              {hover.cell.language} &middot; {hover.cell.category}
            </span>
          </div>
        )}
      </section>

      <section className="selected section band" aria-labelledby="selected-title">
        <div className="wrap">
          <div className="selected__head">
            <h2 id="selected-title" className="selected__title">
              Start with these.
            </h2>
            <p className="selected__sub">
              {flagshipProjects.length} projects that cover most of what I do:
              instrument control, distributed services, agents, and a few end to
              end apps. Each one has a live demo on its page.
            </p>
          </div>
          <ol className="rows rows--selected">
            {flagshipProjects.map((p, i) => (
              <ProjectRow
                key={p.name}
                project={p}
                number={indexOf.get(p.name) ?? i + 1}
                animIndex={i}
                variant="selected"
              />
            ))}
          </ol>
          <div className="selected__more">
            <Link to="/work" className="btn btn--ghost">
              All {totalProjects} repos
            </Link>
          </div>
        </div>
      </section>

      <section className="spread section" aria-labelledby="spread-title">
        <div className="wrap">
          <h2 id="spread-title" className="spread__title">
            Where they sit.
          </h2>
          <p className="spread__sub">
            The same blocks, grouped by what they are. Each row opens that group
            in the index.
          </p>
          <ul className="spread__rows surface">
            {categoryBuckets.map((b) => (
              <li key={b.label}>
                <Link
                  to={`/work?c=${encodeURIComponent(b.label)}`}
                  className="spread__row"
                >
                  <span className="spread__name">{b.label}</span>
                  <span
                    className="spread__blocks"
                    aria-hidden="true"
                    style={{ width: `${(b.count / maxCount) * 100}%` }}
                  >
                    {Array.from({ length: b.count }).map((_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <span className="spread__count mono num">
                    {String(b.count).padStart(2, "0")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
