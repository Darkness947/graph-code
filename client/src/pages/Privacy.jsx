import Footer from '../components/Footer.jsx';

// The four statements required by spec 8.4.
const STATEMENTS = [
  {
    icon: 'bi-unlock',
    text: 'Only public repositories are analyzed in this version.',
  },
  {
    icon: 'bi-file-earmark-x',
    text: 'Source code is never stored; only the graph structure and metadata are stored.',
  },
  {
    icon: 'bi-send',
    text: "Code excerpts are sent to Google's Gemini API when the user requests an AI analysis, and the free tier allows Google to use submitted content to improve its products.",
  },
  {
    icon: 'bi-trash3',
    text: "Users can delete a repository's data at any time.",
  },
];

/** Privacy and AI notice (spec 8.2, 8.4). */
export default function Privacy() {
  return (
    <>
      <article className="text-page">
        <h1>Privacy and AI notice</h1>
        <p className="lead-text">What Graph Code does with a repository you analyze.</p>
        <ul>
          {STATEMENTS.map((statement) => (
            <li key={statement.icon}>
              <i className={`bi ${statement.icon}`} aria-hidden="true" />
              <span>{statement.text}</span>
            </li>
          ))}
        </ul>
      </article>
      <Footer />
    </>
  );
}
