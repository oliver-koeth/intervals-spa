# AGENT.md

## Purpose

This file is for autonomous coding agents working in this repository.
It defines execution workflow and where to find authoritative project rules
without duplicating product specs.

## Canonical References (Do Not Rephrase Here)

- Product requirements: `docs/REQUIREMENTS.md`
- Architecture and layer boundaries: `docs/ARCHITECTURE.md`
- Domain model and invariants: `docs/MODEL.md`
- Build sequencing: `docs/PLAN.md`
- UI/visual conventions: `docs/STYLEGUIDE.md`
- Enhancement lifecycle and artifact flow: `docs/ENHANCEMENTS.md`
- Human contributor workflow: `CONTRIBUTING.md`

When in doubt, update those source docs instead of expanding this file.

## Current State Snapshot

- Project is in **Phase 1 (Foundation and Scaffolding)** from `docs/PLAN.md`.
- Ralph backlog file: `scripts/ralph/prd.json`
- Branch target in backlog: `ralph/phase-1-foundation-scaffolding`
- As of this snapshot, no stories are yet marked complete.

## Agent Execution Rules

1. Work from `scripts/ralph/prd.json` in ascending `priority`.
2. Keep edits scoped to the active story; avoid bundling unrelated refactors.
3. Preserve architectural import direction (see `CONTRIBUTING.md` and `docs/ARCHITECTURE.md`):
   - Backend: `api -> application -> domain`; infrastructure is adapter-only.
   - Frontend: `pages -> components -> hooks -> api/types`.
4. Run quality gates locally before marking a story complete:
   - `make quality`
5. After completing a story:
   - set that story's `passes` to `true` in `scripts/ralph/prd.json`
   - append a short entry to `scripts/ralph/progress.txt` (what changed, files touched, checks run)
6. If a story reveals reusable repo-level conventions, update this file briefly.
7. Keep CI quality gates in `.github/workflows/ci.yml` aligned with local `make quality` commands.

## Backend-Specific Rules

8. Keep domain enums centralised in `src/intervals/domain/enums.py`; import from
   `intervals.domain.enums` everywhere else.
9. Subclass `BoundaryModel` (Pydantic, `extra="forbid"`) for every request/response DTO
   in `src/intervals/application/contracts.py`.
10. Parse external payloads through `src/intervals/application/parsing.py::parse_contract`
    so Pydantic failures map to shared `ValidationError` with stable field-path messages.
11. Keep Phase 3+ semantic guards in `src/intervals/application/validation.py`; prefix
    error messages with the failing field path (e.g. `duration_seconds: ...`).
12. Keep nutrition-output and domain hard invariants in `src/intervals/domain/validation.py`
    and raise `DomainRuleError` (not `ValidationError`) for domain impossibilities.
13. Route handlers in `src/intervals/api/` must be thin: validate HTTP input, delegate to
    application services, map exceptions to HTTP error responses.
14. Use `src/intervals/shared/errors.py` error hierarchy; map errors to HTTP status codes
    in `src/intervals/api/error_handlers.py`.
15. For any canonical ordering (e.g. zone sequence `1..5`), define it as a single constant
    and import it across modules — never re-declare.
16. When API contract shapes or enum sets change, update `docs/ARCHITECTURE.md` and
    `docs/MODEL.md` in the same iteration.

## Frontend-Specific Rules

17. All API calls go through `frontend/src/api/` typed client modules; components must
    not call `fetch` directly.
18. Keep page components in `frontend/src/pages/`; reusable UI in `frontend/src/components/`.
19. Shared TypeScript types for API request/response shapes live in `frontend/src/types/api.ts`.
20. Do not duplicate business-rule logic in the frontend; delegate to backend API.
21. Follow `docs/STYLEGUIDE.md` for visual tokens, component patterns, and dark-mode parity.
22. Use Tailwind utility classes; do not write bespoke CSS for components that already have
    Tailwind equivalents.

## Quality Gate Reference

```bash
# Full gate
make quality

# Backend only
uv run ruff check .
uv run mypy --strict src
uv run pytest

# Frontend only
cd frontend && pnpm lint && pnpm typecheck && pnpm test
```
