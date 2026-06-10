import { NavLink, Link } from 'react-router-dom';
import GitHubIcon from './GitHubIcon';

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        <Link to="/" className="brand">
          <span className="brand__mark">SAY-5</span>
          Sai Asish Y
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/work">Work</NavLink>
          <a
            className="site-nav__gh"
            href="https://github.com/SAY-5"
            target="_blank"
            rel="noreferrer"
          >
            <GitHubIcon />
            <span className="site-nav__label">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
