import { Link } from 'react-router-dom';
import GitHubIcon from './GitHubIcon';

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <div>
          <p className="site-footer__name">
            Sai Asish Y
          </p>
          <p className="site-footer__line">
            Most of my public repos are systems and infrastructure code. Some
            are agents and web apps. A few are things I wanted to understand
            and never turned into anything.
          </p>
        </div>
        <div className="site-footer__right">
          <a href="https://github.com/SAY-5" target="_blank" rel="noreferrer">
            <GitHubIcon size={13} /> github.com/SAY-5
          </a>
          <Link to="/work">Index</Link>
          <span className="site-footer__meta">
            &copy; {year} Sai Asish Y
          </span>
        </div>
      </div>
    </footer>
  );
}
