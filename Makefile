.PHONY: help dev lint test test-unit test-e2e sync clean clean-ports deploy gen-env

# Source per-environment config from .env (KEY=value form), with a safe default.
-include .env
export GMAIL_PROXY_URL ?= https://your-worker.your-subdomain.workers.dev

help:
	@echo ""
	@echo "=== Frontend (JS — production) ==="
	@echo "  make dev              - Serve static files on :8111 (no backend)"
	@echo "  make lint             - Lint + format JS with Biome"
	@echo "  make test-unit        - Run JS unit tests (Vitest)"
	@echo "  make test-e2e         - Run Playwright E2E tests"
	@echo "  make sync             - Install all dependencies"
	@echo "  make deploy           - Deploy to Cloudflare Pages"
	@echo ""
	@echo "  GMAIL_PROXY_URL is read from .env (see .env.example) and baked"
	@echo "  into static/js/env.js by 'make dev' / 'make deploy'."
	@echo ""
	@echo "=== Combined ==="
	@echo "  make test             - Run all tests (unit + E2E)"
	@echo "  make clean            - Remove caches and temp files"
	@echo "  make clean-ports      - Kill orphaned servers on dev/test ports"

# ─── Frontend (JS) ────────────────────────────────────────────────────────────

gen-env:
	@printf 'window.__FINCOACH_CONFIG__ = {\n  GMAIL_PROXY_URL: "%s",\n};\n' "$(GMAIL_PROXY_URL)" > static/js/env.js
	@echo "Generated static/js/env.js with GMAIL_PROXY_URL=$(GMAIL_PROXY_URL)"

dev: gen-env
	npx serve static -l 8111 --cors

lint:
	npx @biomejs/biome check --fix static/js/

test-unit:
	npx vitest run

deploy: gen-env
	@DEPLOY_TS=$$(date -u +%Y%m%d%H%M%S) && \
	sed -i "s/const CACHE_NAME = \"fincoach-v[^\"]*\"/const CACHE_NAME = \"fincoach-$$DEPLOY_TS\"/" static/js/sw.js && \
	echo "Stamped CACHE_NAME: fincoach-$$DEPLOY_TS" && \
	npx wrangler pages deploy static --project-name=finance-coach-pro && \
	git checkout static/js/sw.js

test-e2e: clean-ports
	npx playwright test

# ─── Combined ─────────────────────────────────────────────────────────────────

test: test-unit test-e2e

sync:
	npm install
	npx playwright install chromium
	@[ -f static/js/env.js ] || $(MAKE) gen-env

clean:
	rm -rf node_modules/.cache

clean-ports:
	@echo "Killing processes on ports 8111, 8082..."
	@-lsof -ti :8111 | xargs -r kill 2>/dev/null; true
	@-lsof -ti :8082 | xargs -r kill 2>/dev/null; true
	@echo "Done."
