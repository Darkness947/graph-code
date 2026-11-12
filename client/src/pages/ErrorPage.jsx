import { Link, useSearchParams } from 'react-router-dom';
import MessagePanel from '../components/MessagePanel.jsx';
import SignInButton from '../components/SignInButton.jsx';

// Titles, text and actions from spec 8.7. `retry` offers "Try again" instead of "Back to home".
const ERROR_PANELS = new Map([
  [
    'access_denied',
    {
      icon: 'bi-slash-circle',
      title: 'Sign-in was cancelled',
      text: "You didn't authorize Graph Code on GitHub. No account was created.",
    },
  ],
  [
    'state_mismatch',
    {
      icon: 'bi-shield-exclamation',
      failure: true,
      retry: true,
      title: "Sign-in couldn't be verified",
      text: 'For your security, this sign-in attempt was rejected. Please try again.',
    },
  ],
  [
    'oauth_failed',
    {
      icon: 'bi-x-circle',
      failure: true,
      retry: true,
      title: 'Sign-in failed',
      text: "GitHub didn't complete the sign-in. Please try again in a moment.",
    },
  ],
]);

const FALLBACK = {
  icon: 'bi-x-circle',
  failure: true,
  title: 'Something went wrong',
  text: 'An unexpected error occurred.',
};

/** Error page, chosen by `?code=` (spec 8.7). */
export default function ErrorPage() {
  const [params] = useSearchParams();
  const { retry, ...panel } = ERROR_PANELS.get(params.get('code')) ?? FALLBACK;

  return (
    <MessagePanel {...panel}>
      {retry ? (
        <SignInButton label="Try again" />
      ) : (
        <Link className="btn btn-quiet" to="/">
          Back to home
        </Link>
      )}
    </MessagePanel>
  );
}
