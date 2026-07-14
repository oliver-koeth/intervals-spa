# Contributing to `intervals-spa`

## Local Setup

### Backend

1. Install Python `3.11+`.
2. Install `uv`.
3. Sync dependencies (including dev tools):
   ```bash
   uv sync --dev
   ```
4. Verify the API starts:
   ```bash
   uv run uvicorn intervals.api.main:app --reload
   ```

### Frontend

1. Install Node.js `20+` and `pnpm`.
2. Install dependencies:
   ```bash
   cd frontend && pnpm install
   ```
3. Verify the dev server starts:
   ```bash
   pnpm dev
   ```

## Pre-Commit Quality Commands

Run these before opening a pull request:

### Backend
1. `uv run ruff check .`
2. `uv run mypy --strict src`
3. `uv run pytest`

### Frontend
1. `cd frontend && pnpm lint`
2. `cd frontend && pnpm typecheck`
3. `cd frontend && pnpm test`

### All gates at once
```bash
make quality
```

## Architecture Boundary Expectations

### Backend

Keep imports and responsibilities aligned with the backend architecture:

- `src/intervals/api`: HTTP route handlers, request validation, error mapping only.
- `src/intervals/application`: use-case orchestration and boundary request/response contracts.
- `src/intervals/domain`: pure business rules and domain entities only.
- `src/intervals/infrastructure`: I/O, persistence, config loading, and external integrations.
- `src/intervals/shared`: cross-cutting concerns shared by multiple layers.

Import direction must remain inward:

- `api` can import `application` and `shared`.
- `application` can import `domain` and `shared`.
- `domain` must not import `api`, `application`, or `infrastructure`.

### Frontend

Keep responsibilities aligned with the frontend architecture:

- `pages/`: route-level page components; orchestrate data fetching and render layouts.
- `components/`: reusable, stateless (or lightly stateful) UI components.
- `hooks/`: custom React hooks that encapsulate side-effects and state logic.
- `api/`: typed fetch wrappers for all backend API endpoints.
- `types/`: TypeScript type definitions shared across the frontend.

Dependency direction: `pages -> components`, `pages/components -> hooks -> api/types`.

## Commit Message Convention

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

Examples:
- `feat(api): add POST /intervals endpoint`
- `fix(domain): reject negative duration_seconds`
- `docs(arch): update sequence diagram for Phase 4`

## Pull Request Checklist

- [ ] `make quality` passes locally
- [ ] New code has tests
- [ ] Architecture boundaries are preserved
- [ ] Docs updated if API contracts or behavior changed
