import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';
import { zipFixtureRepo } from '../helpers/fixtures.js';
import { DEFAULT_LIMITS as LIMITS } from '../helpers/limits.js';
import {
  createPipelineSteps,
  startIngestion,
} from '../../src/services/ingestion/startIngestion.js';
import { buildGraphModel } from '../../src/services/ingestion/graphModel.js';
import { createParserService } from '../../src/services/ingestion/parsing/parserService.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

/** The native parser, except that it fails on the fixture's `src/broken.js` (parse_error). */
const native = createParserService({ backend: 'native' });
const parserService = {
  parse: (grammar, text) => {
    if (text.includes('FORCE_PARSE_ERROR')) throw new Error('forced parse error');
    return native.parse(grammar, text);
  },
};

describe.skipIf(!hasTestDb)('parse, resolve and build a fixture ZIP (integration)', () => {
  let pool;
  /** What the persisting stub saw: the graph model and the job row at that moment. */
  let model;
  let jobAtPersisting;
  let finalJob;

  beforeAll(async () => {
    pool = await resetTestDatabase();
    const user = await pool.query(
      `INSERT INTO users (github_id, github_login, access_token_enc, token_key_id)
       VALUES (1, 'u', $1, 1) RETURNING id`,
      [Buffer.from('encrypted')],
    );
    const repo = await pool.query(
      `INSERT INTO repositories (user_id, owner, name, display_name, default_branch, visibility)
       VALUES ($1, 'octo', 'sample', 'Octo/sample', 'main', 'public') RETURNING id`,
      [user.rows[0].id],
    );

    const archive = await zipFixtureRepo('ingest-sample', {
      'node_modules/react/index.js': 'module.exports = {};',
      'src/app.test.tsx': "import './app';",
      'src/__tests__/lazy.js': "require('../lazy');",
      'src/types.d.ts': 'declare const x: number;',
      'dist/bundle.js': "import './src/app';",
    });
    const github = {
      getHeadCommit: vi.fn().mockResolvedValue(SHA),
      downloadArchive: vi.fn().mockResolvedValue(archive),
    };
    const crypto = { decrypt: vi.fn(() => 'gho_token') };
    const steps = {
      ...createPipelineSteps({ pool, crypto, github, limits: LIMITS, parserService }),
      // Persisting belongs to T2.5: build the rows it will write, then stop.
      persisting: async (ctx) => {
        model = buildGraphModel(ctx.fileGraph);
        jobAtPersisting = (
          await pool.query('SELECT * FROM ingestion_jobs WHERE id = $1', [ctx.job.id])
        ).rows[0];
        throw new Error('stop before persisting');
      },
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const queue = await startIngestion({ pool, concurrency: 1, steps, logger });
    const job = await pool.query(
      `INSERT INTO ingestion_jobs (repository_id, job_type) VALUES ($1, 'initial') RETURNING id`,
      [repo.rows[0].id],
    );
    queue.enqueue(job.rows[0].id);
    await queue.idle();
    finalJob = (await pool.query('SELECT * FROM ingestion_jobs WHERE id = $1', [job.rows[0].id]))
      .rows[0];
  });
  afterAll(async () => {
    await pool?.end();
  });

  const pathOf = (id) => model.nodes.find((n) => n.id === id).path;

  it('runs every phase up to persisting', () => {
    expect(jobAtPersisting).toMatchObject({ status: 'running', phase: 'persisting' });
    // Only the persisting stub failed the job.
    expect(finalJob).toMatchObject({ phase: 'persisting', error_code: 'PERSIST_FAILED' });
  });

  it('AC1: the fixture ingests into exactly the expected nodes', () => {
    expect(model.nodes.map((n) => `${n.nodeType} ${n.path} ${JSON.stringify(n.metrics)}`)).toEqual([
      'file index.js {"fanIn":0,"fanOut":2}',
      'folder src {"fileCount":7}',
      'file src/app.tsx {"fanIn":1,"fanOut":3}',
      'folder src/components {"fileCount":3}',
      'file src/components/Button.jsx {"fanIn":2,"fanOut":1}',
      'file src/components/Card.tsx {"fanIn":1,"fanOut":0}',
      'file src/components/index.ts {"fanIn":1,"fanOut":2}',
      'file src/lazy.js {"fanIn":1,"fanOut":0}',
      'folder src/lib {"fileCount":2}',
      'file src/lib/format.ts {"fanIn":2,"fanOut":1}',
      'file src/lib/util.ts {"fanIn":2,"fanOut":1}',
    ]);
  });

  it('AC1: the fixture ingests into exactly the expected edges, importer -> imported', () => {
    expect(model.edges.map((e) => `${pathOf(e.source)} -> ${pathOf(e.target)}`).sort()).toEqual([
      'index.js -> src/app.tsx',
      'index.js -> src/lazy.js',
      'src/app.tsx -> src/components/Button.jsx',
      'src/app.tsx -> src/components/index.ts',
      'src/app.tsx -> src/lib/util.ts',
      'src/components/Button.jsx -> src/lib/format.ts',
      'src/components/index.ts -> src/components/Button.jsx',
      'src/components/index.ts -> src/components/Card.tsx',
      'src/lib/format.ts -> src/lib/util.ts',
      'src/lib/util.ts -> src/lib/format.ts',
    ]);
  });

  it('AC2: folder and file nodes carry their columns', () => {
    const byPath = Object.fromEntries(model.nodes.map((n) => [n.path, n]));
    expect(byPath['src/components']).toMatchObject({
      name: 'components',
      pathLtree: 'r.src.components',
      language: null,
      contentHash: null,
    });
    expect(byPath['src/components/Card.tsx']).toMatchObject({
      name: 'Card.tsx',
      language: 'tsx',
      exports: ['Card'],
      sizeBytes: 35,
    });
    expect(byPath['src/components/Card.tsx'].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(model.languageSummary).toEqual({ js: 2, tsx: 2, jsx: 1, ts: 3 });
  });

  it('AC3: unresolved imports are recorded with their reasons', () => {
    expect(
      model.unresolved
        .map((u) => `${pathOf(u.sourceNodeId)} | ${u.rawSpecifier} | ${u.reason}`)
        .sort(),
    ).toEqual([
      'src/app.tsx | ./missing | file_not_found',
      'src/app.tsx | @/nope/thing | alias_not_found',
      'src/app.tsx | dynamic import (line 7) | dynamic_import',
      'src/components/Button.jsx | ../../../outside | outside_repo',
    ]);
    expect(model.report).toEqual({
      skippedFiles: [{ path: 'src/broken.js', reason: 'parse_error' }],
      unresolvedCount: 4,
    });
  });

  it('AC4: parsing leaves every file processed and the parse failure skipped', () => {
    expect(jobAtPersisting).toMatchObject({
      files_total: 9,
      files_processed: 9,
      files_skipped: 1,
    });
  });
});
