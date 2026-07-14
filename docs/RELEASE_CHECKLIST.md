# Release Readiness Checklist

Use this checklist before publishing a release candidate.

## 1. Baseline and Environment

- [ ] Working tree is clean (`git status --short` has no output).
- [ ] Backend dependencies are synced:
  ```bash
  uv sync --dev
  ```
- [ ] Frontend dependencies are installed:
  ```bash
  cd frontend && pnpm install
  ```

## 2. Quality Gates

- [ ] Run all local quality checks:
  ```bash
  make quality
  ```
  Expected: lint, typecheck, and tests pass for both backend and frontend.

## 3. Build Gates

- [ ] Build Python package:
  ```bash
  uv build
  ```
  Expected: `dist/` contains one `.whl` and one `.tar.gz`.

- [ ] Build frontend static assets:
  ```bash
  cd frontend && pnpm build
  ```
  Expected: `frontend/dist/` contains `index.html` and asset bundle.

## 4. Smoke Gates

- [ ] Start the backend and verify health:
  ```bash
  uv run uvicorn intervals.api.main:app
  curl http://127.0.0.1:8000/api/v1/health
  ```
  Expected: `{"status": "ok"}`.

- [ ] Verify frontend dev server starts:
  ```bash
  cd frontend && pnpm dev
  ```
  Expected: `http://localhost:5173` loads without errors.

## 5. CI Gate Verification

- [ ] Confirm latest GitHub Actions CI run for target commit is green.
  Expected:
  - `quality` job passes: ruff, mypy, pytest, eslint, tsc, vitest.
  - `build` job passes: Python wheel + frontend bundle.
  - `smoke` job passes: API health check from installed wheel.

## 6. Versioning and Release Notes

- [ ] Bump version in `pyproject.toml` and `frontend/package.json`.
- [ ] Use `v1.0.0` or `v1.0.0-rc.N` tags.
- [ ] Prepare release notes:
  - Feature summary
  - Install / deploy instructions
  - Known limitations

## 7. Final Go / No-Go

- [ ] Re-run:
  ```bash
  make quality
  cd frontend && pnpm build
  uv build
  ```
- [ ] If all pass, proceed with tag and release publication.
