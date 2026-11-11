import { Link } from 'react-router-dom';
import MessagePanel from '../components/MessagePanel.jsx';

/** Not-found page (spec 8.7). */
export default function NotFound() {
  return (
    <MessagePanel
      icon="bi-signpost-split"
      title="Page not found"
      text="Nothing lives at this address. It may have moved, or the link may be mistyped."
    >
      <Link className="btn btn-primary" to="/">
        Home
      </Link>
      <Link className="btn btn-quiet" to="/dashboard">
        Dashboard
      </Link>
    </MessagePanel>
  );
}
