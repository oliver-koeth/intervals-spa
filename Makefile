UV     ?= .venv/bin/uv
PNPM   ?= cd frontend && pnpm

.PHONY: quality lint typecheck test \
        fe-lint fe-typecheck fe-test \
        build dev clean

# ── Full quality gate ──────────────────────────────────────────────────────────
quality: lint typecheck test fe-lint fe-typecheck fe-test

# ── Backend ───────────────────────────────────────────────────────────────────
lint:
	$(UV) run ruff check .

typecheck:
	$(UV) run mypy --strict src

test:
	$(UV) run pytest

# ── Frontend ──────────────────────────────────────────────────────────────────
fe-lint:
	$(PNPM) run lint

fe-typecheck:
	$(PNPM) run typecheck

fe-test:
	$(PNPM) run test run

# ── Build ─────────────────────────────────────────────────────────────────────
build:
	$(UV) build
	$(PNPM) run build

# ── Development servers (run separately in two terminals) ─────────────────────
dev-backend:
	$(UV) run uvicorn intervals.api.main:app --reload

dev-frontend:
	$(PNPM) run dev

# ── Housekeeping ──────────────────────────────────────────────────────────────
clean:
	rm -rf dist/ frontend/dist/ .venv/
