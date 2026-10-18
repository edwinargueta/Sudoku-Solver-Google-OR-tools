import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import BoardActions from './BoardActions'

function renderActions(overrides: Partial<Parameters<typeof BoardActions>[0]> = {}) {
  const handlers = {
    onSolve: vi.fn(),
    onCheck: vi.fn(),
    onUndo: vi.fn(),
    onClear: vi.fn(),
  }
  render(
    <BoardActions
      busy={false}
      solving={false}
      isEmpty={false}
      solved={false}
      canUndo={false}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

describe('the group', () => {
  it('is announced as the board actions group', () => {
    renderActions()
    expect(screen.getByRole('group', { name: 'Board actions' })).toBeDefined()
  })

  it('offers exactly four, in the order they are reached for', () => {
    renderActions()
    const group = screen.getByRole('group', { name: 'Board actions' })
    const labels = within(group)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual(['Solve', 'Check Moves', 'Undo', 'Clear'])
  })
})

describe('the actions', () => {
  it('wires each button to its handler', async () => {
    const user = userEvent.setup()
    const { onSolve, onCheck, onClear } = renderActions()
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    await user.click(screen.getByRole('button', { name: 'Check Moves' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onSolve).toHaveBeenCalledOnce()
    expect(onCheck).toHaveBeenCalledOnce()
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('will not solve or check an empty board', () => {
    renderActions({ isEmpty: true })
    expect(button('Solve')).toHaveProperty('disabled', true)
    expect(button('Check Moves')).toHaveProperty('disabled', true)
  })

  it('leaves Clear available on an empty board', () => {
    renderActions({ isEmpty: true })
    expect(button('Clear')).toHaveProperty('disabled', false)
    expect(button('Clear').getAttribute('aria-disabled')).toBe('false')
  })

  it('says so while solving', () => {
    renderActions({ busy: true, solving: true })
    expect(button('Solving…')).toBeDefined()
  })

  it('does not claim to be solving while a puzzle is dealt or a check runs', () => {
    renderActions({ busy: true, solving: false })
    expect(button('Solve')).toBeDefined()
  })

  it('will not check the solver\'s own answer', () => {
    renderActions({ solved: true })
    expect(button('Check Moves')).toHaveProperty('disabled', true)
    expect(button('Solve')).toHaveProperty('disabled', false)
  })
})

describe('while a request is out', () => {
  // Disabling the button that was just pressed would drop focus to the page.
  it('marks every action unavailable without disabling it', () => {
    renderActions({ busy: true, solving: true, canUndo: true })
    for (const name of ['Solving…', 'Check Moves', 'Undo', 'Clear']) {
      expect(button(name).disabled, name).toBe(false)
      expect(button(name).getAttribute('aria-disabled'), name).toBe('true')
    }
  })

  it('ignores presses', async () => {
    const user = userEvent.setup()
    const handlers = renderActions({ busy: true, solving: true, canUndo: true })
    for (const name of ['Solving…', 'Check Moves', 'Undo', 'Clear']) await user.click(button(name))
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })
})

describe('undo', () => {
  // aria-disabled rather than disabled: taking back the last move would
  // otherwise disable the button in the player's hand.
  it('is unavailable until a move has been made', async () => {
    const user = userEvent.setup()
    const { onUndo } = renderActions()
    expect(button('Undo').getAttribute('aria-disabled')).toBe('true')
    await user.click(button('Undo'))
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('takes back the last move once there is one', async () => {
    const user = userEvent.setup()
    const { onUndo } = renderActions({ canUndo: true })
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('is locked while the solver is running', () => {
    renderActions({ canUndo: true, busy: true })
    expect(button('Undo').getAttribute('aria-disabled')).toBe('true')
  })
})
