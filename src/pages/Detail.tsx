import { useParams, Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import GitHubIcon from '../components/GitHubIcon';
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
    hidden: { opacity: 0, y: reduce ? 0 : 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
  };

  return (
    <article className="detail">
      <div className="wrap">
        <Link to="/work" className="detail__back">
          &#8592; All work
        </Link>

        <motion.header
          className="detail__head"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.07 } } }}
        >
          <motion.div className="detail__meta" variants={item}>
            <span className="detail__cat mono">{project.category}</span>
            <span className="detail__lang mono">{project.language}</span>
            {project.isFlagship && (
              <span className="detail__flag mono">Featured</span>
            )}
          </motion.div>
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
              Live demo &#8599;
            </a>
            <a
              className="btn btn--ghost"
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon /> View on GitHub
            </a>
          </motion.div>
        </motion.header>

        <div className="detail__body">
          <div className="detail__main">
            <section className="detail__section">
              <h2 className="detail__h2">Summary</h2>
              <p className="detail__summary">{project.summary}</p>
            </section>

            <section className="detail__section">
              <h2 className="detail__h2">Highlights</h2>
              <ul className="detail__highlights">
                {project.highlights.map((h, i) => (
                  <li key={i} className="detail__highlight">
                    <span className="detail__bullet mono">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </section>

            {project.isFlagship &&
              (demoReady ? (
                <DemoSlot name={project.name} />
              ) : (
                <section className="demo-slot" aria-labelledby="demo-title">
                  <span className="demo-slot__tag mono">Interactive demo</span>
                  <h2 id="demo-title" className="demo-slot__title">
                    Coming to this page
                  </h2>
                  <p className="demo-slot__note">
                    An interactive demo of this project&apos;s core mechanism is
                    in progress and will run right here.
                  </p>
                  <p className="demo-slot__concept">{project.demoConcept}</p>
                </section>
              ))}
          </div>

          <aside className="detail__aside">
            <div className="detail__panel">
              <h2 className="detail__panel-title mono">Stack</h2>
              <ul className="detail__stack">
                {project.stack.map((s) => (
                  <li key={s} className="chip">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="detail__panel">
              <h2 className="detail__panel-title mono">Links</h2>
              <a
                className="detail__link-row"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
              >
                <GitHubIcon size={14} /> SAY-5/{project.name}
              </a>
              <a
                className="detail__link-row"
                href={showcaseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                &#8599; Live demo
              </a>
            </div>
          </aside>
        </div>

        <nav className="detail__nav" aria-label="Project navigation">
          {prev ? (
            <Link to={`/p/${prev.name}`} className="detail__nav-link">
              <span className="detail__nav-dir mono">Previous</span>
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
              <span className="detail__nav-dir mono">Next</span>
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
