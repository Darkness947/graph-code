/** A centred panel for a short message with one or two actions (error, not found). */
export default function MessagePanel({ icon, failure = false, title, text, children }) {
  return (
    <div className="centered-fill">
      <section className="message-panel">
        <i
          className={`bi ${icon} message-icon${failure ? ' is-failure' : ''}`}
          aria-hidden="true"
        />
        <h1>{title}</h1>
        <p>{text}</p>
        <div className="message-actions">{children}</div>
      </section>
    </div>
  );
}
