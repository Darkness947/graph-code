import { describe, expect, it } from 'vitest';
import { routedPath, strokeFor } from './AggregateEdge.jsx';

describe('routedPath', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 50, y: 100 },
    { x: 0, y: 200 },
  ];

  it('starts and ends at the handles and passes through the route', () => {
    const [d, labelX, labelY] = routedPath(route, 0, 0, 0, 200);
    expect(d.startsWith('M 0,0')).toBe(true);
    expect(d.endsWith('0,200')).toBe(true);
    expect(d).toContain(' 50,100');
    expect([labelX, labelY]).toEqual([25, 150]);
  });

  it('carries the inner points along when the ends move (during animation)', () => {
    const [d] = routedPath(route, 10, 0, 10, 200);
    expect(d).toContain(' 60,100');
  });
});

describe('strokeFor', () => {
  it('grows with the number of imports, from 1.25 to 3 px', () => {
    expect(strokeFor(1)).toBe(1.25);
    expect(strokeFor(4)).toBe(2.25);
    expect(strokeFor(1000)).toBe(3);
  });
});
