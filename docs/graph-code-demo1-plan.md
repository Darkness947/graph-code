# Graph Code — Demo 1 Scope and Increment Plan

**Senior Project Part 1, Initial Implementation**
**Demonstration:** live on campus with the Project Advisor, 13–17 December 2026, together with the Proposal Presentation (30 marks in total).

## 1. Purpose and framing

Demo 1 is the first increment of the real Graph Code system. It is not an extension of the Summer prototype. The team is using an Agile, incremental process: the system is built in short increments, and each one ends with working, deployed software and a review. Demo 1 is the result of the first three increments.

The Summer 2026 prototype answered the main technical questions:

- tree-sitter and a custom resolver can build a correct graph.
- React Flow and Dagre stay readable at scale.
- The Gemini free tier has real limits.

Its proven modules (the parser, the import resolver and the graph canvas) are ported into a clean repository built to the documented architecture. Everything else (sign-in, sessions, the database, background jobs, caching and validation) is written new against the Part 1 design.

Building the real system now has two benefits. Nothing is built twice. And by Spring 2027 the committee, who will not have seen Part 1, will be evaluating a system with a clean history, tests and a working deployment.

## 2. Scope

### 2.1 In scope

| # | Feature | What the demo shows | Requirements |
|---|---|---|---|
| F1 | **GitHub sign-in and logout** | OAuth with state check, encrypted token, server-side session in PostgreSQL, logout that destroys the session | R1.1–R1.7, S1.1–S1.5 |
| F2 | **Repositories: list, add, ingest** | The user's public GitHub repositories, or any public repository by owner/name or URL; background ingestion with live progress; graph saved to PostgreSQL | R2.1–R2.4, R3.1–R3.9, R4.1–R4.5 |
| F3 | **Dashboard** | Analyzed repositories with status, file and edge counts, language, last-synced time; empty and failed states | R2.4, R10.1 |
| F4 | **Delete repository** | Confirmation step, then removal of the repository and all its data | R4.6, R10.3 |
| F5 | **Graph workspace** | Collapsed folders, edge aggregation with counts, hover-revealed edges, focus mode, filename search, directory sidebar, code viewer | R5.1–R5.11, R6.1, R6.2, R6.4, R9.1, R9.2 |
| F6 | **AI change impact (blast radius)** | Explicit click only; cached results; validation that removes non-existent files; distinct messages for quota, timeout, network and malformed output; positive "no dependents" state; AI data notice shown once | R7.1–R7.8 |

### 2.2 Not in Demo 1 (planned for Spring 2027)

- Private repositories (the private-access opt-in)
- Re-sync
- AI file summary, intent search and change plan
- Profile page and account deletion
- Python and Java support
- Full hardening pass on rate limits and security headers. Basic versions are in Demo 1.
- Advanced features: monorepo support and incremental re-ingestion

If time runs out, cut in this order:

1. The GitHub repository list in F2. Adding a repository by owner/name still works.
2. The directory sidebar in F5.
3. Animated layout transitions in F5.

The AI error states in F6 are cut last, because they are what make the AI feature credible.

## 3. Increment plan

| Increment | Dates | Goal | Main work | Review |
|---|---|---|---|---|
| **1. Foundation** | 10 Nov – 15 Nov | A deployed skeleton with working sign-in | Repository setup and tooling; database schema and migrations on NeonDB; GitHub sign-in, sessions, logout; security middleware; health endpoint; deployment to Netlify, Render and NeonDB; UptimeRobot; port the parser and resolver with unit tests | Team review; sign in on the deployed site |
| **2. Ingestion** | 16 Nov – 23 Nov | Repositories go from GitHub to PostgreSQL | Repository list and add flow; background ingestion job with progress; size and safety limits; atomic graph persistence; dashboard; delete repository | Team review; ingest three test repositories on the deployed site |
| **3. Exploration and AI** | 24 Nov – 30 Nov | The full Demo 1 loop works end to end | Graph API; port the readability-v2 canvas onto real data; focus mode, search, directory sidebar, code viewer; blast-radius analysis with cache, validation, audit and error states | Team review; full rehearsal on the deployed site |
| **Buffer** | 1 Dec – 12 Dec | Demo-ready | Bug fixes, demo repositories, cache pre-warming, two rehearsals, backup recording | Final dry run |
| **Demo** | 13 – 17 Dec | Live demonstration | Proposal presentation and Demo 1 | Advisor evaluation |

If an increment slips, the next one starts from where it ended and the cut order in Section 2.2 applies. The buffer week is not used for new features.

