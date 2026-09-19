/** Difficulty picker and the actions that drive the solver. */

export default function Toolbar({
  levels,
  level,
  busy,
  isEmpty,
  checkUnique,
  onPickLevel,
  onShuffle,
  onSolve,
  onCheck,
  onClear,
  onToggleUnique,
}) {
  const chosen = levels.find((entry) => entry.key === level)

  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <label className="field">
          <span className="field__label">Difficulty</span>
          <div className="field__inline">
            <select
              className="select"
              value={level}
              disabled={busy || levels.length === 0}
              onChange={(event) => onPickLevel(event.target.value)}
            >
              <option value="" disabled>
                {levels.length ? 'Choose…' : 'Loading…'}
              </option>
              {levels.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                  {entry.count > 1 ? ` · ${entry.count} puzzles` : ''}
                </option>
              ))}
            </select>
            {/* Re-picking the same option fires no change event, so rerolling needs a button. */}
            <button className="button button--ghost" onClick={onShuffle} disabled={busy || !level}>
              New puzzle
            </button>
          </div>
          {chosen ? <small className="field__hint">{chosen.description}</small> : null}
        </label>
      </div>

      <div className="toolbar__row toolbar__row--buttons">
        <button className="button button--primary" onClick={onSolve} disabled={busy || isEmpty}>
          {busy ? 'Solving…' : 'Solve'}
        </button>
        <button className="button" onClick={onCheck} disabled={busy || isEmpty}>
          Check
        </button>
        <button className="button button--ghost" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>

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
    </div>
  )
}
