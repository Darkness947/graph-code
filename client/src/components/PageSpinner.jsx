/** A centred spinner for a page or panel that is loading. */
export default function PageSpinner({ label = 'Loading…' }) {
  return (
    <div className="centered-fill">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">{label}</span>
      </div>
    </div>
  );
}
