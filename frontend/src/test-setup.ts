/**
 * Unmount whatever a test rendered before the next one runs.
 *
 * Testing Library registers this itself when a runner exposes `afterEach`
 * globally. Tests here import their helpers explicitly, so it does not, and
 * without this every render would pile up in the same document.
 */

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
