# Prototype intake (T1.0)

Date: 10 Nov 2026. Source: `_prototype/` (git-ignored, reference only).

## What the prototype contains

| Area | Files | Libraries (locked versions) |
|---|---|---|
| Parser | `ingest/parser.js` | `web-tree-sitter` 0.20.8 (WebAssembly) with bundled javascript, typescript and tsx `.wasm` grammars |
| Resolver | `ingest/resolver.js` | Node `fs`, `path` |
| Download/driver | `ingest/index.js` | `adm-zip` 0.6.0, `fast-glob` 3.3.3, `node-fetch` 3.3.2 (not in spec 3.2; not ported) |
| Canvas | `frontend/src/GraphBuilder.js`, `App.jsx` | `@xyflow/react` 12.11.2, `dagre` 0.8.5, `react`/`react-dom` 19.2.8, `vite` 8.2.1, `@vitejs/plugin-react` 6.0.5 |
| AI script | `ai-script/blast-radius.js`, `server.js`, `load-test.js` | `express` 5.2.1, `cors`, `dotenv`, raw `fetch` to Gemini |

- **Node identifiers:** the file path; folders are `folder:<dir>`, one flat group per directory.
- **Edge direction:** stored importer -> imported; the canvas flips it for display.
- **Prototype output:** `Darkness947/vigilante-resume-tailor`, 63 files, 107 edges, 116 unresolved.

## Conflicts with the specification and the decision (D-04: option A, follow the spec)

1. Node ids become database UUIDs; folders become real nested nodes (`parentPath`).
2. Edges are drawn importer -> imported, with no reversal. In spec 8.6 item 9, "edges from the target to high-risk files" means the edges between the target and its high-risk dependents.
3. The parser is rewritten as a tree walk over the allowed node API (no queries), adding `import()`, TypeScript-only import forms, `dynamic_import`, exports, line numbers and `.mjs`/`.cjs`.
4. The resolver is rewritten to spec 7.5 step 4 (tsconfig paths/baseUrl, in-memory file index, `.js` -> `.ts`, `outside_repo`, bare packages ignored). T1.6 explains each edge difference against the prototype.
5. Download is from `codeload.github.com` pinned to a commit SHA, not a guessed branch.
6. The canvas lacks several spec 8.6 behaviours and colours nodes red/orange by degree (risk colours are for AI only); it is rebuilt to spec 8.6 as an upgraded version on the prototype's foundations.
7. `dagre` is replaced by `@dagrejs/dagre` (same API).
8. The AI script puts the key in the URL and has no schema, cache, validation or deadline; spec 7.7 replaces it entirely. Nothing is ported.
9. The bundled `.wasm` grammars are tied to `web-tree-sitter` 0.20.8 and could seed `server/grammars/` only if D-01 triggers.

## User decisions

- **Node 26** (spec 3.1 says 26 but `.nvmrc`/engines/D-01 say 22; resolved to 26). If a native build needs it, S-12 applies; D-01 remains available.
- **One test repository:** `Darkness947/vigilante-resume-tailor` replaces "the three test repositories". It has 63 files, so the 300-file/15 s target cannot be measured directly; timings are reported per 100 files.
- **Canvas:** an upgraded, stronger version built on the prototype's foundations.
- **Known risk:** `tree-sitter-typescript` 0.23.2 requires `tree-sitter` ^0.21, while `tree-sitter-javascript` 0.25.0 requires ^0.25. The T1.6 spike must find a compatible pinned set.
