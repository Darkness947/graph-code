import CloseButton from 'react-bootstrap/CloseButton';
import Toast from 'react-bootstrap/Toast';
import { dismissToast, useToastStore } from '../store/toastStore.js';

/** Renders the message set by `showToast` (see `store/toastStore.js`). */
export default function AppToast() {
  const message = useToastStore((s) => s.message);
  const id = useToastStore((s) => s.id);

  return (
    <div className="app-toast-region" aria-live="polite">
      <Toast
        key={id}
        className="app-toast"
        show={message !== null}
        onClose={dismissToast}
        delay={6000}
        autohide
      >
        <Toast.Body>
          <span>{message}</span>
          <CloseButton aria-label="Dismiss" onClick={dismissToast} />
        </Toast.Body>
      </Toast>
    </div>
  );
}
