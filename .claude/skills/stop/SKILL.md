---
description: Graph Code STOP protocol. Use whenever a human must act (accounts, dashboards, keys, .env values, browser checks, files from outside the repository) or a decision deviates from the spec, including the known stops S-00 to S-12 and D-01 to D-04.
argument-hint: "[stop-id, e.g. S-02 or D-03]"
---

# STOP protocol ($ARGUMENTS)

Stopping ends your turn. Do not continue with any other work until I reply.

## 1. Find the guide

- **Known stop (S-xx):** read its entry in spec Part 1.4 (`docs/graph-code-demo1-claude-code-spec.md`). That entry is the minimum content of the guide.
- **Unlisted stop:** if the situation needs me but has no ID, still stop and write a guide in the same format, titled `S-NEW <short title>`.
- **Website changed:** if a website's layout no longer matches the guide, say so and adapt the steps.

## 2. Write the message: Action Stop (something I must do)

Use exactly this structure, in one message:

```
🛑 STOP — ACTION REQUIRED: <stop ID> <short title>

Why this is needed:
<one or two sentences: what is blocked and why you cannot do it>

What you need to do (step by step):
1. <exact website, menu, button and field names; exact values; commands in code blocks>
2. ...

What to send back to me:
- <e.g. "Reply 'Done S-02'. Do not paste the connection string here; put it in server/.env as in step 6.">

How I will check it worked:
<the command or test you will run after I confirm>

I will resume with: <task ID and name>
```

## 3. Write the message: Decision Stop (a choice the spec does not settle)

```
⚠️ STOP — DECISION REQUIRED: <D-ID> <short title>

Situation:
<what happened, with the error message or evidence>

Options:
A. <option> — <consequence>
B. <option> — <consequence>

My recommendation: <A or B, and why in one or two sentences>

I will not continue until you choose.
```

The expected decision stops are:

- **D-01:** native tree-sitter fails. Apply the pre-agreed rule in Part 1.4, report which condition was met, and switch to `PARSER_BACKEND=wasm` unless I object.
- **D-02:** a dependency not listed in Part 3.2. State its purpose, weekly downloads, maintenance status and the alternative without it.
- **D-03:** any change to the schema (Part 5) or the API contract (Part 6). State the reason and the exact change.
- **D-04:** prototype code conflicts with the spec. Explain the conflict and propose the change.

## Rules

- **Secrets go into files or dashboards, never into chat.** Never ask me to paste a secret here, never read `.env` files, and never print secret values.
- **Write for a beginner.** Every step must be followable by a student who has never used the service.
- **Check before resuming.** After I reply, run the check you promised and report the result. If it fails, say exactly what is wrong and give the corrective steps, and do not resume.
