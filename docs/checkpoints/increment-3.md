# ✅ CHECKPOINT — INCREMENT 3 COMPLETE

Date: 21 Nov 2026 (deadline 30 Nov). Base: `main` at `38f9b98` (PR #36). Deployed site: https://graph-code.netlify.app (API on Render, database on Neon).

Increment goal: the plan's full demo script (Section 6) passes on the deployed site.

## What works

| Feature | How to try it on the deployed site |
|---|---|
| Graph and source endpoints (T3.1) | Open any Ready repository; **View code** on a file |
| Canvas, collapsed by default (T3.2) | **Open graph** on vigilante. Folders show their name, file count and chevron; double-click or the chevron expands with a ~300 ms animation. Centrality borders, minimap, zoom controls, node dragging (PR #25) |
| Wrapper folders open in place (D-05) | In vigilante, `src` holds about 80% of the files, so it opens without a tray |
| Bundled edges at rest, exact edges on hover (D-06) | Hover any node; click a count badge to expand its target folder |
| Focus mode, search, directory sidebar (T3.3) | Click `card.tsx`: neighbours stay bright and the rest dims. Use **Escape** or "← Back to full graph". **Search files…** gives "No files match '…'". Clicking in the tree selects or expands on the canvas |
| Insights panel and code drawer (T3.4) | Nothing / file / folder selected. **Show** unresolved imports. **View code**: skeleton, highlighted code, a drag-resizable drawer that loads a new file when the selection changes |
| AI service with model fallback, cache and audit (T3.5) | **Analyze change impact (AI)** on `src/components/ui/card.tsx` |
| Rate limits and the in-flight lock (T3.6) | 10 analyses per minute and one in flight per user, then "You're doing that too often. Try again in {n} seconds." (covered by tests) |
| AI panel and canvas extension (T3.7) | Notice modal on first use; loading; result with risk cards, "AI-generated" and "Cached"; High/Medium/Low borders and red edges to High files. `src/components/ui/switch.tsx` shows "No dependents" |
| State polish and keyboard pass (T3.8) | Retry on the dashboard load error; filter no-match; Tab to canvas nodes and Enter to select; a keyboard-resizable drawer |
| A GitHub 401 is confirmed before sign-out (PR #33) | Covered by tests |
| Failed card on the deployed site (T2.6, first triggered in T3.9) | Analyze `Darkness947/NEON-TECH` (archive over 50 MB): "This repository's archive is too large or couldn't be read safely." with **Try again** |
| Repositories that commit `node_modules` ingest (D-07, PR #36) | Analyze `Darkness947/Full-Stack-To-Do-List`: Ready with "23 files · 24 dependencies" |

## Deployed-site check

**Full demo script (T3.9):** run by the human on 21 Nov against `docs/e2e/t3.9-deployed-checklist.md`. Result: **all 38 steps passed**. The steps cover the plan §6 script in order: sign-in, add, dashboard, workspace navigation, focus, search and code, fresh and cached AI, no dependents, delete, not-found and keyboard.

**Checkpoint re-check:** run by the human on 21 Nov after the PR #36 deploy. Result: **all 8 steps passed**.

1. Sign in shows GitHub name and avatar (S-10.1): pass
2. Cookie `gc.sid` HttpOnly, Secure, SameSite=Lax (S-10.2): pass
3. Logout, then `/dashboard` redirects to landing (S-10.3): pass
4. Cancelled sign-in message (S-10.4): pass
5. `Darkness947/Full-Stack-To-Do-List` reaches Ready with 23 files · 24 dependencies (D-07 deployed; T3.9 step 39): pass
6. vigilante `card.tsx` analysis returns "Cached" with risk borders on the canvas: pass
7. `ingestionMs` readable from `/api/repos`: pass
8. Remove Full-Stack-To-Do-List, with the "Repository removed" toast: pass

## Tests

- **Server:** 580 passed, 0 failed. Lint clean.
- **Client:** 356 passed, 0 failed. Lint clean. `npm run build` succeeds.

## Known issues

- **Render free-tier cold start:** the first request after idle can take 30–60 s. UptimeRobot pings every 5 minutes.
- **Canvas smoothness on a large repository is unverified (spec 8.6 item 10).** The spec target is "the large Next.js repository", and none is ingested. The largest repository checked is NEON-HUB (134 files, 300 dependencies), which ran smoothly. Layout takes under 100 ms for 1,000 files in tests, and only visible elements render.
- **Performance target (about 15 s for 300 files, spec 7.5):** still not measured directly. Measured rates are 3.7–5.8 s per 100 files on 70–134 files (see Measured facts). They extrapolate to about 11–17 s for 300 files, so the target is likely met but not proven.
- **Keyboard:** React Flow renders only on-screen nodes, so off-screen nodes can't be reached with Tab. Search is the keyboard route to any file (T3.8).
- **AI total time:** excerpt fetching runs before the 20 s AI deadline. With a slow GitHub, the total can approach Netlify's ~26 s proxy limit (T3.5).
- **`gemini-2.5-flash` as the fallback:** it can exceed the 12 s per-attempt cap on large prompts (14.3 s measured in T3.5). It helps mainly when `flash-lite` hits its quota on small prompts.
- **GitHub 401 retries:** in the worst case, one GitHub call takes 4 requests (about 30 s) if both probes time out. Why GitHub sent the stray 401 is still unknown (PR #33).
- **Favicon:** Safari has no SVG favicon support, and `/favicon.ico` falls through to `index.html` (PR #34).
- **Dragged positions:** they last only until the next expand or collapse (PR #25).
- **Delete cascade:** the indexes noted in the Increment 2 checkpoint are still missing (`edges` by `repository_id`, `ai_audit_log.ai_result_id`). This is negligible at Demo 1 sizes and would need D-03.

## Deviations from the specification

- **D-05 (approved 17–18 Nov):** wrapper folders (at least 60% of their parent's files) open in place without a tray, instead of "every top-level folder is collapsed" (spec 8.6 item 1). PRs #24 and #26.
- **D-06 (approved 18 Nov):** at rest, edges are bundled between siblings, and an open folder can be an endpoint. Exact file edges show on hover or selection (spec 8.6 item 2). PR #27.
- **D-07 (approved 21 Nov):** the ZIP compression-ratio check applies only to entries that are about to be inflated, not to "any entry" (spec 7.5 step 2). Skipped and `too_large` entries are never inflated, and path validation still runs on every entry. PR #36.
- **A GitHub 401 with the user's token** is probed with `GET /user` and retried once before the session ends. This refines the PR #18 deviation, against spec 7.4's "no retry on 4xx". PR #33.
- **An archive over `MAX_ZIP_BYTES`** fails with `ARCHIVE_LIMIT_EXCEEDED`, not `DOWNLOAD_FAILED` (spec 7.5 step 1). This is a T2.3 user decision (commit `1c675fc`), first listed here.
- **T3.8 AC1 not met:** S-11 was skipped by user decision, so the landing page keeps the drawn "Workspace preview" placeholder instead of a hero screenshot.
- **Wording not in spec 8.9:**
  - the dashboard filter's "No repositories match '{query}'" (T3.8)
  - screen-reader node labels and hint (T3.8)
  - workspace load errors "Graph not ready yet", "Repository not found" and "Couldn't load the graph" (T3.2)
  - `GRAPH_NOT_READY`: "This repository's graph isn't ready yet." (T3.1)
- **Additions the spec doesn't define:** node dragging (PR #25, at the user's request), and one extra module, `services/ai/aiErrors.js` (T3.5).
- **`GEMINI_MODELS`** is `gemini-2.5-flash-lite,gemini-2.5-flash` instead of the default list, as S-04 allows. `gemini-flash-latest` timed out on the ping.
- **Test repositories:** vigilante (main), plus NEON-HUB, NEON-TECH and Full-Stack-To-Do-List for add, delete and failure. These replace the three from S-00 and extend the one-repository decision in `docs/prototype-intake.md`.
- **Unchanged from earlier:**
  - Node 26
  - `solo/<task>-<slug>` branches
  - D-04 (follow the spec)
  - the PR #18 decisions: a GitHub 401 ends the session as `UNAUTHENTICATED`, and signed-in users can reach `/` and `/about`

## Cuts

None (`docs/cuts.md` does not exist).

## Measured facts

- **Parser backend:** `PARSER_BACKEND=native` (confirmed on Render, 21 Nov).
- **Pinned versions:** `tree-sitter` 0.21.1, `tree-sitter-javascript` 0.23.1, `tree-sitter-typescript` 0.23.2.
- **`GEMINI_MODELS`:** `gemini-2.5-flash-lite,gemini-2.5-flash` (confirmed on Render, 21 Nov; matches the T3.5 `ai:ping` choice).
- **Ingestion on the deployed site** (end to end: download, extract, parse, resolve, persist):

  | Repository | Files | Dependencies | Time | Per 100 files |
  |---|---|---|---|---|
  | `Darkness947/vigilante-resume-tailor` | 70 | 108 | `ingestionMs` 4073 | **5.8 s** |
  | `Darkness947/NEON-HUB` | 134 | 300 | about 5 s (stopwatch, T3.9) | about 3.7 s |
  | `Darkness947/Full-Stack-To-Do-List` | 23 | 24 | `ingestionMs` 2661 | 11.6 s |

  Fixed costs (the GitHub round trips and the database transaction) dominate small repositories. That explains why the per-100-file rate falls as file count grows.
- **AI latency on the deployed site** (vigilante `src/components/ui/card.tsx`, T3.9): fresh about 6 s, cached under 2 s.
