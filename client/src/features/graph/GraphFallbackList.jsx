export const LAYOUT_FAILED = "The graph couldn't be drawn for this repository.";

/**
 * Shown instead of the canvas when layout throws (spec 8.6 item 11): every file with its
 * import counts, so the workspace is never blank.
 * @param {{ nodes: Iterable<{ type: string, path: string, metrics?: { fanIn?: number, fanOut?: number } }> }} props
 */
export default function GraphFallbackList({ nodes }) {
  const files = [...nodes]
    .filter((n) => n.type === 'file')
    .sort((a, b) => a.path.localeCompare(b.path));
  return (
    <section className="gc-fallback" aria-labelledby="gc-fallback-title">
      <p id="gc-fallback-title" className="gc-fallback-message" role="alert">
        <i className="bi bi-diagram-3" aria-hidden="true" /> {LAYOUT_FAILED}
      </p>
      <table className="gc-fallback-table">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Imports</th>
            <th scope="col">Used by</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.path}>
              <td className="gc-fallback-path">{f.path}</td>
              <td>{f.metrics?.fanOut ?? 0}</td>
              <td>{f.metrics?.fanIn ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