## 4. Responsibilities

| Member | Primary ownership in Demo 1 | Supporting |
|---|---|---|
| Hussain (full-stack, team leader) | AI layer (F6 backend, including the Gemini model router); server skeleton and security middleware; sign-in backend and sessions (F1); deployment and environment setup; integration | Reviews Hassan's and Mohammed's pull requests |
| Hassan (Frontend developer) | The whole client: sign-in UI (F1), dashboard and add/delete UI (F2–F4), graph workspace (F5), AI panel (F6), every UI state and message | Reviews Hussain's and Mohammed's pull requests per increment |
| Mohammed (Database engineer) | Schema and migrations; token encryption; GitHub client; parser and resolver (native tree-sitter with pluggable language layers); ingestion pipeline and persistence (F2); graph and source endpoints; the blast-radius query; delete (F4) | Reviews Hussain's and Hassan's pull requests per increment |

The detailed division, the contracts between members and each member's prompts are in `graph-code-demo1-team-tasks.md`.

Each member reviews at least one pull request from each other member per increment, so no layer is understood by only one person. Each member uses **Claude Code** to implement their own tasks from the shared specification (`graph-code-demo1-claude-code-spec.md`), under their own supervision. The repository's `CLAUDE.md`, rules and shared permission settings keep all three members' sessions on the same rules. Every change Claude Code makes is reviewed by a person and tested before merging.

## 5. Definition of done

A feature counts as done for Demo 1 when all of the following are true:

1. It meets the acceptance criteria in the implementation specification.
2. It has the unit and integration tests listed there, and they pass.
3. It works on the deployed site (Netlify, Render, NeonDB), not only locally.
4. Its empty, loading and error states are implemented with the agreed wording.
5. It has been reviewed by another team member and merged into `main`.

## 6. Demonstration script (about 10 minutes)

1. **Landing page and sign-in (1 min).** Sign in with GitHub, which lands on the dashboard. Mention the state check and that the token is encrypted and never sent to the browser.
2. **Add a repository (2 min).** Add a medium-sized public repository and show the live progress bar and phase labels. Mention that ingestion runs as a background job.
3. **Dashboard (30 s).** Show the analyzed repositories with their metadata.
4. **Graph workspace (3 min).**
   - **Navigation:** the collapsed folders, aggregated edges with counts, and edges revealed on hover.
   - **Focus mode:** expand a folder, then click a central file. Focus mode dims the rest and zooms in.
   - **Search and code:** search for a file by name, then open the code viewer.
5. **AI change impact (2 min).**
   - **Fresh analysis:** click Analyze on a central file. The risk cards appear and the highlight extends to the affected files.
   - **Cached analysis:** click Analyze again. The result returns instantly from the cache.
   - **Prepared states:** show the "no dependents" state on an isolated file. Explain the error states, and show the quota message if it occurs naturally.
6. **Delete (30 s).** Delete a repository, confirm it, and the dashboard updates.
7. **Close (1 min).** Show the increment plan and what is next for Spring 2027.

### Demo-day preparation

- **Repositories:** use the known-good public repositoriy from prototype (the Next.js repository), ingested in advance.
- **Cache:** pre-warm the AI cache for the files that will be analyzed live. Keep one file un-cached to show a fresh call.

## 7. Risks to Demo 1

| Risk | Mitigation |
|---|---|
| Gemini free-tier quota is exhausted during the demo | Pre-warmed cache; automatic fallback to the next configured Gemini model on quota errors (within a 20-second deadline); `ai:ping` run before the demo to confirm which models respond; only one live fresh call; the quota message is a designed state; backup recording |
| Render backend is asleep or slow | UptimeRobot; warm-up request; loading states. The team may use a paid Render plan for the presentation month |
| tree-sitter native modules fail to install or build (on a teammate's laptop or on Render) | Exact pinned versions chosen and verified on all three machines and Render in a first-day spike in Increment 1. Parsing is split into backends, extractors and resolvers, so a pre-agreed rule can switch to the WebAssembly backend by configuration without rewriting extraction |
| Claude Code usage limits or cost | Each member needs Claude Code access through a paid Claude plan or API credits. This sits outside the zero-budget hosting stack, so state it in the proposal's economic constraint. Short, one-task sessions keep usage down |
| An increment slips | Cut order in Section 2.2; buffer week |
| Campus network problems | Hotspot as a backup; backup recording |
| Large repository exceeds free-tier memory | 1,000-file ceiling and size caps; use tested demo repositories only |
