/**
 * Choosing what to play, above the board.
 *
 * It sits here rather than in the settings panel because on a phone that panel
 * is below the fold: on first load the board is empty and every action is
 * disabled, so the one control that does anything has to be the one you can
 * see. The row is kept to a single line — the level's description is desktop
 * only — because every pixel above the grid pushes the actions down.
 */

import type { Level } from '../api/types'

interface LevelPickerProps {
  levels: Level[]
  level: string
  busy: boolean
  onPickLevel: (level: string) => void
  onShuffle: () => void
}

export default function LevelPicker({
  levels,
  level,
  busy,
  onPickLevel,
  onShuffle,
}: LevelPickerProps) {
  const chosen = levels.find((entry) => entry.key === level)

  return (
    <div className="level-picker">
      <div className="field__inline">
        <select
          className="select"
          aria-label="Difficulty"
          value={level}
          disabled={busy || levels.length === 0}
          onChange={(event) => onPickLevel(event.target.value)}
        >
          <option value="" disabled>
            {levels.length ? 'Choose a difficulty…' : 'Loading…'}
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
    </div>
  )
}
