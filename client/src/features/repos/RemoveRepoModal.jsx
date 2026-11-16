import { useState } from 'react';
import Modal from 'react-bootstrap/Modal';
import { deleteRepo } from '../../api/repos.js';
import { GENERIC_ERROR, REMOVE_CONFIRM, addErrorMessage } from './messages.js';
import { handleUnauthenticated } from './useRepositories.js';

/**
 * Confirms and removes a repository (spec 8.5). `repo` null hides the modal.
 * `onRemoved(repo)` runs after a successful delete; `onBlocked(repo)` after `409 JOB_ACTIVE`.
 */
export default function RemoveRepoModal({ repo, onHide, onRemoved, onBlocked }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Keeps the text during the closing fade, after the parent has cleared `repo`.
  const [shown, setShown] = useState(repo);
  if (repo && repo !== shown) setShown(repo);

  const close = () => {
    if (busy) return;
    setError(null);
    onHide();
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteRepo(repo.id);
      setBusy(false);
      onRemoved(repo);
    } catch (err) {
      setBusy(false);
      if (handleUnauthenticated(err)) return onHide();
      // Already gone (removed elsewhere): the outcome the user asked for.
      if (err?.status === 404) return onRemoved(repo);
      if (err?.code === 'JOB_ACTIVE') {
        setError(addErrorMessage(err));
        onBlocked?.(repo);
      } else {
        setError(GENERIC_ERROR);
      }
    }
  };

  return (
    <Modal
      show={repo !== null}
      onHide={close}
      onExited={() => setError(null)}
      aria-labelledby="remove-repo-text"
      centered
    >
      <Modal.Body>
        {shown && (
          <p id="remove-repo-text" className="mb-0">
            {REMOVE_CONFIRM(shown.displayName)}
          </p>
        )}
        {error && (
          <p className="mt-3 mb-0" role="alert">
            {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-quiet" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger-outline" onClick={remove} disabled={busy}>
          Remove
        </button>
      </Modal.Footer>
    </Modal>
  );
}
