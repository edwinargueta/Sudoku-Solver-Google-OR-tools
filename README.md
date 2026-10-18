# Sudoku Solver · Google OR-Tools CP-SAT

A Sudoku solver with no search code in it. The rules are stated as constraints,
[Google OR-Tools](https://developers.google.com/optimization) CP-SAT does the
solving, and a React front end lets you watch it happen.

**Stack:** FastAPI + OR-Tools on the backend, React + TypeScript (Vite) on
the front end.

**Live at [sudoku-csp.duckdns.org](https://sudoku-csp.duckdns.org/)** — free to
use, nothing to sign up for. It runs on a single-node k3s cluster on an Oracle
Cloud Always Free ARM VM, with images built for `linux/arm64` by GitHub Actions
and a Let's Encrypt certificate issued by cert-manager. The whole thing costs
nothing to host — [ARCHITECTURE.md](ARCHITECTURE.md) has the diagrams and the
line-by-line cost breakdown, and [One-time setup](#one-time-setup) has the recipe.

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

- Solves any valid 9×9 puzzle in milliseconds: most of the samples in under
  two, and none, the empty board included, in more than a few dozen with the
  uniqueness check on.
- **Proves uniqueness** — asks CP-SAT for a second solution, which is how you
  tell a well-posed puzzle from an under-specified one. It only says "unique"
  when the search ran to the end; one cut short by the time limit says so.
- **Names contradictions** rather than shrugging: a repeated given comes back as
  `r1c5=6 repeats in its row`, and every cell of the clash is highlighted on
  the board, clues included. The status line counts the cells in conflict and
  names the one you typed rather than the clue it repeats, since only yours
  can change.
- Reports the search statistics behind every solve — wall time, branches,
  solutions found.
- Ships forty sample puzzles across four difficulties, ten apiece, graded by
  the technique each one demands and drawn at random when you pick a level.
- **Plays like a board, not a form** — the puzzle's clues are read-only, every
  entry is a move that Undo (or Ctrl+Z / Cmd+Z) can take back, and Clear
  removes your moves while leaving the clues alone. Clear, New puzzle and a
  change of level ask first whenever there are moves to lose, and New puzzle
  never deals the one already on the board while the level has another.
  Check Moves checks your own entries, so it is off while the solver's answer
  is shown; erasing a cell the solver filled puts your board back.
- **Shows you the constraints** — selecting a cell shades the twenty others a
  digit there could clash with: its row, its column and its box. The same three
  all-different constraints the solver is working with, drawn on the board.
- **Reachable on a phone** — the difficulty picker sits above the board and
  Solve, Check Moves, Undo and Clear sit below it, so choosing a puzzle and
  playing it both happen without scrolling. The settings panel keeps what you
  touch once.
- **Playable from the keyboard and a screen reader** — the board is one Tab
  stop and an ARIA grid of rows and cells, the arrow keys move around it, and
  a cell in a clash is marked invalid and underlined, not only coloured.

---

## Quickstart

Requires **Python 3.11+** and **Node 24+** (`frontend/.nvmrc`; `nvm use` in `frontend/` picks it up).

```bash
make setup     # venv + backend deps + npm install
make dev       # API on :8000, UI on :5173
```

Then open http://localhost:5173.

`make setup` builds the venv with whatever `python3` is first on the PATH. If
that one is older than 3.11 it stops and says so; name a newer one with
`make setup PYTHON=python3.13`. On Debian and Ubuntu, `python -m venv` also
needs the `python3-venv` package.

<details>
<summary>Without make</summary>

Two terminals, both starting from the repository root. The backend installs
the same pinned versions CI tests. The app itself is not installed: uvicorn
and pytest import it from `backend/`.

```bash
# Terminal 1: backend — http://127.0.0.1:8000 (docs at /docs)
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.lock
.venv/bin/uvicorn app.main:app --reload
```

```bash
# Terminal 2: frontend — http://localhost:5173
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
├── ARCHITECTURE.md             # system design, diagrams, why it costs nothing
├── .github/
│   ├── workflows/ci.yml        # tests and checks, then arm64 images to GHCR from main
│   ├── scripts/smoke.sh        # runs both images as the cluster does, and probes them
│   └── dependabot.yml          # monthly updates for the pinned actions and base images
├── compose.yaml                # nginx + uvicorn under the cluster's constraints
├── deploy/k8s/
│   ├── base/                   # deployments, services, ingress, config
│   ├── bootstrap/              # cert-manager issuer, applied once per cluster
│   ├── overlays/{dev,prod}/    # what changes per environment
│   └── render.sh               # renders an overlay; pins prod to a commit
├── backend/
│   ├── Dockerfile              # venv built in one stage, run in a slim one
│   ├── requirements.lock       # the pinned, hashed versions the image ships
│   ├── requirements-dev.lock   # the same pins plus the dev tools, for CI and setup
│   ├── app/
│   │   ├── main.py             # app factory, CORS, body limit, router wiring
│   │   ├── config.py           # settings, SUDOKU_-prefixed env vars
│   │   ├── api/routes.py       # /health, /puzzles, /levels, /solve, /validate
│   │   ├── models/schemas.py   # Pydantic request and response contracts
│   │   └── sudoku/
│   │       ├── board.py        # grid vocabulary: parse, format, conflicts
│   │       ├── puzzles.py      # graded puzzle library, ten per level
│   │       └── solver.py       # the CP-SAT model  ← the interesting file
│   └── tests/                  # board, solver, HTTP, settings
└── frontend/
    ├── Dockerfile              # Vite build, then nginx serves the bundle
    ├── nginx.conf.template     # SPA fallback, headers, the /api and docs proxy
    ├── .nvmrc                  # the Node version, for nvm and for CI
    ├── src/
    │   ├── App.tsx
    │   ├── api/client.ts       # fetch wrapper, one place for errors
    │   ├── api/types.ts        # the wire contract, mirroring the Pydantic models
    │   ├── hooks/useSudoku.ts  # the game's state and its API calls
    │   ├── lib/grid.ts         # pure grid helpers
    │   └── components/         # LevelPicker, SudokuGrid, BoardActions, StatusLine, …
    ├── e2e/                    # browser tests: desktop and phones, real API
    ├── playwright.config.ts    # the four browser projects and their servers
    ├── tsconfig.json           # the browser half; no Node types on purpose
    ├── tsconfig.node.json      # vite.config.ts and its test, which run in Node
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

Three details worth knowing:

- **Uniqueness needs enumeration.** `max_solutions > 1` sets
  `enumerate_all_solutions`, which only the sequential search supports.
  Asking for two solutions and getting one back proves uniqueness only when
  the search ran to the end: CP-SAT then reports OPTIMAL, and the response
  says `exhaustive: true`. A search the time limit cut short has found one
  solution and settled nothing, so it comes back `unique: false` and
  `truncated: true`.
- **One worker is the fast setting.** A single-solution solve could use
  CP-SAT's parallel portfolio, but on a 9×9 board the extra workers only add
  thread start-up and contention and take three to five times as long, so
  the default is one.
- **Contradictory givens never reach the solver.** `find_conflicts()` catches a
  digit repeated in a row, column, or box first, and lists every cell of the
  repeat, so the API can point at the offending cells instead of reporting a
  bare "infeasible".

---

## API

Interactive docs at http://127.0.0.1:8000/docs.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/health` | Liveness, plus the OR-Tools build in use |
| `GET` | `/api/puzzles` | The whole sample library, as strings and as grids |
| `GET` | `/api/puzzles/{key}` | One sample by key — `easy-1`, `hard-7`, `blank` |
| `GET` | `/api/levels` | The difficulty bands and how many puzzles each holds |
| `GET` | `/api/levels/{key}/random` | A random puzzle from `easy`, `medium`, `hard`, `evil` or `blank`; `?exclude=<puzzle key>` never deals that one while the level has another |
| `POST` | `/api/solve` | Solve a grid; `max_solutions: 2` to test uniqueness |
| `POST` | `/api/validate` | Duplicate givens, without solving |

A grid is always a 9×9 array of ints with `0` for an empty cell, in both
directions. `/solve` also accepts a `puzzle` string of 81 cells: `1`–`9` for
a digit (ASCII only), `.`, `0` or `_` for an empty cell. Whitespace and the
`|`, `-` and `+` that `render()` draws between boxes are skipped, so a
pretty-printed grid can be pasted back in; `-` and a space are layout, not
empty cells.

Requests are strict, so a mistake is an error rather than a guess. An
unknown field is a 422 (`extra_forbidden`), so a misspelt `max_solution`
cannot quietly fall back to the default. A cell must be a JSON integer from
0 to 9: `true`, `"5"` and `5.0` are refused. `max_solutions` is an integer
from 1 to 1000, `time_limit_s` a number above 0 and at most 60 (cut down to
the server's own limit when it asks for more), and a `puzzle` string at most
1000 characters.

```bash
curl -s localhost:8000/api/solve \
  -H 'content-type: application/json' \
  -d '{"puzzle":"53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79","max_solutions":2}' \
  | jq '{status, solution_count, unique, exhaustive, truncated, wall_time_ms, branches}'
```

The filter leaves out the grids. The whole response, with the grids
abbreviated:

```jsonc
{
  "status": "SOLVED",
  "solution": [[5, 3, 4, 6, 7, 8, 9, 1, 2], ...],
  "solutions": [[[5, 3, 4, 6, 7, 8, 9, 1, 2], ...]],   // every grid collected
  "solution_count": 1,
  "unique": true,       // a second solution was searched for and does not exist
  "exhaustive": true,   // the search ran to the end, so the count is complete
  "truncated": false,   // true when it stopped at max_solutions or the time limit
  "wall_time_ms": 0.4,
  "branches": 0,
  "conflicts": []
}
```

`truncated` is true whenever solutions came back and the search did not
finish, so asking for exactly N and getting N back reports it too: nobody
looked for the next one. For the same reason a solve with `max_solutions: 1`
that finds its solution is never exhaustive. `INFEASIBLE` is: the search
finished, and proved there is nothing to find.

Errors keep one shape: `detail` is a string, except on a 422, where it is a
list with each problem's `type`, `loc` and `msg` and never the input that
caused it.

| Status | When | `detail` |
|---|---|---|
| `404` | no such puzzle or level | `unknown level 'x'; try one of [...]` |
| `413` | a body over 16 KiB, by `Content-Length` or counted as it streams | `Request body too large.` |
| `422` | anything the schemas refuse, NaN and Infinity included | `[{"type", "loc", "msg"}, ...]` |
| `503` | every solve slot is taken; `Retry-After: 1` | `The solver is busy. Try again in a moment.` |

The OpenAPI schema at `/docs` documents all of these, and the 9×9 bounds. A
500 is a fault on the server, such as CP-SAT rejecting the model it was
given; it is logged, and never passed off as `UNKNOWN` or a time limit.

Solve handlers are deliberately plain `def`, not `async def`: CP-SAT is blocking
CPU work, and FastAPI runs sync handlers in a worker thread rather than stalling
the event loop. At most `SUDOKU_SOLVER_CONCURRENCY` solves run at once; one more
gets the 503 straight away rather than queuing behind CP-SAT. `/api/health` is
the exception to the rule: it is `async` and needs no worker thread, so a probe
is still answered while every thread is solving.

---

## Tests

```bash
make test              # both unit suites
make test-backend      # pytest
make test-frontend     # vitest
make e2e               # browser tests, desktop and phones
```

**Several hundred unit tests**, pytest on the backend and Vitest on the front
end. On top of those, **about fifty browser tests** run across four device
projects in two engines, with Playwright. Every file is meant to be able to
fail on its own.

| File | Covers |
|---|---|
| `backend/tests/test_board.py` | parsing (blanks, layout, non-ASCII digits), formatting, every cell of a conflict, the puzzle library, draws that exclude a puzzle, each module run as a script |
| `backend/tests/test_solver.py` | model shape, every sample, uniqueness, `exhaustive` and `truncated` at the cap and on a timeout, infeasibility, the time limit CP-SAT actually gets, workers, a model CP-SAT rejects |
| `backend/tests/test_api.py` | status codes, payload shapes, strict requests, 422s, NaN and Infinity, the body limit, the 503, OpenAPI, CORS allowed and denied, injected settings |
| `backend/tests/test_config.py` | defaults, bounds, the `SUDOKU_` prefix, where `.env` is read from, the cached singleton |
| `frontend/src/lib/grid.test.ts` | the pure grid helpers, box arithmetic and peer cells |
| `frontend/src/api/client.test.ts` | request shapes, the timeout, every way a request can fail, and what a production build says instead |
| `frontend/src/hooks/useSudoku.test.ts` | the state machine: load, edit, undo, solve, check, clear, the prompts before moves are lost, requests in flight and failing |
| `frontend/src/components/*.test.tsx` | rendering, typing, arrow keys, the ARIA grid and its one Tab stop, locked clues, the constraint highlight, conflicts, busy controls |
| `frontend/src/App.test.tsx` | where things live: picker above the board, actions below it; the API badge and the levels retry coming back |
| `frontend/vite-proxy.test.ts` | the dev and preview proxy: its target from `.env.local` or the shell, and a 502 when the API is not running |
| `frontend/e2e/game.spec.ts` | a game against the real API: dealing, Check Moves, the prompts and New puzzle on every device; solving and contradictions on desktop and iPhone |
| `frontend/e2e/desktop/*.spec.ts` | the keyboard in Chrome and Safari (one Tab stop, the grid's rows and cells, Ctrl+Z), the desktop layout, focus while busy, contrast, forced colors |
| `frontend/e2e/touch/*.spec.ts` | the number pad with real taps, and the board and pad fitting on each phone |

The solver suite asserts the property that matters: a solution must be a
complete valid grid **that leaves every given in place**. Every one of the
forty samples is checked for shape, consistency and a unique solution, so a
badly graded puzzle fails the build rather than reaching the board.

The front-end tests mock `fetch` and the API client rather than starting a
server, so `make test` needs nothing running. Component tests drive the
board the way a person does — typing a digit, pressing Backspace, walking
the grid with arrow keys — instead of reaching for internals.

### Browser tests

jsdom has no stylesheet, no real taps and no API, so the browser tests cover
what the unit tests cannot: the layout on each screen, touch and focus in a
real engine, and whether the UI and the FastAPI schemas actually agree.
`make e2e` builds the bundle that ships, starts uvicorn and `vite preview` on
ports of their own (8001 and 4180, so `make dev` can keep running), and plays
against the real solver. The API's solver and CORS settings are pinned in
`playwright.config.ts`, so a `backend/.env` cannot change what the tests see.
The only thing stubbed is the random draw, pinned to each level's first
puzzle so a test knows where the clues are; the one test of New puzzle leaves
it alone and checks that a different puzzle comes back.

| Project | Browser | Stands in for |
|---|---|---|
| `desktop` | Chromium, 1280×720 | a mouse and keyboard |
| `desktop-safari` | WebKit, 1280×720 | Safari's own quirks with the caret and mouse-up |
| `iphone` | WebKit, 375×548 | an iPhone SE, at Safari's visible height with both toolbars |
| `android` | Chromium, 360px wide | the narrowest common phone |

Files in `e2e/desktop/` run only on the first two, files in `e2e/touch/` only
on the phones, and the rest on all four. A test tagged `@any-engine` checks
something the browser engine cannot change — the API contract, another
iPhone's screen size — so it runs on `desktop` and `iphone` only. Layout
checks compare elements with each other rather than with fixed pixels,
because fonts differ between macOS and the Linux CI runner. There are no
screenshot baselines to keep up to date.

Once, after `make setup`, and again after each Playwright upgrade:

```bash
make e2e-install       # Chromium and WebKit, about 850 MB on disk
```

On Linux it installs the system libraries the browsers need as well, as CI
does (`--with-deps`), and Playwright asks for sudo to do that.

Playwright needs Node 20 or later, so run `nvm use` in `frontend/` first, or
make 24 the default with `nvm alias default 24`.

```bash
make e2e E2E_ARGS="--project=iphone touch/"   # one project, one folder
make e2e E2E_ARGS="--grep @smoke"             # the few that prove it works at all
make e2e-ui            # UI mode: watch, pick a test, step through it
make e2e-report        # the report from the last run
```

**When CI fails and your laptop does not.** Every failed run uploads a
`playwright-report` artifact with a trace and a screenshot for each failure.
Download it and open it with `npx playwright show-report playwright-report.zip`.
To get closer to the runner locally, `make e2e-linux` starts the browsers in
Playwright's Ubuntu 24.04 image (Docker needed) — the release CI runs on, with
the same browser builds — while the tests and servers stay on your machine.

**What no browser test can see.** An emulated iPhone has no software
keyboard, no edit menu and no VoiceOver, so the tests check what those
depend on: every cell asks for no keyboard, a second tap on a chosen cell is
cancelled, the announcement text is right. After a change to the touch code,
check these by hand on a real iPhone:

1. Tapping a cell brings up no keyboard.
2. Tapping the chosen cell again shows no Paste or AutoFill menu.
3. Tapping a cell in the top or bottom row does not make the page jump.
4. Two quick taps on a key enter two digits and do not zoom.
5. On its side, the board and the pad are both on screen once the board is
   scrolled up, with Safari's toolbars showing and hidden.
6. With VoiceOver on, each key press is read out.
7. With VoiceOver on, the board is read as a grid, row by row, and a cell in
   a clash as invalid. The rows and cells are `display: contents` wrappers,
   whose roles older Safari releases drop.

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

The second and third need a Docker daemon, and the third a cluster that can
see the images Docker builds. Rancher Desktop with its dockerd (moby) engine
provides both, and `make deploy ENV=dev` applies to its `rancher-desktop`
context (`KUBE_CONTEXT_dev` names another). Plain k3s runs containerd rather
than Docker, so it never sees what `make images` builds until the images are
imported into it:

```bash
docker save sudoku-api:dev sudoku-web:dev | sudo k3s ctr images import -
```

The dev pods use the image already in the node's runtime and only try a
registry when it is missing, so `ErrImagePull` on `sudoku-api:dev` means the
image never made it there.

Rebuilding an image does **not** update what is already running in the
cluster. The tag is still `:dev` and the pods pull `IfNotPresent`, so
nothing about it looks new to Kubernetes:

```bash
make images
kubectl -n sudoku-dev rollout restart deploy/api deploy/web
```

Neither `make test` nor `make lint` needs any of this running, which is why
they are the check worth doing before a commit. CI runs them, the browser
tests, and the image and manifest checks below before it will push an image.

---

## Containers

Two images. The backend installs its locked dependencies into a venv in one
stage and copies it into a slim runtime, with the app's source copied in after
it, so a code change rebuilds, and a deploy pulls, only that small layer; the
frontend builds the bundle with Node and then serves it from nginx. Under
compose, nginx also proxies `/api` to the backend, the counterpart of the
proxy in `vite.config.ts`: the browser sees a single origin either way, so
CORS never enters the picture. In the cluster the ingress sends `/api`
straight to the api Service, and nginx only passes on `/docs`, `/redoc` and
`/openapi.json`.

```bash
make up            # build both, serve on http://localhost:8080
make down
make images IMAGE_TAG=v0.1.0
make smoke         # build them, run them as the cluster does, and probe them
```

nginx is the only thing here that is not already a dependency — it earns its
place by serving static files properly and by keeping the API same-origin,
which the SPA fallback (`try_files … /index.html`) needs anyway.

What it sends matters to a deploy. `index.html`, and the fallback that
serves it for every client-side route, carry `Cache-Control: no-cache`, so a
browser picks up a new build on its next load; the fingerprinted files
under `/assets/` are immutable for a year. Responses are gzipped, the
`Server` header has no version, and every response, error pages included,
carries `nosniff`, a `strict-origin-when-cross-origin` Referrer-Policy and
HSTS. The SPA's HTML has a Content-Security-Policy of `default-src 'self';
img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'`, which the
docs do not get, since Swagger UI comes from a CDN. **An API on another
origin (`VITE_API_BASE_URL`), an external resource, or an inline script or
style tag added to the SPA needs a matching change to the CSP in
`frontend/nginx.conf.template`.** `/favicon.ico` is a 404: the
icon is inlined in `index.html`.

Both images set a numeric non-root `USER` (10001 for the API, nginx's 101 for
the web). The read-only root comes from where they run: the pod's
`securityContext` in Kubernetes, `read_only` in `compose.yaml`, with the
writable paths mounted as `emptyDir` or `tmpfs` volumes. compose mirrors the
pods otherwise too: no capabilities, `no-new-privileges`, one CPU for the API,
and the site published on 127.0.0.1 only. A write to somewhere new fails
under `make up` first.

uvicorn runs with `--proxy-headers`, and believes `X-Forwarded-For` and
`-Proto` only from the addresses in `FORWARDED_ALLOW_IPS`. The image sets
`127.0.0.1`, which inside a container trusts nobody, so by default a client
can never choose its own address. The cluster trusts its pod network, where
Traefik runs and replaces whatever a client sent. compose trusts everyone: its
nginx adds to a client's own `X-Forwarded-For` and passes on its
`X-Forwarded-Proto`, so a local caller can pick the address the API logs and
the scheme of a redirect. That is harmless, since the site is published on
127.0.0.1 only (see [Configuration](#configuration)). nginx forwards `Host`
with its port, so a redirect from the API comes back to the address the
browser used.

Every base image is pinned by digest as well as tag, and the backend
installs from `backend/requirements.lock`, as wheels only, building nothing,
so two builds of one commit get the same image. Dependabot proposes new
digests once a month.

The ranges in `backend/pyproject.toml` say what the code is written against;
the lock files say what actually ships. `requirements.lock` holds the runtime
pins, hash-checked, for the image and the browser-test job;
`requirements-dev.lock` adds the dev tools on the same pins, for the backend
CI job and `make setup`. After a change to `pyproject.toml`, `make lock`
re-pins both (it needs [uv](https://docs.astral.sh/uv/)), and
`make lock LOCK_ARGS=--upgrade` moves every pin to the newest release allowed.

---

## Kubernetes

`deploy/k8s` is a kustomize base with one overlay per environment. The base
is the whole app; an overlay says what is different about a place.

```bash
make manifests ENV=dev                 # render, change nothing
make deploy ENV=dev                    # apply to the rancher-desktop context
make manifests ENV=prod TAG=<sha>      # prod, pinned to a commit CI built
make deploy ENV=prod TAG=<sha>
```

`make deploy` renders the overlay first, so a broken overlay or a bad `TAG`
fails before anything is applied. Then it picks the cluster: dev goes to the
`rancher-desktop` context (`KUBE_CONTEXT_dev`), prod to `KUBE_CONTEXT_prod`,
or `KUBE_CONTEXT`, when one is set. With none set it names the current
context and asks; anything but `y` applies nothing.

| | `dev` | `prod` |
|---|---|---|
| namespace | `sudoku-dev` | `sudoku-prod` |
| images | local `:dev`, from `make images` | `ghcr.io/…:<commit sha>`, built for arm64 |
| pull policy | `IfNotPresent` | `IfNotPresent` |
| replicas | 1 api, 1 web | 1 api, 2 web |
| host | `sudoku.localhost` | your DuckDNS name |
| TLS | none | cert-manager, Let's Encrypt; plain HTTP redirected to HTTPS |

Both run Traefik, which k3s ships, so the ingress class is settled in the
base rather than per overlay. The ingress splits the paths itself — `/api`
to the API, everything else to the static bundle — which keeps the browser
on one origin and CORS out of the picture. The API config is a generated
ConfigMap, so its name carries a content hash and the pods actually roll
when a value changes. It sets one search worker, two solves at a time on
the pod's one CPU, and `FORWARDED_ALLOW_IPS=10.42.0.0/16`, k3s's default pod
network, where Traefik and the web pods run.

Both namespaces enforce the `restricted` Pod Security profile, which both
pods already meet: non-root, no privilege escalation, no capabilities,
`RuntimeDefault` seccomp. Neither mounts a service account token or gets
Service links in its environment, since nothing in them talks to the
Kubernetes API. The API's probes both hit `/api/health`, which answers
without a worker thread: readiness takes the pod out of the Service after
three failures (about 30 s), liveness restarts it only after six (about two
minutes), since a restart kills every solve in flight. Each pod sleeps 5 s
before it stops, so Traefik has stopped sending it requests by then. In prod
the web Service also carries a Traefik sticky cookie: while a rollout has
both builds serving, a browser's asset requests go to the pod its
`index.html` came from, the one whose build has those files.

Adding an environment means copying an overlay and changing the namespace,
the host and the image tags.

### How a deploy works

```
push to main
     │
     ▼
GitHub Actions  ──builds linux/arm64──▶  ghcr.io/<owner>/sudoku-backend
                                          ghcr.io/<owner>/sudoku-frontend
                                          tagged :<commit sha> and :latest
     │
     │  make deploy ENV=prod TAG=<commit sha>
     ▼
k3s on the Ampere VM  ──pulls :<sha>──▶  api and web pods roll
     │
     ▼
Traefik  ──▶  https://<your host>        certificate from cert-manager
```

Everything above the cluster is automatic; the rollout is not. The
workflow in `.github/workflows/ci.yml` runs every check first — pytest,
Vitest, the browser tests, a native build of both images run through
`.github/scripts/smoke.sh`, and both overlays rendered — and **only builds
if they all pass**, so a red test never reaches the registry. Only `main`
publishes: pull requests run every check and push nothing, and so does a
manual run from any other branch. The build then produces both images for
`linux/arm64` and pushes them to GHCR under the names the prod overlay pulls,
tagged with the commit and with `:latest`. Nothing deploys `:latest`; it
only says which build of `main` is newest. The frontend's Node stage is
pinned to `$BUILDPLATFORM`, so the bundle is built natively on the x86
runner and only the small nginx stage is emulated.

The smoke test runs both containers the way the pod does — read-only root,
the same writable mounts, no capabilities — and checks what only a running
container shows: that nginx accepts the config its entrypoint renders, the
SPA fallback, the cache and security headers, both proxied paths, and a
redirect that keeps the port. `make smoke` runs the same script locally, on
127.0.0.1:18000 and 18080 (`SMOKE_API_PORT`, `SMOKE_WEB_PORT`).

The workflow's token is read-only except in the build job, which alone can
write packages. A push to a pull request cancels the run it replaces, while
runs on `main` queue, so builds land in commit order. Every action is pinned
to a commit, with its release in a comment, and `.github/dependabot.yml`
proposes new action commits and base-image digests once a month. Node majors
and Python minors are left out: they move with `frontend/.nvmrc` and the
`python-version` in `ci.yml`.

The repository is public, so Actions minutes are free and the packages can
be public too — which is why no pull secret appears anywhere in
`deploy/k8s`.

So the loop, once the cluster exists, is:

```bash
git push                                         # CI tests, builds and pushes :<sha>
make deploy ENV=prod TAG=$(git rev-parse HEAD)   # once that run is green
kubectl -n sudoku-prod rollout status deploy/api deploy/web
```

`TAG` is the full 40-character SHA of a commit CI built, as
`git rev-parse HEAD` prints it; anything shorter is refused, since no image
carries it. The prod overlay's own tag is a placeholder, `set-by-make-deploy`:
`deploy/k8s/render.sh` swaps the commit in on a scratch copy of `deploy/k8s`,
so the tree never changes, and checks that every image took it. The applied
spec therefore names the build that runs, and a container that restarts gets
the same build back. Applied by hand with
`kubectl apply -k deploy/k8s/overlays/prod`, the overlay names an image that
does not exist: the new pods sit in `ErrImagePull` while the old ones keep
serving.

To go back to a known-good build, deploy its commit:

```bash
make deploy ENV=prod TAG=<older sha>
```

That is also the only rollback that lasts. `kubectl set image` would work
until the next `make deploy`, which puts the overlay's image back.

`make publish` is for when CI is queued behind something slow. It runs the
lint and the unit tests, refuses a working tree with any change in it,
untracked files included, then cross-builds HEAD for arm64 and pushes it as
`:<full commit sha>`, never `:latest`. The browser tests and the image checks
are skipped, which is the price of not waiting. It needs `docker login
ghcr.io` first, with a token that can write packages. Deploy it the same
way, with `make deploy ENV=prod TAG=$(git rev-parse HEAD)`.

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
   are in place. cert-manager's webhook refuses it until it is up, hence
   the wait:

   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/<VERSION>/cert-manager.yaml
   kubectl -n cert-manager wait --for=condition=Available deployment --all --timeout=180s
   kubectl apply -f deploy/k8s/bootstrap/clusterissuer.yaml
   ```

   Should the last line still fail with `failed calling webhook`, the
   webhook's CA bundle is not injected yet: give it a few seconds and apply
   it again.

6. **Fill in the placeholders**, then deploy:

   | Where | What |
   |---|---|
   | `overlays/prod/ingress-tls.yaml` | your hostname, in both the `tls` and `rules` blocks |
   | `bootstrap/clusterissuer.yaml` | the ACME account's contact address |
   | `overlays/prod/kustomization.yaml` | the registry owner, if it is not `edwinargueta` |
   | `base/kustomization.yaml` | `FORWARDED_ALLOW_IPS`, if k3s was installed with a `--cluster-cidr` other than 10.42.0.0/16 |

   ```bash
   make deploy ENV=prod TAG=<sha of the green run>
   kubectl -n sudoku-prod get certificate -w    # READY should turn True
   ```

   Set `KUBE_CONTEXT_prod` to the tunnelled cluster's context name, in the
   environment or on the command line, and `make deploy` stops asking which
   cluster you meant.

The contact address gets no expiry warnings: Let's Encrypt stopped sending
them in 2025. `kubectl get certificate` is where renewal shows, and
cert-manager renews on its own.

The HTTP-to-HTTPS redirect is a Traefik Middleware
(`overlays/prod/redirect-https.yaml`, `traefik.io/v1alpha1`), which needs
Traefik 2.10 or later; a current k3s ships that. The HTTP-01 challenge is
unaffected, since cert-manager's solver gets an Ingress of its own.

While testing, point the issuer at Let's Encrypt **staging** first.
Production allows five failed validations per hostname an hour, and five
copies of the same certificate a week, so a setup that keeps failing, or
keeps being torn down and rebuilt, runs into them quickly.

### When it goes wrong

| Symptom | Cause |
|---|---|
| `exec format error` | an amd64 image on the ARM VM — check the workflow built `linux/arm64` |
| `ImagePullBackOff` | the package is still private, or its name does not match the overlay's `image:` |
| `ErrImagePull` on `:set-by-make-deploy` | the prod overlay was applied by hand; deploy with `make deploy ENV=prod TAG=<sha>` |
| `ErrImagePull` on `sudoku-api:dev` | the dev image is not in the node's runtime; `make images`, and import it on plain k3s |
| Certificate stuck not ready | DNS does not resolve to the VM, or 80 is blocked by the VM's iptables |
| cert-manager's solver pod refused | cert-manager was installed with `--acme-http01-solver-run-as-non-root=false`; `sudoku-prod` enforces the restricted profile |
| New code not live | no `make deploy ENV=prod TAG=<sha>` after CI pushed that commit |
| Pods `Pending` | the VM, as provisioned, has few cores and shares them with k3s, Traefik and cert-manager; the requests in `api-resources.yaml` assume that |
| `503` "The solver is busy" | `SUDOKU_SOLVER_CONCURRENCY` solves were already running; raise it if the node has the CPU |
| API logs show a node's IP, not the visitor's | k3s's ServiceLB with Traefik's default `externalTrafficPolicy: Cluster` replaces the client address; setting it to `Local` in a Traefik `HelmChartConfig` keeps it |

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

The backend reads `backend/.env` wherever uvicorn or pytest is started from,
and an exported variable wins over the file. A value out of its range stops
the app at startup, so a typo in a ConfigMap fails the rollout rather than
every solve. `frontend/.env.local` is read by Vite for the bundle, and by
`vite.config.ts` for the proxy of both `vite` and `vite preview`; there too
the shell wins.

| Variable | Default | Meaning |
|---|---|---|
| `SUDOKU_SOLVER_TIME_LIMIT_S` | `10.0` | Seconds CP-SAT gets per solve, above 0 and at most 60. Also the ceiling: a request's `time_limit_s` can only lower it |
| `SUDOKU_SOLVER_WORKERS` | `1` | Search workers for a single-solution solve, 1 to 16. One is the fastest on 9×9 |
| `SUDOKU_SOLVER_CONCURRENCY` | the CPUs the process may run on | Solves at once; one more gets a 503 with `Retry-After: 1`. The default counts the CPUs the scheduler allows, not a container's CPU limit, so set it in a container |
| `SUDOKU_CORS_ORIGINS` | Vite dev server | JSON list of allowed origins; GET and POST with `Content-Type` only, no credentials |
| `SUDOKU_APP_NAME` | `Sudoku Solver (OR-Tools CP-SAT)` | Title of the docs, and reported by `/` and `/api/health` |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` in the image | uvicorn's own: whose `X-Forwarded-*` headers it believes. compose sets `*`: the port is only on the compose network, but nginx passes on a client's own headers, so the logged address is whatever a local caller sends, which is harmless with the site on 127.0.0.1 only. The cluster sets its pod network |
| `BACKEND_ORIGIN` | `http://api:8000` | Where the container's nginx proxies `/api` (under compose) and the docs paths |
| `VITE_API_BASE_URL` | `/api` | Where the UI sends requests; left empty, it is `/api` too. The image's CSP allows only its own origin, so an API on another origin also needs a `connect-src` for it in `frontend/nginx.conf.template` |
| `VITE_API_DOCS_URL` | `http://127.0.0.1:8000/docs` under `vite`, `/docs` in a build | The footer's API docs link |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8000` | Where the dev and preview servers proxy `/api` |

The API's path is `/api`, fixed; there is no setting for it.

`VITE_API_BASE_URL` and `VITE_API_DOCS_URL` are inlined into the bundle when
it is built, so setting them on a running container changes nothing: pass
them to the image build with `docker build --build-arg`. Everything else is
read when its process starts.

---

## Roadmap

- [ ] Generate puzzles on demand, rather than drawing from a fixed library
- [ ] Explain a solve — surface the propagations, not just the answer
- [ ] Variants: diagonal, killer, hyper — each is a handful of extra constraints
- [x] Containers for both halves, and kustomize overlays to deploy them
- [x] Build and publish arm64 images from CI on every push to `main`
- [x] Browser tests on desktop and phones, run by CI before an image is built
- [x] Run prod by commit rather than `:latest`, and smoke-test the images and
      manifests on every pull request
- [ ] Deploy each green build of `main` by itself, rather than a
      `make deploy` by hand
- [ ] Import a puzzle from a photo
