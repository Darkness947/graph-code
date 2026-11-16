# ✅ CHECKPOINT — INCREMENT 2 COMPLETE

Date: 16 Nov 2026 (deadline 23 Nov). Base: `main` at `d79f6c7`, plus PR #20 (test timeout fix). Deployed site: https://graph-code.netlify.app (API on Render, database on Neon).

Increment goal: public repositories go from GitHub into PostgreSQL with live progress, appear on the dashboard and can be deleted.

## What works

| Feature | How to try it on the deployed site |
|---|---|
| Dashboard with repository cards, filter and empty state (T2.6) | Sign in; type in **Filter repositories…** |
| Analyze from your GitHub list, with paging (T2.1, T2.6) | **Analyze a repository** → **From your GitHub** → **Analyze** on a row; **Load more** past 30 |
| Analyze any public repository by `owner/name` or URL, with inline errors (T2.1, T2.6) | **Any public repository** tab; try an unknown repository or one already added |
| Ingestion pipeline: download pinned to the commit SHA, safe ZIP extraction with every limit, native tree-sitter parse, import resolution, folder nodes and metrics (T2.2–T2.4) | Analyze `Darkness947/vigilante-resume-tailor` |
| Live progress: phase labels, amber progress bar, polling every 1.5 s until the card switches to Ready without a reload (T2.2, T2.6) | Watch the card while it analyzes |
| Atomic persistence of nodes, edges, unresolved imports and repository statistics (T2.5) | Ready card shows "70 files · 108 dependencies · synced …" |
| Failed card with the job's message and **Try again** (T2.6) | Shown when a job fails (covered by tests; not triggered on the site) |
| Delete a repository with confirmation and toast; blocked while a job runs (T2.7) | Trash icon on a card → **Remove**; during analysis the icon is disabled with "Wait for analysis to finish" |
| A rejected GitHub token ends the session cleanly (PR #18) | Covered by tests |

## Deployed-site check

Run by the human on 16 Nov. Result: **all 15 steps passed**.

1. Sign in shows GitHub name and avatar (S-10.1): pass
2. Cookie `gc.sid` HttpOnly, Secure, SameSite=Lax (S-10.2): pass
3. Logout, then `/dashboard` redirects to landing (S-10.3): pass
4. Cancelled sign-in message (S-10.4): pass
5. **From your GitHub** list loads: pass
6. Analyze `vigilante-resume-tailor`: analyzing card with phase labels and progress bar: pass
7. Remove disabled with the tooltip while analyzing: pass
8. Card switches to Ready without a reload: pass
9. Analyze button disabled for invalid input; "You've already analyzed this repository." with **Open graph**: pass
10. Unknown repository: "We couldn't find that repository on GitHub. Check the owner and name.": pass
11. Filter hides and restores the card: pass
12. `/api/repos` statistics readable: pass
13. Remove modal shows the exact text; Cancel changes nothing: pass
14. Remove: card gone, "Repository removed" toast, still gone after reload: pass
15. Re-analyze after removal reaches Ready: pass

## Tests

- Server: 451 passed, 0 failed (with PR #20). Lint clean. Without PR #20, one checkpoint run had 3 integration tests time out at Vitest's 5 s default while waiting on Neon; no assertion failed.
- Client: 124 passed, 0 failed. Lint clean. `npm run build` succeeds.

## Known issues

- Render free tier cold start: the first request after idle can take 30–60 s. UptimeRobot (5-minute interval) reduces this.
- The performance target (about 15 s for a 300-file repository, spec 7.5) cannot be measured directly with the one 70-file test repository. A linear extrapolation of the measured run gives about 17.5 s for 300 files. That is an upper bound, because download and database round trips are mostly fixed costs, but the target is not proven. Re-measure if a larger public repository is added.
- `edges` has no index starting with `repository_id`, and `ai_audit_log.ai_result_id` has no index, so the delete cascade scans those tables. This is negligible at Demo 1 sizes. Adding the indexes would need D-03.
- `GEMINI_API_KEY` is not set on Render yet (S-04 belongs to T3.5).
- **Failed card:** not triggered on the deployed site; covered by RTL tests only.

## Deviations from the specification

- One test repository (`Darkness947/vigilante-resume-tailor`) instead of the three from S-00 (user decision, recorded in `docs/prototype-intake.md`). Timings are reported per 100 files.
- Spec deviations recorded with PR #18:
  - A GitHub `401` maps to `UNAUTHENTICATED`, and the session ends.
  - Signed-in users can reach `/` and `/about`.
- T2.7 additions within the spec'd flow:
  - A `404` on delete is treated as already removed.
  - Delete failures show inline in the modal, using the 8.9 wording.
  - A poll that started before a local add, retry or remove is dropped.
- Earlier deviations are unchanged: Node 26, `solo/<task>-<slug>` branches, and the D-04 decision to follow the spec.

## Cuts

None (`docs/cuts.md` does not exist).

## Measured facts

- **Parser backend:** `PARSER_BACKEND=native`. The first real parse on Render succeeded, which closes the Increment 1 known issue. D-01 was not triggered.
- **Pinned versions:** `tree-sitter` 0.21.1, `tree-sitter-javascript` 0.23.1, `tree-sitter-typescript` 0.23.2.
- **Ingestion on the deployed site,** `Darkness947/vigilante-resume-tailor`:
  - 70 files, 108 edges, 2 unresolved imports, 0 skipped files.
  - `ingestionMs` 4073, which is about **5.8 s per 100 files** end to end (download, extract, parse, resolve, persist). The stopwatch read about 4 s.
  - The figures above are from the run reported after the remove-and-re-add test. The human reported one set of figures; re-adding produced a Ready graph again.
  - For comparison, the Summer prototype gave 63 files, 107 edges and 116 unresolved imports. The file count differs because the spec's skip rules differ from the prototype's. The gap in unresolved imports was not investigated. It most likely reflects how each resolver counts package (external) imports.
- **`GEMINI_MODELS`:** not confirmed yet, because `ai:ping` arrives in T3.5. The default list applies: `gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-latest`.
- **AI latency, cached and fresh:** not measurable yet (Increment 3).
