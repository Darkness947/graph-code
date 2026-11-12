import { Link, NavLink } from 'react-router-dom';
import { useSession } from '../features/auth/useSession.js';
import SignInButton from './SignInButton.jsx';
import UserMenu from './UserMenu.jsx';

/** Three connected nodes: the smallest dependency graph. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 6.5v3.2M11 9.7 5.5 15M11 9.7 16.5 15" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="4.5" r="2.75" fill="currentColor" />
      <circle cx="5" cy="16.5" r="2.75" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="16.5" r="2.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Shared top bar (spec 8.3). */
export default function NavBar() {
  const { user, isLoading, isSignedIn } = useSession();

  return (
    <header className="topbar">
      <Link className="topbar-wordmark" to={isSignedIn ? '/dashboard' : '/'}>
        <Mark />
        Graph Code
      </Link>
      {!isLoading && (
        <nav className="topbar-actions" aria-label="Main">
          {isSignedIn ? (
            <UserMenu user={user} />
          ) : (
            <>
              <NavLink className="topbar-link" to="/about">
                About
              </NavLink>
              <SignInButton />
            </>
          )}
        </nav>
      )}
    </header>
  );
}
