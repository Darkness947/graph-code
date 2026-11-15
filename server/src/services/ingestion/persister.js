import { buildGraphModel } from './graphModel.js';

/** Most rows in one INSERT statement (spec 7.5 step 5). */
export const CHUNK_ROWS = 500;

/**
 * Inserts rows in chunks of at most CHUNK_ROWS, each one parameterized statement. The SQL text
 * holds only placeholders built from the row count; every value travels as a parameter.
 * @param {import('pg').PoolClient} client
 * @param {{ table: string, columns: string[], casts?: Record<string, string>, rows: unknown[][],
 *   beforeChunk?: (info: { table: string, index: number }) => void | Promise<void> }} spec
 *   `table` and `columns` are code constants, never user input. `casts[column]` is appended to
 *   that column's placeholder (for example `{ path_ltree: '::ltree' }`).
 */
async function insertChunks(client, { table, columns, casts = {}, rows, beforeChunk }) {
  for (let index = 0, start = 0; start < rows.length; index++, start += CHUNK_ROWS) {
    await beforeChunk?.({ table, index });
    const chunk = rows.slice(start, start + CHUNK_ROWS);
    const width = chunk[0].length;
    const values = chunk.map(
      (_, r) =>
        `(${columns.map((name, c) => `$${r * width + c + 1}${casts[name] ?? ''}`).join(', ')})`,
    );
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`,
      chunk.flat(),
    );
  }
}

/**
 * The persisting step (spec 7.5 step 5). In one transaction it replaces the repository's graph
 * (delete nodes, cascading to edges and unresolved imports; bulk-insert the new rows), writes the
 * repository statistics, and marks the job succeeded. Any error rolls everything back and
 * rethrows, which the orchestrator turns into PERSIST_FAILED. Takes `ctx.fileGraph`, `ctx.commitSha`.
 * @param {{ pool: import('pg').Pool,
 *   beforeChunk?: (info: { table: string, index: number }) => void | Promise<void> }} deps
 *   `beforeChunk` is a test hook called before each chunk insert; production never sets it.
 * @returns {import('./orchestrator.js').PipelineStep}
 */
export function createPersistingStep({ pool, beforeChunk }) {
  return async function persisting(ctx) {
    const model = buildGraphModel(ctx.fileGraph);
    ctx.fileGraph = undefined;
    const repositoryId = ctx.job.repositoryId;

    const client = await pool.connect();
    /** Set when ROLLBACK fails: the connection may hold an open transaction, so it is destroyed. */
    let broken = false;
    const rollback = () =>
      client.query('ROLLBACK').catch((err) => {
        broken = true;
        throw err;
      });
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM nodes WHERE repository_id = $1', [repositoryId]);

      await insertChunks(client, {
        table: 'nodes',
        columns: [
          'id',
          'repository_id',
          'path',
          'path_ltree',
          'name',
          'node_type',
          'language',
          'content_hash',
          'size_bytes',
          'exports',
          'metrics',
        ],
        casts: { path_ltree: '::ltree', metrics: '::jsonb' },
        rows: model.nodes.map((n) => [
          n.id,
          repositoryId,
          n.path,
          n.pathLtree,
          n.name,
          n.nodeType,
          n.language,
          n.contentHash,
          n.sizeBytes,
          n.exports,
          JSON.stringify(n.metrics),
        ]),
        beforeChunk,
      });
      await insertChunks(client, {
        table: 'edges',
        columns: ['repository_id', 'source_node_id', 'target_node_id'],
        rows: model.edges.map((e) => [repositoryId, e.source, e.target]),
        beforeChunk,
      });
      await insertChunks(client, {
        table: 'unresolved_imports',
        columns: ['source_node_id', 'raw_specifier', 'reason'],
        rows: model.unresolved.map((u) => [u.sourceNodeId, u.rawSpecifier, u.reason]),
        beforeChunk,
      });

      const fileCount = model.nodes.filter((n) => n.nodeType === 'file').length;
      await client.query(
        `UPDATE repositories SET commit_sha = $2, file_count = $3, edge_count = $4,
           language_summary = $5::jsonb, last_ingested_at = now(),
           ingestion_ms = GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() -
             (SELECT started_at FROM ingestion_jobs WHERE id = $6))) * 1000)::int)
         WHERE id = $1`,
        [
          repositoryId,
          ctx.commitSha,
          fileCount,
          model.edges.length,
          JSON.stringify(model.languageSummary),
          ctx.job.id,
        ],
      );

      if (!(await ctx.jobs.succeed(ctx.job.id, model.report, client))) {
        // The job was recovered or deleted meanwhile: leave its state alone.
        await rollback();
        return;
      }
      await client.query('COMMIT');
    } catch (err) {
      await rollback().catch(() => {});
      throw err;
    } finally {
      client.release(broken);
    }
  };
}
