#!/usr/bin/env bash
# fetch-intervals-by-label.sh
# ─────────────────────────────────────────────────────────────────────────────
# Fetch all intervals matching a given label across activities in a date range.
#
# Usage:
#   ./tools/fetch-intervals-by-label.sh [OPTIONS]
#
# Options:
#   -l, --label    <label>      Interval label to search for (default: fahrtkopf)
#   -s, --start    <YYYY-MM-DD> Oldest activity date (default: 2026-01-01)
#   -e, --end      <YYYY-MM-DD> Newest activity date (default: today)
#   -o, --output   <file>       Output JSON file (default: intervals-<label>-<start>-<end>.json)
#   -d, --delay    <seconds>    Sleep between activity fetches (default: 0.15)
#   -h, --help                  Show this help and exit
#
# Reads credentials from .env in the project root:
#   INTERVALS_API_KEY     — your intervals.icu API key
#   INTERVALS_ATHLETE_ID  — your athlete ID (e.g. i75074)
#
# Examples:
#   ./tools/fetch-intervals-by-label.sh
#   ./tools/fetch-intervals-by-label.sh --label fahrtkopf --start 2026-01-01
#   ./tools/fetch-intervals-by-label.sh -l vo2max -s 2025-01-01 -e 2025-12-31 -o vo2max_2025.json
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Locate project root (one level above ./tools) ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Load .env ─────────────────────────────────────────────────────────────────
ENV_FILE="${PROJECT_ROOT}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  # Export only KEY=VALUE lines, skip comments and blanks
  set -o allexport
  # shellcheck disable=SC1090
  source <(grep -E '^[A-Z_]+=.+' "${ENV_FILE}")
  set +o allexport
else
  echo "ERROR: .env file not found at ${ENV_FILE}" >&2
  echo "       Copy .env.example to .env and fill in your credentials." >&2
  exit 1
fi

# ── Validate required env vars ────────────────────────────────────────────────
: "${INTERVALS_API_KEY:?'INTERVALS_API_KEY not set in .env'}"
: "${INTERVALS_ATHLETE_ID:?'INTERVALS_ATHLETE_ID not set in .env'}"

# ── Defaults ──────────────────────────────────────────────────────────────────
LABEL="fahrtkopf"
START_DATE="2026-01-01"
END_DATE="$(date +%Y-%m-%d)"
OUTPUT_FILE=""
DELAY="0.15"

# ── Parse arguments ───────────────────────────────────────────────────────────
usage() {
  sed -n '/^# Usage:/,/^# ─/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,3\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -l|--label)   LABEL="$2";      shift 2 ;;
    -s|--start)   START_DATE="$2"; shift 2 ;;
    -e|--end)     END_DATE="$2";   shift 2 ;;
    -o|--output)  OUTPUT_FILE="$2"; shift 2 ;;
    -d|--delay)   DELAY="$2";      shift 2 ;;
    -h|--help)    usage ;;
    *) echo "Unknown option: $1  (use -h for help)" >&2; exit 1 ;;
  esac
done

# Default output filename if not specified
if [[ -z "${OUTPUT_FILE}" ]]; then
  OUTPUT_FILE="${PROJECT_ROOT}/tools/output/intervals-${LABEL}-${START_DATE}-${END_DATE}.json"
fi

# ── Constants ─────────────────────────────────────────────────────────────────
BASE="https://intervals.icu/api/v1"
AUTH="API_KEY:${INTERVALS_API_KEY}"
ATHLETE="${INTERVALS_ATHLETE_ID}"
UA="intervals-spa/0.1 (github.com/intervals-spa)"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "[$(date +%H:%M:%S)]  $*" >&2; }
warn() { echo "[$(date +%H:%M:%S)]  WARN  $*" >&2; }

# curl wrapper: exits non-zero on HTTP error, sets $HTTP_STATUS
api_get() {
  local url="$1"
  local response http_status
  response=$(curl -s -w '\n__HTTP_STATUS__%{http_code}' \
    -u "${AUTH}" \
    -H "User-Agent: ${UA}" \
    -H "Accept: application/json" \
    "${url}")
  http_status=$(echo "${response}" | tail -n1 | sed 's/__HTTP_STATUS__//')
  body=$(echo "${response}" | sed '$d')

  if [[ "${http_status}" -eq 429 ]]; then
    retry_after=$(echo "${response}" | grep -i 'Retry-After' | awk '{print $2}' || echo "60")
    warn "Rate limited (429). Waiting ${retry_after}s before retry..."
    sleep "${retry_after}"
    api_get "$url"   # single retry
    return
  fi

  if [[ "${http_status}" -lt 200 || "${http_status}" -ge 300 ]]; then
    warn "HTTP ${http_status} for ${url}"
    echo "null"
    return
  fi

  echo "${body}"
}

