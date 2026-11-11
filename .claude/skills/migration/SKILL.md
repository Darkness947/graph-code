---
description: Adds a new numbered SQL migration to Graph Code, applies it to the test database, and runs the server tests. Any schema change needs an approved D-03 first.
argument-hint: "[short-name, e.g. add_repo_index]"
disable-model-invocation: true
allowed-tools: Bash(ls server/src/db/migrations*) Bash(npm test *) Bash(npm run test *) Bash(npm run lint *)
---

# New migration: $0

Existing migrations: !`ls server/src/db/migrations 2>/dev/null || echo "none yet (T1.2 creates 001_init.sql)"`

## Before writing anything

1. **Get D-03 approved first.** A schema change is a Decision Stop (D-03, spec Part 1.4) unless this is T1.2 creating `001_init.sql` exactly as in spec Part 5.2.
   - If D-03 has not been approved in this session, use the `stop` skill.
   - State the reason and the exact SQL change, then wait.
2. **Read the database rules:** spec Part 5 (5.1 runner, 5.2 schema, 5.3 `path_ltree` encoding).

## Write it

- **File name:** create `server/src/db/migrations/<NNN>_$0.sql`, where `<NNN>` is the next three-digit number.
- **Never edit an applied migration.** Every change is a new file.
- **Keep it self-contained.** The runner wraps it in a transaction, so do not add `BEGIN` or `COMMIT`.
- **Prefer safe forms:** `ADD COLUMN ... NULL`, or with a default, and `CREATE INDEX IF NOT EXISTS`.
- **Keep ownership intact.** Every table that holds user data stays reachable from `repositories.user_id`, and deletes cascade from `repositories`.
- **Parameters only.** Any query you add that uses the new schema takes parameters (`\$1`, `\$2`). Never build SQL from strings.

## Apply and test

1. **Run the server tests.** They reset the schema on `TEST_DATABASE_URL` and apply every migration, which proves the new file applies cleanly from zero.
2. **Do not touch the dev or production databases yourself, and never read `.env`.** Give me the command to run on dev:

   ```
   cd server && npm run db:migrate
   ```

   Then give me the production steps (Render shell or a local run against the production branch) as an Action Stop.
3. **Add or adjust tests** for anything that reads or writes the new columns.

## Report

- **Migration details:** the file name, the SQL in a code block, and the D-03 decision it implements.
- **Documents to update:** list the Database Design text, the ER diagram (`graph-code-er-diagram.drawio`) and spec Part 5.2, so the documentation stays in step with the schema.
