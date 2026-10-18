import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import StatusLine from './StatusLine'

describe('the status line', () => {
  it('shows the message and carries its kind into the class', () => {
    render(<StatusLine status={{ kind: 'error', message: 'No solution exists.', id: 1 }} />)
    const message = screen.getByRole('status')
    expect(message.textContent).toBe('No solution exists.')
    expect(message.className).toContain('status__message--error')
  })

  it('is a live region, so a check with nothing to repaint still announces', () => {
    render(<StatusLine status={{ kind: 'ok', message: 'No conflicts · 30 of 81 filled.', id: 1 }} />)
    expect(screen.getByRole('status').textContent).toContain('30 of 81')
  })

  it('replaces the message when the same words are said again, so they are read out again', () => {
    const status = { kind: 'ok', message: 'No conflicts · 30 of 81 filled.' } as const
    const { rerender } = render(<StatusLine status={{ ...status, id: 1 }} />)
    const region = screen.getByRole('status')
    const first = region.firstChild

    rerender(<StatusLine status={{ ...status, id: 2 }} />)
    expect(screen.getByRole('status'), 'the live region itself stays').toBe(region)
    expect(region.firstChild).not.toBe(first)
    expect(region.textContent).toBe(status.message)
  })

  it('leaves the message alone when nothing new was said', () => {
    const status = { kind: 'idle', message: 'Type a puzzle, or pick a difficulty.', id: 3 } as const
    const { rerender } = render(<StatusLine status={status} />)
    const first = screen.getByRole('status').firstChild
    rerender(<StatusLine status={{ ...status }} />)
    expect(screen.getByRole('status').firstChild).toBe(first)
  })
})
