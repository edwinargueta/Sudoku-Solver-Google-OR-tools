# Sudoku Solver · Google OR-Tools CP-SAT

A Sudoku solver with no search code in it. The rules are stated as constraints,
[Google OR-Tools](https://developers.google.com/optimization) CP-SAT does the
solving, and a React front end lets you watch it happen.

**Stack:** FastAPI + OR-Tools on the backend, React + TypeScript (Vite) on
the front end.

---

## Why this repo exists

Backtracking a Sudoku grid by hand is a fine exercise, and it is the wrong tool
once the constraints get interesting. Constraint programming inverts the job:
you describe what a valid answer looks like and let a solver find one. This repo
is a small, complete example of that shift —

- **Modeling over algorithms.** The entire solver is 81 variables and 27
  all-different constraints. Adding a rule (diagonals, killer cages) is a line
  of model, not a rewrite of a search loop.
- **CP-SAT in a real shape.** Model construction, solution callbacks, solution
  enumeration, time limits, and search statistics — the parts of the API you
  actually reach for.
- **An honest service boundary.** The solver knows nothing about HTTP, the API
  knows nothing about React, and each layer is tested on its own terms.

---

## What it does

- Solves any valid 9×9 puzzle in single-digit milliseconds.
- **Proves uniqueness** — asks CP-SAT for a second solution, which is how you
  tell a well-posed puzzle from an under-specified one.
- **Names contradictions** rather than shrugging: a repeated given comes back as
  `r1c5=6 repeats in its row` and gets highlighted on the board.
- Reports the search statistics behind every solve — wall time, branches,
  solutions found.
- Ships forty sample puzzles across four difficulties, ten apiece, graded by
  the technique each one demands and drawn at random when you pick a level.

---

## Quickstart

Requires **Python 3.11+** and **Node 18+**.

```bash
make setup     # venv + backend deps + npm install
make dev       # API on :8000, UI on :5173
```

Then open http://localhost:5173.

<details>
<summary>Without make</summary>

```bash
# Backend — http://127.0.0.1:8000 (docs at /docs)
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload

# Frontend — http://localhost:5173
cd frontend
npm install
npm run dev
```

</details>

The Vite dev server proxies `/api` to uvicorn, so the browser sees a single
origin and CORS never comes into it during development. `frontend/.npmrc` pins
the public npm registry, so the install works regardless of what registry the
machine defaults to.

---

## Layout

```
Sudoku Solver Google OR tools/
├── .github/workflows/          # builds arm64 images, pushes them to GHCR
├── compose.yaml                # nginx + uvicorn, the deployed shape locally
├── deploy/k8s/
│   ├── base/                   # deployments, services, ingress, config
│   ├── bootstrap/              # cert-manager issuer, applied once per cluster
│   └── overlays/{dev,prod}/    # what changes per environment
├── backend/
│   ├── Dockerfile              # venv built in one stage, run in a slim one
│   ├── app/
│   │   ├── main.py             # app factory, CORS, router wiring
│   │   ├── config.py           # settings, SUDOKU_-prefixed env vars
│   │   ├── api/routes.py       # /health, /puzzles, /levels, /solve, /validate
│   │   ├── models/schemas.py   # Pydantic request and response contracts
│   │   └── sudoku/
│   │       ├── board.py        # grid vocabulary: parse, format, conflicts
│   │       ├── puzzles.py      # graded puzzle library, ten per level
│   │       └── solver.py       # the CP-SAT model  ← the interesting file
│   └── tests/                  # 210 tests: board, solver, HTTP contract
└── frontend/
    ├── Dockerfile              # Vite build, then nginx serves the bundle
    ├── nginx.conf.template     # SPA fallback + same-origin /api proxy
    ├── src/
    │   ├── App.tsx
    │   ├── api/client.ts       # fetch wrapper, one place for errors
    │   ├── api/types.ts        # the wire contract, mirroring the Pydantic models
    │   ├── hooks/useSudoku.ts  # all board state and API traffic
    │   ├── lib/grid.ts         # pure grid helpers
    │   └── components/         # SudokuGrid, Toolbar, StatusPanel
    ├── tsconfig.json           # the browser half; no Node types on purpose
    ├── tsconfig.node.json      # vite.config.ts, which does run in Node
    └── vite.config.ts
```

Every module under `app/sudoku/` runs on its own:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m app.sudoku.solver    # solves one puzzle per level
```

---

## The model

The whole solver, in [`backend/app/sudoku/solver.py`](backend/app/sudoku/solver.py):

```python
cells = [[model.new_int_var(1, 9, f"r{r}c{c}") for c in range(9)] for r in range(9)]

for r in range(9):
    model.add_all_different(cells[r])                       # 9 rows
for c in range(9):
    model.add_all_different([cells[r][c] for r in range(9)])  # 9 columns
for br in range(0, 9, 3):
    for bc in range(0, 9, 3):                                # 9 boxes
        model.add_all_different([cells[br + dr][bc + dc]
                                 for dr in range(3) for dc in range(3)])

for r, c in givens:
    model.add(cells[r][c] == puzzle[r][c])                   # one per given
```

That is the entire algorithm: 81 variables, 27 all-different constraints, and
one equality per clue. No backtracking, no constraint propagation by hand.

Two details worth knowing:

- **Uniqueness needs enumeration.** `max_solutions > 1` sets
  `enumerate_all_solutions` and drops CP-SAT to a single worker, because
  enumeration is only supported by the sequential search. Asking for two
  solutions and getting one back is a proof of uniqueness.
- **Contradictory givens never reach the solver.** `find_conflicts()` catches a
  digit repeated in a row, column, or box first, so the API can point at the
  offending cell instead of reporting a bare "infeasible".

---

## API

Interactive docs at http://127.0.0.1:8000/docs.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/health` | Liveness, plus the OR-Tools build in use |
| `GET` | `/api/puzzles` | The whole sample library, as strings and as grids |
| `GET` | `/api/puzzles/{key}` | One sample by key — `easy-1`, `hard-7`, `blank` |
| `GET` | `/api/levels` | The difficulty bands and how many puzzles each holds |
| `GET` | `/api/levels/{key}/random` | A random puzzle from `easy`, `medium`, `hard`, `evil` or `blank` |
| `POST` | `/api/solve` | Solve a grid; `max_solutions: 2` to test uniqueness |
| `POST` | `/api/validate` | Duplicate givens, without solving |

A grid is always a 9×9 array of ints with `0` for an empty cell, in both
directions. `/solve` also accepts an 81-character `puzzle` string.

```bash
curl -s localhost:8000/api/solve \
  -H 'content-type: application/json' \
  -d '{"puzzle":"53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79","max_solutions":2}' \
  | python3 -m json.tool | head -20
```

```jsonc
{
  "status": "SOLVED",
  "solution": [[5, 3, 4, 6, 7, 8, 9, 1, 2], ...],
  "solution_count": 1,
  "unique": true,       // a second solution was searched for and does not exist
  "truncated": false,
  "wall_time_ms": 3.9,
  "branches": 0,
  "conflicts": []
}
```

Solve handlers are deliberately plain `def`, not `async def`: CP-SAT is blocking
CPU work, and FastAPI runs sync handlers in a worker thread rather than stalling
the event loop.

---

## Tests

```bash
make test          # or: cd backend && .venv/bin/python -m pytest
```

210 tests in three layers, each able to fail on its own:

| File | Covers |
|---|---|
| `tests/test_board.py` | parsing, formatting, conflicts, completeness, the puzzle library |
| `tests/test_solver.py` | model shape, every sample, uniqueness, infeasibility, time limits |
| `tests/test_api.py` | status codes, payload shapes, 422s, CORS |

The solver suite asserts the property that matters: a solution must be a
complete valid grid **that leaves every given in place**. Every one of the
forty samples is checked for shape, consistency and a unique solution, so a
badly graded puzzle fails the build rather than reaching the board.

---

## Running it locally

Three ways to run the same app, each one a step further from your editor.
Pick by what you are actually testing.

| Testing | Command | Serves on | Picks up an edit |
|---|---|---|---|
| the code | `make dev` | http://localhost:5173 | yes, both halves reload |
| the image | `make up` | http://localhost:8080 | on the next run — it rebuilds |
| the deploy | `make deploy ENV=dev` | http://sudoku.localhost | no, see below |

`make dev` is the one to live in. Reach for `make up` when the thing under
test is the container rather than the code — the nginx config, the SPA
fallback, the same-origin proxy, or whether the image builds from a clean
context. Reach for the cluster when it is the manifests: probes, generated
config, ingress routing.

The second and third need a Docker daemon, and the third a cluster; Rancher
Desktop provides both, as does k3s.

Rebuilding an image does **not** update what is already running in the
cluster. The tag is still `:dev` and the pods pull `IfNotPresent`, so
nothing about it looks new to Kubernetes:

```bash
make images
kubectl -n sudoku-dev rollout restart deploy/api deploy/web
```

Neither `make test` nor `make lint` needs any of this running, which is why
they are the check worth doing before a commit.

---

## Containers

Two images. The backend builds its venv in one stage and copies it into a
slim runtime; the frontend builds the bundle with Node and then serves it
from nginx, which also proxies `/api` to the backend. That proxy is the
production counterpart of the one in `vite.config.ts`: the browser sees a
single origin either way, so CORS never enters the picture.

```bash
make up            # build both, serve on http://localhost:8080
make down
make images IMAGE_TAG=v0.1.0
```

nginx is the only thing here that is not already a dependency — it earns its
place by serving static files properly and by keeping the API same-origin,
which the SPA fallback (`try_files … /index.html`) needs anyway.

Both images run as a non-root user with a read-only root filesystem, so the
writable paths nginx needs are mounted as `emptyDir` volumes in Kubernetes.

---

## Kubernetes

`deploy/k8s` is a kustomize base with one overlay per environment. The base
is the whole app; an overlay says what is different about a place.

```bash
make manifests ENV=dev     # render, change nothing
make deploy ENV=dev        # apply to the current context
make deploy ENV=prod
```

| | `dev` | `prod` |
|---|---|---|
| namespace | `sudoku-dev` | `sudoku-prod` |
| images | local `:dev`, never pulled | `ghcr.io/…:latest`, built for arm64 |
| replicas | 1 api, 1 web | 1 api, 2 web |
| host | `sudoku.localhost` | your DuckDNS name |
| TLS | none | cert-manager, Let's Encrypt |

Both run Traefik, which k3s ships, so the ingress class is settled in the
base rather than per overlay. The ingress splits the paths itself — `/api`
to the API, everything else to the static bundle — which keeps the browser
on one origin and CORS out of the picture. The API config is a generated
ConfigMap, so its name carries a content hash and the pods actually roll
when a value changes.

Adding an environment means copying an overlay and changing the namespace,
the host and the image tags.

### How a deploy works

```
push to main
     │
     ▼
GitHub Actions  ──builds linux/arm64──▶  ghcr.io/<owner>/sudoku-backend
                                          ghcr.io/<owner>/sudoku-frontend
                                          tagged :latest and :<commit sha>
     │
     │  kubectl rollout restart
     ▼
k3s on the Ampere VM  ──pulls :latest──▶  api and web pods swap
     │
     ▼
Traefik  ──▶  https://<your host>        certificate from cert-manager
```

Everything above the cluster is automatic; the rollout is not. The
workflow in `.github/workflows/` builds both images for `linux/arm64` on
every push to `main` and pushes them to GHCR under the names the prod
overlay pulls. The frontend's Node stage is pinned to `$BUILDPLATFORM`, so the
bundle is built natively on the x86 runner and only the small nginx stage
is emulated. Documentation and manifest changes skip the workflow.

The repository is public, so Actions minutes are free and the packages can
be public too — which is why no pull secret appears anywhere in
`deploy/k8s`.

So the loop, once the cluster exists, is:

```bash
git push                                                   # CI builds and pushes
kubectl -n sudoku-prod rollout restart deploy/api deploy/web
kubectl -n sudoku-prod rollout status deploy/api deploy/web
```

That middle step is not optional. The tag is still `latest`, so nothing
about the Deployment has changed and Kubernetes has no reason to pull
again on its own.

To go back to a known-good build, use the commit tag that CI also pushes:

```bash
kubectl -n sudoku-prod set image deploy/api \
  api=ghcr.io/<owner>/sudoku-backend:<commit-sha>
```

`make publish` does the same build from a laptop and skips CI entirely,
which is handy when a run is queued behind something slow.

### One-time setup

The target is a single Oracle Always Free Ampere VM running k3s: Traefik
is built in, cert-manager issues the certificate, DuckDNS supplies the
hostname, and GHCR stores the images. None of it costs anything.

**The constraint that governs everything: the free VM is ARM64.** An amd64
image crash-loops there with `exec format error`, which is why CI builds
for `linux/arm64` and why the backend sits on `python:3.13-slim` — Debian
rather than Alpine, so the OR-Tools aarch64 wheel installs as a binary
instead of trying to compile.

1. **Provision the VM** and open 22, 80 and 443 in the OCI security list.
   Then fix the VM's own iptables, which drop 80 and 443 regardless of the
   cloud firewall — this is the single most common way the setup appears
   to work and does not.
2. **Point DNS at it.** `dig +short <host>` must return the VM's IP
   *before* the first deploy, or the Let's Encrypt HTTP-01 challenge has
   nowhere to land.
3. **Install k3s** on the VM: `curl -sfL https://get.k3s.io | sh -`.
   Manage it over an SSH tunnel rather than exposing port 6443.
4. **Push once and make the packages public.** After the first green
   Actions run, both images appear under your GitHub profile → Packages;
   set each to Public so k3s can pull without credentials.
5. **Install cert-manager and the issuer.** The ClusterIssuer lives
   outside the overlays because its kind does not exist until the CRDs
   are in place:

   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/<VERSION>/cert-manager.yaml
   kubectl apply -f deploy/k8s/bootstrap/clusterissuer.yaml
   ```

6. **Fill in the placeholders**, then deploy:

   | Where | What |
   |---|---|
   | `overlays/prod/ingress-tls.yaml` | your hostname, in both the `tls` and `rules` blocks |
   | `bootstrap/clusterissuer.yaml` | the address Let's Encrypt emails about expiry |
   | `overlays/prod/kustomization.yaml` | the registry owner, if it is not `edwinargueta` |

   ```bash
   make deploy ENV=prod
   kubectl -n sudoku-prod get certificate -w    # READY should turn True
   ```

While testing, point the issuer at Let's Encrypt **staging** first. The
production rate limits are per-domain and unforgiving, and a few failed
attempts can lock you out for a week.

### When it goes wrong

| Symptom | Cause |
|---|---|
| `exec format error` | an amd64 image on the ARM VM — check the workflow built `linux/arm64` |
| `ImagePullBackOff` | the package is still private, or its name does not match the overlay's `image:` |
| Certificate stuck not ready | DNS does not resolve to the VM, or 80 is blocked by the VM's iptables |
| New code not live | no `rollout restart` after CI pushed a new `:latest` |
| Pods `Pending` | the free VM has one or two cores; the requests in `api-resources.yaml` assume that |

```bash
kubectl -n sudoku-prod get pods
kubectl -n sudoku-prod logs deploy/api
kubectl -n sudoku-prod describe certificate sudoku-tls
kubectl -n sudoku-prod get events --sort-by=.lastTimestamp
```

---

## Configuration

Copy the examples and edit; every backend key is prefixed `SUDOKU_`.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

| Variable | Default | Meaning |
|---|---|---|
| `SUDOKU_SOLVER_TIME_LIMIT_S` | `10.0` | Seconds CP-SAT gets per request |
| `SUDOKU_SOLVER_WORKERS` | `8` | Search workers for a single-solution solve |
| `SUDOKU_CORS_ORIGINS` | Vite dev server | JSON list of allowed origins |
| `VITE_API_BASE_URL` | `/api` | Where the UI sends requests |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8000` | Where the dev proxy forwards |
| `BACKEND_ORIGIN` | `http://api:8000` | Where the container's nginx proxies `/api` |

---

## Roadmap

- [ ] Generate puzzles on demand, rather than drawing from a fixed library
- [ ] Explain a solve — surface the propagations, not just the answer
- [ ] Variants: diagonal, killer, hyper — each is a handful of extra constraints
- [x] Containers for both halves, and kustomize overlays to deploy them
- [x] Build and publish arm64 images from CI on every push to `main`
- [ ] Have the cluster pull new images by itself, rather than a rollout restart
- [ ] Import a puzzle from a photo
