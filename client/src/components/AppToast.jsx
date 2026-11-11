import { useEffect, useState } from 'react';
import Toast from 'react-bootstrap/Toast';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Shows the message a navigation carried in `location.state.toast`, for example
 * `navigate('/', { state: { toast: 'Please sign in' } })`.
 */
export default function AppToast() {
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState(null);
  const incoming = location.state?.toast;

  // A new message arrived with this navigation: show it (state adjusted during render).
  if (incoming && incoming !== message) setMessage(incoming);

  useEffect(() => {
    // Drop the message from history so a reload or Back does not show it again.
    if (incoming) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [incoming, location.pathname, location.search, navigate]);

  return (
    <div className="app-toast-region" aria-live="polite">
      <Toast
        className="app-toast"
        show={message !== null}
        onClose={() => setMessage(null)}
        delay={6000}
        autohide
      >
        <Toast.Body>
          <span>{message}</span>
          <button
            type="button"
            className="btn-close"
            aria-label="Dismiss"
            onClick={() => setMessage(null)}
          />
        </Toast.Body>
      </Toast>
    </div>
  );
}
