import { describe, expect, it } from 'vitest';
import { codeTheme, prismLanguage } from './codeLanguage.js';

describe('prismLanguage', () => {
  it('maps each supported extension', () => {
    expect(prismLanguage('src/a.ts')).toBe('typescript');
    expect(prismLanguage('src/a.tsx')).toBe('tsx');
    for (const ext of ['js', 'jsx', 'mjs', 'cjs']) {
      expect(prismLanguage(`src/a.${ext}`)).toBe('jsx');
    }
  });
});

describe('codeTheme', () => {
  it('uses design tokens only, never a risk colour', () => {
    const colours = codeTheme.styles.map((s) => s.style.color).filter(Boolean);
    expect(colours.every((c) => c.startsWith('var(--'))).toBe(true);
    expect(colours.join()).not.toMatch(/risk|danger/);
  });
});
