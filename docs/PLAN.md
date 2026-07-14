# Implementation Plan — `intervals-spa`

## 1. Goal

Implement the `intervals-spa` system in a sequence that minimises rework, enforces deterministic
behaviour early, and follows the documented architecture boundaries.

Primary references:
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/MODEL.md`

## 2. Guiding Principles

- Build domain logic before API wiring.
- Lock contracts and validation early.
- Keep business rules pure and deterministic.
- Prove correctness with unit and integration tests before UX polish.
- Frontend only talks to backend via typed API client.

---

## 3. Phased Build Order

### Phase 1: Foundation and Scaffolding *(current phase)*

**Scope:**
- Project structure: `src/intervals/{api,application,domain,infrastructure,shared}`, `frontend/src/`.
- Packaging and tooling baseline (`pyproject.toml`, `frontend/package.json`, lint/type/test config).
- Shared error hierarchy and canonical exit codes.
- Empty test skeleton (`tests/unit`, `tests/integration`, `tests/e2e`).

**Deliverables:**
- Importable package skeleton.
- Baseline CI-ready quality gates: `make quality` passes.
- Typed error classes.

**Completion criteria:**
- `uv sync --dev` succeeds.
- `pnpm install` in `frontend/` succeeds.
- Import boundaries are enforceable by structure.

---

### Phase 2: Domain Model and Contracts

**Scope:**
- Implement enums: `IntensityZone`, `TrainingType`, `WorkoutStatus`.
- Implement domain entities: `Interval`, `Workout`.
- Implement application boundary DTOs: `WorkoutRequest`, `WorkoutResponse`.
- Implement `parse_contract()` with Pydantic → ValidationError mapping.
- Implement TypeScript API types in `frontend/src/types/api.ts`.

**Deliverables:**
- Domain entities and application contracts compile/typecheck.
- Contract tests validate required fields and allowed values.
- Frontend types mirror backend contracts.

---

### Phase 3: Validation Layer

**Scope:**
- Implement input validation: `name` non-blank, `duration_seconds > 0`, `target_watts >= 0`.
- Implement domain invariant checks in `domain/validation.py`.
- Implement semantic guards in `application/validation.py`.

**Deliverables:**
- Validation functions with typed errors.
- Unit tests for invalid-input matrix and invariant failures.

---

### Phase 4: Persistence Adapter

**Scope:**
- Implement `WorkoutStore` with SQLite backend (replacing in-memory placeholder).
- Implement `WorkoutRepository` adapter pattern.
- Wire through dependency injection in FastAPI.

**Deliverables:**
- Persisted workouts survive process restarts.
- Integration tests covering CRUD lifecycle.

---

### Phase 5: REST API

**Scope:**
- Implement all Phase 1 endpoints (`GET/POST /workouts`, `GET/PUT/DELETE /workouts/{id}`).
- Wire `WorkoutService` into route handlers via dependency injection.
- Map domain errors to HTTP responses via `error_handlers.py`.
- Add OpenAPI metadata to routes.

**Deliverables:**
- All endpoints return correct responses and error shapes.
- API integration tests with `httpx` ASGI client.

---

### Phase 6: Frontend — Workouts List

**Scope:**
- Implement `WorkoutsPage` with data fetching via `useWorkouts` hook.
- Render workout cards in canonical order.
- Handle loading and error states.
- Style using design tokens from `docs/STYLEGUIDE.md`.

**Deliverables:**
- Workouts list page renders real API data.
- Vitest tests for workout list component.

---

### Phase 7: Frontend — Workout Detail

**Scope:**
- Implement `WorkoutDetailPage` with interval breakdown.
- Render zone distribution summary.
- Handle 404 gracefully.

**Deliverables:**
- Detail page renders real API data for a single workout.
- Tests for detail component rendering.

---

### Phase 8: Workout CRUD UI

**Scope:**
- Add create-workout form with validation.
- Add status update controls (mark complete / skip).
- Add delete confirmation.

**Deliverables:**
- Full create / read / update / delete cycle from the browser.

---

### Phase 9: CI, Packaging, and Release Readiness

**Scope:**
- Finalize `.github/workflows/ci.yml` with all quality + build + smoke jobs.
- Verify pip-installable API (`uvicorn` entry point).
- Verify Nginx-served frontend from `pnpm build` output.
- Update `docs/RELEASE_CHECKLIST.md`.

**Deliverables:**
- CI green on all branches.
- Documented install and deploy workflow in `INSTALL.md`.

---

## 4. Suggested Milestone Gates

| Gate   | Phases  | Signal                                          |
|--------|---------|-------------------------------------------------|
| Gate A | 1–3     | Contracts and validation stable; safe to build API. |
| Gate B | 4–5     | Full API CRUD working with persistence.         |
| Gate C | 6–8     | Browser CRUD round-trip works end to end.       |
| Gate D | 9       | CI green; deployment guide complete.            |

---

## 5. Key Risks and Mitigations

| Risk                          | Mitigation                                                    |
|-------------------------------|---------------------------------------------------------------|
| Frontend/backend type drift   | TypeScript types in `src/types/api.ts` mirror Python DTOs; lint on both sides. |
| Domain invariant leakage      | Domain layer has no imports from API/infrastructure; enforced by lint. |
| Persistence schema migration  | Use Alembic from Phase 4; design schema to be additive.       |
| Test coverage gaps            | Require unit + integration tests for every new use-case service. |
