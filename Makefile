# Two toolchains, one entry point. Run `make setup` once, then `make dev`.

BACKEND  := backend
FRONTEND := frontend
PY       := $(BACKEND)/.venv/bin/python

.PHONY: help setup setup-backend setup-frontend dev api web test lint clean

help:
	@echo "setup   - create the venv, install backend and frontend deps"
	@echo "dev     - run the API and the Vite dev server together"
	@echo "api     - run just the FastAPI backend on :8000"
	@echo "web     - run just the React frontend on :5173"
	@echo "test    - run the backend test suite"
	@echo "lint    - ruff on the backend, eslint on the frontend"
	@echo "clean   - remove build artifacts, caches, and node_modules"

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

test:
	cd $(BACKEND) && .venv/bin/python -m pytest

lint:
	cd $(BACKEND) && .venv/bin/python -m ruff check app tests
	cd $(FRONTEND) && npm run lint

clean:
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache $(BACKEND)/*.egg-info
	rm -rf $(FRONTEND)/node_modules $(FRONTEND)/dist
