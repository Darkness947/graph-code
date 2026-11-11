import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from './useSession.js';

/** Guards the protected routes (spec 8.2): spinner while loading, landing page on 401. */
export default function ProtectedRoute() {
  const { status, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="centered-fill">
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading…</span>
        </div>
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/" replace state={{ toast: 'Please sign in' }} />;
  }
  if (status === 'error') {
    return <Navigate to="/error" replace />;
  }
  return <Outlet />;
}
