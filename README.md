# intervals-spa

A browser-only dashboard for reviewing training activities, intervals, and glucose data from
[intervals.icu](https://intervals.icu) (and optionally [Strava](https://www.strava.com)).

There is **no backend**. The app is a static site: it talks to intervals.icu/Strava directly
from the browser using your own API key / OAuth token, and stores settings and cached data in
your browser's `localStorage`. It is deployed as-is to GitHub Pages.

## Directory Layout

```
intervals-spa/
  webapp/               The entire application (deployed to GitHub Pages)
    index.html            Markup + <script> tags loading webapp/src/* in order
    styles.css            All styling (light/dark theme)
    server.py             Local-dev-only static server + optional API proxy (not deployed)
    src/                   Application code, split by feature — see docs/ARCHITECTURE.md
    datenschutz.html, impressum.html, license.html   Legal pages
  tools/                 Standalone CLI scripts for the intervals.icu API
  docs/                  Architecture and intervals.icu API integration reference
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full breakdown of `webapp/src/`.

## Developer Setup

1. No install/build step is required — `webapp/` is plain HTML/CSS/JS.
2. Start the local dev server (serves static files, optionally proxies API calls to avoid CORS
   on `localhost`):
   ```bash
   ./webapp/run.sh 8080
   ```
   or with auto-restart on file changes:
   ```bash
   ./webapp/dev.sh 8080
   ```
3. Open `http://localhost:8080`.
4. In the **Settings** screen, enter your intervals.icu athlete ID and API key (see
   [`INTEGRATION.md`](INTEGRATION.md)), and optionally connect Strava.

Charts are rendered with [Apache ECharts](https://echarts.apache.org/); UI controls use
[Shoelace](https://shoelace.style/).

## Quality Checks

```bash
make quality
```

This syntax-checks every file in `webapp/src/`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
more.

## Deployment

Every push to `master` deploys `webapp/` as-is to GitHub Pages via
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) — no build step. See
[`AGENTS.md`](AGENTS.md) for the branching convention used when developing new features.

## Data & Privacy

All settings, API keys, and cached search/glucose data live in your browser's `localStorage`
only. Nothing is sent to or stored on any server operated by this project. See
`webapp/datenschutz.html` (Datenschutz/privacy) and `webapp/impressum.html`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## intervals.icu API Reference

See [`INTEGRATION.md`](INTEGRATION.md) for authentication, rate limits, and endpoint reference.
