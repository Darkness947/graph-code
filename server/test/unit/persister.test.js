import { describe, it, expect, vi } from 'vitest';
import { CHUNK_ROWS, createPersistingStep } from '../../src/services/ingestion/persister.js';

const file = (i) => ({
  path: `src/f${i}.js`,
  language: 'js',
  contentHash: 'h',
  sizeBytes: 1,
  exports: [],
});

function setup({ succeed = true, files = 2, failOn, rollbackFails = false } = {}) {
  const sql = [];
  const client = {
    query: vi.fn(async (text, params = []) => {
      sql.push({ text, params });
      if (failOn && text.includes(failOn)) throw new Error('boom');
      if (text === 'ROLLBACK' && rollbackFails) throw new Error('rollback failed');
      return { rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  const jobs = {
    succeed: vi.fn(async () => {
      sql.push({ text: 'SUCCEED', params: [] });
      return succeed;
    }),
  };
  const fileGraph = {
    files: Array.from({ length: files }, (_, i) => file(i)),
    edges: [],
    unresolved: [],
    skipped: [],
  };
  const ctx = { job: { id: 'j', repositoryId: 'r' }, jobs, commitSha: 'sha', fileGraph };
  return { sql, client, pool, ctx };
}
const head = (s) => s.text.split(/[ (]/).slice(0, 3).join(' ');

describe('createPersistingStep (unit)', () => {
  it('runs BEGIN, delete, inserts, update, succeed, COMMIT in order and releases the client', async () => {
    const { sql, client, pool, ctx } = setup();
    await createPersistingStep({ pool })(ctx);
    expect(sql.map(head)).toEqual([
      'BEGIN',
      'DELETE FROM nodes',
      'INSERT INTO nodes',
      'UPDATE repositories SET',
      'SUCCEED',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(ctx.fileGraph).toBeUndefined();
  });

  it('splits rows into chunks of at most 500 and keeps values out of the SQL text', async () => {
    const { sql, pool, ctx } = setup({ files: 1200 });
    await createPersistingStep({ pool })(ctx);
    const inserts = sql.filter((s) => s.text.startsWith('INSERT INTO nodes'));
    expect(inserts.map((s) => s.params.length / 11)).toEqual([CHUNK_ROWS, CHUNK_ROWS, 201]);
    expect(inserts[0].text).not.toContain('src/f0.js');
  });

  it('rolls back, releases and rethrows when a statement fails', async () => {
    const { sql, client, pool, ctx } = setup({ failOn: 'INSERT INTO nodes' });
    await expect(createPersistingStep({ pool })(ctx)).rejects.toThrow('boom');
    expect(sql.at(-1).text).toBe('ROLLBACK');
    expect(sql.some((s) => s.text === 'COMMIT')).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('destroys the connection and rethrows the original error when ROLLBACK also fails', async () => {
    const { client, pool, ctx } = setup({ failOn: 'INSERT INTO nodes', rollbackFails: true });
    await expect(createPersistingStep({ pool })(ctx)).rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('rolls back quietly when the job is no longer running', async () => {
    const { sql, pool, ctx } = setup({ succeed: false });
    await expect(createPersistingStep({ pool })(ctx)).resolves.toBeUndefined();
    expect(sql.at(-1).text).toBe('ROLLBACK');
  });

  it('calls the test hook before every chunk', async () => {
    const { pool, ctx } = setup({ files: 501 });
    const beforeChunk = vi.fn();
    await createPersistingStep({ pool, beforeChunk })(ctx);
    expect(beforeChunk.mock.calls.map(([i]) => `${i.table}#${i.index}`)).toEqual([
      'nodes#0',
      'nodes#1',
    ]);
  });
});
