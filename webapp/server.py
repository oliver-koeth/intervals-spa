#!/usr/bin/env python3
"""Local server for the static intervals app.

- Serves static files from ./webapp
- Adds POST /api/search proxy endpoint for intervals.icu
"""

from __future__ import annotations

import argparse
import base64
import json
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT_DIR = Path(__file__).resolve().parent
API_BASE = "https://intervals.icu/api/v1"
USER_AGENT = "intervals-spa-local-server/0.1"


def _json_response(handler: SimpleHTTPRequestHandler, code: int, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)


def _api_get(url: str, auth: str) -> Any:
    req = Request(
        url,
        headers={
            "Authorization": auth,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urlopen(req, timeout=30) as resp:  # nosec B310
        return json.loads(resp.read().decode("utf-8"))


def _normalize_type(value: str) -> str:
    return "".join(value.split()).lower()


def run_search(payload: dict[str, Any]) -> list[dict[str, Any]]:
    athlete_id = str(payload.get("athlete_id", "")).strip()
    api_key = str(payload.get("api_key", "")).strip()
    label = str(payload.get("label", "")).strip().lower()
    activity_type = str(payload.get("activity_type", "")).strip()
    start_date = str(payload.get("start_date", "")).strip()
    end_date = str(payload.get("end_date", "")).strip()
    time_target_s = payload.get("time_target_s")
    time_margin_s = payload.get("time_margin_s")

    if not athlete_id or not api_key or not start_date or not end_date:
        raise ValueError("athlete_id, api_key, start_date, and end_date are required")

    auth = "Basic " + base64.b64encode(f"API_KEY:{api_key}".encode("utf-8")).decode("ascii")
    fields = quote("id,name,start_date_local,type")
    activities_url = (
        f"{API_BASE}/athlete/{quote(athlete_id)}/activities"
        f"?oldest={quote(start_date)}&newest={quote(end_date)}&fields={fields}"
    )
    activities = _api_get(activities_url, auth)

    target_type = _normalize_type(activity_type)
    margin_s = int(time_margin_s or 10)
    results: list[dict[str, Any]] = []

    for activity in activities:
        if target_type and _normalize_type(str(activity.get("type", ""))) != target_type:
            continue

        interval_url = f"{API_BASE}/activity/{quote(str(activity.get('id')))}" "/intervals"
        try:
            interval_data = _api_get(interval_url, auth)
        except (HTTPError, URLError):
            time.sleep(0.15)
            continue

        for interval in interval_data.get("icu_intervals", []):
            interval_label = str(interval.get("label", "")).lower()
            if label and label not in interval_label:
                continue

            moving_time_s = int(interval.get("moving_time") or 0)
            if time_target_s is not None:
                lo = int(time_target_s) - margin_s
                hi = int(time_target_s) + margin_s
                if moving_time_s < lo or moving_time_s > hi:
                    continue

            results.append(
                {
                    "interval_id": interval.get("id"),
                    "activity_id": activity.get("id"),
                    "date": str(activity.get("start_date_local", ""))[:10],
                    "activity_name": activity.get("name", ""),
                    "activity_type": activity.get("type", ""),
                    "label": interval.get("label", ""),
                    "moving_time_s": moving_time_s,
                    "avg_hr": interval.get("average_heartrate", 0),
                    "max_hr": interval.get("max_heartrate", 0),
                    "zone": interval.get("zone"),
                }
            )

        time.sleep(0.15)

    return results


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/search":
            _json_response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body or "{}")
            results = run_search(payload)
        except ValueError as exc:
            _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except HTTPError as exc:
            _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": f"Upstream HTTP {exc.code}"})
            return
        except URLError as exc:
            _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": f"Upstream error: {exc.reason}"})
            return
        except Exception as exc:  # noqa: BLE001
            _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        _json_response(self, HTTPStatus.OK, {"results": results})


def main() -> None:
    parser = argparse.ArgumentParser(description="Intervals static app local server")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Serving on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
