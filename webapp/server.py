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
from urllib.parse import parse_qs, quote, urlencode, urlparse
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


def _api_get_with_headers(url: str, headers: dict[str, str]) -> Any:
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as resp:  # nosec B310
        return json.loads(resp.read().decode("utf-8"))


def _api_post_form(url: str, form_data: dict[str, str]) -> Any:
    raw = urlencode(form_data).encode()
    req = Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urlopen(req, timeout=30) as resp:  # nosec B310
        return json.loads(resp.read().decode("utf-8"))


def _normalize_type(value: str) -> str:
    return "".join(value.split()).lower()


def run_streams(activity_id: str, api_key: str) -> dict[str, list[int]]:
    auth = "Basic " + base64.b64encode(f"API_KEY:{api_key}".encode()).decode("ascii")
    url = f"{API_BASE}/activity/{quote(activity_id)}/streams?types=heartrate,time"
    raw = _api_get(url, auth)
    return {
        "time":      next((s["data"] for s in raw if s.get("type") == "time"),      []),
        "heartrate": next((s["data"] for s in raw if s.get("type") == "heartrate"), []),
    }


def run_zone_models(athlete_id: str, api_key: str) -> list[dict[str, Any]]:
    auth = "Basic " + base64.b64encode(f"API_KEY:{api_key}".encode()).decode("ascii")
    url = f"{API_BASE}/athlete/{quote(athlete_id)}/sport-settings"
    raw = _api_get(url, auth)
    seen: set[int] = set()
    models: list[dict[str, Any]] = []
    for s in raw:
        sid = s.get("id")
        hr_zones = s.get("hr_zones") or []
        if sid and sid not in seen and hr_zones:
            seen.add(sid)
            names = s.get("hr_zone_names") or [f"Z{i+1}" for i in range(len(hr_zones))]
            models.append({
                "id":            sid,
                "hr_zones":      hr_zones,
                "hr_zone_names": names,
                "lthr":          s.get("lthr"),
                "max_hr":        s.get("max_hr"),
            })
    return models


def run_search(payload: dict[str, Any]) -> list[dict[str, Any]]:
    athlete_id = str(payload.get("athlete_id", "")).strip()
    api_key = str(payload.get("api_key", "")).strip()
    label = str(payload.get("label", "")).strip().lower()
    activity_type = str(payload.get("activity_type", "")).strip()
    start_date = str(payload.get("start_date", "")).strip()
    end_date = str(payload.get("end_date", "")).strip()
    time_target_s = payload.get("time_target_s")
    time_margin_s = payload.get("time_margin_s")
    exclude_recovery = bool(payload.get("exclude_recovery", False))

    if not athlete_id or not api_key or not start_date or not end_date:
        raise ValueError("athlete_id, api_key, start_date, and end_date are required")

    auth = "Basic " + base64.b64encode(f"API_KEY:{api_key}".encode()).decode("ascii")
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
            if exclude_recovery and interval.get("type") == "RECOVERY":
                continue
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
                    "activity_start_local": activity.get("start_date_local", ""),
                    "date": str(activity.get("start_date_local", ""))[:10],
                    "activity_name": activity.get("name", ""),
                    "activity_type": activity.get("type", ""),
                    "label": interval.get("label", ""),
                    "interval_type": interval.get("type", ""),
                    "moving_time_s": moving_time_s,
                    "start_index": int(interval.get("start_index") or 0),
                    "avg_hr": interval.get("average_heartrate", 0),
                    "max_hr": interval.get("max_heartrate", 0),
                    "zone": interval.get("zone"),
                }
            )

        time.sleep(0.15)

    return results


def run_strava_token(payload: dict[str, Any]) -> dict[str, Any]:
    client_id = str(payload.get("client_id", "")).strip()
    client_secret = str(payload.get("client_secret", "")).strip()
    grant_type = str(payload.get("grant_type", "")).strip()
    if not client_id or not client_secret or not grant_type:
        raise ValueError("client_id, client_secret and grant_type are required")

    form: dict[str, str] = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": grant_type,
    }
    if grant_type == "authorization_code":
        code = str(payload.get("code", "")).strip()
        if not code:
            raise ValueError("code is required for authorization_code grant")
        form["code"] = code
    elif grant_type == "refresh_token":
        refresh_token = str(payload.get("refresh_token", "")).strip()
        if not refresh_token:
            raise ValueError("refresh_token is required for refresh_token grant")
        form["refresh_token"] = refresh_token
    else:
        raise ValueError("unsupported grant_type")

    return _api_post_form("https://www.strava.com/oauth/token", form)


def run_strava_get(path: str, access_token: str) -> Any:
    if not path.startswith("/"):
        raise ValueError("path must start with /")
    return _api_get_with_headers(
        f"https://www.strava.com/api/v3{path}",
        {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        def _qs(key: str) -> str:
            return qs.get(key, [""])[0].strip()

        if parsed.path == "/api/streams":
            activity_id = _qs("activity_id")
            api_key = _qs("api_key")
            if not activity_id or not api_key:
                _json_response(
                    self,
                    HTTPStatus.BAD_REQUEST,
                    {"error": "activity_id and api_key are required"},
                )
                return
            try:
                _json_response(self, HTTPStatus.OK, run_streams(activity_id, api_key))
            except HTTPError as exc:
                _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": f"Upstream HTTP {exc.code}"})
            except URLError as exc:
                _json_response(
                    self,
                    HTTPStatus.BAD_GATEWAY,
                    {"error": f"Upstream error: {exc.reason}"},
                )
            except Exception as exc:  # noqa: BLE001
                _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        if parsed.path == "/api/zone-models":
            athlete_id = _qs("athlete_id")
            api_key = _qs("api_key")
            if not athlete_id or not api_key:
                _json_response(
                    self,
                    HTTPStatus.BAD_REQUEST,
                    {"error": "athlete_id and api_key are required"},
                )
                return
            try:
                _json_response(self, HTTPStatus.OK, run_zone_models(athlete_id, api_key))
            except HTTPError as exc:
                _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": f"Upstream HTTP {exc.code}"})
            except URLError as exc:
                _json_response(
                    self,
                    HTTPStatus.BAD_GATEWAY,
                    {"error": f"Upstream error: {exc.reason}"},
                )
            except Exception as exc:  # noqa: BLE001
                _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        if parsed.path == "/api/strava/get":
            path = _qs("path")
            access_token = _qs("access_token")
            if not path or not access_token:
                _json_response(
                    self,
                    HTTPStatus.BAD_REQUEST,
                    {"error": "path and access_token are required"},
                )
                return
            try:
                _json_response(self, HTTPStatus.OK, {"result": run_strava_get(path, access_token)})
            except ValueError as exc:
                _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except HTTPError as exc:
                _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": f"Upstream HTTP {exc.code}"})
            except URLError as exc:
                _json_response(
                    self,
                    HTTPStatus.BAD_GATEWAY,
                    {"error": f"Upstream error: {exc.reason}"},
                )
            except Exception as exc:  # noqa: BLE001
                _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/api/search", "/api/strava/token"):
            _json_response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body or "{}")
            if self.path == "/api/search":
                results = run_search(payload)
                _json_response(self, HTTPStatus.OK, {"results": results})
            else:
                token_payload = run_strava_token(payload)
                _json_response(self, HTTPStatus.OK, token_payload)
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Intervals static app local server")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Serving on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
