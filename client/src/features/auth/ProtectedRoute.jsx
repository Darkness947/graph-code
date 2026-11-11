import { useEffect, useRef } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { showToast } from '../../store/toastStore.js';
import { useSession } from './useSession.js';

/** Guards the protected routes (spec 8.2): spinner while loading, landing page on 401. */
export default function ProtectedRoute() {
  const { status, isLoading } = useSession();

  // A visitor who was never signed in is told why they landed on the home page.
  // Someone who just logged out is not.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (status === 'authenticated') wasSignedIn.current = true;
    else if (status === 'anonymous' && !wasSignedIn.current) showToast('Please sign in');
  }, [status]);

  if (isLoading) {
    return (
      <div className="centered-fill">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading…</span>
        </div>
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/" replace />;
  if (status === 'error') return <Navigate to="/error" replace />;
  return <Outlet />;
}
