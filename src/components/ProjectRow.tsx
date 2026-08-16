import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import type { Project } from '../data/projects';
import '../styles/row.css';

type Props = {
  project: Project;
  number: number;
  animIndex?: number;
  variant?: 'index' | 'selected';
};

const pad = (n: number) => String(n).padStart(3, '0');

export default function ProjectRow({
  project,
  number,
  animIndex = 0,
  variant = 'index',
}: Props) {
  const style = { '--i': Math.min(animIndex, 14) } as CSSProperties;
  return (
    <li className={`row row--${variant}`} style={style}>
      <Link to={`/p/${project.name}`} className="row__link">
        <span className="row__idx mono num" aria-hidden="true">
          {pad(number)}
        </span>
        <span className="row__main">
          <span className="row__title">
            {project.title}
            {project.isFlagship && variant === 'index' && (
              <span className="row__flag" title="Selected work" aria-label="Selected work" />
            )}
          </span>
          <span className="row__tagline">{project.tagline}</span>
        </span>
        <span className="row__meta">
          <span className="row__lang">{project.language}</span>
          <span className="row__cat">{project.category}</span>
        </span>
      </Link>
    </li>
  );
}
