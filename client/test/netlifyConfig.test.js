// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');

/** Splits `[[redirects]]` tables into plain key/value objects (the file is simple enough for this). */
function redirects() {
  return toml
    .split('[[redirects]]')
    .slice(1)
    .map((block) => {
      const rule = {};
      for (const [, key, value] of block.matchAll(/^\s*(\w+)\s*=\s*"?([^"\n]+)"?\s*$/gm)) {
        rule[key] = value;
      }
      return rule;
    });
}

describe('netlify.toml', () => {
  it('has no unfilled placeholder', () => {
    expect(toml).not.toMatch(/[<>]/);
  });

  it('proxies /api/* to the Render API as a forced 200 rewrite', () => {
    const [api] = redirects();
    expect(api.from).toBe('/api/*');
    expect(api.to).toMatch(/^https:\/\/[a-z0-9-]+\.onrender\.com\/api\/:splat$/);
    expect(api.status).toBe('200');
    expect(api.force).toBe('true');
  });

  it('serves the SPA shell for every other path, after the API rule', () => {
    const rules = redirects();
    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({ from: '/*', to: '/index.html', status: '200' });
  });

  it('builds with Node 26 and publishes dist', () => {
    expect(toml).toMatch(/NODE_VERSION\s*=\s*"26"/);
    expect(toml).toMatch(/publish\s*=\s*"dist"/);
  });
});
