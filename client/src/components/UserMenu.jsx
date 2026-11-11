import Dropdown from 'react-bootstrap/Dropdown';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../api/auth.js';
import { useSessionStore } from '../features/auth/useSession.js';
import { showToast } from '../store/toastStore.js';

/** Avatar and login with a dropdown: "Dashboard" and "Log out" (spec 8.3). */
export default function UserMenu({ user }) {
  const navigate = useNavigate();
  const clearSession = useSessionStore((s) => s.clear);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      showToast('Something went wrong. Try again.');
      return;
    }
    clearSession();
    navigate('/');
  };

  return (
    <Dropdown align="end">
      <Dropdown.Toggle as="button" type="button" className="user-menu-toggle">
        {user.avatarUrl ? (
          <img className="user-avatar" src={user.avatarUrl} alt="" width="24" height="24" />
        ) : (
          <span className="user-avatar">
            <i className="bi bi-person-fill" aria-hidden="true" />
          </span>
        )}
        <span>{user.login}</span>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item as={Link} to="/dashboard">
          Dashboard
        </Dropdown.Item>
        <Dropdown.Item as="button" type="button" onClick={handleLogout}>
          Log out
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}
