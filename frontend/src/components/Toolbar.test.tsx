import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Level } from '../api/types'
import Toolbar from './Toolbar'

const LEVELS: Level[] = [
  { key: 'blank', label: 'Blank grid', description: 'An empty board.', count: 1 },
  { key: 'easy', label: 'Easy', description: 'Naked singles are enough.', count: 10 },
]

function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const handlers = {
    onPickLevel: vi.fn(),
    onShuffle: vi.fn(),
    onSolve: vi.fn(),
    onCheck: vi.fn(),
    onClear: vi.fn(),
    onToggleUnique: vi.fn(),
  }
  render(
    <Toolbar
      levels={LEVELS}
      level=""
      busy={false}
      isEmpty={false}
      checkUnique
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('the difficulty picker', () => {
  it('offers one option per level, with its size', () => {
    renderToolbar()
    expect(screen.getByRole('option', { name: /Easy · 10 puzzles/ })).toBeDefined()
    // A level holding a single board should not advertise a count.
    expect(screen.getByRole('option', { name: 'Blank grid' })).toBeDefined()
  })

  it('reports the level that was chosen', async () => {
    const user = userEvent.setup()
    const { onPickLevel } = renderToolbar()
    await user.selectOptions(screen.getByRole('combobox'), 'easy')
    expect(onPickLevel).toHaveBeenCalledWith('easy')
  })

  it('explains what the chosen level demands', () => {
    renderToolbar({ level: 'easy' })
    expect(screen.getByText('Naked singles are enough.')).toBeDefined()
  })

  it('says it is loading before the levels arrive', () => {
    renderToolbar({ levels: [] })
    expect(screen.getByRole('option', { name: 'Loading…' })).toBeDefined()
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
  })
})

describe('the actions', () => {
  it('wires each button to its handler', async () => {
    const user = userEvent.setup()
    const { onSolve, onCheck, onClear } = renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onSolve).toHaveBeenCalledOnce()
    expect(onCheck).toHaveBeenCalledOnce()
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('rerolls the current level', async () => {
    const user = userEvent.setup()
    const { onShuffle } = renderToolbar({ level: 'easy' })
    await user.click(screen.getByRole('button', { name: 'New puzzle' }))
    expect(onShuffle).toHaveBeenCalledOnce()
  })

  it('cannot reroll before a level is chosen', () => {
    renderToolbar()
    expect(screen.getByRole('button', { name: 'New puzzle' })).toHaveProperty('disabled', true)
  })

  it('will not solve or check an empty board', () => {
    renderToolbar({ isEmpty: true })
    expect(screen.getByRole('button', { name: 'Solve' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Check' })).toHaveProperty('disabled', true)
  })

  it('locks the controls and says so while solving', () => {
    renderToolbar({ busy: true })
    expect(screen.getByRole('button', { name: 'Solving…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveProperty('disabled', true)
  })
})

describe('the uniqueness switch', () => {
  it('reports when it is turned off', async () => {
    const user = userEvent.setup()
    const { onToggleUnique } = renderToolbar()
    await user.click(screen.getByRole('checkbox'))
    expect(onToggleUnique).toHaveBeenCalledWith(false)
  })
})
