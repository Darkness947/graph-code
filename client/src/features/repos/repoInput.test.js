import { describe, expect, it } from 'vitest';
import { parseRepoInput } from './repoInput.js';

describe('parseRepoInput', () => {
  it.each([
    ['octocat/hello', { owner: 'octocat', name: 'hello' }],
    ['  octocat/hello.git ', { owner: 'octocat', name: 'hello' }],
    ['https://github.com/octocat/hello', { owner: 'octocat', name: 'hello' }],
    ['https://github.com/octocat/hello/tree/main', { owner: 'octocat', name: 'hello' }],
  ])('accepts %s', (input, expected) => {
    expect(parseRepoInput(input)).toEqual(expected);
  });

  it.each([
    '',
    'octocat',
    'a/b/c',
    '-bad/name',
    'octocat/..',
    'http://github.com/octocat/hello',
    'https://evil.com/octocat/hello',
    'https://user@github.com/octocat/hello',
    'https://github.com/octocat',
    42,
  ])('rejects %s', (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });
});
