import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Project } from '../data/projects';

type Props = {
  project: Project;
  index?: number;
  variant?: 'compact' | 'featured';
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function ProjectTile({
  project,
  index = 0,
  variant = 'compact',
}: Props) {
  const topStack = project.stack.slice(0, variant === 'featured' ? 4 : 3);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.42, ease, delay: Math.min(index * 0.03, 0.3) }}
      className={`tile tile--${variant}`}
    >
      <Link to={`/p/${project.name}`} className="tile__link">
        <div className="tile__top">
          <span className="tile__cat mono">{project.category}</span>
          {project.isFlagship && (
            <span className="tile__flag mono" aria-label="Featured project">
              Featured
            </span>
          )}
        </div>

        <h3 className="tile__title">{project.title}</h3>
        <p className="tile__tagline">{project.tagline}</p>

        {variant === 'featured' && project.highlights[0] && (
          <p className="tile__highlight">{project.highlights[0]}</p>
        )}

        <div className="tile__foot">
          <span className="tile__lang mono">{project.language}</span>
          <ul className="tile__chips" aria-label="Stack">
            {topStack.map((s) => (
              <li key={s} className="chip">
                {s}
              </li>
            ))}
          </ul>
          <span className="tile__arrow" aria-hidden="true">
            &#8599;
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
