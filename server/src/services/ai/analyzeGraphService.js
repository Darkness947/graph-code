import { notReady, nodeNotFound } from '../graph/graphQueryService.js';
import { auditOutcomeOf } from './aiErrors.js';
import { computeInputHash, PROMPT_VERSION } from './inputHash.js';
import { createSubgraphExtractor } from './subgraphExtractor.js';
import {
  buildBlastRadiusPrompt,
  SYSTEM_INSTRUCTION,
  RESPONSE_SCHEMA,
} from './prompts/blastRadius.js';
import { validateResponse } from './responseValidator.js';

/**
 * AI blast-radius analysis (spec 7.7). Every outcome from the cache check on, success or failure,
 * writes one audit row; so does the no-dependents short-circuit.
 * @param {{
 *   repos: { get: (userId: string, repoId: string) => Promise<Record<string, any>> },
 *   graphs: ReturnType<typeof import('../graph/graphRepository.js').createGraphRepository>,
 *   cache: ReturnType<typeof import('./aiCacheRepository.js').createAiCacheRepository>,
 *   audit: ReturnType<typeof import('./auditLogger.js').createAuditLogger>,
 *   retriever: ReturnType<typeof import('./codeRetriever.js').createCodeRetriever>,
 *   gemini: { generateJson: (input: object) => Promise<{ text: string, model: string, attempts: number, latencyMs: number }> },
 *   getToken: (userId: string) => Promise<string>,
 *   now?: () => number }} deps
 */
export function createAnalyzeGraphService({
  repos,
  graphs,
  cache,
  audit,
  retriever,
  gemini,
  getToken,
  now = Date.now,
}) {
  const extractor = createSubgraphExtractor(graphs);

  /**
   * @param {{ userId: string, sessionId?: string, requestId?: string, repositoryId: string,
   *   mode: 'blast_radius', nodeId: string }} input
   * @returns {Promise<object>} the AnalysisResult (spec 6.2)
   * @throws {import('../../errors/AppError.js').AppError} NOT_FOUND, GRAPH_NOT_READY, AI_* or
   *   GitHub/auth errors
   */
  async function analyzeGraph({ userId, sessionId, requestId, repositoryId, mode, nodeId }) {
    const started = now();

    // 1–2. The target (a file of a ready repository the user owns) and its dependents. All three
    // reads are scoped to the user, so they can run together.
    const [repository, target, dependents] = await Promise.all([
      repos.get(userId, repositoryId),
      graphs.findNode(userId, repositoryId, nodeId),
      graphs.findDependents(userId, repositoryId, nodeId),
    ]);
    if (repository.status !== 'ready') throw notReady();
    if (!target || target.nodeType !== 'file') throw nodeNotFound();

    const record = (inputHash, fields) =>
      audit.record({
        userId,
        repositoryId,
        sessionId,
        requestId,
        mode,
        targetPath: target.path,
        inputHash,
        latencyMs: now() - started,
        cacheHit: false,
        attempts: 0,
        ...fields,
      });
    const result = (fields) => ({
      mode,
      targetPath: target.path,
      generatedAt: new Date(now()).toISOString(),
      noDependents: false,
      ...fields,
    });

    // No dependents: no Gemini call and no cache write.
    if (dependents.length === 0) {
      const targetOnly = [{ path: target.path, contentHash: target.contentHash, distance: 0 }];
      await record(computeInputHash({ mode, target, nodes: targetOnly }), { outcome: 'success' });
      return {
        ...result({ noDependents: true, dependents: [], summary: '', risks: [], removedCount: 0 }),
        cached: false,
      };
    }

    // 3–4. Subgraph and input hash.
    const subgraph = await extractor.extract(userId, repositoryId, target, dependents);
    const inputHash = computeInputHash({ mode, target, nodes: subgraph.nodes });
    const cacheKey = { userId, repositoryId, mode, targetPath: target.path, inputHash };

    let answer = null;
    try {
      // 5. Cache.
      const hit = await cache.find(cacheKey);
      if (hit) {
        await record(inputHash, { outcome: 'success', cacheHit: true, aiResultId: hit.id });
        return { ...hit.response, cached: true };
      }

      // The validator needs every file path; load them while Gemini works. The no-op catch keeps
      // an early failure from being unhandled; it is rethrown where the paths are awaited.
      const filePaths = graphs.listFilePaths(userId, repositoryId);
      filePaths.catch(() => {});

      // 6–7. Excerpts (memory only) and prompt.
      const excerpts = await retriever.retrieve({
        token: await getToken(userId),
        owner: repository.owner,
        name: repository.name,
        commitSha: target.commitSha,
        target,
        dependents: subgraph.dependents,
      });
      const prompt = buildBlastRadiusPrompt({
        targetPath: target.path,
        dependents: subgraph.dependents,
        edges: subgraph.edges,
        excerpts,
      });

      // 8–9. Model router, then validation.
      answer = await gemini.generateJson({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt,
        responseSchema: RESPONSE_SCHEMA,
        requestId,
      });
      const validated = validateResponse(answer.text, {
        targetPath: target.path,
        filePaths: await filePaths,
        distances: new Map(dependents.map((d) => [d.path, d.distance])),
      });

      // 10–11. Save, audit, return.
      const response = result({
        dependents: dependents.map((d) => ({ path: d.path, distance: d.distance })),
        ...validated,
      });
      const aiResultId = await cache.save({
        ...cacheKey,
        model: answer.model,
        promptVersion: PROMPT_VERSION,
        response,
      });
      await record(inputHash, {
        outcome: 'success',
        model: answer.model,
        attempts: answer.attempts,
        aiResultId,
      });
      return { ...response, cached: false };
    } catch (err) {
      await record(inputHash, {
        outcome: auditOutcomeOf(err),
        // A model answered but its answer was unusable: record which one.
        model: answer?.model ?? null,
        attempts: answer?.attempts ?? err.attempts ?? 0,
      });
      throw err;
    }
  }

  return { analyzeGraph };
}
