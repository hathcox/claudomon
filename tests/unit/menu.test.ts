import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hashSeed, makeGenome } from '../../plugin/hooks/genome'
import { BUTTONS, MENU_ROWS, MENU_WIDTH, buildMenu, hotspotAt } from '../../plugin/hooks/menu'
import type { MenuInfo } from '../../plugin/hooks/menu'

const p = makeGenome(hashSeed('menu')).palette
const info = (over: Partial<MenuInfo> = {}): MenuInfo => ({
  name: 'Pip', species: 'Quooo', level: 3, into: 53, span: 150, ageDays: 4, bestWpm: 88,
  stats: { prompts: 12, reads: 40, searches: 22, eaten: 310, pooped: 12_345, tinkers: 3, launches: 5, keys: 999, pets: 7 },
  ...over,
})

test('the card is always its full size, every row exactly its width', () => {
  for (const hover of [null, 'close', 'reads', 'rename', 'hide', 'xp']) {
    for (const name of [null, 'Pip', 'A really very long name for a very small creature']) {
      const m = buildMenu(info({ name }), p, hover)
      assert.equal(m.rows.length, MENU_ROWS)
      for (const runs of m.rows) assert.equal(runs.reduce((n, r) => n + r.text.length, 0), MENU_WIDTH, `${name} ${hover}`)
    }
  }
})

test('hotspots stay inside the card and never overlap', () => {
  const m = buildMenu(info(), p, null)
  for (const s of m.spots) assert.ok(s.from >= 0 && s.to <= MENU_WIDTH && s.from < s.to && s.row >= 0 && s.row < MENU_ROWS)
  for (const a of m.spots) for (const b of m.spots) {
    if (a !== b && a.row === b.row) assert.ok(a.to <= b.from || b.to <= a.from, `${a.id} overlaps ${b.id}`)
  }
})

test('every button can be hit, and its tooltip shows when hovered', () => {
  const m = buildMenu(info(), p, null)
  for (const b of BUTTONS) {
    const spot = m.spots.find(s => s.id === b.id)!
    assert.equal(hotspotAt(m, spot.row, spot.from), b.id)
    const hovered = buildMenu(info(), p, b.id)
    const footer = hovered.rows[MENU_ROWS - 1]!.map(r => r.text).join('')
    assert.ok(footer.includes(b.tip.slice(0, 20)), `${b.id}: tooltip missing`)
  }
  assert.equal(hotspotAt(m, 5, 2), null)
})

test('big numbers stay short', () => {
  const row = buildMenu(info(), p, null).rows[3]!.map(r => r.text).join('')
  assert.ok(row.includes('12k'), row)
})
