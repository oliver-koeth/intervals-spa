# INTEGRATION.md — intervals.icu API

This document is a developer digest of the [intervals.icu API](https://intervals.icu/api-docs.html).
It covers authentication, bootstrapping, rate limits, and a structured reference to every endpoint
group, with links to the live API documentation.

**Live API docs:** [`https://intervals.icu/api-docs.html`](https://intervals.icu/api-docs.html)  
**OpenAPI spec:** [`https://intervals.icu/api/v1/docs`](https://intervals.icu/api/v1/docs)  
**Forum — API access:** [`https://forum.intervals.icu/t/api-access-to-intervals-icu/609`](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)  
**Forum — OAuth:** [`https://forum.intervals.icu/t/intervals-icu-oauth-support/2759`](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759)  
**Terms and Conditions:** [`https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087`](https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087)

---

## Table of Contents

1. [Base URL and Conventions](#1-base-url-and-conventions)
2. [Authentication](#2-authentication)
   - 2.1 [API Key (Personal / Script Use)](#21-api-key-personal--script-use)
   - 2.2 [OAuth 2.0 (Multi-User Apps)](#22-oauth-20-multi-user-apps)
   - 2.3 [Choosing the Right Method](#23-choosing-the-right-method)
3. [Bootstrapping](#3-bootstrapping)
   - 3.1 [Personal Script Bootstrap](#31-personal-script-bootstrap)
   - 3.2 [OAuth App Bootstrap](#32-oauth-app-bootstrap)
4. [Rate Limits](#4-rate-limits)
5. [Athlete ID Shorthand](#5-athlete-id-shorthand)
6. [API Groups and Endpoints](#6-api-groups-and-endpoints)
7. [Key Data Shapes](#7-key-data-shapes)
8. [Common Query Parameters](#8-common-query-parameters)
9. [Error Handling](#9-error-handling)
10. [Client Considerations](#10-client-considerations)
11. [Integration Checklist for intervals-spa](#11-integration-checklist-for-intervals-spa)

---

## 1. Base URL and Conventions

```
https://intervals.icu
```

All API paths are prefixed with `/api/v1/`. Example:

```
GET https://intervals.icu/api/v1/athlete/0/activities
```

- **Date format:** ISO-8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS`). Dates are always in the athlete's local timezone unless otherwise stated.
- **Athlete ID placeholder:** Use `"0"` in place of a real athlete ID to mean *the athlete associated with the current credential*. See [§5](#5-athlete-id-shorthand).
- **JSON:** All requests and responses are `application/json` unless the endpoint specifies `multipart/form-data` (file uploads) or a `.csv` / `.zip` variant.
- **Optional CSV / binary output:** Many endpoints accept an extension suffix in the path (e.g. `/wellness.csv`, `/activities.csv`, `/power-curves.csv`) to return CSV instead of JSON.

---

## 2. Authentication

The API supports two authentication schemes, defined in the OpenAPI spec under
`components.securitySchemes`:

| Scheme        | Type          | When to use                      |
|---------------|---------------|----------------------------------|
| `APIKey`      | HTTP Basic    | Personal scripts and tools       |
| `AccessToken` | HTTP Bearer   | Multi-user OAuth applications    |

Both schemes are listed under the global `security` requirement — you need exactly one of them.

---

### 2.1 API Key (Personal / Script Use)

**Source:** Generate your API key at [`https://intervals.icu/settings`](https://intervals.icu/settings) → *Developer Settings* section.

The API uses [HTTP Basic Authentication](https://en.wikipedia.org/wiki/Basic_access_authentication):
- **Username:** `API_KEY` (the literal string)
- **Password:** your API key (e.g. `1l0nlqjq3j1obdhg08rz5rfhx`)

#### curl

```bash
curl -u API_KEY:<your-api-key> \
  https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-01-01
```

#### Python (requests)

```python
import requests

API_KEY = "your-api-key"
BASE = "https://intervals.icu/api/v1"
AUTH = ("API_KEY", API_KEY)

# Get the current athlete profile
resp = requests.get(f"{BASE}/athlete/0", auth=AUTH)
resp.raise_for_status()
athlete = resp.json()
print(athlete["id"], athlete["name"])
```

#### Python (httpx, async)

```python
import httpx

async with httpx.AsyncClient(
    base_url="https://intervals.icu/api/v1",
    auth=("API_KEY", "your-api-key"),
    headers={"User-Agent": "intervals-spa/0.1 (https://github.com/your/repo)"},
) as client:
    r = await client.get("/athlete/0")
    r.raise_for_status()
    print(r.json()["name"])
```

---

### 2.2 OAuth 2.0 (Multi-User Apps)

Use OAuth when your application acts on behalf of multiple users. Users grant and revoke access
per-app without exposing their API keys.

#### 2.2.1 Register Your Application

Email [`[email protected]`](mailto:[email protected]) with:

| Field             | Description                              |
|-------------------|------------------------------------------|
| App name          | Public display name                      |
| Description       | What the app does                        |
| Website URL       | Your app's homepage                      |
| Logo image URL    | Square, at least 128×128 px              |
| Privacy policy URL| GDPR / legal requirement                 |
| Redirect URI(s)   | Where users land after consent (`http://localhost/` is always allowed) |
| Your athlete ID   | Found at the bottom of `/settings`       |

After registration, `client_id` and `client_secret` appear under *Manage App* on
[`https://intervals.icu/settings`](https://intervals.icu/settings).

#### 2.2.2 Scopes

Request only the scopes your app needs. Use `READ` or `WRITE` (WRITE implies READ).

| Scope      | Covers                                      |
|------------|---------------------------------------------|
| `ACTIVITY` | Completed rides, runs, swims, etc.          |
| `WELLNESS` | Weight, resting HR, HRV, sleep, mood, etc.  |
| `CALENDAR` | Planned workouts and calendar events        |
| `CHATS`    | Chats, groups, and messages                 |
| `LIBRARY`  | Workout library, folders, plans             |
| `SETTINGS` | Athlete and sport settings                  |

Combine with commas: `ACTIVITY:READ,WELLNESS:WRITE`

#### 2.2.3 Authorization Flow (Authorization Code)

**Step 1 — Redirect user to consent page:**

```
https://intervals.icu/oauth/authorize
  ?client_id=<your-client-id>
  &redirect_uri=<your-redirect-uri>
  &scope=ACTIVITY:READ,WELLNESS:WRITE
  &state=<optional-csrf-token>
```

The user logs in (if not already) and sees a consent dialog. On approval:

```
<your-redirect-uri>?code=3983ed415f66413c890ca48b7cce59e4&state=<your-state>
```

On denial:

```
<your-redirect-uri>?error=access_denied
```

**Step 2 — Exchange code for access token (within 2 minutes):**

```bash
curl -X POST https://intervals.icu/api/oauth/token \
  -d client_id=<your-client-id> \
  -d client_secret=<your-client-secret> \
  -d code=3983ed415f66413c890ca48b7cce59e4
```

Successful response:

```json
{
  "token_type": "Bearer",
  "access_token": "d842c1fc25f241e5ae440d09756448a9",
  "scope": "ACTIVITY:READ,WELLNESS:WRITE",
  "athlete": {
    "id": "2049151",
    "name": "David (intervals.icu)"
  }
}
```

**Step 3 — Call the API with the bearer token:**

```bash
curl -H "Authorization: Bearer d842c1fc25f241e5ae440d09756448a9" \
  https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-01-01
```

#### 2.2.4 Disconnecting a User

When a user revokes access in your app, call:

```
DELETE https://intervals.icu/api/v1/disconnect-app
Authorization: Bearer <access-token>
```

→ `200 OK` on success, `401` if the token is missing or invalid.

---

### 2.3 Choosing the Right Method

```
Are you only accessing your own data?
  YES → Use API Key (Basic Auth) — simpler, no registration needed
  NO  → Use OAuth 2.0 — required for apps with multiple users
```

---

## 3. Bootstrapping

### 3.1 Personal Script Bootstrap

1. Log in to [intervals.icu](https://intervals.icu).
2. Go to **Settings → Developer Settings** and copy your API key.
3. Store it in an environment variable (never hardcode):
   ```bash
   export INTERVALS_API_KEY="your-api-key"
   ```
4. Verify access:
   ```bash
   curl -u API_KEY:$INTERVALS_API_KEY \
     "https://intervals.icu/api/v1/athlete/0"
   ```
   Expected: JSON object with your athlete `id`, `name`, `email`, etc.

5. Note your athlete ID from the response — you can use `"0"` everywhere, but the real
   ID is useful for logging and debugging.

6. Make your first data pull (last 7 days of activities):
   ```bash
   curl -u API_KEY:$INTERVALS_API_KEY \
     "https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-07-07&newest=2026-07-14"
   ```

### 3.2 OAuth App Bootstrap

1. Register your app by emailing [`[email protected]`](mailto:[email protected]).
2. Receive `client_id` and `client_secret`.
3. Implement the authorization-code flow (see [§2.2.3](#223-authorization-flow-authorization-code)).
4. Store access tokens securely (server-side, never in browser `localStorage` for long-lived secrets).
5. Verify the token by calling `GET /api/v1/athlete/0` with the bearer token.
6. The response includes the athlete `id` — store it as the canonical ID for all subsequent calls for this user.
7. When deploying, monitor the OAuth client management page on `/settings/apps` for
   rate-limit usage and errors.

---

## 4. Rate Limits

Every response includes these headers:

```
X-RateLimit-Limit:     <15m-limit>,<daily-limit>
X-RateLimit-Remaining: <15m-remaining>,<daily-remaining>
```

When a limit is exceeded, the server returns `429 Too Many Requests` with:

```
Retry-After: <seconds-until-retry>
```

### Limits by credential type

| Credential    | Daily limit                              | Per-15-minute limit               | Per-second |
|---------------|------------------------------------------|-----------------------------------|------------|
| **API key**   | 5 000 requests/day                       | 2 500 (rolling window)            | 10/IP      |
| **OAuth app** | 100/user × users (min 5 000, max 50 000) | 1/8 of daily limit (min 2 500)    | 10/IP      |

**Daily reset:** midnight UTC.

**OAuth app sizing example:**
- 200 users → 200 × 100 = 20 000 daily limit, 2 500 per-15-min limit.
- 600 users → capped at 50 000 daily (contact support for higher limits).

**Backfill / new-user setup:** The per-user factor is used to calculate the total daily
limit — it is not enforced per individual user — so backfilling historical data for a new
user will not specifically rate-limit that user's token.

---

## 5. Athlete ID Shorthand

Endpoints that accept `{id}` in the path (representing an athlete) support:

- **`"0"`** — resolves to the athlete whose credential (API key or bearer token) is being used.
- **Real athlete ID** — e.g. `"2049151"`. Obtained from `GET /api/v1/athlete/0` → `.id`.

Using `"0"` is recommended for personal scripts; the real ID is required when a coach
accesses another athlete's data.

---

## 6. API Groups and Endpoints

The full OpenAPI spec is at [`https://intervals.icu/api/v1/docs`](https://intervals.icu/api/v1/docs)
and is rendered interactively at [`https://intervals.icu/api-docs.html`](https://intervals.icu/api-docs.html).

> **OAuth scope required** is shown where it differs from `ACTIVITY:READ` default.
> Endpoints without a scope note are accessible with any valid credential.

---

### 6.1 Athletes

Base path: `/api/v1/athlete/{id}`  
OAuth scope: `SETTINGS:READ` / `SETTINGS:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}`](https://intervals.icu/api-docs.html#/Athletes/showAthlete) | Get athlete profile + sport settings + custom items |
| `PUT`  | [`/api/v1/athlete/{id}`](https://intervals.icu/api-docs.html#/Athletes/updateAthlete) | Update athlete fields |
| `GET`  | [`/api/v1/athlete/{id}/profile`](https://intervals.icu/api-docs.html#/Athletes/getProfile) | Public profile info |
| `GET`  | [`/api/v1/athletes`](https://intervals.icu/api-docs.html#/Athletes/listAthletes) | List athletes you follow or coach |
| `GET`  | [`/api/v1/athlete/{id}/training-plan`](https://intervals.icu/api-docs.html#/Athletes/getTrainingPlan) | Current training plan |
| `PUT`  | [`/api/v1/athlete/{id}/training-plan`](https://intervals.icu/api-docs.html#/Athletes/updateTrainingPlan) | Change training plan |
| `GET`  | [`/api/v1/athlete/{id}/settings/{deviceClass}`](https://intervals.icu/api-docs.html#/Athletes/getSettings) | UI settings for phone/tablet/desktop |
| `GET`  | [`/api/v1/athlete/{id}/athlete-summary{ext}`](https://intervals.icu/api-docs.html#/Athletes/getAthleteSummary) | Summary of followed athletes |
| `PUT`  | [`/api/v1/athlete-plans`](https://intervals.icu/api-docs.html#/Athletes/changeAthleteTrainingPlans) | Bulk-change training plans |

**Key response fields (Athlete):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Athlete's unique ID |
| `name` | string | Display name |
| `email` | string | Email address |
| `weight` | number | Body weight (kg) |
| `sex` | string | `M` or `F` |
| `measurement_preference` | string | `metric` or `imperial` |
| `fahrenheit` | boolean | Temperature preference |
| `timezone` | string | IANA timezone string |

---

### 6.2 Activities

Base path: `/api/v1/athlete/{id}/activities` or `/api/v1/activity/{id}`  
OAuth scope: `ACTIVITY:READ` / `ACTIVITY:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/activities`](https://intervals.icu/api-docs.html#/Activities/listActivities) | List activities for date range (desc) |
| `POST` | [`/api/v1/athlete/{id}/activities`](https://intervals.icu/api-docs.html#/Activities/uploadActivity) | Upload a fit/tcx/gpx/zip file |
| `POST` | [`/api/v1/athlete/{id}/activities/manual`](https://intervals.icu/api-docs.html#/Activities/createManualActivity) | Create a manual activity |
| `POST` | [`/api/v1/athlete/{id}/activities/manual/bulk`](https://intervals.icu/api-docs.html#/Activities/bulkCreateManualActivities) | Bulk create manual activities (upsert on `external_id`) |
| `GET`  | [`/api/v1/activity/{id}`](https://intervals.icu/api-docs.html#/Activities/showActivity) | Get a single activity (full detail) |
| `PUT`  | [`/api/v1/activity/{id}`](https://intervals.icu/api-docs.html#/Activities/updateActivity) | Update activity fields |
| `DELETE` | [`/api/v1/activity/{id}`](https://intervals.icu/api-docs.html#/Activities/deleteActivity) | Delete an activity |
| `GET`  | [`/api/v1/activity/{id}/intervals`](https://intervals.icu/api-docs.html#/Activities/listIntervals) | Get activity intervals |
| `GET`  | [`/api/v1/activity/{id}/streams{ext}`](https://intervals.icu/api-docs.html#/Activities/listStreams) | Raw time-series streams (power, HR, cadence…) |
| `GET`  | [`/api/v1/activity/{id}/power-curve{ext}`](https://intervals.icu/api-docs.html#/Activities/getPowerCurve) | Power curve (MMP) |
| `GET`  | [`/api/v1/activity/{id}/hr-curve{ext}`](https://intervals.icu/api-docs.html#/Activities/getHRCurve) | Heart-rate curve |
| `GET`  | [`/api/v1/activity/{id}/pace-curve{ext}`](https://intervals.icu/api-docs.html#/Activities/getPaceCurve) | Pace curve |
| `GET`  | [`/api/v1/athlete/{id}/activity-power-curves{ext}`](https://intervals.icu/api-docs.html#/Activities/listActivityPowerCurves) | Best power curves over a date range |
| `GET`  | [`/api/v1/athlete/{id}/power-curves{ext}`](https://intervals.icu/api-docs.html#/Activities/listAthletesPowerCurves) | Athlete's all-time best power curves |
| `GET`  | [`/api/v1/athlete/{id}/activities.csv`](https://intervals.icu/api-docs.html#/Activities/downloadActivitiesCSV) | Download activities as CSV |
| `GET`  | [`/api/v1/athlete/{id}/activities/search`](https://intervals.icu/api-docs.html#/Activities/searchActivities) | Search by name/tag (summary) |
| `GET`  | [`/api/v1/activity/{id}/map`](https://intervals.icu/api-docs.html#/Activities/getMap) | Map/GPS data |
| `GET`  | [`/api/v1/activity/{id}/segments`](https://intervals.icu/api-docs.html#/Activities/getSegments) | Strava-compatible segments |
| `GET`  | [`/api/v1/activity/{id}/weather-summary`](https://intervals.icu/api-docs.html#/Activities/getWeatherSummary) | Weather data for the activity |

**Key Activity fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Activity ID (e.g. `A12345678`) |
| `start_date_local` | string | ISO-8601 local datetime |
| `type` | string | `Ride`, `Run`, `Swim`, etc. |
| `name` | string | User-assigned name |
| `distance` | number | Metres |
| `moving_time` | integer | Seconds |
| `elapsed_time` | integer | Seconds |
| `total_elevation_gain` | number | Metres |
| `icu_training_load` | integer | Calculated training load |
| `icu_ftp` | integer | FTP at time of activity (watts) |
| `icu_atl` | number | Acute training load after activity |
| `icu_ctl` | number | Chronic training load after activity |
| `icu_intensity` | number | Intensity factor |
| `icu_zone_times` | array | Time in each power zone (seconds) |
| `icu_hr_zone_times` | array | Time in each HR zone (seconds) |
| `average_heartrate` | integer | bpm |
| `average_speed` | number | m/s |
| `icu_average_watts` | integer | Average power (watts) |
| `icu_weighted_avg_watts` | integer | Normalised power (watts) |
| `external_id` | string | Your external reference ID |
| `tags` | array | User-applied tags |
| `source` | string | `STRAVA`, `GARMIN`, `MANUAL`, etc. |

---

### 6.3 Events (Calendar)

Base path: `/api/v1/athlete/{id}/events`  
OAuth scope: `CALENDAR:READ` / `CALENDAR:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/events{format}`](https://intervals.icu/api-docs.html#/Events/listEvents) | List events for date range (add `.csv` for CSV) |
| `POST` | [`/api/v1/athlete/{id}/events`](https://intervals.icu/api-docs.html#/Events/createEvent) | Create an event (planned workout, note, etc.) |
| `POST` | [`/api/v1/athlete/{id}/events/bulk`](https://intervals.icu/api-docs.html#/Events/bulkCreateEvents) | Create multiple events |
| `GET`  | [`/api/v1/athlete/{id}/events/{eventId}`](https://intervals.icu/api-docs.html#/Events/getEvent) | Get a single event |
| `PUT`  | [`/api/v1/athlete/{id}/events/{eventId}`](https://intervals.icu/api-docs.html#/Events/updateEvent) | Update an event |
| `DELETE` | [`/api/v1/athlete/{id}/events/{eventId}`](https://intervals.icu/api-docs.html#/Events/deleteEvent) | Delete an event |
| `GET`  | [`/api/v1/athlete/{id}/events/{eventId}/download{ext}`](https://intervals.icu/api-docs.html#/Events/downloadEvent) | Download planned workout (zwo/mrc/erg/fit) |
| `POST` | [`/api/v1/athlete/{id}/events/{eventId}/mark-done`](https://intervals.icu/api-docs.html#/Events/markEventDone) | Create manual activity from planned workout |
| `POST` | [`/api/v1/athlete/{id}/duplicate-events`](https://intervals.icu/api-docs.html#/Events/duplicateEvents) | Duplicate events |
| `DELETE` | [`/api/v1/athlete/{id}/events`](https://intervals.icu/api-docs.html#/Events/deleteEvents) | Delete a range of events |
| `PUT`  | [`/api/v1/athlete/{id}/events/bulk-delete`](https://intervals.icu/api-docs.html#/Events/bulkDeleteEvents) | Delete events by `id` or `external_id` |
| `GET`  | [`/api/v1/athlete/{id}/fitness-model-events`](https://intervals.icu/api-docs.html#/Events/listFitnessModelEvents) | Events that influence fitness (CTL/ATL) calculation |

**Event categories:** `WORKOUT`, `RACE`, `NOTE`, `HOLIDAY`, `TARGET`

**Key Event fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Event ID |
| `external_id` | string | Your external reference (for upserts) |
| `start_date_local` | string | ISO-8601 local date/datetime |
| `end_date_local` | string | ISO-8601 local end date/datetime |
| `type` | string | Sport type (`Ride`, `Run`, etc.) |
| `category` | string | `WORKOUT`, `NOTE`, `RACE`, etc. |
| `name` | string | Event title |
| `description` | string | Notes or instructions |
| `indoor` | boolean | Indoor session |
| `icu_training_load` | integer | Expected training load |
| `workout_doc` | object | Structured interval workout definition |
| `target` | string | Target description |
| `athlete_cannot_edit` | boolean | Coach-locked event |
| `hide_from_athlete` | boolean | Hidden from athlete view |
| `plan_applied` | string | Date plan was applied |

---

### 6.4 Wellness

Base path: `/api/v1/athlete/{id}/wellness`  
OAuth scope: `WELLNESS:READ` / `WELLNESS:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/wellness/{date}`](https://intervals.icu/api-docs.html#/Wellness/getWellness) | Get wellness for a specific date |
| `PUT`  | [`/api/v1/athlete/{id}/wellness/{date}`](https://intervals.icu/api-docs.html#/Wellness/updateWellnessByDate) | Update wellness for a specific date |
| `GET`  | [`/api/v1/athlete/{id}/wellness{ext}`](https://intervals.icu/api-docs.html#/Wellness/listWellness) | List wellness records for date range |
| `PUT`  | [`/api/v1/athlete/{id}/wellness`](https://intervals.icu/api-docs.html#/Wellness/updateWellness) | Update a wellness record (id = ISO-8601 day) |
| `PUT`  | [`/api/v1/athlete/{id}/wellness-bulk`](https://intervals.icu/api-docs.html#/Wellness/bulkUpdateWellness) | Bulk-update wellness records |
| `POST` | [`/api/v1/athlete/{id}/wellness`](https://intervals.icu/api-docs.html#/Wellness/uploadWellness) | Upload wellness from CSV (`multipart/form-data`) |

**Key Wellness fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | ISO-8601 date (is the primary key) |
| `ctl` | number | Chronic Training Load (fitness) |
| `atl` | number | Acute Training Load (fatigue) |
| `rampRate` | number | CTL change per week |
| `weight` | number | Body weight (kg) |
| `restingHR` | integer | Resting heart rate (bpm) |
| `hrv` | number | HRV score (ms) |
| `hrvSDNN` | number | HRV SDNN (ms) |
| `sleepSecs` | integer | Sleep duration (seconds) |
| `sleepScore` | number | Sleep quality score |
| `soreness` | integer | Muscle soreness (1–10) |
| `fatigue` | integer | Fatigue (1–10) |
| `stress` | integer | Mental stress (1–10) |
| `mood` | integer | Mood (1–10) |
| `motivation` | integer | Motivation (1–10) |
| `kcalConsumed` | integer | Daily calories consumed |
| `steps` | integer | Daily step count |
| `spO2` | number | Blood oxygen (%) |
| `vo2max` | number | VO2max |
| `comments` | string | Free-text notes |

---

### 6.5 Sport Settings

Base path: `/api/v1/athlete/{athleteId}/sport-settings`  
OAuth scope: `SETTINGS:READ` / `SETTINGS:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{athleteId}/sport-settings`](https://intervals.icu/api-docs.html#/Sports/listSportSettings) | List all sport settings |
| `GET`  | [`/api/v1/athlete/{athleteId}/sport-settings/{id}`](https://intervals.icu/api-docs.html#/Sports/getSportSettings) | Get sport settings by id or type (`Run`, `Ride`, etc.) |
| `PUT`  | [`/api/v1/athlete/{athleteId}/sport-settings/{id}`](https://intervals.icu/api-docs.html#/Sports/updateSportSettings) | Update sport settings |
| `POST` | [`/api/v1/athlete/{athleteId}/sport-settings`](https://intervals.icu/api-docs.html#/Sports/createSportSettings) | Create settings for a sport with defaults |
| `DELETE` | [`/api/v1/athlete/{athleteId}/sport-settings/{id}`](https://intervals.icu/api-docs.html#/Sports/deleteSportSettings) | Delete sport settings |
| `PUT`  | [`/api/v1/athlete/{athleteId}/sport-settings/{id}/apply`](https://intervals.icu/api-docs.html#/Sports/applySportSettings) | Re-apply zones to matching activities (async) |

Key `SportSettings` fields: `ftp`, `indoor_ftp`, `w_prime`, `p_max`, `power_zones`,
`lthr`, `threshold_pace`, `types` (array of activity types this applies to).

---

### 6.6 Workout Library

Base path: `/api/v1/athlete/{id}/workouts` and `/api/v1/athlete/{id}/folders`  
OAuth scope: `LIBRARY:READ` / `LIBRARY:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/workouts`](https://intervals.icu/api-docs.html#/Library/listWorkouts) | List all workouts in library |
| `POST` | [`/api/v1/athlete/{id}/workouts`](https://intervals.icu/api-docs.html#/Library/createWorkout) | Create a workout |
| `POST` | [`/api/v1/athlete/{id}/workouts/bulk`](https://intervals.icu/api-docs.html#/Library/bulkCreateWorkouts) | Bulk-create workouts |
| `GET`  | [`/api/v1/athlete/{id}/workouts/{workoutId}`](https://intervals.icu/api-docs.html#/Library/showWorkout) | Get a workout |
| `PUT`  | [`/api/v1/athlete/{id}/workouts/{workoutId}`](https://intervals.icu/api-docs.html#/Library/updateWorkout) | Update a workout |
| `DELETE` | [`/api/v1/athlete/{id}/workouts/{workoutId}`](https://intervals.icu/api-docs.html#/Library/deleteWorkout) | Delete a workout |
| `GET`  | [`/api/v1/athlete/{id}/folders`](https://intervals.icu/api-docs.html#/Library/listFolders) | List all folders, plans, and workouts |
| `POST` | [`/api/v1/athlete/{id}/folders`](https://intervals.icu/api-docs.html#/Library/createFolder) | Create a folder or plan |
| `POST` | [`/api/v1/athlete/{id}/folders/{folderId}/import-workout`](https://intervals.icu/api-docs.html#/Library/importWorkout) | Import workout from zwo/mrc/erg/fit file |
| `POST` | [`/api/v1/athlete/{id}/download-workout{ext}`](https://intervals.icu/api-docs.html#/Library/downloadWorkout) | Convert workout to zwo/mrc/erg/fit |

---

### 6.7 Gear

Base path: `/api/v1/athlete/{id}/gear`  
OAuth scope: `SETTINGS:READ` / `SETTINGS:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/gear{ext}`](https://intervals.icu/api-docs.html#/Gear/listGear) | List all gear (CSV via `.csv`) |
| `POST` | [`/api/v1/athlete/{id}/gear`](https://intervals.icu/api-docs.html#/Gear/createGear) | Create a gear item or component |
| `PUT`  | [`/api/v1/athlete/{id}/gear/{gearId}`](https://intervals.icu/api-docs.html#/Gear/updateGear) | Update gear |
| `DELETE` | [`/api/v1/athlete/{id}/gear/{gearId}`](https://intervals.icu/api-docs.html#/Gear/deleteGear) | Delete gear |
| `POST` | [`/api/v1/athlete/{id}/gear/{gearId}/reminder`](https://intervals.icu/api-docs.html#/Gear/createReminder) | Add a maintenance reminder |

---

### 6.8 Chats

Base path: `/api/v1/athlete/{id}/chats` and `/api/v1/chats/{id}`  
OAuth scope: `CHATS:READ` / `CHATS:WRITE`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/chats`](https://intervals.icu/api-docs.html#/Chats/listChats) | List chats (most recently active first) |
| `GET`  | [`/api/v1/athlete/{id}/groups`](https://intervals.icu/api-docs.html#/Chats/listGroups) | List groups |
| `GET`  | [`/api/v1/chats/{id}/messages`](https://intervals.icu/api-docs.html#/Chats/listMessages) | List messages (most recent first) |
| `POST` | [`/api/v1/chats/send-message`](https://intervals.icu/api-docs.html#/Chats/sendMessage) | Send a message |
| `GET`  | [`/api/v1/activity/{id}/messages`](https://intervals.icu/api-docs.html#/Chats/listActivityMessages) | Activity comments |
| `POST` | [`/api/v1/activity/{id}/messages`](https://intervals.icu/api-docs.html#/Chats/addActivityMessage) | Add activity comment |

---

### 6.9 Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/routes`](https://intervals.icu/api-docs.html#/Routes/listRoutes) | List routes with activity counts |
| `GET`  | [`/api/v1/athlete/{id}/routes/{route_id}`](https://intervals.icu/api-docs.html#/Routes/getRoute) | Get a route |
| `PUT`  | [`/api/v1/athlete/{id}/routes/{route_id}`](https://intervals.icu/api-docs.html#/Routes/updateRoute) | Update a route |
| `GET`  | [`/api/v1/athlete/{id}/routes/{route_id}/similarity/{other_id}`](https://intervals.icu/api-docs.html#/Routes/getRouteSimilarity) | Compare two routes |

---

### 6.10 Weather

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/weather-forecast`](https://intervals.icu/api-docs.html#/Weather/getWeatherForecast) | Weather forecast for configured location |
| `GET`  | [`/api/v1/athlete/{id}/weather-config`](https://intervals.icu/api-docs.html#/Weather/getWeatherConfig) | Athlete's weather configuration |
| `PUT`  | [`/api/v1/athlete/{id}/weather-config`](https://intervals.icu/api-docs.html#/Weather/updateWeatherConfig) | Update weather configuration |

---

### 6.11 Custom Items

Allows embedding custom charts, dashboards, and fields into the intervals.icu UI.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | [`/api/v1/athlete/{id}/custom-item`](https://intervals.icu/api-docs.html#/Custom%20Items/listCustomItems) | List custom items |
| `POST` | [`/api/v1/athlete/{id}/custom-item`](https://intervals.icu/api-docs.html#/Custom%20Items/createCustomItem) | Create a custom item |
| `GET`  | [`/api/v1/athlete/{id}/custom-item/{itemId}`](https://intervals.icu/api-docs.html#/Custom%20Items/getCustomItem) | Get a custom item |
| `PUT`  | [`/api/v1/athlete/{id}/custom-item/{itemId}`](https://intervals.icu/api-docs.html#/Custom%20Items/updateCustomItem) | Update a custom item |
| `DELETE` | [`/api/v1/athlete/{id}/custom-item/{itemId}`](https://intervals.icu/api-docs.html#/Custom%20Items/deleteCustomItem) | Delete a custom item |

---

## 7. Key Data Shapes

### 7.1 Date and Time

- Dates are always **ISO-8601** strings: `"2026-07-14"` or `"2026-07-14T08:30:00"`.
- All date-times are in the **athlete's local timezone** unless the field name ends in `_utc` or `UTC`.
- The Wellness `id` field is the date string itself (e.g. `"2026-07-14"`).

### 7.2 Activity ID Format

Activity IDs are strings like `"A123456789"`. Always treat them as opaque strings, not integers.

### 7.3 Power / Training Load Fields

| Field prefix | Description |
|---|---|
| `icu_` | Computed by intervals.icu |
| `ss_` | Sweet-spot parameters |
| `icu_pm_` | Power model parameters (stored) |
| `icu_rolling_` | Rolling/smoothed values |

### 7.4 Workout Document (`workout_doc`)

The `workout_doc` object is intervals.icu's internal structured workout format. It defines
steps, intervals, targets (power/HR/pace), and timing. This is the same object used by the
workout editor UI and can be converted to Zwift `.zwo`, Garmin `.fit`, `.mrc`, or `.erg`
via the download endpoint.

---

## 8. Common Query Parameters

### Activities

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `oldest` | string | ✅ | Oldest date/time (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS`) |
| `newest` | string | ❌ | Newest date/time (defaults to now) |
| `limit` | integer | ❌ | Maximum number of activities to return |
| `fields` | array | ❌ | Comma-separated field names to include (omits nulls) |
| `route_id` | integer | ❌ | Filter to activities on this route |

### Events (Calendar)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `oldest` | string | ❌ | Oldest date (defaults to today) |
| `newest` | string | ❌ | Newest date (defaults to oldest + 6 days) |
| `category` | array | ❌ | Filter: `WORKOUT`, `NOTE`, `RACE`, etc. |
| `ext` | string | ❌ | Convert workouts to `zwo`, `mrc`, `erg`, or `fit` |
| `resolve` | boolean | ❌ | Resolve power/HR/pace targets to absolute values |

### Wellness

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `oldest` | string | ❌ | Oldest date |
| `newest` | string | ❌ | Newest date (inclusive) |
| `fields` | array | ❌ | Field names to include |

### `fields` Projection

Most list endpoints accept `?fields=id,name,start_date_local,type` to return only the specified
fields. This reduces payload size significantly and is recommended for large date ranges.

```bash
# Only fetch the fields you need
curl -u API_KEY:$KEY \
  "https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-01-01&fields=id,name,type,moving_time,icu_training_load"
```

---

## 9. Error Handling

| HTTP Status | Meaning |
|-------------|---------|
| `200 OK` | Success |
| `201 Created` | Resource created |
| `400 Bad Request` | Invalid request parameters |
| `401 Unauthorized` | Missing or invalid credential |
| `403 Forbidden` | Valid credential but insufficient scope |
| `404 Not Found` | Resource does not exist |
| `429 Too Many Requests` | Rate limit exceeded — respect `Retry-After` header |
| `500 Internal Server Error` | Server error — retry with exponential backoff |

**Always check `Retry-After`** on 429 responses before retrying.

Recommended retry strategy:
1. On `429`: wait the number of seconds in `Retry-After`, then retry once.
2. On `5xx`: exponential backoff starting at 1 s, up to 3 retries.
3. On `401`: refresh/re-obtain credentials; do not retry blindly.

---

## 10. Client Considerations

### User-Agent

intervals.icu is served via Cloudflare. Some HTTP client libraries (e.g. Python's `urllib`)
are blocked because their default `User-Agent` looks bot-like. **Always set a descriptive
`User-Agent` header:**

```
User-Agent: intervals-spa/0.1 (https://github.com/your-org/intervals-spa)
```

### HTTPS Only

All API calls must use HTTPS. HTTP requests will be redirected or rejected.

### Idempotency

Use `external_id` on activities and events when creating records from your own system.
The bulk-create endpoints support upsert semantics on `external_id`, making it safe to
re-send data without creating duplicates.

### Pagination

Most list endpoints are not paginated in the traditional sense — they accept `oldest` /
`newest` date bounds and an optional `limit`. To paginate large ranges, slide the
`oldest` / `newest` window and use `limit` to cap each request.

### Timezone Awareness

Always pass dates in the athlete's local timezone. Use `GET /api/v1/athlete/0` to
retrieve `timezone` first, then format dates accordingly.

---

## 11. Integration Checklist for intervals-spa

This checklist guides the implementation of the intervals.icu integration inside this project.

### Infrastructure

- [ ] Add `INTERVALS_API_KEY` (and/or `INTERVALS_CLIENT_ID` / `INTERVALS_CLIENT_SECRET`) to `src/intervals/infrastructure/config.py` settings.
- [ ] Create `src/intervals/infrastructure/intervals_client.py`:
  - Async `httpx.AsyncClient` with Basic auth for API key mode.
  - Bearer token injection for OAuth mode.
  - `User-Agent` header set to `intervals-spa/<version>`.
  - `Retry-After` handling on 429.
  - Exponential backoff on 5xx.
- [ ] Add `intervals_athlete_id` to athlete settings (default `"0"` for self-access).

### Domain

- [ ] Define `IntervalsActivity`, `IntervalsEvent`, `IntervalsWellness` value objects in `src/intervals/domain/` (distinct from the internal `Workout` entity).
- [ ] Map `intervals.icu` zone model (Z1–Z5 via sport settings) to the internal `IntensityZone` enum.

### Application

- [ ] `IntervalsActivityService.fetch_activities(oldest, newest)` → list of `IntervalsActivity`.
- [ ] `IntervalsEventService.fetch_events(oldest, newest)` → list of `IntervalsEvent`.
- [ ] `IntervalsWellnessService.fetch_wellness(oldest, newest)` → list of `IntervalsWellness`.
- [ ] `IntervalsSyncService.sync_athlete()` → bootstrap athlete ID and sport settings.

### API Routes

- [ ] `GET /api/v1/intervals/activities` — proxies intervals.icu activities into the SPA.
- [ ] `GET /api/v1/intervals/events` — proxies calendar events.
- [ ] `GET /api/v1/intervals/wellness` — proxies wellness data.
- [ ] `GET /api/v1/intervals/athlete` — returns cached intervals.icu athlete profile.

### Frontend

- [ ] Add `src/api/intervalsClient.ts` typed wrappers for the proxy routes above.
- [ ] Add `IntervalsActivitiesPage` showing imported activities.
- [ ] Render zone distribution using `icu_zone_times` and the semantic zone colors from `docs/STYLEGUIDE.md`.

### Security

- [ ] Store `INTERVALS_API_KEY` in server-side environment variable only — never expose in frontend bundle.
- [ ] For OAuth: store access tokens in server-side session storage, not browser `localStorage`.
- [ ] Rotate API keys immediately if compromised via `/settings` → Developer Settings → Regenerate.

---

*Generated from the [intervals.icu OpenAPI spec](https://intervals.icu/api/v1/docs) (v1.0.0)
and the API forum posts — verify against the live docs for the latest endpoint signatures.*
