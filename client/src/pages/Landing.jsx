import { Navigate } from 'react-router-dom';
import SignInButton from '../components/SignInButton.jsx';
import { useSession } from '../features/auth/useSession.js';
import WorkspacePreview from './WorkspacePreview.jsx';

const STEPS = [
  {
    icon: 'bi-github',
    title: '1. Connect a repository',
    text: 'Sign in with GitHub and choose any public JavaScript or TypeScript repository.',
  },
  {
    icon: 'bi-diagram-3',
    title: '2. Explore the graph',
    text: 'Each file is a node and each import is an edge, so you can follow how the code fits together.',
  },
  {
    icon: 'bi-broadcast',
    title: '3. Predict change impact',
    text: 'Select a file and AI ranks the files that depend on it by how likely they are to break.',
  },
];

/** Landing page (spec 8.4). Signed-in users go straight to the dashboard (spec 8.2). */
export default function Landing() {
  const { isSignedIn } = useSession();
  if (isSignedIn) return <Navigate to="/dashboard" replace />;

  return (
    <div className="landing">
      <section className="hero">
        <h1 className="hero-headline">
          See your codebase&apos;s architecture. Predict what breaks before you change it.
        </h1>
        <p className="hero-sub">
          Graph Code turns a GitHub repository into an interactive dependency graph and uses AI to
          show which files a change will affect.
        </p>
        <SignInButton large />
        <WorkspacePreview />
      </section>

      <section className="how" aria-labelledby="how-title">
        <h2 className="how-title" id="how-title">
          How it works
        </h2>
        <ol className="how-steps">
          {STEPS.map((step) => (
            <li className="how-step" key={step.title}>
              <i className={`bi ${step.icon}`} aria-hidden="true" />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
