# Contributing to `intervals-spa`

## Local Setup

No install or build step is required — `webapp/` is plain HTML/CSS/JS, loaded directly by the
browser.

1. Install Python `3.8+` (only used to run the local dev server).
2. Start the dev server:
   ```bash
   ./webapp/run.sh 8080
   ```
   or, with auto-restart on file changes:
   ```bash
   ./webapp/dev.sh 8080
   ```
3. Open `http://localhost:8080` and configure your intervals.icu credentials in **Settings**.

## Pre-Commit Quality Commands

```bash
make quality
```

This runs `node --check` over every file in `webapp/src/` to catch syntax errors. There is
currently no linter/formatter or automated test suite for the webapp JS — see
`docs/ARCHITECTURE.md` §8 for planned follow-ups (ESLint config, Playwright tests).

## Architecture Boundary Expectations

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full breakdown. In short:

- Everything lives under `webapp/`; there is no backend and no build step in production.
- `webapp/src/*.js` are loaded as classic (non-module) `<script>` tags, in the exact order
  listed in `index.html`. They share one global scope by design.
  - `state.js` must load first (defines the shared `state` object and constants).
  - `main.js` must load last (calls `init()`, which wires up all DOM event listeners).
  - Keep new files grouped by feature (see the existing files for the pattern) and add their
    `<script>` tag to `index.html` in a position consistent with what they depend on.
- `webapp/server.py` is local-development tooling only (static file serving + optional API
  proxy to dodge CORS on `localhost`). Never add production-only logic there — it is not part
  of the GitHub Pages deployment.
- All persistent app data (settings, API keys, cached activities/intervals/glucose readings)
  must go through `localStorage` — never introduce a server-side store.

## Commit Message Convention

Follow the existing history: short, descriptive, imperative-mood summaries (no strict
Conventional Commits prefix required), e.g.:

- `Add activity similarity UI`
- `Fix mobile tap selection in compare charts`
- `Add filters to activities page`

## Branching

Per [`AGENTS.md`](AGENTS.md): when starting a new feature while on `master`, create a feature
branch first, and keep it off GitHub Pages (i.e. don't merge to `master`) until the feature is
ready — `pages.yml` deploys on every push to `master`.

## Pull Request Checklist

- [ ] `make quality` passes locally
- [ ] Manually verified the affected screen(s) in the browser (no automated UI tests yet)
- [ ] `docs/ARCHITECTURE.md` updated if the file layout or external API usage changed
