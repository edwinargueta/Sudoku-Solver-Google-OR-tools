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
    <BoardActions busy={false} isEmpty={false} canUndo={false} {...handlers} {...overrides} />,
  )
  return handlers
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
    expect(screen.getByRole('button', { name: 'Solve' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Check Moves' })).toHaveProperty('disabled', true)
  })

  it('leaves Clear available on an empty board', () => {
    renderActions({ isEmpty: true })
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveProperty('disabled', false)
  })

  it('locks the controls and says so while solving', () => {
    renderActions({ busy: true })
    expect(screen.getByRole('button', { name: 'Solving…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveProperty('disabled', true)
  })
})

describe('undo', () => {
  it('is unavailable until a move has been made', () => {
    renderActions()
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true)
  })

  it('takes back the last move once there is one', async () => {
    const user = userEvent.setup()
    const { onUndo } = renderActions({ canUndo: true })
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('is locked while the solver is running', () => {
    renderActions({ canUndo: true, busy: true })
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true)
  })
})
