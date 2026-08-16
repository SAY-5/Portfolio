import { useParams, Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import GitHubIcon from '../components/GitHubIcon';
import Arrow from '../components/Arrow';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { projects, getProject } from '../data/projects';
import { hasDemo } from '../lib/demoRegistry';
import DemoSlot from '../components/DemoSlot';
import NotFound from './NotFound';
import '../styles/detail.css';

const ease = [0.22, 1, 0.36, 1] as const;

const SHOWCASE_BASE = 'https://showcases-lime.vercel.app';

export default function Detail() {
  const { name } = useParams();
  const reduce = useReducedMotion();
  const project = name ? getProject(name) : undefined;

  useDocumentTitle(project?.title);

  if (!project) return <NotFound />;

  const idx = projects.findIndex((p) => p.name === project.name);
  const prev = idx > 0 ? projects[idx - 1] : null;
  const next = idx < projects.length - 1 ? projects[idx + 1] : null;
  const showcaseUrl = `${SHOWCASE_BASE}/${project.name}`;
  const githubUrl = `https://github.com/SAY-5/${project.name}`;
  const demoReady = hasDemo(project.name);

  const item = {
    hidden: { opacity: 0, y: reduce ? 0 : 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.55, ease } },
  };

  return (
    <article className="detail">
      <div className="wrap">
        <Link to="/work" className="detail__back">
          <Arrow dir="left" size={13} /> Index
        </Link>

        <motion.header
          className="detail__head"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.07 } } }}
        >
          <motion.p className="detail__meta" variants={item}>
            <span className="detail__idx mono num">{String(idx + 1).padStart(3, '0')}</span>
            <span className="detail__dot" aria-hidden="true" />
            <span>{project.language}</span>
            <span className="detail__dot" aria-hidden="true" />
            <span>{project.category}</span>
            {project.isFlagship && (
              <>
                <span className="detail__dot" aria-hidden="true" />
                <span className="detail__flag">Selected</span>
              </>
            )}
          </motion.p>
          <motion.h1 className="detail__title" variants={item}>
            {project.title}
          </motion.h1>
          <motion.p className="detail__tagline" variants={item}>
            {project.tagline}
          </motion.p>
          <motion.div className="detail__links" variants={item}>
            <a
              className="btn btn--solid"
              href={showcaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the app <Arrow className="btn__arrow" />
            </a>
            <a
              className="tlink detail__gh"
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon size={13} /> SAY-5/{project.name}
            </a>
          </motion.div>
        </motion.header>

        {demoReady && <DemoSlot name={project.name} />}

        <div className="detail__body">
          <div className="detail__main">
            <section className="detail__section">
              <h2 className="detail__h2">What it is</h2>
              <p className="detail__summary">{project.summary}</p>
            </section>

            <section className="detail__section">
              <h2 className="detail__h2">Notes</h2>
              <ul className="detail__highlights">
                {project.highlights.map((h, i) => (
                  <li key={i} className="detail__highlight">
                    {h}
                  </li>
                ))}
              </ul>
            </section>

            {!demoReady && project.isFlagship && (
              <section className="detail__section detail__planned">
                <h2 className="detail__h2">Demo, in progress</h2>
                <p className="detail__summary">{project.demoConcept}</p>
              </section>
            )}
          </div>

          <aside className="detail__aside">
            <div className="detail__panel">
              <h2 className="detail__panel-title">Stack</h2>
              <p className="detail__stack">{project.stack.join(', ')}</p>
            </div>
            <div className="detail__panel">
              <h2 className="detail__panel-title">Links</h2>
              <a
                className="detail__link-row"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
              >
                <GitHubIcon size={13} /> Source on GitHub
              </a>
              <a
                className="detail__link-row"
                href={showcaseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Arrow size={13} /> Standalone app
              </a>
            </div>
          </aside>
        </div>

        <nav className="detail__nav" aria-label="Project navigation">
          {prev ? (
            <Link to={`/p/${prev.name}`} className="detail__nav-link">
              <span className="detail__nav-dir"><Arrow dir="left" size={12} /> Previous</span>
              <span className="detail__nav-name">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to={`/p/${next.name}`}
              className="detail__nav-link detail__nav-link--next"
            >
              <span className="detail__nav-dir">Next <Arrow dir="right" size={12} /></span>
              <span className="detail__nav-name">{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </article>
  );
}
