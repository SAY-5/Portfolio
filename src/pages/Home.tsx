import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import ProjectTile from '../components/ProjectTile';
import GitHubIcon from '../components/GitHubIcon';
import CategoryConstellation from '../components/CategoryConstellation';
import Reveal from '../components/Reveal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { flagshipProjects } from '../data/projects';
import {
  totalProjects,
  languageCount,
  categoryBuckets,
  topLanguages,
} from '../data/stats';
import '../styles/home.css';

const ease = [0.22, 1, 0.36, 1] as const;

export default function Home() {
  useDocumentTitle();
  const reduce = useReducedMotion();

  const heroChildren = {
    hidden: {},
    show: {
      transition: { staggerChildren: reduce ? 0 : 0.08, delayChildren: 0.05 },
    },
  };
  const heroItem = {
    hidden: { opacity: 0, y: reduce ? 0 : 22 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } },
  };

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__beam" aria-hidden="true" />
        <div className="hero__film hero__film--left" aria-hidden="true" />
        <div className="hero__film hero__film--right" aria-hidden="true" />
        <div className="wrap hero__inner">
          <motion.div
            className="hero__copy"
            variants={heroChildren}
            initial="hidden"
            animate="show"
          >
            <motion.p className="eyebrow" variants={heroItem}>
              Sai Asish Y / SAY-5
            </motion.p>
            <motion.h1
              id="hero-title"
              className="hero__title"
              variants={heroItem}
            >
              I build systems that
              <br />
              <span className="hero__accent">run in production.</span>
            </motion.h1>
            <motion.p className="hero__lede" variants={heroItem}>
              Software engineer shipping across systems, distributed infra,
              agents, full-stack web, and C++. {totalProjects} projects, eight
              languages, one place to look at all of them.
            </motion.p>
            <motion.div className="hero__cta" variants={heroItem}>
              <Link to="/work" className="btn btn--solid">
                Explore the work
              </Link>
              <a
                className="btn btn--ghost"
                href="https://github.com/SAY-5"
                target="_blank"
                rel="noreferrer"
              >
                <GitHubIcon /> github.com/SAY-5
              </a>
            </motion.div>
          </motion.div>

          <CategoryConstellation />
        </div>
      </section>

      <section className="featured wrap" aria-labelledby="featured-title">
        <Reveal className="section-head">
          <p className="eyebrow">Featured work</p>
          <h2 id="featured-title" className="section-title">
            Eight projects worth the deep dive
          </h2>
          <p className="section-sub">
            The ones that carry the most range: orchestration, distributed
            services, agent platforms, and full-stack products.
          </p>
        </Reveal>

        <div className="featured__grid">
          {flagshipProjects.map((p, i) => (
            <ProjectTile
              key={p.name}
              project={p}
              index={i}
              variant="featured"
            />
          ))}
        </div>
      </section>

      <section className="numbers" aria-labelledby="numbers-title">
        <div className="wrap">
          <Reveal className="section-head">
            <p className="eyebrow">By the numbers</p>
            <h2 id="numbers-title" className="section-title">
              {totalProjects} projects, {languageCount} languages
            </h2>
          </Reveal>

          <div className="numbers__grid">
            <Reveal className="numbers__cats">
              <h3 className="numbers__label mono">Categories</h3>
              <ul className="bars">
                {categoryBuckets.map((b, i) => (
                  <li key={b.label} className="bar">
                    <span className="bar__label">{b.label}</span>
                    <span className="bar__track">
                      <motion.span
                        className="bar__fill"
                        initial={{ scaleX: 0 }}
                        whileInView={{
                          scaleX: b.count / categoryBuckets[0].count,
                        }}
                        viewport={{ once: true, margin: '-40px' }}
                        transition={{ duration: 0.7, ease, delay: i * 0.05 }}
                      />
                    </span>
                    <span className="bar__count mono">{b.count}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal className="numbers__langs">
              <h3 className="numbers__label mono">Languages</h3>
              <ul className="langgrid">
                {topLanguages.map((b) => (
                  <li key={b.label} className="langgrid__item">
                    <span className="langgrid__name">{b.label}</span>
                    <span className="langgrid__count mono">
                      {String(b.count).padStart(2, '0')}
                    </span>
                  </li>
                ))}
              </ul>
              <Link to="/work" className="btn btn--solid numbers__browse">
                Browse all {totalProjects}
              </Link>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