# ── Dependency checks ─────────────────────────────────────────────────────────
for dep in curl jq; do
  if ! command -v "${dep}" &>/dev/null; then
    echo "ERROR: '${dep}' is required but not installed." >&2
    exit 1
  fi
done

# ── Create output directory ───────────────────────────────────────────────────
mkdir -p "$(dirname "${OUTPUT_FILE}")"

# ── Main ──────────────────────────────────────────────────────────────────────
log "Athlete:    ${ATHLETE}"
log "Label:      ${LABEL}"
log "Date range: ${START_DATE} → ${END_DATE}"
log "Output:     ${OUTPUT_FILE}"
log "Delay:      ${DELAY}s between activity fetches"
log ""

# Step 1 — fetch all activity IDs in the date range
log "Fetching activity list..."
ACTIVITIES_URL="${BASE}/athlete/${ATHLETE}/activities?oldest=${START_DATE}&newest=${END_DATE}&fields=id,name,start_date_local,type"
activities_json=$(api_get "${ACTIVITIES_URL}")

total=$(echo "${activities_json}" | jq 'length')
log "Found ${total} activities in range."

if [[ "${total}" -eq 0 ]]; then
  log "No activities found. Writing empty result."
  echo "[]" > "${OUTPUT_FILE}"
  exit 0
fi

# Step 2 — fetch intervals for each activity and filter by label
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

matched=0
processed=0

while IFS=$'\t' read -r act_id date name type; do
  processed=$(( processed + 1 ))
  log "[${processed}/${total}] ${date}  ${type:-?}  ${name}"

  intervals_json=$(api_get "${BASE}/activity/${act_id}/intervals")

  if [[ "${intervals_json}" == "null" ]] || [[ -z "${intervals_json}" ]]; then
    warn "  Skipping ${act_id} — no interval data returned."
    sleep "${DELAY}"
    continue
  fi

  # Extract matching intervals, augment with activity context
  hits=$(echo "${intervals_json}" | jq \
    --arg act_id   "${act_id}" \
    --arg date     "${date}"   \
    --arg name     "${name}"   \
    --arg type     "${type}"   \
    --arg label    "${LABEL}"  \
    '[.icu_intervals // []
      | .[]
      | select(.label == $label)
      | {
          activity_id:          $act_id,
          date:                 $date,
          activity_name:        $name,
          activity_type:        $type,
          interval_id:          .id,
          label:                .label,
          start_time:           .start_time,
          end_time:             .end_time,
          moving_time_s:        .moving_time,
          elapsed_time_s:       .elapsed_time,
          distance_m:           .distance,
          avg_watts:            .average_watts,
          weighted_watts:       .weighted_average_watts,
          max_watts:            .max_watts,
          avg_watts_kg:         .average_watts_kg,
          intensity_pct:        .intensity,
          avg_hr:               .average_heartrate,
          max_hr:               .max_heartrate,
          avg_cadence:          .average_cadence,
          avg_speed_ms:         .average_speed,
          elevation_gain_m:     .total_elevation_gain,
          avg_gradient_pct:     .average_gradient,
          training_load:        .training_load,
          joules:               .joules,
          joules_above_ftp:     .joules_above_ftp,
          wbal_start:           .wbal_start,
          wbal_end:             .wbal_end,
          zone:                 .zone,
          decoupling:           .decoupling
        }
    ]')

  count=$(echo "${hits}" | jq 'length')
  if [[ "${count}" -gt 0 ]]; then
    matched=$(( matched + count ))
    log "  → ${count} matching interval(s) found."
    echo "${hits}" > "${TMP_DIR}/${act_id}.json"
  fi

  sleep "${DELAY}"

done < <(echo "${activities_json}" | jq -r '.[] | [.id, (.start_date_local[:10]), .name, (.type // "")] | @tsv')

# Step 3 — merge all per-activity results into one JSON array
log ""
log "Merging results..."

if [[ "$(ls -A "${TMP_DIR}" 2>/dev/null)" ]]; then
  jq -s '[.[][]]' "${TMP_DIR}"/*.json > "${OUTPUT_FILE}"
else
  echo "[]" > "${OUTPUT_FILE}"
fi

total_matched=$(jq 'length' "${OUTPUT_FILE}")

log "Done. ${total_matched} interval(s) labelled '${LABEL}' found across ${processed} activities."
log "Results written to: ${OUTPUT_FILE}"
