import { Link } from 'react-router-dom';
import Arrow from '../components/Arrow';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import '../styles/notfound.css';

export default function NotFound() {
  useDocumentTitle('Not found');
  return (
    <section className="wrap notfound" aria-labelledby="nf-title">
      <h1 id="nf-title" className="notfound__title">
        <span className="notfound__code">404</span>
        <span className="notfound__text">Nothing at this address.</span>
      </h1>
      <p className="notfound__sub">Everything else is in the index.</p>
      <div className="notfound__links">
        <Link className="btn btn--solid" to="/work">
          Open the index <Arrow className="btn__arrow" />
        </Link>
        <Link className="tlink" to="/">
          Home
        </Link>
      </div>
    </section>
  );
}
