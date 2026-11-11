import { SIGN_IN_URL } from '../api/auth.js';

/** A primary link that starts sign-in. A normal navigation to the server, not a fetch (spec 8.3). */
export default function SignInButton({ large = false, label = 'Sign in with GitHub' }) {
  return (
    <a className={`btn btn-primary${large ? ' btn-lg' : ''}`} href={SIGN_IN_URL}>
      <i className="bi bi-github me-2" aria-hidden="true" />
      {label}
    </a>
  );
}
