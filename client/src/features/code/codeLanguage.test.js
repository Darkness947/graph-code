import { describe, expect, it } from 'vitest';
import { clampDrawerHeight, codeTheme, prismLanguage } from './codeLanguage.js';

describe('prismLanguage', () => {
  it('maps each supported extension', () => {
    expect(prismLanguage('src/a.ts')).toBe('typescript');
    expect(prismLanguage('src/a.tsx')).toBe('tsx');
    for (const ext of ['js', 'jsx', 'mjs', 'cjs']) {
      expect(prismLanguage(`src/a.${ext}`)).toBe('jsx');
    }
  });
});

describe('clampDrawerHeight', () => {
  it('keeps the drawer between 20% and 70%', () => {
    expect(clampDrawerHeight(5)).toBe(20);
    expect(clampDrawerHeight(40)).toBe(40);
    expect(clampDrawerHeight(95)).toBe(70);
    expect(clampDrawerHeight(NaN)).toBe(20);
  });
});

describe('codeTheme', () => {
  it('uses design tokens only, never a risk colour', () => {
    const colours = codeTheme.styles.map((s) => s.style.color).filter(Boolean);
    expect(colours.every((c) => c.startsWith('var(--'))).toBe(true);
    expect(colours.join()).not.toMatch(/risk|danger/);
  });
});
