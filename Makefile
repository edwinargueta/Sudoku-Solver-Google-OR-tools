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

.PHONY: help setup setup-backend setup-frontend dev api web test test-backend \
        test-frontend lint clean images publish up down manifests deploy

help:
	@echo "setup     - create the venv, install backend and frontend deps"
	@echo "dev       - run the API and the Vite dev server together"
	@echo "api       - run just the FastAPI backend on :8000"
	@echo "web       - run just the React frontend on :5173"
	@echo "test      - run both test suites"
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

lint:
	cd $(BACKEND) && .venv/bin/python -m ruff check app tests
	cd $(FRONTEND) && npm run lint
	cd $(FRONTEND) && npm run typecheck

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
