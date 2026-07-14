#!/usr/bin/env bash
# ralph.sh — agentic story runner for intervals-spa
# Usage: bash scripts/ralph/ralph.sh [--dry-run]
set -euo pipefail

PRD="$(dirname "$0")/prd.json"
PROGRESS="$(dirname "$0")/progress.txt"

echo "Ralph — intervals-spa"
echo "PRD: $PRD"
echo ""

if [[ ! -f "$PRD" ]]; then
  echo "ERROR: prd.json not found at $PRD" >&2
  exit 1
fi

echo "Stories:"
python3 - <<'PY'
import json, sys
with open("scripts/ralph/prd.json") as f:
    data = json.load(f)
for s in sorted(data["stories"], key=lambda x: x["priority"]):
    status = "✓" if s.get("passes") else "○"
    print(f"  {status} [{s['id']}] {s['title']}")
PY
