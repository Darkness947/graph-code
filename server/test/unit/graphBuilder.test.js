import { describe, expect, it } from 'vitest';
import { buildFileGraph } from '../../src/services/ingestion/graphBuilder.js';
import { createParserService } from '../../src/services/ingestion/parsing/parserService.js';
import { loadFixtureRepo } from '../helpers/fixtures.js';

const parserService = createParserService({ backend: 'native' });
const build = (repo) => buildFileGraph(loadFixtureRepo(repo), { parserService });
const edgesOf = (graph) => graph.edges.map((e) => `${e.from} -> ${e.to}`).sort();
const unresolvedOf = (graph) =>
  graph.unresolved.map((u) => `${u.sourcePath} | ${u.specifier} | ${u.reason}`).sort();

describe('buildFileGraph on fixture repositories', () => {
  it('js-forms: every import form becomes an edge importer -> imported', () => {
    const graph = build('js-forms');
    expect(edgesOf(graph)).toEqual(
      ['a.js', 'b.js', 'c.jsx', 'side-effect.js', 'd.mjs', 'e.cjs', 'f.js', 'g.js', 'h.js']
        .map((to) => `main.js -> ${to}`)
        .sort(),
    );
    expect(unresolvedOf(graph)).toEqual([
      'main.js | dynamic import (line 10) | dynamic_import',
      'main.js | dynamic import (line 11) | dynamic_import',
    ]);
  });

  it('ts-forms: TypeScript-only forms resolve', () => {
    expect(edgesOf(build('ts-forms'))).toEqual([
      'main.ts -> legacy.ts',
      'main.ts -> types.ts',
      'main.ts -> types2.ts',
      'main.ts -> values.ts',
      'view.tsx -> values.ts',
    ]);
  });

  it('alias-baseurl: aliases, multiple targets, a commented tsconfig and baseUrl lookups', () => {
    const graph = build('alias-baseurl');
    expect(edgesOf(graph)).toEqual([
      'src/app.ts -> src/lib/b.ts',
      'src/app.ts -> src/shared/s.ts',
      'src/app.ts -> src/utils/a.ts',
    ]);
    expect(unresolvedOf(graph)).toEqual(['src/app.ts | missing/x | alias_not_found']);
  });

  it('alias-no-baseurl: paths resolve from the tsconfig location', () => {
    const graph = build('alias-no-baseurl');
    expect(edgesOf(graph)).toEqual(['src/app.ts -> config/index.ts', 'src/app.ts -> src/a.ts']);
    expect(unresolvedOf(graph)).toEqual(['src/app.ts | @/nope | alias_not_found']);
  });

  it('no-tsconfig: aliases stay external, relative imports still resolve', () => {
    const graph = build('no-tsconfig');
    expect(edgesOf(graph)).toEqual(['src/app.js -> src/b.js']);
    expect(graph.unresolved).toEqual([]);
  });

  it('resolution: index, .js->.ts, outside repo, bare, self, duplicate and circular imports', () => {
    const graph = build('resolution');
    expect(edgesOf(graph)).toEqual([
      'src/circular-a.ts -> src/circular-b.ts',
      'src/circular-b.ts -> src/circular-a.ts',
      'src/main.ts -> src/circular-a.ts',
      'src/main.ts -> src/esm.ts',
      'src/main.ts -> src/tsx-comp.tsx',
      'src/main.ts -> src/util.ts',
      'src/main.ts -> src/widgets/index.ts',
    ]);
    expect(unresolvedOf(graph)).toEqual([
      'src/main.ts | ../../outside | outside_repo',
      'src/main.ts | ./missing | file_not_found',
      'src/main.ts | dynamic import (line 11) | dynamic_import',
    ]);
  });

  it('records language, size, sha-256 hash and exports per file', () => {
    const graph = build('ts-forms');
    const view = graph.files.find((f) => f.path === 'view.tsx');
    expect(view.language).toBe('tsx');
    expect(view.exports).toEqual(['View', 'default']);
    expect(view.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.sizeBytes).toBeGreaterThan(0);
  });
});

describe('buildFileGraph failures', () => {
  it('skips a file whose parse throws, with reason parse_error', () => {
    const throwing = {
      parse: (grammar, text) => {
        if (text.includes('BOOM')) throw new Error('boom');
        return parserService.parse(grammar, text);
      },
    };
    const graph = buildFileGraph(
      {
        files: [
          { path: 'a.js', content: "import './b';" },
          { path: 'b.js', content: 'BOOM' },
        ],
      },
      { parserService: throwing },
    );
    expect(graph.skipped).toEqual([{ path: 'b.js', reason: 'parse_error' }]);
    expect(graph.files.map((f) => f.path)).toEqual(['a.js']);
    expect(unresolvedOf(graph)).toEqual(['a.js | ./b | file_not_found']);
  });

  it('ignores files with an unsupported extension', () => {
    const graph = buildFileGraph(
      { files: [{ path: 'README.md', content: '# hi' }] },
      { parserService },
    );
    expect(graph.files).toEqual([]);
    expect(graph.skipped).toEqual([]);
  });

  it('keeps tsx and js files in one resolution family', () => {
    const graph = buildFileGraph(
      {
        files: [
          { path: 'a.js', content: "import './b';" },
          { path: 'b.tsx', content: 'export const b = 1;' },
        ],
      },
      { parserService },
    );
    expect(edgesOf(graph)).toEqual(['a.js -> b.tsx']);
  });
});
