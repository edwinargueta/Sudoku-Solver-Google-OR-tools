# Two toolchains, one entry point. Run `make setup` once, then `make dev`.

BACKEND  := backend
FRONTEND := frontend
PY       := $(BACKEND)/.venv/bin/python

# What the venv is made from; it has to be 3.11 or newer.
# make setup PYTHON=python3.13
PYTHON   ?= python3

# Overridable: make images IMAGE_TAG=v0.1.0, make manifests ENV=prod
IMAGE_TAG   ?= dev
ENV         ?= dev

# The commit prod runs: make deploy ENV=prod TAG=<sha>. CI pushes every
# build of main as :<full commit sha>, and so does `make publish`.
TAG         ?=

# The kube context each overlay is applied to. With none set, `deploy`
# asks before applying to whatever context is current.
KUBE_CONTEXT_dev  ?= rancher-desktop
KUBE_CONTEXT_prod ?=
KUBE_CONTEXT      ?= $(KUBE_CONTEXT_$(ENV))

# Where `make publish` pushes, and for which architecture. The Always Free
# Ampere VM is ARM: an amd64 image crash-loops there with "exec format error".
REGISTRY    ?= ghcr.io/edwinargueta
REPO_SLUG   ?= sudoku
PLATFORM    ?= linux/arm64
GIT_SHA      = $(shell git rev-parse HEAD)

# Extra arguments for `make lock`: LOCK_ARGS=--upgrade moves every pin.
LOCK_ARGS   ?=

# Extra arguments for the browser tests: make e2e E2E_ARGS="--project=iphone touch/"
E2E_ARGS    ?=
# Playwright's Ubuntu 24.04 image, tagged with the installed version.
PW_VERSION   = $(shell cd $(FRONTEND) && node -p "require('@playwright/test/package.json').version")
PW_IMAGE     = mcr.microsoft.com/playwright:v$(PW_VERSION)-noble

.PHONY: help setup setup-backend setup-frontend dev api web test test-backend \
        test-frontend lint lock clean images smoke publish committed up down \
        manifests deploy e2e e2e-ui e2e-install e2e-report e2e-linux

help:
	@echo "setup     - create the venv, install backend and frontend deps"
	@echo "setup-backend  - just the venv, from the locked dependencies"
	@echo "setup-frontend - just the frontend's node_modules"
	@echo "dev       - run the API and the Vite dev server together"
	@echo "api       - run just the FastAPI backend on :8000"
	@echo "web       - run just the React frontend on :5173"
	@echo "test      - run both unit test suites (pytest and vitest)"
	@echo "test-backend   - just pytest"
	@echo "test-frontend  - just vitest"
	@echo "e2e       - browser tests: desktop and phones, against the real API"
	@echo "e2e-ui    - the same in Playwright's UI mode, for writing tests"
	@echo "e2e-install - download the browsers, again after a Playwright upgrade"
	@echo "e2e-report  - open the report from the last browser run"
	@echo "e2e-linux - browser tests with the browsers on Ubuntu 24.04, as on CI"
	@echo "lint      - ruff on the backend, eslint and tsc on the frontend"
	@echo "lock      - re-pin the backend's dependencies after a pyproject change"
	@echo "clean     - remove build artifacts, caches, and node_modules"
	@echo "images    - build both container images at :$(IMAGE_TAG)"
	@echo "smoke     - build them and check the running containers, as CI does"
	@echo "publish   - test, cross-build HEAD for $(PLATFORM), push as :<sha>"
	@echo "up        - run the containers together on :8080"
	@echo "down      - stop them"
	@echo "manifests - render the $(ENV) overlay without applying it (prod: TAG=<sha>)"
	@echo "deploy    - apply the $(ENV) overlay (prod: TAG=<sha> of a CI build)"

setup: setup-backend setup-frontend

# The same pinned versions CI tests and the image ships. The app itself is
# not installed: pytest and uvicorn import it from backend/, as CI and the
# image do.
setup-backend:
	@$(PYTHON) -c 'import sys; sys.exit(sys.version_info < (3, 11))' || \
		{ echo "$(PYTHON) is older than 3.11; try make setup PYTHON=python3.13" >&2; exit 1; }
	$(PYTHON) -m venv $(BACKEND)/.venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r $(BACKEND)/requirements-dev.lock

setup-frontend:
	cd $(FRONTEND) && npm install

api:
	cd $(BACKEND) && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd $(FRONTEND) && npm run dev

# Ctrl-C stops both; the trap kills the backend when the foreground job exits.
dev:
	@trap 'kill 0' EXIT INT TERM; $(MAKE) api & $(MAKE) web

test: test-backend test-frontend

test-backend:
	cd $(BACKEND) && .venv/bin/python -m pytest

test-frontend:
	cd $(FRONTEND) && npm test

# What CI runs: builds the UI, then starts its own API and preview on ports of
# their own (8001 and 4180), so a running `make dev` is left alone.
e2e:
	cd $(FRONTEND) && npx playwright test $(E2E_ARGS)

e2e-ui:
	cd $(FRONTEND) && npx playwright test --ui $(E2E_ARGS)

