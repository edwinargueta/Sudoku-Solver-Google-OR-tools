/**
 * The board, as a player sees it.
 *
 * Tests say what a player does — put a 7 in row 1, column 3 — and this decides
 * how: typed on a keyboard, or tapped on the number pad on a touch screen. It
 * is the only file that knows how a move is made or names a CSS class.
 *
 * Rows and columns count from 1, as the cells' labels and the status line do.
 */

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

// State with no ARIA of its own, kept here so a renamed class is a one-file change.
export const SELECTED = /\bcell--selected\b/
export const LOCKED = /\bcell--locked\b/
export const CONFLICT = /\bcell--conflict\b/

type Action = 'Solve' | 'Check Moves' | 'Undo' | 'Clear'

export class Board {
  readonly picker: Locator
  readonly grid: Locator
  readonly pad: Locator
  readonly erase: Locator
  readonly actions: Locator
  readonly status: Locator
  readonly announcer: Locator
  readonly badge: Locator

  constructor(
    readonly page: Page,
    readonly touch: boolean,
  ) {
    this.picker = page.getByRole('combobox', { name: 'Difficulty' })
    this.grid = page.getByRole('grid', { name: 'Sudoku board' })
    this.pad = page.getByRole('group', { name: 'Number pad' })
    this.erase = this.pad.getByRole('button', { name: 'Erase', exact: true })
    this.actions = page.getByRole('group', { name: 'Board actions' })
    this.status = page.getByRole('status')
    this.announcer = this.pad.locator('[aria-live="polite"]')
    this.badge = page.locator('.badge')
  }

  cell(row: number, col: number): Locator {
    return this.page.getByRole('textbox', { name: `row ${row} column ${col}`, exact: true })
  }

  key(digit: number): Locator {
    return this.pad.getByRole('button', { name: String(digit), exact: true })
  }

  action(name: Action): Locator {
    return this.actions.getByRole('button', { name, exact: true })
  }

  /**
   * Pick a difficulty and wait for its puzzle. The picker is switched off
   * while the request is out, so it coming back on is the signal; the status
   * alone is not, since dealing the same puzzle twice leaves it unchanged.
   */
  async deal(level = 'easy'): Promise<void> {
    await this.picker.selectOption(level)
    await expect(this.picker).toBeEnabled()
    await expect(this.status).toHaveText(/^Loaded /)
  }

  async newPuzzle(): Promise<void> {
    await this.page.getByRole('button', { name: 'New puzzle' }).click()
    await expect(this.picker).toBeEnabled()
    await expect(this.status).toHaveText(/^Loaded /)
  }

  /** Tapped on a touch screen, clicked otherwise; always the cell's centre. */
  async choose(row: number, col: number): Promise<void> {
    if (this.touch) await this.cell(row, col).tap()
    else await this.cell(row, col).click()
  }

  async press(name: Action): Promise<void> {
    if (this.touch) await this.action(name).tap()
    else await this.action(name).click()
  }

  /** A move the board should take: typed, or tapped on the pad. */
  async enter(row: number, col: number, digit: number): Promise<void> {
    await this.choose(row, col)
    if (this.touch) await this.key(digit).tap()
    else await this.page.keyboard.press(String(digit))
  }

  async empty(row: number, col: number): Promise<void> {
    await this.choose(row, col)
    if (this.touch) await this.erase.tap()
    else await this.page.keyboard.press('Backspace')
  }

  /**
   * A move the board should refuse, such as a digit on one of the puzzle's
   * clues. On a touch screen the pad is switched off then, and Playwright's
   * tap() waits for a switched-off button to come back on; tapping the key's
   * centre on the screen itself skips that wait but sends the same touches.
   */
  async attempt(row: number, col: number, digit: number): Promise<void> {
    await this.choose(row, col)
    if (this.touch) await this.tapAnyway(this.key(digit))
    else await this.page.keyboard.press(String(digit))
  }

  async tapAnyway(target: Locator): Promise<void> {
    const { x, y, width, height } = await this.box(target)
    await this.page.touchscreen.tap(x + width / 2, y + height / 2)
  }

  /** The whole board, one string a row, '.' for an empty cell. */
  async rows(): Promise<string[]> {
    const values = await this.grid
      .getByRole('textbox')
      .evaluateAll((cells) => cells.map((cell) => (cell as HTMLInputElement).value || '.'))
    return Array.from({ length: 9 }, (_, row) => values.slice(row * 9, row * 9 + 9).join(''))
  }

  /** A bounding box, or a failure that names what was not on screen. */
  async box(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await target.boundingBox()
    if (!box) throw new Error(`not rendered: ${target}`)
    return box
  }
}
