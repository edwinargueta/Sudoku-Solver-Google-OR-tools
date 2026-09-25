import { useEffect, useState } from 'react'

import { getHealth } from './api/client'
import type { Health } from './api/types'
import BoardActions from './components/BoardActions'
import LevelPicker from './components/LevelPicker'
import SolveStats from './components/SolveStats'
import SolverOptions from './components/SolverOptions'
import StatusLine from './components/StatusLine'
import SudokuGrid from './components/SudokuGrid'
import { useSudoku } from './hooks/useSudoku'

// The Vite dev server proxies /api only, so the docs link points at uvicorn.
const DOCS_URL = import.meta.env.VITE_API_DOCS_URL ?? 'http://127.0.0.1:8000/docs'

/** Small badge in the header proving the backend is up and which build it runs. */
function BackendBadge() {
  const [health, setHealth] = useState<Health | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getHealth()
      .then((data) => {
        if (!cancelled) setHealth(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return <span className="badge badge--down">API offline</span>
  if (!health) return <span className="badge">connecting…</span>
  return <span className="badge badge--up">OR-Tools {health.ortools_version}</span>
}

export default function App() {
  const sudoku = useSudoku()

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="header__title">Sudoku Solver</h1>
          <p className="header__subtitle">
            81 variables, 27 all-different constraints, solved by Google OR-Tools CP-SAT.
          </p>
        </div>
        <BackendBadge />
      </header>

      <main className="layout">
        <section className="panel panel--board" aria-label="Board">
          <LevelPicker
            levels={sudoku.levels}
            level={sudoku.level}
            busy={sudoku.busy}
            onPickLevel={sudoku.loadLevel}
            onShuffle={sudoku.shuffle}
          />
          <SudokuGrid
            grid={sudoku.displayGrid}
            givens={sudoku.givens}
            locked={sudoku.locked}
            conflictedCells={sudoku.conflictedCells}
            readOnly={sudoku.busy}
            onChange={sudoku.updateCell}
          />
          <BoardActions
            busy={sudoku.busy}
            isEmpty={sudoku.isEmpty}
            canUndo={sudoku.canUndo}
            onSolve={sudoku.solve}
            onCheck={sudoku.check}
            onUndo={sudoku.undo}
            onClear={sudoku.clear}
          />
          <StatusLine status={sudoku.status} />
          <p className="hint">Type 1–9, arrow keys to move, Backspace to clear a cell.</p>
        </section>

        <section className="panel" aria-label="Controls">
          <SolverOptions
            busy={sudoku.busy}
            checkUnique={sudoku.checkUnique}
            onToggleUnique={sudoku.setCheckUnique}
          />
          <SolveStats stats={sudoku.stats} />
        </section>
      </main>

      <footer className="footer">
        <a href={DOCS_URL} target="_blank" rel="noreferrer">
          API docs
        </a>
        <span>·</span>
        <a href="https://developers.google.com/optimization/cp/cp_solver" target="_blank" rel="noreferrer">
          CP-SAT reference
        </a>
      </footer>
    </div>
  )
}
