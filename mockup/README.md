# Mockup

Static HTML mockup for the interval search/list/compare flow.

## Run

From the repository root:

```bash
python3 -m http.server 8080 --directory mockup
```

or:

```bash
./mockup/run.sh 8080
```

Open:

```text
http://localhost:8080
```

## Notes

- Data is hardcoded from `tools/output/intervals-fahrtkopf-2026-01-01-2026-07-14.json`
  and copied to `mockup/data/intervals.json`.
- Search is mock-only: submit moves to the intervals screen and applies local filters.
- Charts use Apache ECharts and are rendered from hardcoded/mock data.
