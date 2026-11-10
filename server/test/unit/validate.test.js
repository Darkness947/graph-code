import { describe, it, expect } from 'vitest';
import { OWNER_RE, NAME_RE, isUuid, parseRepoInput } from '../../src/middleware/validate.js';

describe('OWNER_RE and NAME_RE', () => {
  it('accepts normal GitHub owners and rejects invalid ones', () => {
    for (const ok of ['vercel', 'a', 'Darkness947', 'my-org', 'a'.repeat(39)]) {
      expect(OWNER_RE.test(ok)).toBe(true);
    }
    for (const bad of ['', '-lead', 'a'.repeat(40), 'has space', 'a_b', 'a/b', 'a.b']) {
      expect(OWNER_RE.test(bad)).toBe(false);
    }
  });

  it('accepts normal repository names and rejects invalid ones', () => {
    for (const ok of ['next-learn', 'next.js', 'a_b', 'A', 'a'.repeat(100)]) {
      expect(NAME_RE.test(ok)).toBe(true);
    }
    for (const bad of ['', 'a'.repeat(101), 'has space', 'a/b', 'a;b', 'a$b']) {
      expect(NAME_RE.test(bad)).toBe(false);
    }
  });
});

describe('isUuid', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isUuid('3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b')).toBe(true);
    expect(isUuid('3F2B8C1E-9A4D-4E6F-8B1A-2C3D4E5F6A7B')).toBe(true);
    for (const bad of ['', 'abc', '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7', null, undefined, 42]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe('parseRepoInput', () => {
  it('parses owner/name', () => {
    expect(parseRepoInput('vercel/next-learn')).toEqual({ owner: 'vercel', name: 'next-learn' });
    expect(parseRepoInput('  vercel/next-learn  ')).toEqual({
      owner: 'vercel',
      name: 'next-learn',
    });
  });

  it('parses github.com URLs, including trailing slash, .git and extra path', () => {
    const expected = { owner: 'vercel', name: 'next-learn' };
    expect(parseRepoInput('https://github.com/vercel/next-learn')).toEqual(expected);
    expect(parseRepoInput('https://github.com/vercel/next-learn/')).toEqual(expected);
    expect(parseRepoInput('https://github.com/vercel/next-learn.git')).toEqual(expected);
    expect(parseRepoInput('https://github.com/vercel/next-learn/tree/main/src')).toEqual(expected);
  });

  it('rejects URLs whose host is not exactly github.com', () => {
    for (const bad of [
      'https://gitlab.com/a/b',
      'https://evil.com/github.com/a/b',
      'https://github.com.evil.com/a/b',
      'https://www.github.com/a/b',
      'http://github.com/a/b',
      'https://user:pw@github.com/a/b',
      'https://github.com:8443/a/b',
      'https://api.github.com/repos/a/b',
    ]) {
      expect(parseRepoInput(bad)).toBeNull();
    }
  });

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      'vercel',
      'a/b/c',
      '/b',
      'a/',
      'a/..',
      'a/.',
      '-a/b',
      'a/b c',
      'https://github.com/onlyowner',
      'https://',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(parseRepoInput(bad)).toBeNull();
    }
  });
});
