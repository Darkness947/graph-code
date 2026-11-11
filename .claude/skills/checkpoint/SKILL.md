---
description: Runs the end-of-increment checkpoint for Graph Code Demo 1 after T1.9, T2.8 or T3.10 - full tests, a deployed-site check, the checkpoint report and a two-line advisor summary.
argument-hint: "[increment number: 1, 2 or 3]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git log *) Bash(git pull *) Bash(npm test *) Bash(npm run lint *) Bash(npm run test *)
---

# Checkpoint: Increment $0

Merged since the last checkpoint: !`git log --oneline -30 2>/dev/null || echo "no git history"`


## Increment goals

- **Increment 1:** a deployed skeleton where I can sign in and out.
- **Increment 2:** public repositories go from GitHub into PostgreSQL with live progress, appear on the dashboard and can be deleted.
- **Increment 3:** the plan's full demo script (Section 6) passes on the deployed site.

## Steps

1. **Run the full suites.** Pull `main`, then run the full test suites and lint in `client/` and `server/`. Report the counts.
2. **Write the deployed-site check.** Write numbered steps for Increment $0's goal, each with its expected result, using the deployed Netlify URL. Include S-10 (sign in on the deployed site). Use the `stop` skill so I can run the steps and reply pass or fail for each one.
3. **Measure the facts.** Ask me for any measurement you cannot take yourself:
   - pinned tree-sitter versions and the parser backend (`PARSER_BACKEND`)
   - the confirmed `GEMINI_MODELS` (from `ai:ping`)
   - ingestion timings on the deployed site (small, medium and large test repositories)
   - AI latency for a cached and a fresh analysis
4. **Write the report.** Write `docs/checkpoints/increment-$0.md` in the spec's Part 1.5 format, extended:

   ```
   ✅ CHECKPOINT — INCREMENT $0 COMPLETE

   What works: <features, each with how to try it on the deployed site>
   Deployed-site check: <step results>
   Tests: <client and server, passed / failed>
   Known issues: <list>
   Deviations from the specification: <list or "none">
   Cuts: <from docs/cuts.md or "none">
   Measured facts: <the values above>
   ```

   Deliver it on a branch named `inc$0/checkpoint`, through a PR (never push to `main`).
5. **Write the advisor summary.** Give me two plain lines for my advisor: what this increment delivered and what comes next.
6. **Stop.** End with: `Reply "start increment <next>" when the review is done.` Do not start the next increment's work.

If any check fails, list the failures with the task each belongs to, and propose fixes in priority order. Do not mark the checkpoint complete.
