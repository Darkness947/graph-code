import { AppError } from '../../errors/AppError.js';
import { computeInputHash, PROMPT_VERSION } from './inputHash.js';
import { createSubgraphExtractor } from './subgraphExtractor.js';
import {
  buildBlastRadiusPrompt,
  SYSTEM_INSTRUCTION,
  RESPONSE_SCHEMA,
} from './prompts/blastRadius.js';
import { validateResponse } from './responseValidator.js';

/**
 * AI blast-radius analysis (spec 7.7). Every outcome after the target is found is audited.
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
   * @throws {AppError} NOT_FOUND, GRAPH_NOT_READY, AI_* or GitHub/auth errors
   */
  async function analyzeGraph({ userId, sessionId, requestId, repositoryId, mode, nodeId }) {
    const started = now();

    // 1. Load the target: a file of a ready repository the user owns.
    const repository = await repos.get(userId, repositoryId);
    if (repository.status !== 'ready') {
      throw new AppError('GRAPH_NOT_READY', "This repository's graph isn't ready yet.");
    }
    const target = await graphs.findNode(userId, repositoryId, nodeId);
    if (!target || target.nodeType !== 'file') throw new AppError('NOT_FOUND', 'File not found.');

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
    const targetNode = { path: target.path, contentHash: target.contentHash, distance: 0 };
    const base = { mode, targetPath: target.path };

    // 2. Dependents; none means no Gemini call and no cache write.
    const dependents = await graphs.findDependents(userId, repositoryId, nodeId);
    if (dependents.length === 0) {
      await record(computeInputHash({ mode, target, nodes: [targetNode] }), {
        outcome: 'success',
      });
      return {
        ...base,
        cached: false,
        generatedAt: new Date(now()).toISOString(),
        noDependents: true,
        dependents: [],
        summary: '',
        risks: [],
        removedCount: 0,
      };
    }

    // 3–5. Subgraph, input hash, cache.
    const subgraph = await extractor.extract(userId, repositoryId, target, dependents);
    const inputHash = computeInputHash({ mode, target, nodes: subgraph.nodes });
    const cacheKey = { userId, repositoryId, mode, targetPath: target.path, inputHash };
    const hit = await cache.find(cacheKey);
    if (hit) {
      await record(inputHash, { outcome: 'success', cacheHit: true, aiResultId: hit.id });
      return { ...hit.response, cached: true };
    }

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

    // 8. Model router.
    let answer;
    try {
      answer = await gemini.generateJson({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt,
        responseSchema: RESPONSE_SCHEMA,
        requestId,
      });
    } catch (err) {
      await record(inputHash, {
        outcome: err.outcome ?? 'network_error',
        attempts: err.attempts ?? 0,
      });
      throw err;
    }

    // 9. Validate.
    let validated;
    try {
      validated = validateResponse(answer.text, {
        targetPath: target.path,
        filePaths: await graphs.listFilePaths(userId, repositoryId),
        distances: new Map(dependents.map((d) => [d.path, d.distance])),
      });
    } catch (err) {
      await record(inputHash, {
        outcome: 'malformed_output',
        model: answer.model,
        attempts: answer.attempts,
      });
      throw err;
    }

    // 10–11. Save, audit, return.
    const response = {
      ...base,
      generatedAt: new Date(now()).toISOString(),
      noDependents: false,
      dependents: dependents.map((d) => ({ path: d.path, distance: d.distance })),
      ...validated,
    };
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
  }

  return { analyzeGraph };
}
