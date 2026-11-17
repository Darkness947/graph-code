import { useEffect, useState } from 'react';

export const MOVE_MS = 300;

const ease = (t) => 1 - (1 - t) ** 3;
const mix = (a, b, t) => a + (b - a) * t;
const reducedMotion = () =>
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** One frame between the drawn nodes and the new layout, `k` in 0..1. */
function between(from, target, k) {
  const before = new Map(from.map((n) => [n.id, n]));
  return target.map((n) => {
    const p = before.get(n.id);
    if (!p || p.parentId !== n.parentId) return n;
    return {
      ...n,
      position: { x: mix(p.position.x, n.position.x, k), y: mix(p.position.y, n.position.y, k) },
      width: mix(p.width, n.width, k),
      height: mix(p.height, n.height, k),
    };
  });
}

/**
 * Moves nodes from where they are drawn now to a new layout over about 300 ms (spec 8.6
 * item 6). Positions and folder sizes are interpolated frame by frame, so edges follow their
 * nodes. Nodes that are new, or that changed parent, appear at their place straight away.
 * The first layout is shown without motion, and so is every layout under reduced motion.
 * @param {object[]} target React Flow nodes from the layout
 * @returns {{ nodes: object[], moving: boolean }}
 */
export function useAnimatedNodes(target) {
  const [anim, setAnim] = useState({ target, from: target, nodes: target, moving: false });

  // A new layout: start from what is drawn now (adjusting state during render, so no frame
  // of the final layout is ever shown before the motion starts).
  if (anim.target !== target) {
    const instant = reducedMotion();
    setAnim({
      target,
      from: anim.nodes,
      nodes: instant ? target : between(anim.nodes, target, 0),
      moving: !instant,
    });
  }

  const { moving, from } = anim;
  useEffect(() => {
    if (!moving) return undefined;
    const start = performance.now();
    let raf = 0;
    // Read the clock here rather than trusting the frame timestamp, whose origin can differ.
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / MOVE_MS);
      setAnim((a) =>
        a.target === target
          ? { ...a, nodes: t === 1 ? target : between(from, target, ease(t)), moving: t < 1 }
          : a,
      );
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [moving, from, target]);

  return { nodes: anim.nodes, moving: anim.moving };
}
