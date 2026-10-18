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
  const handlers = { onPickLevel: vi.fn(), onShuffle: vi.fn(), onRetry: vi.fn() }
  const props = {
    levels: LEVELS,
    level: '',
    busy: false,
    failed: false,
    loading: false,
    ...handlers,
    ...overrides,
  }
  const view = render(<LevelPicker {...props} />)
  return { ...handlers, props, rerender: view.rerender }
}

function picker(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Difficulty' }) as HTMLSelectElement
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
    renderPicker({ levels: [], loading: true })
    expect(screen.getByRole('option', { name: 'Loading…' })).toBeDefined()
    expect(picker()).toHaveProperty('disabled', true)
  })

  // A player who cancels the prompt about losing their moves keeps the level
  // they were on, so the picker has to go back to saying so.
  it('stays on the current level when the pick is turned down', async () => {
    const user = userEvent.setup()
    const { onPickLevel } = renderPicker({ level: 'easy' })
    await user.selectOptions(picker(), 'blank')
    expect(onPickLevel).toHaveBeenCalledWith('blank')
    expect(picker().value).toBe('easy')
  })
})

describe('while a puzzle is being dealt', () => {
  // Disabling the select in the player's hand would drop focus to the page,
  // and a keyboard's type-ahead is exactly what deals from it.
  it('stays enabled, and focused, but says it is unavailable', () => {
    const { props, rerender } = renderPicker({ level: 'easy' })
    picker().focus()
    rerender(<LevelPicker {...props} busy />)
    expect(picker().disabled).toBe(false)
    expect(picker().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(picker())
  })

  it('ignores another pick until the first has landed', async () => {
    const user = userEvent.setup()
    const { onPickLevel } = renderPicker({ level: 'easy', busy: true })
    await user.selectOptions(picker(), 'blank')
    expect(onPickLevel).not.toHaveBeenCalled()
    expect(picker().value).toBe('easy')
  })
})

describe('when the levels could not be loaded', () => {
  it('says so, rather than claiming to still be loading', () => {
    renderPicker({ levels: [], failed: true })
    expect(screen.getByRole('option', { name: 'Could not load the levels' })).toBeDefined()
    expect(screen.queryByRole('option', { name: 'Loading…' })).toBeNull()
  })

  it('offers a retry in place of New puzzle', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderPicker({ levels: [], failed: true })
    expect(screen.queryByRole('button', { name: 'New puzzle' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('does not retry twice at once', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderPicker({ levels: [], failed: true, loading: true })
    expect(screen.getByRole('option', { name: 'Loading…' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('leaves focus on the button once a retry brings the levels', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderPicker({ levels: [], failed: true })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    const retry = document.activeElement
    rerender(<LevelPicker {...props} levels={LEVELS} failed={false} />)
    expect(document.activeElement).toBe(retry)
    expect(retry?.textContent).toBe('New puzzle')
  })
})

describe('New puzzle', () => {
  it('rerolls the current level', async () => {
    const user = userEvent.setup()
    const { onShuffle } = renderPicker({ level: 'easy' })
    await user.click(screen.getByRole('button', { name: 'New puzzle' }))
    expect(onShuffle).toHaveBeenCalledOnce()
  })

  it('cannot reroll before a level is chosen', async () => {
    const user = userEvent.setup()
    const { onShuffle } = renderPicker()
    const button = screen.getByRole('button', { name: 'New puzzle' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await user.click(button)
    expect(onShuffle).not.toHaveBeenCalled()
  })

  it('is locked while a request is out, without losing focus', async () => {
    const user = userEvent.setup()
    const { onShuffle } = renderPicker({ level: 'easy', busy: true })
    const button = screen.getByRole('button', { name: 'New puzzle' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await user.click(button)
    expect(onShuffle).not.toHaveBeenCalled()
  })
})
