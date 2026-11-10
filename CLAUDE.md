# Graph Code — Demo 1 (solo build)

Graph Code turns a public GitHub repository into an interactive dependency graph and uses AI (Gemini) to predict the impact of changing a file. One developer (the user) does every human action; Claude Code builds everything else.

## Documents (read only the parts you need; never load whole files)
- `docs/graph-code-demo1-claude-code-spec.md` — THE specification. Parts 0 and 1 apply in full. Part 9 lists every task with acceptance criteria (AC).
- `docs/graph-code-demo1-plan.md` — scope, cut order (2.2), demo script (Section 6), demo-day prep.
- `docs/prototype-intake.md` — what the Summer prototype contained and the D-04 decision.
- `_prototype/` — git-ignored Summer prototype, reference only. Never commit it. Never read `_prototype/.env`.

## Stack
- Node 26 (`.nvmrc` 26, `engines >=26 <27`). Two independent npm projects, no workspaces: `client/` and `server/`.
- Client: React, Vite, React Router, Zustand, Bootstrap 5, React Flow (`@xyflow/react`), `@dagrejs/dagre`, `prism-react-renderer`.
- Server: Express, `express-session` + `connect-pg-simple`, `pg`, native tree-sitter (exact pinned versions), `@google/genai`.
- Database: PostgreSQL on Neon (branches `dev`, `test`). Hosting: Netlify (client, proxies `/api`) -> Render (server).
- Allowed dependencies: spec 3.2 only. Anything else needs Decision Stop D-02.

## Commands
- `server/`: `npm run dev` (port 3000), `npm test`, `npm run lint`, `db:migrate`, `db:check`, `config:check`, `ai:ping`, `parser:check`.
- `client/`: `npm run dev` (port 5173, proxies `/api` to 3000), `npm test`, `npm run lint`, `npm run build`.
- Run tests and lint in the project you changed after every meaningful step; run both projects fully before delivering.

## Binding rules
1. Follow spec Part 9 in order, one task at a time. Do not start the next increment until the user confirms the checkpoint passed.
2. Plan before editing: announce the task, read its AC and referenced sections, present a plan (numbered AC, files, tests per AC, expected stops, risks), and wait for approval. Edit nothing before approval.
3. Branch per task from the latest main: `solo/<task>-<slug>`. Small Conventional Commits. Never merge pull requests. Never push to `main`. The user merges.
4. Never deviate from the spec silently. Raise a Decision Stop (D-01..D-04). For D-02 and D-03 the user's decision alone is enough.
5. Keep every interface shape (API, schema, module contracts) exactly as the spec defines.
6. Write tests alongside code. A task is done only when every AC is met with evidence, full suites and lint pass, and the diff is clean (no secrets, `.env`, `_prototype/`, `CLAUDE.local.md`).
7. Self-review the diff as a strict reviewer (ideally a subagent without your reasoning) before opening the PR. Fix blocking and should-fix findings.
8. Deliver with `gh pr create` using the report template (spec 11.2), post the report, then stop: "Ready to merge: PR #<n>. Reply 'merged' to continue."
9. Sessions: after "merged", pull main and continue. Stop for a new session at an increment end or after about two large tasks.

## STOP protocol (spec Part 1) — summary
- STOP immediately when the user must act: accounts, dashboards, keys, `.env` values, deployed URLs, browser checks on the deployed site. Known stops: S-00..S-12.
- Action Stop format: `STOP — ACTION REQUIRED: <id> <title>`, then Why / What you need to do (concrete steps) / What to send back / How I will check / I will resume with.
- Decision Stop format: `STOP — DECISION REQUIRED: <id> <title>`, then Situation / Options / My recommendation.
- Secrets go into files or dashboards, never chat. Never ask the user to paste a secret.
- After the user replies, run the stop's check and continue only if it passed.
- Increment checkpoints (after T1.9, T2.8, T3.10): run full suites, write numbered deployed-site checks, stop, then write `docs/checkpoints/increment-<n>.md` (Part 1.5 format) via PR, give two advisor lines, and wait for "start increment <n+1>".

## Security rules
- Parameterized SQL only; every query scoped to the signed-in user; another user's data returns 404.
- GitHub requests only to `github.com`, `api.github.com`, `codeload.github.com`.
- Repository code is parsed, never executed, never stored.
- No secrets in code, logs, chat or git. Never read any `.env` file. `.claude/settings.json` only denies `server/.env` and `client/.env.production`, so `_prototype/.env` is protected by this rule alone.
- No `dangerouslySetInnerHTML`.
- Only `.env.example` is committed, with no real values.

## Fixed decisions to remember
- Branches are `solo/<task>-<slug>` (spec 0.1 shows `inc1/t1.3-auth`; solo adaptation).
- Node 26 (deviation from spec's `.nvmrc` 22; user decision 10 Nov 2026).
- D-04: follow the spec everywhere. UUID node ids, real nested folder nodes, edges importer -> imported, drawn unreversed.
- One test repository: `Darkness947/vigilante-resume-tailor` (63 files); report per-100-file timing.
- The canvas is an upgraded build on the prototype's foundations, still within spec 8.1/8.6.
- Deadlines: Increment 1 by 15 Nov, Increment 2 by 23 Nov, Increment 3 by 30 Nov, demo ready by 12 Dec.

Path-scoped rules live in `.claude/rules/server.md` and `.claude/rules/client.md`.
