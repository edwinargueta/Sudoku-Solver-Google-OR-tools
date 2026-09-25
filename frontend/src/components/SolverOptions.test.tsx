import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import SolverOptions from './SolverOptions'

function renderOptions(overrides: Partial<Parameters<typeof SolverOptions>[0]> = {}) {
  const onToggleUnique = vi.fn()
  render(<SolverOptions busy={false} checkUnique onToggleUnique={onToggleUnique} {...overrides} />)
  return { onToggleUnique }
}

describe('the uniqueness switch', () => {
  it('reports when it is turned off', async () => {
    const user = userEvent.setup()
    const { onToggleUnique } = renderOptions()
    await user.click(screen.getByRole('checkbox'))
    expect(onToggleUnique).toHaveBeenCalledWith(false)
  })

  it('is locked while the solver is running', () => {
    renderOptions({ busy: true })
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true)
  })

  it('carries none of the board actions', () => {
    renderOptions()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
