/** How hard the solver should look. Everything you do to the board is elsewhere. */

interface SolverOptionsProps {
  busy: boolean
  checkUnique: boolean
  onToggleUnique: (checked: boolean) => void
}

export default function SolverOptions({ busy, checkUnique, onToggleUnique }: SolverOptionsProps) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checkUnique}
        disabled={busy}
        onChange={(event) => onToggleUnique(event.target.checked)}
      />
      <span>
        Check uniqueness
        <small>Asks CP-SAT for a second solution — slower, but proves the puzzle is well-posed.</small>
      </span>
    </label>
  )
}
