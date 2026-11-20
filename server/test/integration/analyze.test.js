import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { tokenCryptoFromConfig } from '../../src/services/auth/tokenCrypto.js';
import { encodePathLtree } from '../../src/services/ingestion/ltree.js';
import { createGraphRepository } from '../../src/services/graph/graphRepository.js';
import { finalError } from '../../src/services/ai/geminiClient.js';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';
import { signIn } from '../helpers/auth.js';

const config = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY_HOPS: 1,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_KEY_ID: 1,
  MAX_ZIP_BYTES: 1000,
  GEMINI_MODELS: ['m1', 'm2', 'm3'],
  AI_TIMEOUT_MS: 20000,
  AI_ATTEMPT_TIMEOUT_MS: 12000,
};
const SHA = 'd'.repeat(40);
const ROOMY = { windowMs: 60_000, limit: 1000 };
const RATE_LIMITED_MESSAGE = /^You're doing that too often\. Try again in \d+ seconds\.$/;

/** A promise with its resolve and reject exposed, to hold Gemini mid-call. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const oauth = {
  authorizeUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCode: vi.fn(),
  fetchUser: vi.fn(),
};
const github = {
  getRepository: vi.fn(),
  listUserRepositories: vi.fn(),
  getFileSource: vi.fn(),
};
const gemini = { generateJson: vi.fn() };

const answer = (risks, extra = {}) => ({
  text: JSON.stringify({ summary: 'Changing utils.ts mainly affects the app.', risks }),
  model: 'm1',
  attempts: 1,
  latencyMs: 42,
  ...extra,
});
const GOOD_RISKS = [
  { path: 'src/app.tsx', level: 'high', reason: 'Calls format() directly.' },
  { path: 'main.js', level: 'low', reason: 'Indirect.' },
  { path: 'src/invented.ts', level: 'medium', reason: 'Not a real file.' },
];

describe.skipIf(!hasTestDb)('POST /api/repos/:id/analyze (integration)', () => {
  let pool;
  let app;
  let cookieA;
  let cookieB;
  let userA;
  let userB;
  let graphs;
  const crypto = tokenCryptoFromConfig(config);

  const userIdOf = async (ghId) =>
    (await pool.query('SELECT id FROM users WHERE github_id = $1', [ghId])).rows[0].id;

  async function insertRepo(userId, name, status = 'ready') {
    const { rows } = await pool.query(
      `INSERT INTO repositories (user_id, owner, name, display_name, default_branch, visibility,
         status, commit_sha, file_count, edge_count)
       VALUES ($1, 'darkness947', $2, $3, 'main', 'public', $4, $5, 3, 2)
       RETURNING id`,
      [userId, name, `Darkness947/${name}`, status, status === 'ready' ? SHA : null],
    );
    return rows[0].id;
  }

  async function insertNode(repoId, path, type = 'file') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO nodes (id, repository_id, path, path_ltree, name, node_type, language,
         size_bytes, content_hash)
       VALUES ($1, $2, $3, $4::ltree, $5, $6, $7, $8, $9)`,
      [
        id,
        repoId,
        path,
        encodePathLtree(path),
        path.split('/').pop(),
        type,
        type === 'file' ? 'ts' : null,
        type === 'file' ? 100 : null,
        type === 'file' ? `hash-${path}` : null,
      ],
    );
    return id;
  }

  async function insertEdges(repoId, pairs) {
    for (const [source, target] of pairs) {
      await pool.query(
        'INSERT INTO edges (repository_id, source_node_id, target_node_id) VALUES ($1, $2, $3)',
        [repoId, source, target],
      );
    }
  }

  /**
   * Files: src/lib/utils.ts (target), src/app.tsx and index.js import it, main.js imports
   * index.js, and utils.ts imports main.js (a cycle). A chain c1 ← c2 ← … ← c5 and a file
   * with no dependents. One folder.
   */
  async function seed(repoId) {
    const ids = {
      src: await insertNode(repoId, 'src', 'folder'),
      utils: await insertNode(repoId, 'src/lib/utils.ts'),
      app: await insertNode(repoId, 'src/app.tsx'),
      index: await insertNode(repoId, 'index.js'),
      main: await insertNode(repoId, 'main.js'),
      lonely: await insertNode(repoId, 'lonely.ts'),
    };
    for (let i = 1; i <= 5; i += 1) ids[`c${i}`] = await insertNode(repoId, `chain/c${i}.ts`);
    await insertEdges(repoId, [
      [ids.app, ids.utils],
      [ids.index, ids.utils],
      [ids.index, ids.app],
      [ids.main, ids.index],
      [ids.utils, ids.main],
      [ids.c2, ids.c1],
      [ids.c3, ids.c2],
      [ids.c4, ids.c3],
      [ids.c5, ids.c4],
    ]);
    return ids;
  }

  const analyze = (cookie, repoId, nodeId, mode = 'blast_radius') =>
    request(app).post(`/api/repos/${repoId}/analyze`).set('Cookie', cookie).send({ mode, nodeId });
  const auditRows = async (repoId) =>
    (
      await pool.query(
        `SELECT ai_result_id, session_id_hash, mode, target_path, input_hash, cache_hit, model,
           attempts, outcome, latency_ms
         FROM ai_audit_log WHERE repository_id = $1 ORDER BY id`,
        [repoId],
      )
    ).rows;
  const resultRows = async (repoId) =>
    (await pool.query('SELECT * FROM ai_results WHERE repository_id = $1', [repoId])).rows;

  beforeAll(async () => {
    pool = await resetTestDatabase();
    // A generous analyze limit: these tests send many requests per minute from one user.
    app = createApp(config, { pool, oauth, crypto, github, gemini, analyzeLimit: ROOMY });
    graphs = createGraphRepository(pool);
    cookieA = await signIn(app, oauth, 401);
    cookieB = await signIn(app, oauth, 402);
    userA = await userIdOf(401);
    userB = await userIdOf(402);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    github.getFileSource.mockReset().mockResolvedValue('export const x = 1;\n');
    gemini.generateJson.mockReset();
    await pool.query('DELETE FROM repositories');
  });

  describe('input and access', () => {
    it('requires a session', async () => {
      const id = randomUUID();
      const res = await request(app)
        .post(`/api/repos/${id}/analyze`)
        .send({ mode: 'blast_radius', nodeId: id });
      expect(res.status).toBe(401);
    });

    it('validates the id, mode and nodeId', async () => {
      const id = randomUUID();
      for (const res of [
        await analyze(cookieA, 'nope', id),
        await analyze(cookieA, id, 'nope'),
        await analyze(cookieA, id, id, 'summary'),
        await request(app).post(`/api/repos/${id}/analyze`).set('Cookie', cookieA).send({}),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it("returns 404 for another user's repository, an unknown node and a folder", async () => {
      const repoId = await insertRepo(userA, 'mine');
      const ids = await seed(repoId);
      expect((await analyze(cookieB, repoId, ids.utils)).status).toBe(404);
      expect((await analyze(cookieA, repoId, randomUUID())).status).toBe(404);
      const folder = await analyze(cookieA, repoId, ids.src);
      expect(folder.status).toBe(404);
      expect(folder.body.error.code).toBe('NOT_FOUND');
      expect(gemini.generateJson).not.toHaveBeenCalled();
      expect(await auditRows(repoId)).toHaveLength(0);
    });

    it('returns GRAPH_NOT_READY before ingestion succeeds', async () => {
      const repoId = await insertRepo(userA, 'busy', 'analyzing');
      const res = await analyze(cookieA, repoId, randomUUID());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GRAPH_NOT_READY');
    });
  });

  describe('dependents query (spec 7.6)', () => {
    it('follows cycles safely and returns each shortest distance, nearest first', async () => {
      const repoId = await insertRepo(userA, 'deps');
      const ids = await seed(repoId);
      const deps = await graphs.findDependents(userA, repoId, ids.utils);
      expect(deps.map((d) => [d.path, d.distance])).toEqual([
        ['index.js', 1],
        ['src/app.tsx', 1],
        ['main.js', 2],
      ]);
    });

    it('stops at depth 4 and is scoped to the owner', async () => {
      const repoId = await insertRepo(userA, 'chain');
      const ids = await seed(repoId);
      const deps = await graphs.findDependents(userA, repoId, ids.c1);
      expect(deps.map((d) => [d.path, d.distance])).toEqual([
        ['chain/c2.ts', 1],
        ['chain/c3.ts', 2],
        ['chain/c4.ts', 3],
        ['chain/c5.ts', 4],
      ]);
      expect(await graphs.findDependents(userA, repoId, ids.c2)).toHaveLength(3);
      expect(await graphs.findDependents(userB, repoId, ids.c1)).toEqual([]);
    });
  });

  describe('analysis, cache and audit', () => {
    it('misses, then hits the cache without calling Gemini again', async () => {
      const repoId = await insertRepo(userA, 'cache');
      const ids = await seed(repoId);
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));

      const first = await analyze(cookieA, repoId, ids.utils);
      expect(first.status).toBe(200);
      expect(Object.keys(first.body).sort()).toEqual(
        [
          'cached',
          'dependents',
          'generatedAt',
          'mode',
          'noDependents',
          'removedCount',
          'risks',
          'summary',
          'targetPath',
        ].sort(),
      );
      expect(first.body).toMatchObject({
        mode: 'blast_radius',
        targetPath: 'src/lib/utils.ts',
        cached: false,
        noDependents: false,
        dependents: [
          { path: 'index.js', distance: 1 },
          { path: 'src/app.tsx', distance: 1 },
          { path: 'main.js', distance: 2 },
        ],
        summary: 'Changing utils.ts mainly affects the app.',
        risks: [
          { path: 'src/app.tsx', level: 'high', reason: 'Calls format() directly.' },
          { path: 'main.js', level: 'low', reason: 'Indirect.' },
        ],
        removedCount: 1,
      });
      expect(Number.isNaN(Date.parse(first.body.generatedAt))).toBe(false);

      // The prompt carried the subgraph and the excerpts fetched at commit_sha.
      const call = gemini.generateJson.mock.calls[0][0];
      expect(call.prompt).toContain('- main.js (distance 2)');
      expect(call.prompt).toContain('export const x = 1;');
      expect(call.responseSchema.required).toEqual(['summary', 'risks']);
      expect(github.getFileSource).toHaveBeenCalledWith(
        'gho_401',
        'darkness947',
        'cache',
        'src/lib/utils.ts',
        SHA,
      );

      github.getFileSource.mockClear();
      const second = await analyze(cookieA, repoId, ids.utils);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ ...first.body, cached: true });
      expect(gemini.generateJson).toHaveBeenCalledTimes(1);
      expect(github.getFileSource).not.toHaveBeenCalled();

      const [results, audit] = [await resultRows(repoId), await auditRows(repoId)];
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        model: 'm1',
        prompt_version: 'blast-radius-v1',
        target_path: 'src/lib/utils.ts',
      });
      expect(audit).toHaveLength(2);
      expect(audit[0]).toMatchObject({
        ai_result_id: results[0].id,
        cache_hit: false,
        model: 'm1',
        attempts: 1,
        outcome: 'success',
        mode: 'blast_radius',
        target_path: 'src/lib/utils.ts',
        input_hash: results[0].input_hash,
      });
      expect(audit[0].session_id_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(audit[0].latency_ms).toBeGreaterThanOrEqual(0);
      expect(audit[1]).toMatchObject({
        ai_result_id: results[0].id,
        cache_hit: true,
        model: null,
        attempts: 0,
        outcome: 'success',
      });
    });

    it('stores the fallback model and serves its result as a cache hit', async () => {
      const repoId = await insertRepo(userA, 'fallback');
      const ids = await seed(repoId);
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS, { model: 'm2', attempts: 2 }));

      expect((await analyze(cookieA, repoId, ids.utils)).body.cached).toBe(false);
      const second = await analyze(cookieA, repoId, ids.utils);
      expect(second.body.cached).toBe(true);
      expect(gemini.generateJson).toHaveBeenCalledTimes(1);
      expect((await resultRows(repoId))[0].model).toBe('m2');
      expect((await auditRows(repoId))[0]).toMatchObject({ model: 'm2', attempts: 2 });
    });

    it('misses the cache again when a dependent changes', async () => {
      const repoId = await insertRepo(userA, 'changed');
      const ids = await seed(repoId);
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));
      await analyze(cookieA, repoId, ids.utils);
      await pool.query("UPDATE nodes SET content_hash = 'new' WHERE id = $1", [ids.main]);
      const again = await analyze(cookieA, repoId, ids.utils);
      expect(again.body.cached).toBe(false);
      expect(gemini.generateJson).toHaveBeenCalledTimes(2);
      expect(await resultRows(repoId)).toHaveLength(2);
    });

    it('short-circuits a file with no dependents: no Gemini call, no cache, one audit row', async () => {
      const repoId = await insertRepo(userA, 'lonely');
      const ids = await seed(repoId);
      const res = await analyze(cookieA, repoId, ids.lonely);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        targetPath: 'lonely.ts',
        cached: false,
        noDependents: true,
        dependents: [],
        risks: [],
        removedCount: 0,
      });
      expect(gemini.generateJson).not.toHaveBeenCalled();
      expect(github.getFileSource).not.toHaveBeenCalled();
      expect(await resultRows(repoId)).toHaveLength(0);
      const audit = await auditRows(repoId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        cache_hit: false,
        outcome: 'success',
        model: null,
        attempts: 0,
        ai_result_id: null,
      });
      expect(audit[0].input_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['AI_QUOTA_EXCEEDED', 429, ['quota', 'quota', 'quota'], false, 3, 'quota_exceeded'],
      ['AI_TIMEOUT', 504, ['timeout', 'timeout'], true, 2, 'timeout'],
      ['AI_UNREACHABLE', 502, ['fatal'], false, 1, 'network_error'],
      ['AI_MALFORMED', 502, ['quota', 'incomplete'], false, 2, 'malformed_output'],
    ])(
      'audits a router failure %s with its attempts and no model',
      async (code, status, failures, deadline, attempts, outcome) => {
        const repoId = await insertRepo(userA, `fail-${code.toLowerCase()}`);
        const ids = await seed(repoId);
        gemini.generateJson.mockRejectedValue(finalError(failures, deadline, attempts));
        const res = await analyze(cookieA, repoId, ids.utils);
        expect(res.status).toBe(status);
        expect(res.body.error.code).toBe(code);
        expect(res.body.error).not.toHaveProperty('attempts');
        expect(res.body.error).not.toHaveProperty('outcome');
        expect(await resultRows(repoId)).toHaveLength(0);
        const audit = await auditRows(repoId);
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ outcome, attempts, model: null, cache_hit: false });
      },
    );

    it('audits an unusable answer as malformed_output with the model that gave it', async () => {
      const repoId = await insertRepo(userA, 'bad-json');
      const ids = await seed(repoId);
      gemini.generateJson.mockResolvedValue({ text: '{"risks": [', model: 'm3', attempts: 3 });
      const res = await analyze(cookieA, repoId, ids.utils);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('AI_MALFORMED');
      expect(res.body.error.message).toBe(
        "Couldn't generate a reliable analysis for this file. Try again.",
      );
      expect(await resultRows(repoId)).toHaveLength(0);
      expect((await auditRows(repoId))[0]).toMatchObject({
        outcome: 'malformed_output',
        model: 'm3',
        attempts: 3,
      });
    });

    it('audits an unexpected failure as network_error', async () => {
      const repoId = await insertRepo(userA, 'unexpected');
      const ids = await seed(repoId);
      gemini.generateJson.mockRejectedValue(new Error('boom'));
      const res = await analyze(cookieA, repoId, ids.utils);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL');
      expect((await auditRows(repoId))[0]).toMatchObject({
        outcome: 'network_error',
        model: null,
        attempts: 0,
      });
    });

    it('still analyzes when an excerpt cannot be fetched', async () => {
      const repoId = await insertRepo(userA, 'flaky');
      const ids = await seed(repoId);
      github.getFileSource.mockRejectedValue(new Error('GitHub down'));
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));
      const res = await analyze(cookieA, repoId, ids.utils);
      expect(res.status).toBe(200);
      expect(gemini.generateJson.mock.calls[0][0].prompt).not.toContain('--- file:');
    });
  });

  describe('rate limits and the in-flight lock (spec 7.1)', () => {
    /** Starts a request now and resolves with its response. */
    const start = (cookie, repoId, nodeId) => analyze(cookie, repoId, nodeId).then((r) => r);

    it('limits analyses per user per window (429 RATE_LIMITED)', async () => {
      const limited = createApp(config, {
        pool,
        oauth,
        crypto,
        github,
        gemini,
        analyzeLimit: { windowMs: 60_000, limit: 2 },
      });
      const id = randomUUID();
      const send = (cookie) =>
        request(limited)
          .post(`/api/repos/${id}/analyze`)
          .set('Cookie', cookie)
          .send({ mode: 'blast_radius', nodeId: 'nope' });
      expect((await send(cookieA)).status).toBe(400);
      expect((await send(cookieA)).status).toBe(400);
      const res = await send(cookieA);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.retryAfterSeconds).toBeGreaterThan(0);
      expect(res.body.error.message).toMatch(RATE_LIMITED_MESSAGE);
      // Keyed by user: another user still has their own allowance.
      expect((await send(cookieB)).status).toBe(400);
    });

    it('refuses a second concurrent analysis from the same user, then frees the slot', async () => {
      const repoId = await insertRepo(userA, 'busy');
      const ids = await seed(repoId);
      const held = deferred();
      gemini.generateJson.mockReturnValueOnce(held.promise);

      const first = start(cookieA, repoId, ids.utils);
      await vi.waitFor(() => expect(gemini.generateJson).toHaveBeenCalledTimes(1));
      const second = await analyze(cookieA, repoId, ids.app);
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('RATE_LIMITED');
      expect(second.body.error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(second.body.error.retryAfterSeconds).toBeLessThanOrEqual(20);
      expect(second.body.error.message).toMatch(RATE_LIMITED_MESSAGE);

      held.resolve(answer(GOOD_RISKS));
      expect((await first).status).toBe(200);
      expect(gemini.generateJson).toHaveBeenCalledTimes(1);
      // The refused request is not an analysis, so only the first one is audited.
      expect(await auditRows(repoId)).toHaveLength(1);

      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));
      expect((await analyze(cookieA, repoId, ids.app)).status).toBe(200);
    });

    it('frees the slot after a failed analysis', async () => {
      const repoId = await insertRepo(userA, 'fails');
      const ids = await seed(repoId);
      gemini.generateJson.mockRejectedValueOnce(finalError(['quota', 'quota', 'quota'], false, 3));
      expect((await analyze(cookieA, repoId, ids.utils)).status).toBe(429);
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));
      expect((await analyze(cookieA, repoId, ids.utils)).status).toBe(200);
    });

    it("does not block another user's analysis", async () => {
      const repoA = await insertRepo(userA, 'a-busy');
      const idsA = await seed(repoA);
      const repoB = await insertRepo(userB, 'b-free');
      const idsB = await seed(repoB);
      const held = deferred();
      gemini.generateJson.mockReturnValueOnce(held.promise);

      const first = start(cookieA, repoA, idsA.utils);
      await vi.waitFor(() => expect(gemini.generateJson).toHaveBeenCalledTimes(1));
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));
      expect((await analyze(cookieB, repoB, idsB.utils)).status).toBe(200);

      held.resolve(answer(GOOD_RISKS));
      expect((await first).status).toBe(200);
    });

    it('never takes the slot for a request that fails validation or access', async () => {
      const repoId = await insertRepo(userA, 'checks');
      const ids = await seed(repoId);
      const held = deferred();
      gemini.generateJson.mockReturnValueOnce(held.promise);

      const first = start(cookieA, repoId, ids.utils);
      await vi.waitFor(() => expect(gemini.generateJson).toHaveBeenCalledTimes(1));
      // Validation runs before the lock, so a bad body is still a 400, not a 429.
      expect((await analyze(cookieA, repoId, 'nope')).status).toBe(400);
      held.resolve(answer(GOOD_RISKS));
      expect((await first).status).toBe(200);

      // A 404 releases the slot like any other outcome.
      expect((await analyze(cookieA, repoId, randomUUID())).status).toBe(404);
      gemini.generateJson.mockResolvedValue(answer(GOOD_RISKS));
      expect((await analyze(cookieA, repoId, ids.app)).status).toBe(200);
    });
  });
});
