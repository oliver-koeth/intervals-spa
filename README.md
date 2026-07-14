# intervals-spa

A single-page application (SPA) for managing and visualising training intervals,
backed by a Python REST API.

## Directory Layout

The project is organised into two top-level workspaces that share clear
dependency boundaries:

```
intervals-spa/
  src/intervals/        Python backend package (FastAPI)
    api/                HTTP route handlers and request/response wiring
    application/        Use-case orchestration and boundary contracts
    domain/             Pure business rules and domain entities
    infrastructure/     Persistence, config loading, and external I/O
    shared/             Cross-cutting utilities and error contracts
  frontend/             React + TypeScript SPA (Vite)
    src/
      api/              Typed API client (fetch wrappers)
      components/       Reusable UI components
      hooks/            Custom React hooks
      pages/            Route-level page components
      types/            Shared TypeScript types
  tests/
    unit/               Fast isolated backend unit tests
    integration/        Backend integration tests
    e2e/                End-to-end browser tests
  docs/                 Architecture, requirements, model, and style docs
  scripts/              Developer tooling and agentic workflow helpers
```

## Developer Setup

### Backend

1. Install Python 3.11+ and [`uv`](https://docs.astral.sh/uv/).
2. Create and sync the environment:
   ```bash
   uv sync --dev
   ```
3. Start the development server:
   ```bash
   uv run uvicorn intervals.api.main:app --reload
   ```
4. Health check:
   ```bash
   curl http://localhost:8000/api/v1/health
   ```

### Frontend

1. Install [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/).
2. Install dependencies:
   ```bash
   cd frontend && pnpm install
   ```
3. Start the development server (proxies `/api` to `localhost:8000`):
   ```bash
   pnpm dev
   ```
4. Open `http://localhost:5173` in your browser.

## Quality Checks

Run all local quality gates (backend + frontend):
```bash
make quality
```

Run gates individually when needed:
```bash
# Backend
uv run ruff check .
uv run mypy --strict src
uv run pytest

# Frontend
cd frontend && pnpm lint
cd frontend && pnpm typecheck
cd frontend && pnpm test
```

## Deployment

See [`INSTALL.md`](INSTALL.md) for Linux VPS and systemd service setup.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contributor workflow and
architecture-boundary expectations.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/health` | Health check |
| `GET`  | `/api/v1/intervals` | List intervals |
| `POST` | `/api/v1/intervals` | Create interval |
| `GET`  | `/api/v1/intervals/{id}` | Get interval by ID |
| `PUT`  | `/api/v1/intervals/{id}` | Update interval |
| `DELETE` | `/api/v1/intervals/{id}` | Delete interval |
| `GET`  | `/api/v1/workouts` | List workouts |
| `POST` | `/api/v1/workouts` | Create workout |
