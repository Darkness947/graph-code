/**
 * Structural importance (spec 8.6 item 7): files in the top 10% by `fanIn` get a 2 px border
 * and a larger size, the top 3% a 3 px border and the largest size. Importance is shown by
 * size and border weight only, never by colour (spec 8.1).
 *
 * The cut-off is the `fanIn` of the file at rank `max(1, floor(n × share))` once files are
 * sorted by `fanIn`, highest first. Files tied with that value are included, and a file nobody
 * imports (`fanIn` 0) is never ranked.
 */

export const TOP_SHARE = 0.1;
export const PEAK_SHARE = 0.03;

/**
 * @param {Array<{ type: string, metrics?: { fanIn?: number } }>} nodes graph nodes (folders are ignored)
 * @returns {{ top: number, peak: number }} the minimum `fanIn` for each tier; `Infinity` when none qualifies
 */
export function centralityThresholds(nodes) {
  const fanIns = nodes
    .filter((n) => n.type === 'file')
    .map((n) => n.metrics?.fanIn ?? 0)
    .sort((a, b) => b - a);
  const cutoff = (share) => {
    if (fanIns.length === 0) return Infinity;
    const rank = Math.max(1, Math.floor(fanIns.length * share));
    const value = fanIns[rank - 1];
    return value > 0 ? value : Infinity;
  };
  return { top: cutoff(TOP_SHARE), peak: cutoff(PEAK_SHARE) };
}

/**
 * @param {number} fanIn
 * @param {{ top: number, peak: number }} thresholds
 * @returns {0 | 1 | 2} 0 = ordinary, 1 = top 10% (2 px), 2 = top 3% (3 px)
 */
export function centralityTier(fanIn, thresholds) {
  if (fanIn >= thresholds.peak) return 2;
  if (fanIn >= thresholds.top) return 1;
  return 0;
}
