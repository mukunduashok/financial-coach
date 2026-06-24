.PHONY: help dev lint test test-unit test-e2e sync clean clean-ports deploy

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
	@echo "=== Combined ==="
	@echo "  make test             - Run all tests (unit + E2E)"
	@echo "  make clean            - Remove caches and temp files"
	@echo "  make clean-ports      - Kill orphaned servers on dev/test ports"

# ─── Frontend (JS) ────────────────────────────────────────────────────────────

dev:
	npx serve static -l 8111 --cors

lint:
	npx @biomejs/biome check --fix static/js/

test-unit:
	npx vitest run

deploy:
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

clean:
	rm -rf node_modules/.cache

clean-ports:
	@echo "Killing processes on ports 8111, 8082..."
	@-lsof -ti :8111 | xargs -r kill 2>/dev/null; true
	@-lsof -ti :8082 | xargs -r kill 2>/dev/null; true
	@echo "Done."
