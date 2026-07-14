# PRD — `intervals-spa`

*(Agentic / Ralph-compatible Coding Workflow)*

---

## 1. Document Metadata

- **Project Name:** intervals-spa
- **Version:** 0.1.0
- **Status:** Draft
- **Target Python Version:** 3.11+
- **Frontend Stack:** React 18, TypeScript 5, Vite 5, Tailwind CSS 3
- **OS Targets:** Cross-platform (Linux, macOS, Windows)

---

## 2. Problem Statement

Provide a fast, browser-based interface for planning and reviewing training interval workouts.
The SPA is backed by a deterministic Python REST API that manages workout and interval data.

The system must be fully machine-executable for agentic coding workflows without ambiguity.

---

## 3. Functional Requirements

### 3.1 Workout Management

- List all workouts ordered by `planned_date` descending.
- Create a workout with `name`, `training_type`, `planned_date`, and an optional list of intervals.
- Retrieve a single workout by UUID.
- Update a workout's name, type, date, status, or interval list.
- Delete a workout.

### 3.2 Interval Management

- Each interval belongs to exactly one workout.
- Required fields: `zone` (Z1–Z5), `duration_seconds` (positive integer).
- Optional field: `target_watts` (non-negative integer).
- A workout may have zero or more intervals.

### 3.3 Workout Status Lifecycle

- New workouts are created with `status = planned`.
- Status transitions: `planned → completed`, `planned → skipped`.
- Completed or skipped workouts cannot be re-opened in Phase 1.

### 3.4 Training Zones

Zones follow the standard five-zone model:

| Zone | Description        |
|------|--------------------|
| Z1   | Active recovery    |
| Z2   | Endurance          |
| Z3   | Tempo              |
| Z4   | Threshold          |
| Z5   | VO2max / Anaerobic |

### 3.5 Training Types

Supported modalities: `cycling`, `running`, `swimming`, `strength`, `other`.

---

## 4. API Contract

### 4.1 Required Endpoints (Phase 1)

| Method   | Path                    | Description           |
|----------|-------------------------|-----------------------|
| `GET`    | `/api/v1/health`        | Health check          |
| `GET`    | `/api/v1/workouts`      | List all workouts     |
| `POST`   | `/api/v1/workouts`      | Create workout        |
| `GET`    | `/api/v1/workouts/{id}` | Get workout by ID     |
| `PUT`    | `/api/v1/workouts/{id}` | Update workout        |
| `DELETE` | `/api/v1/workouts/{id}` | Delete workout        |

### 4.2 Error Contract

All errors return:
```json
{ "error": { "code": "<code>", "message": "<message>" } }
```

| Condition          | HTTP | Code              |
|--------------------|------|-------------------|
| Validation failure | 400  | `validation_error`  |
| Domain violation   | 422  | `domain_rule_error` |
| Not found          | 404  | `not_found`         |
| Unexpected failure | 500  | `internal_error`    |

---

## 5. Frontend Requirements

### 5.1 Pages

- **Workouts list (`/workouts`):** table/card list of all workouts with name, type, date, status, and duration.
- **Workout detail (`/workouts/:id`):** full workout card with interval breakdown and zone distribution.
- **404 page:** minimal not-found screen.

### 5.2 UI Conventions

- Follow `docs/STYLEGUIDE.md` for visual tokens and component patterns.
- Support light and dark mode from day one.
- Responsive: single-column on mobile, multi-column grid on desktop.
- All API calls via typed `src/api/` client — no direct `fetch` in components.

---

## 6. Validation Rules

- `workout.name`: non-blank string.
- `workout.planned_date`: valid ISO date string.
- `interval.duration_seconds`: positive integer (> 0).
- `interval.target_watts`: non-negative integer when provided.
- `interval.zone`: one of `z1`, `z2`, `z3`, `z4`, `z5`.

---

## 7. Definition of Done

- All Phase 1 endpoints are implemented and return correct responses.
- Domain invariants are enforced and tested.
- Frontend renders workout list and detail pages.
- `make quality` passes (lint, typecheck, tests — backend and frontend).
- CI pipeline passes on all branches.
