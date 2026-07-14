# TOOLS.md — Developer Tools for `intervals-spa`

Scripts in this directory are standalone command-line utilities for working with
the intervals.icu API. They all read credentials from the project `.env` file and
write output to `tools/output/`.

**Prerequisites:** `bash 3.2+`, `curl`, `jq`

---

## Table of Contents

1. [Setup](#setup)
2. [fetch-intervals-by-label.sh](#fetch-intervals-by-labelsh)

---

## Setup

All tools read from `.env` in the project root. Make sure it exists and contains
your credentials before running any script:

```bash
# Verify your .env is present
cat .env | grep INTERVALS_

# Expected output:
# INTERVALS_ATHLETE_ID=i75074
# INTERVALS_API_KEY=4dvnhifu9b2...
```

If `.env` is missing, copy the example and fill in your values:

```bash
cp .env.example .env
# then edit .env with your athlete ID and API key
```

Output files are written to `tools/output/` (git-ignored).

---

## fetch-intervals-by-label.sh

Fetches all intervals with a given label across all activities in a date range,
combining the results into a single JSON file.

Because there is no single intervals.icu API endpoint to filter intervals by label
across activities, this script makes two API calls per activity:

1. `GET /api/v1/athlete/{id}/activities` — list activity IDs for the date range.
2. `GET /api/v1/activity/{id}/intervals` — fetch intervals for each activity, then
   filter locally by `label`.

A configurable sleep (`--delay`, default `0.15 s`) between activity fetches keeps
the request rate well below the 10 req/s per-IP limit.

### Usage

```bash
./tools/fetch-intervals-by-label.sh [OPTIONS]
```

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--label` | `-l` | `fahrtkopf` | Interval label to filter for |
| `--start` | `-s` | `2026-01-01` | Oldest activity date (`YYYY-MM-DD`) |
| `--end` | `-e` | today | Newest activity date (`YYYY-MM-DD`) |
| `--output` | `-o` | auto | Output JSON file path |
| `--delay` | `-d` | `0.15` | Sleep in seconds between activity fetches |
| `--help` | `-h` | — | Show usage and exit |

### Examples

```bash
# Default: label=fahrtkopf, full year 2026, auto-named output file
./tools/fetch-intervals-by-label.sh

# Explicit label and date range
./tools/fetch-intervals-by-label.sh --label fahrtkopf --start 2026-01-01 --end 2026-12-31

# Different label, different year, custom output path
./tools/fetch-intervals-by-label.sh -l vo2max -s 2025-01-01 -e 2025-12-31 -o tools/output/vo2max_2025.json

# Slower rate (conservative — useful when you have many activities)
./tools/fetch-intervals-by-label.sh --delay 0.5
```

### Output format

A JSON array of interval objects, one entry per matching interval.
Each object includes both activity context and interval metrics:

```json
[
  {
    "activity_id":      "A123456789",
    "date":             "2026-03-12",
    "activity_name":    "Mittwoch Runde",
    "activity_type":    "Ride",
    "interval_id":      42,
    "label":            "fahrtkopf",
    "start_time":       "2026-03-12T09:14:00",
    "end_time":         "2026-03-12T09:27:30",
    "moving_time_s":    810,
    "elapsed_time_s":   815,
    "distance_m":       6320.5,
    "avg_watts":        278,
    "weighted_watts":   285,
    "max_watts":        412,
    "avg_watts_kg":     3.8,
    "intensity_pct":    98,
    "avg_hr":           164,
    "max_hr":           171,
    "avg_cadence":      89.0,
    "avg_speed_ms":     7.8,
    "elevation_gain_m": 118.0,
    "avg_gradient_pct": 5.2,
    "training_load":    24.3,
    "joules":           225180,
    "joules_above_ftp": 41200,
    "wbal_start":       18500,
    "wbal_end":         12300,
    "zone":             4,
    "decoupling":       1.8
  }
]
```

### Auto-named output files

When `--output` is omitted, the file is saved as:

```
tools/output/intervals-<label>-<start>-<end>.json
```

Example: `tools/output/intervals-fahrtkopf-2026-01-01-2026-12-31.json`

### Progress output

The script prints timestamped progress to stderr so you can pipe stdout or redirect
the output file independently:

```
[09:03:12]  Athlete:    i75074
[09:03:12]  Label:      fahrtkopf
[09:03:12]  Date range: 2026-01-01 → 2026-12-31
[09:03:12]  Output:     tools/output/intervals-fahrtkopf-2026-01-01-2026-12-31.json
[09:03:12]  Delay:      0.15s between activity fetches
[09:03:12]
[09:03:12]  Fetching activity list...
[09:03:13]  Found 187 activities in range.
[09:03:13]  [1/187]  2026-12-28  Ride  Weihnachtsrunde
[09:03:13]    → 2 matching interval(s) found.
[09:03:14]  [2/187]  2026-12-24  Ride  Heiligabend Ausfahrt
...
[09:07:22]  Done. 34 interval(s) labelled 'fahrtkopf' found across 187 activities.
[09:07:22]  Results written to: tools/output/intervals-fahrtkopf-2026-01-01-2026-12-31.json
```

### Rate limiting

The script handles `429 Too Many Requests` automatically:

- Reads the `Retry-After` response header and waits accordingly.
- Retries the failed request once after the wait.
- The `--delay` flag adds a proactive sleep between every activity fetch
  (default `0.15 s ≈ 6 req/s`, well below the 10 req/s per-IP hard limit).

### Error handling

| Situation | Behaviour |
|-----------|-----------|
| `.env` missing | Exits with error message pointing to `.env.example` |
| `curl` or `jq` not installed | Exits with install hint |
| HTTP 429 (rate limited) | Waits `Retry-After` seconds, retries once |
| HTTP 4xx/5xx on activity | Logs a warning, skips activity, continues |
| Activity has no intervals | Silently skipped |
| No matching intervals found | Writes `[]` to output file |

---

## Adding New Tools

1. Create `tools/my-tool.sh` and make it executable (`chmod +x`).
2. Follow the conventions:
   - Read credentials from `.env` via the `source <(grep -E '^[A-Z_]+=.+' .env)` pattern.
   - Write output to `tools/output/`.
   - Log progress to **stderr**, data to **stdout** or an output file.
   - Handle `429` and non-2xx responses gracefully.
3. Document it in this file under a new `##` section.
