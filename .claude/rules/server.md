---
paths: ["server/**"]
---

# Server rules (spec Parts 5-7)

- Plain ES modules, JavaScript, JSDoc types on public functions.
- **SQL:** parameterized only (`$1`, `$2`). Never build SQL from strings.
- **Ownership:** every query on user data is scoped to the signed-in user (`JOIN repositories r ON r.id = $repo AND r.user_id = $user`). Another user's data returns `404`, never `403`.
- **Errors:** throw `AppError` with a code from spec 6.1. The central handler maps everything else to `INTERNAL` and never leaks stack traces.
- **Inputs:** validate every route input with `express-validator` (owner, name, URL host `github.com`, UUID ids).
- **Secrets:** never log tokens, keys, prompts, excerpts or full request headers. Never read `server/.env`. Use `npm run config:check` and `npm run db:check` instead.
- **GitHub:** requests only to `github.com`, `api.github.com`, `codeload.github.com`, through `githubClient.js` (allowlist checked before sending, max 3 redirects, 15 s API / 60 s ZIP timeouts, one retry on network/5xx).
- **Repository code is parsed, never executed, and never stored.** Source is fetched from GitHub on demand.
- **Parsing (7.5.1):** backend, extractor and resolver are separate layers. Extractors use only `type`, `text`, `startPosition`, `namedChildren`, `childForFieldName`, `parent` and `rootNode`. No tree-sitter queries.
- **Ingestion:** enforce every limit in `limits.js`; persist in one transaction.
- **AI (7.7):** SDK only (`@google/genai`), never a hand-built URL. 20 s overall deadline. The input hash never includes the model. Validate, cache and audit every outcome.
- **Tests:** Vitest + Supertest. GitHub and Gemini are always mocked. Integration tests use `TEST_DATABASE_URL`.
- No dependency outside spec 3.2 without Decision Stop D-02. No schema or API change without D-03.
