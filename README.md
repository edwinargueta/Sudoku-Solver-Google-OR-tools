# Sudoku Solver · Google OR-Tools CP-SAT

A Sudoku solver with no search code in it. The rules are stated as constraints,
[Google OR-Tools](https://developers.google.com/optimization) CP-SAT does the
solving, and a React front end lets you watch it happen.

**Stack:** FastAPI + OR-Tools on the backend, React (Vite) on the front end.

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
├── backend/
│   ├── app/
│   │   ├── main.py             # app factory, CORS, router wiring
│   │   ├── config.py           # settings, SUDOKU_-prefixed env vars
│   │   ├── api/routes.py       # /health, /puzzles, /levels, /solve, /validate
│   │   ├── models/schemas.py   # Pydantic request and response contracts
│   │   └── sudoku/
│   │       ├── board.py        # grid vocabulary: parse, format, conflicts
│   │       ├── puzzles.py      # graded puzzle library, ten per level
│   │       └── solver.py       # the CP-SAT model  ← the interesting file
│   └── tests/                  # 209 tests: board, solver, HTTP contract
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── api/client.js       # typed-ish fetch wrapper, one place for errors
    │   ├── hooks/useSudoku.js  # all board state and API traffic
    │   ├── lib/grid.js         # pure grid helpers
    │   └── components/         # SudokuGrid, Toolbar, StatusPanel
    └── vite.config.js
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

209 tests in three layers, each able to fail on its own:

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

---

## Roadmap

- [ ] Generate puzzles on demand, rather than drawing from a fixed library
- [ ] Explain a solve — surface the propagations, not just the answer
- [ ] Variants: diagonal, killer, hyper — each is a handful of extra constraints
- [ ] Dockerfile and a deploy target for the API
- [ ] Import a puzzle from a photo
