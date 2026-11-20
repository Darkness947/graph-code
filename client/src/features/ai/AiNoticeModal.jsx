import { useState } from 'react';
import Modal from 'react-bootstrap/Modal';
import { acknowledgeAiNotice } from '../../api/ai.js';
import { useSessionStore } from '../auth/useSession.js';
import { GENERIC_ERROR } from '../repos/messages.js';
import { handleUnauthenticated } from '../repos/useRepositories.js';
import { NOTICE_CONFIRM, NOTICE_TEXT, NOTICE_TITLE } from './messages.js';

/**
 * The AI notice (spec 8.6), shown before the user's first analysis. Confirming records the
 * acknowledgement on the server, remembers it for this session, then calls `onConfirmed`.
 * @param {{ show: boolean, onHide: () => void, onConfirmed: () => void }} props
 */
export default function AiNoticeModal({ show, onHide, onConfirmed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    if (!busy) onHide();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await acknowledgeAiNotice();
      useSessionStore.getState().acknowledgeAiNotice();
      onHide();
      onConfirmed();
    } catch (err) {
      if (handleUnauthenticated(err)) return onHide();
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      show={show}
      onHide={close}
      onExited={() => setError(null)}
      aria-labelledby="ai-notice-title"
      centered
    >
      <Modal.Header>
        <Modal.Title id="ai-notice-title" as="h2" className="fs-5">
          {NOTICE_TITLE}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-0">{NOTICE_TEXT}</p>
        {error && (
          <p className="modal-inline-error" role="alert">
            {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-quiet" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
          {NOTICE_CONFIRM}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
