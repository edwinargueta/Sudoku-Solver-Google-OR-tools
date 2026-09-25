import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Level } from '../api/types'
import LevelPicker from './LevelPicker'

const LEVELS: Level[] = [
  { key: 'blank', label: 'Blank grid', description: 'An empty board.', count: 1 },
  { key: 'easy', label: 'Easy', description: 'Naked singles are enough.', count: 10 },
]

function renderPicker(overrides: Partial<Parameters<typeof LevelPicker>[0]> = {}) {
  const handlers = { onPickLevel: vi.fn(), onShuffle: vi.fn() }
  render(<LevelPicker levels={LEVELS} level="" busy={false} {...handlers} {...overrides} />)
  return handlers
}

describe('the difficulty picker', () => {
  it('offers one option per level, with its size', () => {
    renderPicker()
    expect(screen.getByRole('option', { name: /Easy · 10 puzzles/ })).toBeDefined()
    // A level holding a single board should not advertise a count.
    expect(screen.getByRole('option', { name: 'Blank grid' })).toBeDefined()
  })

  it('is named for screen readers even without a visible label', () => {
    renderPicker()
    expect(screen.getByRole('combobox', { name: 'Difficulty' })).toBeDefined()
  })

  it('invites a choice before one is made', () => {
    renderPicker()
    expect(screen.getByRole('option', { name: 'Choose a difficulty…' })).toBeDefined()
  })

  it('reports the level that was chosen', async () => {
    const user = userEvent.setup()
    const { onPickLevel } = renderPicker()
    await user.selectOptions(screen.getByRole('combobox'), 'easy')
    expect(onPickLevel).toHaveBeenCalledWith('easy')
  })

  it('explains what the chosen level demands', () => {
    renderPicker({ level: 'easy' })
    expect(screen.getByText('Naked singles are enough.')).toBeDefined()
  })

  it('says it is loading before the levels arrive', () => {
    renderPicker({ levels: [] })
    expect(screen.getByRole('option', { name: 'Loading…' })).toBeDefined()
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
  })
})

describe('New puzzle', () => {
  it('rerolls the current level', async () => {
    const user = userEvent.setup()
    const { onShuffle } = renderPicker({ level: 'easy' })
    await user.click(screen.getByRole('button', { name: 'New puzzle' }))
    expect(onShuffle).toHaveBeenCalledOnce()
  })

  it('cannot reroll before a level is chosen', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: 'New puzzle' })).toHaveProperty('disabled', true)
  })

  it('is locked while the solver is running', () => {
    renderPicker({ level: 'easy', busy: true })
    expect(screen.getByRole('button', { name: 'New puzzle' })).toHaveProperty('disabled', true)
  })
})
