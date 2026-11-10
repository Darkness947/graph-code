# Graph Code — Demo 1

Turns a public GitHub repository into an interactive dependency graph and uses AI (Gemini) to predict the impact of changing a file.

Architecture: React SPA (Netlify) -> Express API (Render) -> PostgreSQL (Neon). The browser calls `/api/*` on its own origin; Netlify proxies it to Render.

## Documents
- [`docs/graph-code-demo1-claude-code-spec.md`](docs/graph-code-demo1-claude-code-spec.md) — specification
- [`docs/graph-code-demo1-plan.md`](docs/graph-code-demo1-plan.md) — scope and demo script
- [`docs/prototype-intake.md`](docs/prototype-intake.md) — Summer prototype intake

## Setup
1. Install Node.js 26 (see `.nvmrc`).
2. Server:
   ```
   cd server
   npm install
   cp .env.example .env   # then fill in the values (see below)
   ```
3. Client:
   ```
   cd client
   npm install
   ```
4. Run both in separate terminals: `npm run dev` in `server/` (port 3000) and in `client/` (port 5173). Open http://localhost:5173.

## Scripts

| Project | Script | Purpose |
|---|---|---|
| both | `npm run dev` | Development server (server: `node --watch`; client: Vite, proxies `/api` to port 3000) |
| both | `npm test` | Run all tests (Vitest) |
| both | `npm run lint` | ESLint and Prettier check |
| both | `npm run format` | Prettier write |
| client | `npm run build` | Production build into `dist/` |
| server | `npm start` | Start the server |
| server | `db:migrate`, `db:check` | Database migrations and connection check (T1.2) |
| server | `config:check` | Validate environment variables (T1.3) |
| server | `ai:ping` | Ping every configured Gemini model (T3.5) |
| server | `parser:check` | Verify the tree-sitter parser (T1.6) |

## Environment variables (names only; values live in `server/.env` and the hosting dashboards)
`NODE_ENV`, `PORT`, `APP_ORIGIN`, `TRUST_PROXY_HOPS`, `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `TOKEN_KEY_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `GEMINI_API_KEY`, `GEMINI_MODELS`, `PARSER_BACKEND`, and the optional tuning values listed in `server/.env.example`.

The client needs no environment variables. Never commit `.env` files.
