import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="wrap" style={{ paddingBlock: '140px' }}>
      <p className="eyebrow">404</p>
      <h1 style={{ fontSize: 'clamp(40px, 8vw, 88px)', margin: '18px 0' }}>
        Nothing here
      </h1>
      <p style={{ maxWidth: '46ch', marginBottom: 28 }}>
        That page does not exist. The work is still where it should be.
      </p>
      <Link className="chip" to="/work" style={{ padding: '10px 18px' }}>
        Browse the work
      </Link>
    </section>
  );
}
