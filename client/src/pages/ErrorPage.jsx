import { Link, useSearchParams } from 'react-router-dom';
import MessagePanel from '../components/MessagePanel.jsx';
import SignInButton from '../components/SignInButton.jsx';

// Titles, text and actions from spec 8.7.
const KNOWN = {
  access_denied: {
    icon: 'bi-slash-circle',
    title: 'Sign-in was cancelled',
    text: "You didn't authorize Graph Code on GitHub. No account was created.",
    retry: false,
  },
  state_mismatch: {
    icon: 'bi-shield-exclamation',
    failure: true,
    title: "Sign-in couldn't be verified",
    text: 'For your security, this sign-in attempt was rejected. Please try again.',
    retry: true,
  },
  oauth_failed: {
    icon: 'bi-x-circle',
    failure: true,
    title: 'Sign-in failed',
    text: "GitHub didn't complete the sign-in. Please try again in a moment.",
    retry: true,
  },
};

const FALLBACK = {
  icon: 'bi-x-circle',
  failure: true,
  title: 'Something went wrong',
  text: 'An unexpected error occurred.',
  retry: false,
};

/** Error page, chosen by `?code=` (spec 8.7). */
export default function ErrorPage() {
  const [params] = useSearchParams();
  const code = params.get('code');
  const entry = (Object.hasOwn(KNOWN, code) && KNOWN[code]) || FALLBACK;

  return (
    <MessagePanel icon={entry.icon} failure={entry.failure} title={entry.title} text={entry.text}>
      {entry.retry ? (
        <SignInButton label="Try again" />
      ) : (
        <Link className="btn btn-quiet" to="/">
          Back to home
        </Link>
      )}
    </MessagePanel>
  );
}
