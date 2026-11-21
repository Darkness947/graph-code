// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('browser-tab icon', () => {
  it('index.html links the SVG favicon', () => {
    expect(read('../index.html')).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    );
  });

  it('the favicon draws the navbar mark in --accent-blue', () => {
    const svg = read('../public/favicon.svg');
    const tokens = read('../src/styles/tokens.css');
    const navBar = read('../src/components/NavBar.jsx');
    const accent = /--accent-blue:\s*(#[0-9a-f]{6})/i.exec(tokens)[1];
    expect(svg).toContain(`stroke="${accent}"`);
    expect(svg).toContain(`fill="${accent}"`);
    const shapes = [...svg.matchAll(/ (d|cx|cy|r)="([^"]+)"/g)];
    expect(shapes).toHaveLength(10); // one path d + three circles × (cx, cy, r)
    for (const shape of shapes) {
      expect(navBar).toContain(`${shape[1]}="${shape[2]}"`);
    }
  });
});
