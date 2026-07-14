# Intervals Web App (Static + Local Server)

This folder now contains a real static web app (not a mock data dashboard).

Implemented screens:

1. **Search** — triggers an intervals.icu search.
2. **Intervals** — displays actual search results and local result filtering.
3. **Settings** — stores athlete ID / API key / API mode in browser local storage.

Charts are intentionally not included yet.

## Local testing (Python server)

Use the local server (serves static files + exposes `/api/search` proxy):

```bash
./mockup/run.sh 8080
```

or with auto-restart on file changes:

```bash
./mockup/dev.sh 8080
```

Open: `http://localhost:8080`

## Static deployment (GitHub Pages)

Deploy the files in `mockup/` as static assets.

In static mode, set **API mode** to **Direct intervals.icu** (or leave **Auto**, which
chooses direct mode outside localhost).

## API modes

- **Auto** (recommended): localhost uses proxy, other hosts use direct.
- **Local proxy**: browser calls `POST /api/search` on local Python server.
- **Direct intervals.icu**: browser calls intervals.icu directly.
