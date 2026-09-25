import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import StatusLine from './StatusLine'

describe('the status line', () => {
  it('shows the message and carries its kind into the class', () => {
    render(<StatusLine status={{ kind: 'error', message: 'No solution exists.' }} />)
    const message = screen.getByRole('status')
    expect(message.textContent).toBe('No solution exists.')
    expect(message.className).toContain('status__message--error')
  })

  it('is a live region, so a check with nothing to repaint still announces', () => {
    render(<StatusLine status={{ kind: 'ok', message: 'No conflicts · 30 of 81 filled.' }} />)
    expect(screen.getByRole('status').textContent).toContain('30 of 81')
  })
})
