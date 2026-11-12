import { NativeBackend } from './backends/nativeBackend.js';

/**
 * Picks the parsing backend from `PARSER_BACKEND` (spec 7.5.1).
 * `wasm` is the D-01 fallback and is not written unless D-01 triggers.
 * @param {{ backend?: string }} [options]
 * @returns {{ backend: string, parse: (grammarId: string, sourceText: string) => { rootNode: any } }}
 */
export function createParserService({ backend = process.env.PARSER_BACKEND || 'native' } = {}) {
  if (backend === 'wasm') {
    throw new Error('PARSER_BACKEND=wasm is the D-01 fallback and is not implemented');
  }
  if (backend !== 'native') {
    throw new Error(`Unknown PARSER_BACKEND: ${backend}`);
  }
  const impl = new NativeBackend();
  return { backend, parse: (grammarId, sourceText) => impl.parse(grammarId, sourceText) };
}
