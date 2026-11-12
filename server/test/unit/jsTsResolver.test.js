import { describe, expect, it } from 'vitest';
import { JsTsResolver } from '../../src/services/ingestion/resolvers/jsTsResolver.js';
import { LanguageResolver } from '../../src/services/ingestion/resolvers/LanguageResolver.js';

function make(paths, config) {
  const resolver = new JsTsResolver();
  resolver.configure(config ? [{ path: 'tsconfig.json', content: config }] : []);
  const index = new Set(paths);
  return (spec, from) => resolver.resolve(spec, from, index);
}

describe('JsTsResolver', () => {
  it('supports JavaScript and TypeScript only', () => {
    const r = new JsTsResolver();
    expect(r).toBeInstanceOf(LanguageResolver);
    expect(r.supports('javascript')).toBe(true);
    expect(r.supports('typescript')).toBe(true);
    expect(r.supports('python')).toBe(false);
  });

  describe('relative specifiers and candidate order', () => {
    const resolve = make([
      'src/a.ts',
      'src/a.js',
      'src/b.tsx',
      'src/dir/index.ts',
      'src/dir2/index.js',
      'src/esm.ts',
      'src/comp.tsx',
      'src/both.js',
      'src/both.ts',
      'src/exact.json.js',
      'src/main.ts',
      'top.ts',
    ]);

    it('tries the extensions in order', () => {
      expect(resolve('./a', 'src/main.ts')).toEqual({ path: 'src/a.js' });
      expect(resolve('./b', 'src/main.ts')).toEqual({ path: 'src/b.tsx' });
    });
    it('resolves a directory to its index file', () => {
      expect(resolve('./dir', 'src/main.ts')).toEqual({ path: 'src/dir/index.ts' });
      expect(resolve('./dir2/', 'src/main.ts')).toEqual({ path: 'src/dir2/index.js' });
    });
    it('maps .js to .ts and .tsx when no .js file exists', () => {
      expect(resolve('./esm.js', 'src/main.ts')).toEqual({ path: 'src/esm.ts' });
      expect(resolve('./comp.js', 'src/main.ts')).toEqual({ path: 'src/comp.tsx' });
    });
    it('prefers the file as written over the mapping', () => {
      expect(resolve('./both.js', 'src/main.ts')).toEqual({ path: 'src/both.js' });
    });
    it('normalizes .. segments', () => {
      expect(resolve('../top', 'src/main.ts')).toEqual({ path: 'top.ts' });
      expect(resolve('./../src/./a.ts', 'src/main.ts')).toEqual({ path: 'src/a.ts' });
    });
    it('resolves from a root-level file', () => {
      expect(resolve('./top', 'root.ts')).toEqual({ path: 'top.ts' });
      expect(resolve('.', 'src/main.ts')).toEqual({ unresolved: 'file_not_found' });
    });
    it('reports file_not_found', () => {
      expect(resolve('./nope', 'src/main.ts')).toEqual({ unresolved: 'file_not_found' });
    });
    it('reports outside_repo when the path escapes the root', () => {
      expect(resolve('../../x', 'src/main.ts')).toEqual({ unresolved: 'outside_repo' });
      expect(resolve('../x', 'main.ts')).toEqual({ unresolved: 'outside_repo' });
      expect(resolve('/etc/passwd', 'src/main.ts')).toEqual({ unresolved: 'outside_repo' });
    });
  });

  describe('bare packages', () => {
    const resolve = make(['src/main.ts']);
    it.each(['react', '@scope/pkg', 'node:fs', 'lodash/fp'])('treats %s as external', (spec) => {
      expect(resolve(spec, 'src/main.ts')).toEqual({ external: true });
    });
  });

  describe('aliases with baseUrl', () => {
    const config = `{
      // comment
      "compilerOptions": { "baseUrl": "src", "paths": { "@/*": ["*"], "~l/*": ["lib/*", "alt/*"], "gone/*": ["x/*"], }, },
    }`;
    const resolve = make(['src/utils/a.ts', 'src/lib/b.ts', 'src/alt/c.ts'], config);

    it('applies a wildcard mapping', () => {
      expect(resolve('@/utils/a', 'src/app.ts')).toEqual({ path: 'src/utils/a.ts' });
    });
    it('tries every target of a mapping in order', () => {
      expect(resolve('~l/b', 'src/app.ts')).toEqual({ path: 'src/lib/b.ts' });
      expect(resolve('~l/c', 'src/app.ts')).toEqual({ path: 'src/alt/c.ts' });
    });
    it('reports alias_not_found when a mapping matches but nothing exists', () => {
      expect(resolve('gone/x', 'src/app.ts')).toEqual({ unresolved: 'alias_not_found' });
      expect(resolve('@/missing', 'src/app.ts')).toEqual({ unresolved: 'alias_not_found' });
    });
    it('resolves a bare specifier under baseUrl, otherwise it is external', () => {
      expect(resolve('utils/a', 'src/app.ts')).toEqual({ path: 'src/utils/a.ts' });
      expect(resolve('react', 'src/app.ts')).toEqual({ external: true });
    });
  });

  describe('aliases without baseUrl', () => {
    const resolve = make(
      ['src/a.ts', 'config/index.ts'],
      '{ "compilerOptions": { "paths": { "@/*": ["src/*"], "@config": ["config/index.ts"] } } }',
    );
    it('resolves paths relative to the tsconfig location', () => {
      expect(resolve('@/a', 'src/app.ts')).toEqual({ path: 'src/a.ts' });
      expect(resolve('@config', 'src/app.ts')).toEqual({ path: 'config/index.ts' });
    });
    it('does not treat a bare name as a baseUrl file', () => {
      expect(resolve('src/a', 'src/app.ts')).toEqual({ external: true });
    });
  });

  describe('configuration', () => {
    it('uses jsconfig.json when there is no tsconfig.json', () => {
      const resolver = new JsTsResolver();
      resolver.configure([
        { path: 'jsconfig.json', content: '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' },
      ]);
      expect(resolver.resolve('@/a', 'x.js', new Set(['src/a.js']))).toEqual({ path: 'src/a.js' });
    });
    it('ignores a tsconfig in a subdirectory and invalid JSON', () => {
      const resolver = new JsTsResolver();
      resolver.configure([
        { path: 'sub/tsconfig.json', content: '{"compilerOptions":{"baseUrl":"x"}}' },
      ]);
      expect(resolver.baseUrl).toBeNull();
      resolver.configure([{ path: 'tsconfig.json', content: '{{{ not json' }]);
      expect(resolver.paths).toEqual([]);
    });
    it('works with a missing tsconfig', () => {
      const resolve = make(['a.ts']);
      expect(resolve('@/a', 'b.ts')).toEqual({ external: true });
    });
    it('does not follow extends', () => {
      const resolve = make(['src/a.ts'], '{ "extends": "./base.json", "compilerOptions": {} }');
      expect(resolve('@/a', 'x.ts')).toEqual({ external: true });
    });
  });
});

describe('JsTsResolver root index and odd specifiers', () => {
  const resolver = new JsTsResolver();
  resolver.configure([
    {
      path: 'tsconfig.json',
      content: '{"compilerOptions":{"baseUrl":".","paths":{"@root":["."]}}}',
    },
  ]);
  const index = new Set(['index.ts', 'a/b.ts']);

  it('resolves a directory import that lands on the repository root', () => {
    expect(resolver.resolve('..', 'a/b.ts', index)).toEqual({ path: 'index.ts' });
    expect(resolver.resolve('.', 'x.ts', index)).toEqual({ path: 'index.ts' });
    expect(resolver.resolve('@root', 'a/b.ts', index)).toEqual({ path: 'index.ts' });
  });

  it('treats an empty specifier as external', () => {
    expect(resolver.resolve('', 'a/b.ts', index)).toEqual({ external: true });
  });
});
