# Two toolchains, one entry point. Run `make setup` once, then `make dev`.

BACKEND  := backend
FRONTEND := frontend
PY       := $(BACKEND)/.venv/bin/python

# Overridable: make images IMAGE_TAG=v0.1.0, make manifests ENV=prod
IMAGE_TAG   ?= dev
ENV         ?= dev

# Where `make publish` pushes, and for which architecture. The Always Free
# Ampere VM is ARM: an amd64 image crash-loops there with "exec format error".
REGISTRY    ?= ghcr.io/edwinargueta
REPO_SLUG   ?= sudoku
PUBLISH_TAG ?= latest
PLATFORM    ?= linux/arm64

# Extra arguments for the browser tests: make e2e E2E_ARGS="--project=iphone touch/"
E2E_ARGS    ?=
# Playwright's Ubuntu 24.04 image, tagged with the installed version.
PW_VERSION   = $(shell cd $(FRONTEND) && node -p "require('@playwright/test/package.json').version")
PW_IMAGE     = mcr.microsoft.com/playwright:v$(PW_VERSION)-noble

.PHONY: help setup setup-backend setup-frontend dev api web test test-backend \
        test-frontend lint clean images publish up down manifests deploy \
        e2e e2e-ui e2e-install e2e-report e2e-linux

help:
	@echo "setup     - create the venv, install backend and frontend deps"
	@echo "dev       - run the API and the Vite dev server together"
	@echo "api       - run just the FastAPI backend on :8000"
	@echo "web       - run just the React frontend on :5173"
	@echo "test      - run both unit test suites (pytest and vitest)"
	@echo "e2e       - browser tests: desktop and phones, against the real API"
	@echo "e2e-ui    - the same in Playwright's UI mode, for writing tests"
	@echo "e2e-install - download the browsers, again after a Playwright upgrade"
	@echo "e2e-report  - open the report from the last browser run"
	@echo "e2e-linux - browser tests with the browsers on Ubuntu 24.04, as on CI"
	@echo "lint      - ruff on the backend, eslint and tsc on the frontend"
	@echo "clean     - remove build artifacts, caches, and node_modules"
	@echo "images    - build both container images at :$(IMAGE_TAG)"
	@echo "publish   - cross-build for $(PLATFORM) and push to $(REGISTRY)"
	@echo "up        - run the containers together on :8080"
	@echo "down      - stop them"
	@echo "manifests - render the $(ENV) overlay without applying it"
	@echo "deploy    - apply the $(ENV) overlay to the current kube context"

setup: setup-backend setup-frontend

setup-backend:
	python3 -m venv $(BACKEND)/.venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -e "$(BACKEND)[dev]"

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

# Each Playwright release pins its own browser builds.
e2e-install:
	cd $(FRONTEND) && npx playwright install chromium webkit

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
	cd $(FRONTEND) && npm run lint
	cd $(FRONTEND) && npm run typecheck
	cd $(FRONTEND) && npm run typecheck:e2e

images:
	docker build -t sudoku-api:$(IMAGE_TAG) $(BACKEND)
	docker build -t sudoku-web:$(IMAGE_TAG) $(FRONTEND)

# One buildx invocation per image: cross-compiles and pushes in a step.
# Needs `docker login ghcr.io` first, with a token that has write:packages.
publish:
	docker buildx build --platform $(PLATFORM) --push \
		-t $(REGISTRY)/$(REPO_SLUG)-backend:$(PUBLISH_TAG) $(BACKEND)
	docker buildx build --platform $(PLATFORM) --push \
		-t $(REGISTRY)/$(REPO_SLUG)-frontend:$(PUBLISH_TAG) $(FRONTEND)

up:
	docker compose up --build

down:
	docker compose down

manifests:
	kubectl kustomize deploy/k8s/overlays/$(ENV)

# Prints the context first: applying to the wrong cluster is the classic way
# to lose an afternoon.
deploy:
	@echo "context: $$(kubectl config current-context)"
	kubectl apply -k deploy/k8s/overlays/$(ENV)

clean:
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache $(BACKEND)/*.egg-info
	rm -rf $(FRONTEND)/node_modules $(FRONTEND)/dist
	rm -rf $(FRONTEND)/test-results $(FRONTEND)/playwright-report $(FRONTEND)/blob-report
