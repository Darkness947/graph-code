---
paths: ["client/**"]
---

# Client rules (spec Part 8)

- React SPA, plain JavaScript. The client calls `/api/*` on its own origin and needs no environment variables.
- **Tokens:** use CSS variables from `styles/tokens.css` (spec 8.1). No hard-coded colours.
- **Colours:** red and gold (`--risk-high`, `--risk-medium`) are for AI risk only. Never use them for decoration, degree or errors elsewhere.
- **Never** use `dangerouslySetInnerHTML`. Render repository text (paths, reasons) as text.
- **Wording:** use the exact strings in spec 8.4-8.9 (user-facing messages in 8.9). Do not paraphrase.
- **API:** all calls go through `api/client.js`. Tests mock at that layer.
- **Graph:** Dagre (`@dagrejs/dagre`) on visible nodes only, top-to-bottom; `onlyRenderVisibleElements`; hover state lives in the store and never re-runs layout. Edge direction is importer -> imported everywhere (D-04 decision A). If layout throws, show the plain list fallback, never a blank canvas.
- **State:** Zustand (`store/workspaceStore.js`) for workspace state.
- **Out of scope (Part 12):** light theme, mobile layouts, profile page, any "preview error state" button.
- **Tests:** Vitest + jsdom + Testing Library + user-event.
- No dependency outside spec 3.2 without Decision Stop D-02.
