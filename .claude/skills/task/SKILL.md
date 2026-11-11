---
description: Runs one Graph Code Demo 1 task from spec Part 9 end to end - announce, scope check, read, plan and wait for approval, build, verify, review, open the PR and stop for the merge.
argument-hint: "[task-id, e.g. T2.3]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git branch *) Bash(git checkout *) Bash(git switch *) Bash(git pull *) Bash(git add *) Bash(git commit *) Bash(git diff *) Bash(git log *) Bash(npm test *) Bash(npm run lint *) Bash(npm run test *)
---

# Task $0

## Where things stand

- Branch: !`git branch --show-current 2>/dev/null || echo "no git repository yet"`
- Uncommitted changes: !`git status --short 2>/dev/null | head -20 || echo "n/a"`

## Sources

- Specification: `docs/graph-code-demo1-claude-code-spec.md` (repository root before T1.1).
- Plan: `docs/graph-code-demo1-plan.md`.
- Read only the parts this task needs. Never load a whole document.
- This is a solo build: you own every file, and I am the only human. The binding rules are in `CLAUDE.md`.

## Routine (do every step, in order)

1. **Announce.** Name the task, its increment and the increment's goal. Ask me today's date if you don't know it. Say whether we are on schedule:
   - Increment 1 by 15 Nov
   - Increment 2 by 23 Nov
   - Increment 3 by 30 Nov
   - Demo ready by 12 Dec

2. **Read.** Read this task's acceptance criteria in spec Part 9. Then read every section they reference (Part 8 for UI, Parts 5–7 for server, Part 1 for its stop points), and the code that already exists.

3. **Plan, then wait.** Present the plan and do not edit any file until I approve it. The plan covers:
   - the numbered acceptance criteria you will meet
   - the files to create or change
   - tests mapped to each criterion
   - the expected stops
   - the risks

4. **Build.**
   - Branch from the latest `main` as `solo/<task-id-lowercase>-<slug>`, for example `solo/t2.3-extraction`.
   - Make small Conventional Commits.
   - Write tests alongside the code. Run the tests and lint for the project you changed after each meaningful step.
   - Whenever I must act, use the `stop` skill (spec Part 1). After I reply, run the stop's check and continue only if it passes.
   - Never work around the specification. Use a Decision Stop (D-01 to D-04) instead.

5. **Verify.**
   - Prove every acceptance criterion with evidence: a test name, command output, or exact browser steps for me.
   - Run the full test suites and lint in both `client/` and `server/`. Everything must pass.
   - Check the diff contains no secrets, `.env`, `_prototype/` or `CLAUDE.local.md` (all git-ignored).

6. **Review.**
   - Run the `simplify` skill, then the `code-review` skill.
   - For anything touching auth, sessions, token crypto, the GitHub client, ZIP extraction or the AI service, also run the `security-review` skill.
   - Then review the diff as a strict reviewer who did not write it. Check:
     - each acceptance criterion
     - interface shapes (spec Parts 5, 6 and 7.5.1)
     - security rules
     - UI tokens, risk colours and exact wording (Parts 8.1 and 8.9)
     - the restricted node API in extractors
     - scope creep
   - Fix every blocking and should-fix finding, then re-run the tests.

7. **Deliver.**
   - Push the branch and open a PR with `gh pr create`, using the task report template (spec Part 11.2) as the body.
   - Post the report here, then STOP with: `Ready to merge: PR #<n>. Reply 'merged' to continue.`
   - Never merge and never push to `main`.

8. **After "merged".** Pull `main` and delete the merged local branch. If the task ended an increment (T1.9, T2.8, T3.10), tell me to run `/checkpoint <n>`. Otherwise name the next task in Part 9 order and continue in this session, unless it has become long (about two large tasks). In that case tell me to start a new session with the master prompt followed by `CONTINUE FROM <next-id>. Today is <date>`.
