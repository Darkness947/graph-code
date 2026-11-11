import { Link } from 'react-router-dom';

/** Site footer (spec 8.4). */
export default function Footer() {
  return (
    <footer className="site-footer">
      <p>
        <Link to="/about">About</Link> · <Link to="/privacy">Privacy</Link> · © 2026 Graph Code
      </p>
      <p>Senior Project, Prince Mohammad Bin Fahd University</p>
    </footer>
  );
}
