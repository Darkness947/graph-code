// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

// Spec 8.1, in table order.
const TOKENS = {
  '--bg-canvas': '#0d1117',
  '--bg-surface': '#161b22',
  '--bg-surface-hover': '#1c2128',
  '--border-default': '#30363d',
  '--text-primary': '#e6edf3',
  '--text-secondary': '#7d8590',
  '--accent-blue': '#2f81f7',
  '--risk-high': '#f85149',
  '--risk-medium': '#e3b341',
  '--risk-low': '#7d8590',
  '--progress-amber': '#d29922',
  '--success-green': '#3fb950',
  '--danger': '#da3633',
  '--node-default': '#21262d',
  '--edge-rest': 'rgb(139 148 158 / 12%)', // #8b949e at 12%
  '--edge-active': 'rgb(139 148 158 / 100%)', // #8b949e at 100%
  '--font-size-base': '14px',
  '--font-size-panel-title': '16px',
  '--font-size-page-title': '24px',
  '--topbar-height': '56px',
};

describe('design tokens (spec 8.1)', () => {
  it.each(Object.entries(TOKENS))('%s is %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });

  it('uses the monospace stack from the spec', () => {
    expect(css).toContain('--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;');
  });
});

describe('Bootstrap overrides and colour rules', () => {
  it.each([
    ['--bs-body-bg', '--bg-canvas'],
    ['--bs-body-color', '--text-primary'],
    ['--bs-border-color', '--border-default'],
    ['--bs-link-color', '--accent-blue'],
    ['--bs-primary', '--accent-blue'],
    ['--bs-card-bg', '--bg-surface'],
  ])('%s maps to %s', (bootstrapVar, token) => {
    expect(globalCss).toContain(`${bootstrapVar}: var(${token});`);
  });

  it('has no hex colours outside tokens.css', () => {
    expect(globalCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('never uses the reserved AI risk colours in the shell', () => {
    expect(globalCss).not.toMatch(/--risk-(high|medium)/);
  });
});
