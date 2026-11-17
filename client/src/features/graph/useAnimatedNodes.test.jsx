import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedNodes } from './useAnimatedNodes.js';

const node = (id, x, extra = {}) => ({
  id,
  position: { x, y: 0 },
  width: 100,
  height: 50,
  ...extra,
});
const motion = (reduce) =>
  vi.stubGlobal('matchMedia', (query) => ({ matches: reduce && query.includes('reduce') }));

describe('useAnimatedNodes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the first layout without motion', () => {
    motion(false);
    const first = [node('a', 0)];
    const { result } = renderHook(({ t }) => useAnimatedNodes(t), { initialProps: { t: first } });
    expect(result.current).toMatchObject({ nodes: first, moving: false });
  });

  it('moves existing nodes from where they were to the new layout', async () => {
    motion(false);
    const { result, rerender } = renderHook(({ t }) => useAnimatedNodes(t), {
      initialProps: { t: [node('a', 0)] },
    });
    const next = [node('a', 300, { width: 200 }), node('b', 50)];
    rerender({ t: next });

    // The first frame starts where `a` was drawn; `b` is new and appears in place.
    expect(result.current.moving).toBe(true);
    expect(result.current.nodes[0].position.x).toBe(0);
    expect(result.current.nodes[1]).toBe(next[1]);

    await waitFor(() => expect(result.current.moving).toBe(false));
    expect(result.current.nodes).toBe(next);
  });

  it('jumps straight to the new layout under reduced motion', () => {
    motion(true);
    const { result, rerender } = renderHook(({ t }) => useAnimatedNodes(t), {
      initialProps: { t: [node('a', 0)] },
    });
    const next = [node('a', 300)];
    rerender({ t: next });
    expect(result.current).toMatchObject({ nodes: next, moving: false });
  });

  it('does not slide a node that moved into a different folder', () => {
    motion(false);
    const { result, rerender } = renderHook(({ t }) => useAnimatedNodes(t), {
      initialProps: { t: [node('a', 0)] },
    });
    const next = [node('p', 0), node('a', 40, { parentId: 'p' })];
    rerender({ t: next });
    expect(result.current.nodes[1]).toBe(next[1]);
  });

  it('moves a dragged node in place, leaving the others untouched', () => {
    motion(false);
    const start = [node('a', 0), node('b', 300)];
    const { result } = renderHook(({ t }) => useAnimatedNodes(t), { initialProps: { t: start } });
    act(() => result.current.moveNode('a', { x: 40, y: 25 }));
    expect(result.current.nodes[0].position).toEqual({ x: 40, y: 25 });
    expect(result.current.nodes[1]).toBe(start[1]);
  });

  it('animates the next layout from where a node was dragged', () => {
    motion(false);
    const { result, rerender } = renderHook(({ t }) => useAnimatedNodes(t), {
      initialProps: { t: [node('a', 0)] },
    });
    act(() => result.current.moveNode('a', { x: 500, y: 0 }));
    rerender({ t: [node('a', 100)] });
    expect(result.current.nodes[0].position.x).toBe(500);
  });
});
