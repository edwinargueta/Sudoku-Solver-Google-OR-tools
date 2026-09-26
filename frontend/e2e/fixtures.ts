/**
 * `test` with a board already on screen, and the API's random draw pinned.
 *
 * Every spec imports `test` and `expect` from here rather than from
 * @playwright/test, so each test starts on a loaded page and fails if React
 * threw along the way.
 */

import { test as base, expect } from '@playwright/test'

import { Board } from './board'

interface Fixtures {
  /** On unless a test says otherwise with test.use({ pinPuzzles: false }). */
  pinPuzzles: boolean
  board: Board
}

export const test = base.extend<Fixtures>({
  pinPuzzles: [true, { option: true }],

  board: async ({ page, hasTouch, pinPuzzles }, use) => {
    // The random route takes no seed, so a test could never say which clue is
    // where. Sending it to the level's first puzzle keeps the real backend in
    // the loop and makes the board known. Blank has only the one, keyed blank.
    if (pinPuzzles) {
      await page.route('**/api/levels/*/random', (route) => {
        const url = route.request().url()
        return url.includes('/levels/blank/')
          ? route.continue()
          : route.continue({ url: url.replace(/\/levels\/([^/]+)\/random$/, '/puzzles/$1-1') })
      })
    }

    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))

    await page.goto('/')
    // The picker stays off until the list of levels arrives: the app's own "ready".
    await expect(page.getByRole('combobox', { name: 'Difficulty' })).toBeEnabled()

    await use(new Board(page, hasTouch))

    expect(errors, 'uncaught errors in the page').toEqual([])
  },
})

export { expect }
