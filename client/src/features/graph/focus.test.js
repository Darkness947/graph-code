import { describe, expect, it } from 'vitest';
import { makeGraph } from '../../../test/graphFixture.js';
import { computeFocusSet, highlightedVisibleIds } from './focus.js';
import { buildGraphIndex } from './graphIndex.js';

const index = (files, imports) => buildGraphIndex(makeGraph(files, imports));
const sorted = (set) => [...set].sort();

describe('computeFocusSet', () => {
  const chain = index(
    ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
    [
      ['a.ts', 'b.ts'],
      ['b.ts', 'c.ts'],
      ['c.ts', 'd.ts'],
      ['d.ts', 'e.ts'],
      ['e.ts', 'f.ts'],
    ],
  );

  it('starts with the file and reaches two hops in both directions', () => {
    const set = computeFocusSet(chain, 'f:c.ts');
    expect(set[0]).toBe('f:c.ts');
    expect(sorted(set)).toEqual(['f:a.ts', 'f:b.ts', 'f:c.ts', 'f:d.ts', 'f:e.ts']);
  });

  it('stops at two hops', () => {
    expect(sorted(computeFocusSet(chain, 'f:a.ts'))).toEqual(['f:a.ts', 'f:b.ts', 'f:c.ts']);
  });

  it('does not include files that only share an import with the file', () => {
    const shared = index(
      ['a.ts', 'b.ts', 'u.ts'],
      [
        ['a.ts', 'u.ts'],
        ['b.ts', 'u.ts'],
      ],
    );
    expect(sorted(computeFocusSet(shared, 'f:a.ts'))).toEqual(['f:a.ts', 'f:u.ts']);
  });

  it('follows direction: a hop into a file does not turn around to its other importers', () => {
    const g = index(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      [
        ['a.ts', 'b.ts'],
        ['c.ts', 'b.ts'],
        ['c.ts', 'd.ts'],
      ],
    );
    expect(sorted(computeFocusSet(g, 'f:a.ts'))).toEqual(['f:a.ts', 'f:b.ts']);
  });

  it('handles cycles and files with no edges', () => {
    const cycle = index(
      ['a.ts', 'b.ts', 'z.ts'],
      [
        ['a.ts', 'b.ts'],
        ['b.ts', 'a.ts'],
      ],
    );
    expect(sorted(computeFocusSet(cycle, 'f:a.ts'))).toEqual(['f:a.ts', 'f:b.ts']);
    expect(computeFocusSet(cycle, 'f:z.ts')).toEqual(['f:z.ts']);
  });
});

describe('highlightedVisibleIds', () => {
  it('maps files to visible nodes and adds the trays around them', () => {
    const ancestors = new Map([
      ['f:a', 'f:a'],
      ['f:b', 'd:closed'],
      ['f:c', 'd:closed'],
    ]);
    const parentOf = new Map([
      ['f:a', 'd:tray'],
      ['d:tray', 'd:outer'],
      ['d:outer', null],
      ['d:closed', null],
    ]);
    expect(sorted(highlightedVisibleIds(['f:a', 'f:b', 'f:c'], ancestors, parentOf))).toEqual([
      'd:closed',
      'd:outer',
      'd:tray',
      'f:a',
    ]);
  });
});
