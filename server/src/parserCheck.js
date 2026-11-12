import { createParserService } from './services/ingestion/parsing/parserService.js';
import { createDefaultRegistry } from './services/ingestion/languages/languageRegistry.js';

const SAMPLES = [
  ['sample.js', "import a from './a.js';\nconst b = require('b');\nexport const c = 1;\n"],
  [
    'sample.ts',
    "import type { T } from './types';\nimport z = require('z');\nexport interface I {}\n",
  ],
  ['sample.tsx', "import React from 'react';\nexport const App = () => <div />;\n"],
];

/**
 * Parses one JavaScript, one TypeScript and one TSX sample with the active backend.
 * @param {(line: string) => void} [log]
 * @returns {boolean} true when every sample parsed and yielded imports
 */
export function runParserCheck(log = console.log) {
  const parserService = createParserService();
  const registry = createDefaultRegistry();
  log(`Parser backend: ${parserService.backend}`);
  let ok = true;
  for (const [path, source] of SAMPLES) {
    const plugin = registry.pluginForPath(path);
    const tree = parserService.parse(registry.grammarFor(path), source);
    const { imports, exports } = plugin.extractor.extract(tree, source);
    log(
      `${path} (${registry.grammarFor(path)}): imports=${JSON.stringify(imports)} exports=${JSON.stringify(exports)}`,
    );
    if (imports.length === 0) ok = false;
  }
  return ok;
}

if (process.argv[1]?.endsWith('parserCheck.js')) {
  try {
    const ok = runParserCheck();
    console.log(ok ? 'parser:check passed' : 'parser:check FAILED');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`parser:check FAILED: ${err.message}`);
    process.exit(1);
  }
}