# Each Playwright release pins its own browser builds. On Linux the system
# libraries they need come too, as on CI; Playwright asks for sudo for those.
e2e-install:
	cd $(FRONTEND) && npx playwright install $(if $(filter Linux,$(shell uname -s)),--with-deps) chromium webkit

e2e-report:
	cd $(FRONTEND) && npx playwright show-report

# For a failure that only happens on the CI runner: the browsers run on
# Ubuntu 24.04, the release CI runs on, with the browser builds this
# Playwright version installs there. The tests and servers stay here. The
# container is stopped whether the tests pass or not, and one left behind by
# an interrupted run is cleared first.
e2e-linux:
	-@docker rm -f sudoku-e2e-browsers >/dev/null 2>&1
	docker run --rm -d --name sudoku-e2e-browsers --init -p 127.0.0.1:3000:3000 \
		--user pwuser --workdir /home/pwuser $(PW_IMAGE) \
		npx -y playwright@$(PW_VERSION) run-server --port 3000 --host 0.0.0.0 >/dev/null
	@for i in $$(seq 60); do curl -s -o /dev/null http://127.0.0.1:3000 && break; sleep 1; done
	cd $(FRONTEND) && E2E_BROWSER_SERVER=ws://127.0.0.1:3000/ npx playwright test $(E2E_ARGS); \
		status=$$?; docker stop sudoku-e2e-browsers >/dev/null; exit $$status

lint:
	cd $(BACKEND) && .venv/bin/python -m ruff check app tests
	cd $(BACKEND) && .venv/bin/python -m ruff format --check app tests
	cd $(FRONTEND) && npm run lint
	cd $(FRONTEND) && npm run typecheck
	cd $(FRONTEND) && npm run typecheck:e2e

# After a change to pyproject.toml. The image installs requirements.lock; CI
# and `make setup` install requirements-dev.lock, the same pins plus the dev
# extras. Needs uv.
lock:
	cd $(BACKEND) && uv pip compile pyproject.toml --universal --generate-hashes \
		$(LOCK_ARGS) -o requirements.lock
	cd $(BACKEND) && uv pip compile pyproject.toml --extra dev --universal --generate-hashes \
		$(LOCK_ARGS) -c requirements.lock -o requirements-dev.lock

images:
	docker build -t sudoku-api:$(IMAGE_TAG) $(BACKEND)
	docker build -t sudoku-web:$(IMAGE_TAG) $(FRONTEND)

# Runs both images the way the cluster does and checks what only a running
# container shows: nginx's rendered config, the SPA fallback, the headers,
# both proxied paths. CI runs the same script on every pull request.
smoke: images
	.github/scripts/smoke.sh sudoku-api:$(IMAGE_TAG) sudoku-web:$(IMAGE_TAG)

# For when CI is queued: the same unit tests and lint first, then HEAD as
# committed, pushed as :<commit sha> like CI's builds, so `make deploy
# ENV=prod TAG=` can take it. :latest is left to CI. One buildx invocation
# per image cross-compiles and pushes in a step. Needs `docker login
# ghcr.io` first, with a token that has write:packages.
publish: committed lint test
	docker buildx build --platform $(PLATFORM) --provenance=false --push \
		-t $(REGISTRY)/$(REPO_SLUG)-backend:$(GIT_SHA) $(BACKEND)
	docker buildx build --platform $(PLATFORM) --provenance=false --push \
		-t $(REGISTRY)/$(REPO_SLUG)-frontend:$(GIT_SHA) $(FRONTEND)

# An edit or an untracked file would go into the image without being in the
# commit the image is tagged with.
committed:
	@[ -z "$$(git status --porcelain)" ] || \
		{ git status --short; echo "Commit first: images are tagged with HEAD." >&2; exit 1; }

up:
	docker compose up --build

down:
	docker compose down

manifests:
	@deploy/k8s/render.sh $(ENV) $(TAG)

# Renders first, so a bad overlay or TAG fails before anything is asked.
# Then the context: the one named for this overlay, or else the current one
# once you have said yes to it. Applying to the wrong cluster is the classic
# way to lose an afternoon.
deploy:
	@if [ "$(ENV)" = prod ] && [ -z "$(TAG)" ]; then \
		echo "prod runs a commit CI built: make deploy ENV=prod TAG=<sha>" >&2; exit 1; \
	fi
	@set -e; manifest=$$(mktemp); trap 'rm -f "$$manifest"' EXIT; \
	deploy/k8s/render.sh $(ENV) $(TAG) > "$$manifest"; \
	context="$(KUBE_CONTEXT)"; \
	if [ -z "$$context" ]; then \
		context=$$(kubectl config current-context); \
		printf 'Apply the %s overlay to context "%s"? [y/N] ' "$(ENV)" "$$context"; \
		read answer || answer=; \
		[ "$$answer" = y ] || { echo "Nothing applied." >&2; exit 1; }; \
	fi; \
	echo "context: $$context"; \
	kubectl --context "$$context" apply -f "$$manifest"

clean:
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache $(BACKEND)/*.egg-info
	rm -rf $(FRONTEND)/node_modules $(FRONTEND)/dist
	rm -rf $(FRONTEND)/test-results $(FRONTEND)/playwright-report $(FRONTEND)/blob-report
