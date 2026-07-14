#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8080}"

echo "Serving web app at http://localhost:${PORT}"
python3 "${ROOT_DIR}/server.py" --port "${PORT}"
