.PHONY: quality lint dev clean

# ── Full quality gate ───────────────────────────────────────────────────────
quality: lint

# ── Static JS syntax check ─────────────────────────────────────────────────
lint:
	@for f in webapp/src/*.js; do node --check "$$f" || exit 1; done

# ── Local development server (static files + optional API proxy) ──────────
dev:
	./webapp/dev.sh 8080

# ── Housekeeping ─────────────────────────────────────────────────────────────
clean:
	rm -rf webapp/__pycache__
