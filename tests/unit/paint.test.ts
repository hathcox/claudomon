import assert from 'node:assert/strict'
import { test } from 'node:test'

import { H, W, hashSeed, makeGenome } from '../../plugin/hooks/genome'
import { paint, toRuns, toStrips } from '../../plugin/hooks/paint'
import { shade } from '../../plugin/hooks/shade'
import type { Action, Pose } from '../../plugin/types'

const ACTIONS: Action[] = ['idle', 'think', 'read', 'search', 'eat', 'poop', 'tinker']
const EXTRAS: Partial<Pose>[] = [
  {}, { blinking: true }, { sleeping: true }, { walking: true }, { gaze: { x: -1, y: -1 } },
  { gaze: { x: 1, y: 1 } }, { emote: 'jump', emoteFrame: 3 }, { emote: 'heart', emoteFrame: 2 },
  { emote: 'happy', emoteFrame: 1 }, { emote: 'wiggle', emoteFrame: 1 }, { typing: { side: 0 } }, { typing: { side: 1 } },
]
const HEX = /^#[0-9a-f]{6}$/

function* frames() {
  for (let i = 0; i < 12; i++) {
    const g = makeGenome(hashSeed(`seed-${i}`))
    for (const action of ACTIONS) {
      for (const extra of EXTRAS) {
        for (const frame of [0, 1, 7, 33]) {
          const pose: Pose = { frame, action, sleeping: false, gaze: null, emote: null, emoteFrame: 0, blinking: false, ...extra }
          yield { g, pose, label: `seed-${i} ${action} ${JSON.stringify(extra)} f${frame}` }
        }
      }
    }
  }
}

test('every pose paints a full canvas of real colours', () => {
  for (const { g, pose, label } of frames()) {
    for (const px of [paint(g, pose), shade(paint(g, pose), g)]) {
      assert.equal(px.length, W * H, label)
      for (const c of px) assert.ok(c === null || HEX.test(c), `${label}: bad colour ${c}`)
    }
  }
})

test('cell rows are exactly the canvas wide, two pixels per cell', () => {
  for (const { g, pose, label } of frames()) {
    for (const solid of [false, true]) {
      const rows = toRuns(paint(g, pose), solid)
      assert.equal(rows.length, H / 2, label)
      for (const runs of rows) assert.equal(runs.reduce((n, r) => n + r.text.length, 0), W, label)
    }
  }
})

test('strips paint only the pet: inside the canvas, never a bare empty run', () => {
  for (const { g, pose, label } of frames()) {
    for (const strip of toStrips(paint(g, pose), true)) {
      const width = strip.runs.reduce((n, r) => n + r.text.length, 0)
      assert.ok(strip.left >= 0 && strip.left + width <= W, label)
      assert.ok(strip.row >= 0 && strip.row < H / 2, label)
      for (const r of strip.runs) assert.ok(r.fg !== undefined || r.bg !== undefined, `${label}: empty run in a strip`)
    }
  }
})

test('Apple Terminal encoding never uses a bare full block', () => {
  for (const { g, pose } of frames()) {
    for (const runs of toRuns(paint(g, pose), true)) for (const r of runs) assert.ok(!r.text.includes('█'))
  }
})
