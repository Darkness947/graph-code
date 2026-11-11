---
description: Ports logic from the Summer prototype in _prototype/ (parser, import resolver, graph canvas, Gemini script) into Graph Code's layered structure with tests. Use when a task reuses prototype code, mainly T1.0, T1.6, T3.2 and T3.5.
argument-hint: "[parser | resolver | canvas | ai]"
---

# Port from the prototype: $ARGUMENTS

The prototype is proven but throwaway. Move its logic into the new structure; never copy it wholesale.

## Rules

- **Never commit or import `_prototype/`.** It is git-ignored and is a reference only.
- **Don't carry prototype leftovers.** Leave behind prototype scripts, static JSON loading, debug logging, hard-coded paths and global state.
- **Raise conflicts as D-04.** If the prototype conflicts with the specification (for example in node identifiers, edge direction or data shape), raise Decision Stop D-04 with the `stop` skill. Do not silently adapt either side.
- **Test before you claim done.** Every ported piece gets tests before it counts as done.

## Where each module goes

| Module | Target (spec section) | Key points |
|---|---|---|
| `parser` | `server/src/services/ingestion/parsing/` and `extractors/` (7.5.1) | The prototype used `web-tree-sitter`. The default here is the native `tree-sitter` with exact pinned versions (T1.6 spike). Split it into the backend `parse(grammarId, sourceText)` and the extractors `extract(tree, sourceText)`. Extractors use ONLY `type`, `text`, `startPosition`, `namedChildren`, `childForFieldName`, `parent` and `rootNode`. `TypeScriptExtractor` extends `JavaScriptExtractor`. Write `wasmBackend.js` only if D-01 triggers. |
| `resolver` | `resolvers/jsTsResolver.js` behind `LanguageResolver` (7.5, 7.5.1) | Implement `supports`, `configure(repoConfigFiles)` and `resolve(specifier, fromPath, fileIndex)`, which returns `{path}`, `{unresolved: reason}` or `{external: true}`. Register it through `languageRegistry.js`. |
| `canvas` | `client/src/` graph workspace (8.6, 8.8) | React Flow and Dagre, using the readability-v2 behaviour. Extract pure functions (visible nodes, ancestor mapping, edge aggregation, centrality thresholds) and unit-test them. Use the tokens from 8.1, with red and gold reserved for AI risk only. Read from the workspace store, never from static JSON. |
| `ai` | `server/src/services/ai/` (7.7) | Only the prompt idea and the JSON-response handling carry over. The new service uses `@google/genai`, the routed client over `GEMINI_MODELS` with a 20-second overall deadline, error classification, cache, validation and audit. |

## Steps

1. **Inventory.** List the prototype files for `$ARGUMENTS`: libraries and versions, inputs and outputs, node identifiers and edge direction. Mark each difference from the specification.
2. **Map.** Map every prototype function to its target file and contract above. Note anything that is dropped and why.
3. **Plan.** Present the plan, including the tests and fixtures, and wait for approval. When this runs inside `/task`, this is the task's plan step.
4. **Port.** Port the logic and add tests:
   - **`parser` and `resolver`:** fixtures under `server/test/fixtures/repos/` for each import form named in T1.6.
   - **`canvas`:** tests for the pure functions, including nested collapsed folders and an edge into a collapsed folder.
5. **Compare (`parser` and `resolver`).** Run the prototype and the new code on the three prototype test repositories. Report identical edges, or explain each difference.
