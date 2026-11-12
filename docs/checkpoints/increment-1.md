# ✅ CHECKPOINT — INCREMENT 1 COMPLETE

Date: 13 Nov 2026 (deadline 15 Nov). Base: `main` at `60e6fed`. Deployed site: https://graph-code.netlify.app (API on Render, database on Neon).

## What works

| Feature | How to try it on the deployed site |
|---|---|
| Landing, About, Privacy, error and Not Found pages (T1.5) | Open `/`, `/about`, `/privacy`, `/no-such-page` |
| Sign in with GitHub, session, avatar and name on the dashboard (T1.4) | Click **Sign in with GitHub**, approve, reload the page |
| Logout and route protection (T1.4, T1.5) | Avatar → **Log out**; open `/dashboard` and get sent to the landing page |
| Cancelled sign-in message (T1.4) | Sign in, click **Cancel** on GitHub's page |
| Session cookie `gc.sid` HttpOnly, Secure, SameSite=Lax (T1.4, T1.8) | Developer tools → Cookies |
| API behind the Netlify proxy (T1.3, T1.8) | Open `/api/health`, which returns `{"status":"ok"}` |
| Uptime monitor (T1.8) | UptimeRobot monitor `Graph Code API` shows Up |

Built but not visible on the site yet: database schema and migrations (T1.2), token encryption (T1.4), JS/TS parser, resolver and language registry (T1.6), and the allowlisted GitHub client (T1.7). Each is covered by tests, and the first routes that use them arrive in Increment 2.

## Deployed-site check

Run by the human on 13 Nov. Result: **all 11 steps passed**.

1. Landing page loads: pass
2. `/about` and `/privacy` render: pass
3. `/dashboard` signed out redirects to landing: pass
4. Not Found page: pass
5. Sign-in shows GitHub name and avatar: pass
6. Reload stays signed in: pass
7. Cookie flags `gc.sid` HttpOnly, Secure, SameSite=Lax: pass
8. `/api/health` through the proxy: pass
9. Logout, then `/dashboard` redirects: pass
10. Cancelled sign-in message: pass
11. UptimeRobot monitor Up: pass

Agent curl checks (T1.8): `/` 200, `/api/health` 200, `/api/me` 401 `UNAUTHENTICATED` error shape, `/dashboard` 200 SPA fallback, login redirect uses the production client ID and callback.

## Tests

- Server: 232 passed, 0 failed. Lint clean.
- Client: 68 passed, 0 failed. Lint clean. `npm run build` succeeds.

## Known issues

- Render free tier cold start: the first request after idle can take 30–60 s. The UptimeRobot monitor (5-minute interval) reduces this.
- `parser:check` was not run on Render. The Render build compiled native tree-sitter with `npm ci` and the service is healthy, but `/api/health` does not load the parser. The first real parse on Render happens with the ingestion work in T2.x, so watch for it there.
- `GEMINI_API_KEY` is not set on Render yet (S-04 belongs to T3.5).
- Spec T1.6 asks for `parser:check` on three team members' machines. This is a solo build, so it passed on one machine.

## Deviations from the specification

- Node 26 instead of the spec's `.nvmrc` 22 (user decision, 10 Nov 2026). Netlify is pinned with `NODE_VERSION=26`.
- Branches are `solo/<task>-<slug>` (solo adaptation of spec 0.1).
- S-06: the spec says to leave `APP_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_CALLBACK_URL` empty. `config.js` (spec 4.2) fails fast without them, so temporary placeholders were set and S-08 replaced them. No code change.
- PR #9 (`netlify.toml`) was merged before the T1.8 report so Netlify could deploy from `main`.
- D-04 decided: follow the spec (UUID node ids, nested folder nodes, edges importer → imported).

## Cuts

None (`docs/cuts.md` does not exist).

## Measured facts

- Parser backend: `PARSER_BACKEND=native` (D-01 not triggered; it built on Render).
- Pinned versions: `tree-sitter` 0.21.1, `tree-sitter-javascript` 0.23.1, `tree-sitter-typescript` 0.23.2.
- Parser timing on `Darkness947/vigilante-resume-tailor` (70 source files under the skip rules): about 380 ms per 100 files cold, about 220 ms per 100 files warm (`buildFileGraph`: parse, extract, resolve, hash; local machine).
- `GEMINI_MODELS`: not confirmed yet, because `ai:ping` arrives in T3.5. The default list applies: `gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-latest`.
- Ingestion timing on the deployed site: not measurable yet (starts in Increment 2).
- AI latency, cached and fresh: not measurable yet (starts in Increment 3).
