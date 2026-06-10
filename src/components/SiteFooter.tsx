import { Link } from 'react-router-dom';
import GitHubIcon from './GitHubIcon';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <div>
          <div className="site-footer__name">
            Sai Asish <span>Y</span>
          </div>
          <p className="site-footer__line">
            148 projects in one place. Built and shipped across systems,
            distributed infra, agents, full-stack web, and C++.
          </p>
        </div>
        <div className="site-footer__right">
          <a href="https://github.com/SAY-5" target="_blank" rel="noreferrer">
            <GitHubIcon size={14} /> github.com/SAY-5
          </a>
          <Link to="/work">Browse all work</Link>
          <span className="site-footer__meta mono">SAY-5 / portfolio</span>
        </div>
      </div>
    </footer>
  );
}
