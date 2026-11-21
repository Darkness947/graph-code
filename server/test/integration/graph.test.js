import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors/AppError.js';
import { tokenCryptoFromConfig } from '../../src/services/auth/tokenCrypto.js';
import { encodePathLtree } from '../../src/services/ingestion/ltree.js';
import { UNRESOLVED_LIMIT } from '../../src/services/graph/graphRepository.js';
import { MAX_SOURCE_BYTES } from '../../src/services/github/githubClient.js';
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
};

const SHA = 'c'.repeat(40);
const UNRESOLVED_TOTAL = UNRESOLVED_LIMIT + 5;

const oauth = {
  authorizeUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCode: vi.fn(),
  fetchUser: vi.fn(),
};
/** A client error with the given `githubReason`, as githubClient.js throws it. */
function githubError(reason) {
  const err = new AppError('GITHUB_UNAVAILABLE', "GitHub isn't responding right now.");
  err.githubReason = reason;
  return err;
}

const github = {
  getRepository: vi.fn(),
  listUserRepositories: vi.fn(),
  getFileSource: vi.fn(),
};

describe.skipIf(!hasTestDb)('graph and source endpoints (integration)', () => {
  let pool;
  let app;
  let cookieA;
  let cookieB;
  let userA;
  let userB;
  const crypto = tokenCryptoFromConfig(config);

  const userIdOf = async (ghId) =>
    (await pool.query('SELECT id FROM users WHERE github_id = $1', [ghId])).rows[0].id;

  /** Inserts a repository row with the given status; ready repositories get a commit_sha. */
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

  async function insertNode(repoId, path, type, extra = {}) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO nodes (id, repository_id, path, path_ltree, name, node_type, language, size_bytes, metrics)
       VALUES ($1, $2, $3, $4::ltree, $5, $6, $7, $8, $9::jsonb)`,
      [
        id,
        repoId,
        path,
        encodePathLtree(path),
        path.split('/').pop(),
        type,
        extra.language ?? null,
        extra.sizeBytes ?? null,
        JSON.stringify(extra.metrics ?? {}),
      ],
    );
    return id;
  }

  /**
   * src/ (folder) → src/lib/ (folder) → utils.ts, big.ts; src/app.tsx; index.js at the top level.
   * Edges: app.tsx → utils.ts, index.js → app.tsx. UNRESOLVED_TOTAL unresolved imports.
   */
  async function seedGraph(repoId) {
    const ids = {
      src: await insertNode(repoId, 'src', 'folder', { metrics: { fileCount: 3 } }),
      lib: await insertNode(repoId, 'src/lib', 'folder', { metrics: { fileCount: 2 } }),
      utils: await insertNode(repoId, 'src/lib/utils.ts', 'file', {
        language: 'ts',
        sizeBytes: 2048,
        metrics: { fanIn: 1, fanOut: 0 },
      }),
      big: await insertNode(repoId, 'src/lib/big.ts', 'file', {
        language: 'ts',
        sizeBytes: MAX_SOURCE_BYTES + 1,
        metrics: { fanIn: 0, fanOut: 0 },
      }),
      app: await insertNode(repoId, 'src/app.tsx', 'file', {
        language: 'tsx',
        sizeBytes: 512,
        metrics: { fanIn: 1, fanOut: 1 },
      }),
      index: await insertNode(repoId, 'index.js', 'file', {
        language: 'js',
        sizeBytes: 64,
        metrics: { fanIn: 0, fanOut: 1 },
      }),
    };
    await pool.query(
      `INSERT INTO edges (repository_id, source_node_id, target_node_id)
       VALUES ($1, $2, $3), ($1, $4, $2)`,
      [repoId, ids.app, ids.utils, ids.index],
    );
    await pool.query(
      `INSERT INTO unresolved_imports (source_node_id, raw_specifier, reason)
       SELECT $1, 'missing-' || g, 'file_not_found' FROM generate_series(1, $2) g`,
      [ids.app, UNRESOLVED_TOTAL],
    );
    return ids;
  }

  const getGraph = (cookie, repoId) =>
    request(app).get(`/api/repos/${repoId}/graph`).set('Cookie', cookie);
  const getSource = (cookie, repoId, nodeId) =>
    request(app).get(`/api/repos/${repoId}/nodes/${nodeId}/source`).set('Cookie', cookie);

  beforeAll(async () => {
    pool = await resetTestDatabase();
    app = createApp(config, { pool, oauth, crypto, github });
    cookieA = await signIn(app, oauth, 301);
    cookieB = await signIn(app, oauth, 302);
    userA = await userIdOf(301);
    userB = await userIdOf(302);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    github.getFileSource.mockReset().mockResolvedValue('export const x = 1;\n');
    await pool.query('DELETE FROM repositories');
  });

  it('requires a session on both routes', async () => {
    const id = randomUUID();
    expect((await request(app).get(`/api/repos/${id}/graph`)).status).toBe(401);
    expect((await request(app).get(`/api/repos/${id}/nodes/${id}/source`)).status).toBe(401);
  });

  it('rejects ids that are not UUIDs with VALIDATION_ERROR', async () => {
    const id = randomUUID();
    for (const res of [
      await getGraph(cookieA, 'nope'),
      await getSource(cookieA, 'nope', id),
      await getSource(cookieA, id, 'nope'),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  describe('GET /api/repos/:id/graph', () => {
    it('returns the documented Graph shape', async () => {
      const repoId = await insertRepo(userA, 'tailor');
      const ids = await seedGraph(repoId);
      const res = await getGraph(cookieA, repoId);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['edges', 'nodes', 'repository', 'unresolved']);
      // The same Repository object GET /api/repos/:id returns.
      const single = await request(app).get(`/api/repos/${repoId}`).set('Cookie', cookieA);
      expect(res.body.repository).toEqual(single.body);
      expect(res.body.repository).toMatchObject({
        id: repoId,
        displayName: 'Darkness947/tailor',
        status: 'ready',
      });

      const byPath = Object.fromEntries(res.body.nodes.map((n) => [n.path, n]));
      expect(Object.keys(byPath).sort()).toEqual([
        'index.js',
        'src',
        'src/app.tsx',
        'src/lib',
        'src/lib/big.ts',
        'src/lib/utils.ts',
      ]);
      // The root folder is not returned; top-level items have parentPath "".
      expect(byPath.src).toEqual({
        id: ids.src,
        path: 'src',
        name: 'src',
        type: 'folder',
        parentPath: '',
        metrics: { fileCount: 3 },
      });
      expect(byPath['src/lib'].parentPath).toBe('src');
      expect(byPath['index.js'].parentPath).toBe('');
      expect(byPath['src/lib/utils.ts']).toEqual({
        id: ids.utils,
        path: 'src/lib/utils.ts',
        name: 'utils.ts',
        type: 'file',
        parentPath: 'src/lib',
        language: 'ts',
        sizeBytes: 2048,
        metrics: { fanIn: 1, fanOut: 0 },
      });

      // Edges are importer → imported, with numeric ids.
      expect(res.body.edges).toHaveLength(2);
      for (const e of res.body.edges) {
        expect(Object.keys(e).sort()).toEqual(['id', 'source', 'target']);
        expect(typeof e.id).toBe('number');
      }
      expect(res.body.edges.map(({ source, target }) => ({ source, target }))).toEqual(
        expect.arrayContaining([
          { source: ids.app, target: ids.utils },
          { source: ids.index, target: ids.app },
        ]),
      );

      // Unresolved: the full count, items capped at 200.
      expect(res.body.unresolved.count).toBe(UNRESOLVED_TOTAL);
      expect(res.body.unresolved.items).toHaveLength(UNRESOLVED_LIMIT);
      expect(res.body.unresolved.items[0]).toEqual({
        sourcePath: 'src/app.tsx',
        specifier: expect.stringMatching(/^missing-\d+$/),
        reason: 'file_not_found',
      });
    });

    it('returns an empty unresolved list with count 0', async () => {
      const repoId = await insertRepo(userA, 'clean');
      await insertNode(repoId, 'a.js', 'file', { language: 'js', sizeBytes: 1 });
      const res = await getGraph(cookieA, repoId);
      expect(res.status).toBe(200);
      expect(res.body.unresolved).toEqual({ count: 0, items: [] });
      expect(res.body.edges).toEqual([]);
    });

    it.each(['pending', 'analyzing', 'failed'])(
      'returns 409 GRAPH_NOT_READY while the repository is %s',
      async (status) => {
        const repoId = await insertRepo(userA, `r-${status}`, status);
        const res = await getGraph(cookieA, repoId);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('GRAPH_NOT_READY');
      },
    );

    it("returns 404 for another user's repository and for an unknown id", async () => {
      const repoId = await insertRepo(userA, 'tailor');
      await seedGraph(repoId);
      for (const res of [await getGraph(cookieB, repoId), await getGraph(cookieA, randomUUID())]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(res.body).not.toHaveProperty('nodes');
      }
    });
  });

  describe('GET /api/repos/:id/nodes/:nodeId/source', () => {
    it('fetches the file from GitHub at commit_sha with the user token', async () => {
      const repoId = await insertRepo(userA, 'tailor');
      const ids = await seedGraph(repoId);
      const res = await getSource(cookieA, repoId, ids.utils);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        path: 'src/lib/utils.ts',
        language: 'ts',
        content: 'export const x = 1;\n',
      });
      expect(github.getFileSource).toHaveBeenCalledExactlyOnceWith(
        'gho_301',
        'darkness947',
        'tailor',
        'src/lib/utils.ts',
        SHA,
      );
    });

    it('returns 200 {tooLarge: true} for a file over 1 MB without calling GitHub', async () => {
      const repoId = await insertRepo(userA, 'tailor');
      const ids = await seedGraph(repoId);
      const res = await getSource(cookieA, repoId, ids.big);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tooLarge: true });
      expect(github.getFileSource).not.toHaveBeenCalled();
    });

    it('returns 200 {tooLarge: true} when GitHub reports the file too large', async () => {
      const repoId = await insertRepo(userA, 'tailor');
      const ids = await seedGraph(repoId);
      github.getFileSource.mockRejectedValue(githubError('TOO_LARGE'));
      const res = await getSource(cookieA, repoId, ids.utils);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tooLarge: true });
    });

    it('returns 502 GITHUB_UNAVAILABLE when GitHub fails', async () => {
      const repoId = await insertRepo(userA, 'tailor');
      const ids = await seedGraph(repoId);
      github.getFileSource.mockRejectedValue(githubError('SERVER'));
      const res = await getSource(cookieA, repoId, ids.utils);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GITHUB_UNAVAILABLE');
    });

    it('returns 401 and forgets the token when GitHub rejects it', async () => {
      // A separate user: the rejection deletes every session of that user.
      const cookie = await signIn(app, oauth, 303);
      const userId = await userIdOf(303);
      const repoId = await insertRepo(userId, 'tailor');
      const ids = await seedGraph(repoId);
      const err = new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
      err.githubReason = 'TOKEN_REJECTED';
      github.getFileSource.mockRejectedValue(err);

      const res = await getSource(cookie, repoId, ids.utils);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      const { rows } = await pool.query('SELECT access_token_enc FROM users WHERE id = $1', [
        userId,
      ]);
      expect(rows[0].access_token_enc).toBeNull();
    });

    it('keeps the session and the token on an unconfirmed GitHub 401 (502, retryable)', async () => {
      const cookie = await signIn(app, oauth, 304);
      const userId = await userIdOf(304);
      const repoId = await insertRepo(userId, 'tailor');
      const ids = await seedGraph(repoId);
      const err = githubError('TOKEN_UNCONFIRMED');
      err.githubStatus = 401;
      github.getFileSource.mockRejectedValue(err);

      const res = await getSource(cookie, repoId, ids.utils);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GITHUB_UNAVAILABLE');
      expect((await request(app).get('/api/me').set('Cookie', cookie)).status).toBe(200);
      const { rows } = await pool.query('SELECT access_token_enc FROM users WHERE id = $1', [
        userId,
      ]);
      expect(rows[0].access_token_enc).not.toBeNull();
    });

    it('returns 409 GRAPH_NOT_READY before ingestion succeeded', async () => {
      const repoId = await insertRepo(userA, 'busy', 'analyzing');
      const nodeId = await insertNode(repoId, 'a.js', 'file', { language: 'js', sizeBytes: 1 });
      const res = await getSource(cookieA, repoId, nodeId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GRAPH_NOT_READY');
      expect(github.getFileSource).not.toHaveBeenCalled();
    });

    it("returns 404 for another user's repository, a foreign node, a folder or an unknown node", async () => {
      const repoA = await insertRepo(userA, 'tailor');
      const idsA = await seedGraph(repoA);
      const otherA = await insertRepo(userA, 'other');
      const otherNode = await insertNode(otherA, 'o.js', 'file', { language: 'js', sizeBytes: 1 });
      const repoB = await insertRepo(userB, 'tailor');
      const idsB = await seedGraph(repoB);

      for (const res of [
        await getSource(cookieB, repoA, idsA.utils), // another user's repository
        await getSource(cookieA, repoA, otherNode), // a node of the user's other repository
        await getSource(cookieA, repoA, idsB.utils), // a node of another user's repository
        await getSource(cookieA, repoA, idsA.lib), // a folder
        await getSource(cookieA, repoA, randomUUID()), // unknown node
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      expect(github.getFileSource).not.toHaveBeenCalled();
    });
  });
});
