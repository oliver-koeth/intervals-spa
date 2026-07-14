#!/usr/bin/env bash
# mockup/dev.sh — hot-reload dev server for the mockup
#
# Runs the local Python server and restarts it automatically whenever any
# of the tracked files change, using watchexec.
#
# Usage:
#   ./mockup/dev.sh [PORT]
#
# Default port: 8080
#
# Prerequisites:
#   watchexec  — https://github.com/watchexec/watchexec
#               brew install watchexec  |  cargo install watchexec-cli
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8080}"

# ── Dependency check ──────────────────────────────────────────────────────
if ! command -v watchexec &>/dev/null; then
  echo "ERROR: watchexec is not installed." >&2
  echo "       Install with:  brew install watchexec" >&2
  echo "       or:            cargo install watchexec-cli" >&2
  exit 1
fi

# ── Watched extensions ────────────────────────────────────────────────────
# html, css, js  — mockup source files
# json           — data files under mockup/data/
# py             — local proxy/static server code
WATCH_EXTS="html,css,js,json,py"

echo ""
echo "  Intervals Mockup — dev server"
echo "  ─────────────────────────────────────────"
echo "  URL:      http://localhost:${PORT}"
echo "  Watching: ${WATCH_EXTS} under ${SCRIPT_DIR}"
echo "  Stop:     Ctrl-C"
echo ""

watchexec \
  --watch "${SCRIPT_DIR}" \
  --exts  "${WATCH_EXTS}" \
  --restart \
  --print-events \
  -- python3 "${SCRIPT_DIR}/server.py" --port "${PORT}"
