import { Link } from 'react-router-dom';

/** About page (spec 8.4: a simple text page). */
export default function About() {
  return (
    <article className="text-page">
      <h1>About Graph Code</h1>
      <p className="lead-text">
        Before you change a file, you want to know what depends on it. Graph Code shows you.
      </p>

      <h2>What it does</h2>
      <p>
        Graph Code reads the JavaScript and TypeScript files in a public GitHub repository, works
        out which files import which, and draws the result as a graph you can explore. Folders
        expand and collapse, and the files that many others rely on are drawn larger, so the
        structure of the project is visible at a glance.
      </p>

      <h2>Predicting change impact</h2>
      <p>
        Select a file and ask for its impact. Graph Code follows the graph to find every file that
        depends on it, then asks an AI model to rate how likely each one is to break and to explain
        why. You get a ranked list to check before you start editing.
      </p>

      <h2>How your code is handled</h2>
      <p>
        Your code is read to build the graph. It is never run, and it is never stored. The{' '}
        <Link to="/privacy">privacy page</Link> explains what is kept and what is sent to the AI
        service.
      </p>

      <h2>Who made it</h2>
      <p>Graph Code is a senior project at Prince Mohammad Bin Fahd University.</p>
    </article>
  );
}
