import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RowBook, margins, place } from '../../plugin/hooks/footing'
import type { Cut, PlaceInput } from '../../plugin/hooks/footing'

const base: PlaceInput = { docked: 'bottom', topless: false, working: false, footing: null, rowId: 'r', component: 'AssistantMessage', cut: undefined }
const at = (over: Partial<PlaceInput>) => place({ ...base, ...over })

// A screen of rows: which one draws the pet? Exactly one, or none.
function drawer(rows: { id: string; component?: string; cut: Cut }[], over: Partial<PlaceInput>): string[] {
  return rows.filter(r => at({ ...over, rowId: r.id, component: r.component ?? 'AssistantMessage', cut: r.cut })).map(r => r.id)
}

test('top dock: the row cut by the top edge holds the pet, and only it', () => {
  const screen = [
    { id: 'old', cut: { first: 7, last: 9, of: 10 } },
    { id: 'mid', cut: { first: 0, last: 4, of: 5 } },
    { id: 'new', cut: { first: 0, last: 3, of: 8 } },
    { id: 'spin', component: 'Spinner', cut: undefined },
  ]
  assert.deepEqual(drawer(screen, { docked: 'top', footing: 'new' }), ['old'])
  assert.deepEqual(drawer(screen, { docked: 'top', footing: 'new', working: true }), ['old'])
})

test('top dock, nothing cut: idle it stands at home at the bottom; working it waits', () => {
  const screen = [{ id: 'a', cut: { first: 0, last: 3, of: 4 } }, { id: 'home', cut: { first: 0, last: 1, of: 2 } }, { id: 'spin', component: 'Spinner', cut: undefined }]
  assert.deepEqual(drawer(screen, { docked: 'top', topless: true, footing: 'home' }), ['home'])
  assert.deepEqual(drawer(screen, { docked: 'top', topless: true, working: true, footing: 'home' }), [])
})

test('bottom dock: at home when it is on screen, on the spinner while working', () => {
  const screen = [{ id: 'a', cut: { first: 3, last: 9, of: 10 } }, { id: 'home', cut: { first: 0, last: 1, of: 2 } }, { id: 'spin', component: 'Spinner', cut: undefined }]
  assert.deepEqual(drawer(screen, { footing: 'home' }), ['home'])
  assert.deepEqual(drawer(screen, { footing: 'home', working: true }), ['spin'])
})

test('bottom dock, scrolled up: the row cut by the bottom edge holds it', () => {
  // Regression: it used to vanish while scrolled up.
  const screen = [{ id: 'a', cut: { first: 2, last: 9, of: 10 } }, { id: 'b', cut: { first: 0, last: 5, of: 30 } }, { id: 'home', cut: null }]
  assert.deepEqual(drawer(screen, { footing: null }), ['b'])
})

test('overlay margins cancel out: the conversation never moves', () => {
  const rows = 7
  for (const cut of [{ first: 3, last: 20, of: 21 }, { first: 0, last: 2, of: 40 }, { first: 39, last: 40, of: 41 }]) {
    for (const layout of ['top-cut', 'bottom-cut'] as const) {
      const m = margins(layout, cut, rows)
      assert.equal(m.marginTop + rows + m.marginBottom, 0, `${layout} ${JSON.stringify(cut)}`)
    }
    // Top: the overlay's first row is the row's first row on screen.
    assert.equal(cut.of + margins('top-cut', cut, rows).marginTop, cut.first)
    // Bottom: the overlay ends on the row's last row on screen.
    assert.equal(cut.of + margins('bottom-cut', cut, rows).marginTop + rows, cut.last + 1)
  }
  assert.deepEqual(margins('above', undefined, rows), { marginTop: -rows, marginBottom: 0 })
})

test('a new "done" row becomes home even when it draws before the turn ends', () => {
  // Regression: home stayed on the prompt row, drawn above it off screen.
  const book = new RowBook()
  book.appended('prompt')
  book.drawn('prompt', 'UserMessage', { first: 0, last: 3, of: 4 })
  book.drawn('reply', 'AssistantMessage', { first: 0, last: 9, of: 10 })
  book.drawn('done', 'TurnDuration', { first: 0, last: 1, of: 2 })
  book.turnEnded()
  assert.equal(book.footing(), 'done')
})

test('a done row drawing again (on a scroll) does not steal home back', () => {
  const book = new RowBook()
  book.drawn('done-1', 'TurnDuration', { first: 0, last: 1, of: 2 })
  book.appended('command')
  book.drawn('command', 'CommandOutput', { first: 0, last: 2, of: 3 })
  book.drawn('done-1', 'TurnDuration', { first: 0, last: 1, of: 2 })
  assert.equal(book.footing(), 'command')
})

test('scrolled away, home is kept but not shown; back on screen, it is', () => {
  const book = new RowBook()
  book.drawn('done', 'TurnDuration', { first: 0, last: 1, of: 2 })
  book.drawn('done', 'TurnDuration', null)
  book.settle()
  assert.equal(book.home, 'done')
  assert.equal(book.footing(), null)
  book.drawn('done', 'TurnDuration', { first: 0, last: 1, of: 2 })
  assert.equal(book.footing(), 'done')
})

test('a home that never draws (stale after a reload) moves to the newest row that does', () => {
  const book = new RowBook()
  book.home = 'stale'
  book.drawn('older', 'AssistantMessage', { first: 0, last: 3, of: 4 })
  book.drawn('done', 'TurnDuration', { first: 0, last: 1, of: 2 })
  book.home = 'stale'
  book.settle()
  assert.equal(book.home, 'done')
})

test('the top row is whichever row last said the top edge cuts it', () => {
  const book = new RowBook()
  book.drawn('a', 'AssistantMessage', { first: 4, last: 9, of: 10 })
  assert.equal(book.topRow, 'a')
  book.drawn('a', 'AssistantMessage', { first: 0, last: 9, of: 10 })
  assert.equal(book.topRow, null)
  book.drawn('s', 'Spinner', { first: 4, last: 9, of: 10 })
  assert.equal(book.topRow, null)
})
