import assert from 'node:assert/strict'
import { test } from 'node:test'

import { H, W, hashSeed, levelOf, makeGenome } from '../../plugin/hooks/genome'

const SEEDS = Array.from({ length: 200 }, (_, i) => `git@github.com:someone/project-${i}.git`)

test('the same project always hatches the same mon', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    assert.deepEqual(makeGenome(hashSeed(seed)), makeGenome(hashSeed(seed)))
  }
})

test('different projects hatch different mons', () => {
  const looks = new Set(SEEDS.map(s => makeGenome(hashSeed(s)).sprite.join('|')))
  assert.ok(looks.size > SEEDS.length * 0.9, `only ${looks.size} distinct sprites in ${SEEDS.length}`)
})

test('every sprite fits its canvas and keeps its eyes on its body', () => {
  for (const seed of SEEDS) {
    const g = makeGenome(hashSeed(seed))
    assert.equal(g.sprite.length, H)
    for (const row of g.sprite) assert.equal(row.length, W)
    for (const x of [g.eyes.left, g.eyes.right]) {
      for (let dx = 0; dx < g.eyes.size; dx++) {
        assert.notEqual(g.sprite[g.eyes.y]![x + dx], '.', `${seed}: eye off the body`)
      }
    }
    assert.ok(g.mouthY > g.eyes.y && g.mouthY <= g.bottom, `${seed}: mouth outside the face`)
  }
})

test('levels start at 50 xp and widen by 50 each', () => {
  assert.deepEqual(levelOf(0), { level: 1, into: 0, span: 50 })
  assert.deepEqual(levelOf(49), { level: 1, into: 49, span: 50 })
  assert.deepEqual(levelOf(50), { level: 2, into: 0, span: 100 })
  assert.deepEqual(levelOf(150), { level: 3, into: 0, span: 150 })
  let last = 0
  for (let xp = 0; xp < 5000; xp += 7) {
    const { level, into, span } = levelOf(xp)
    assert.ok(level >= last && into >= 0 && into < span)
    last = level
  }
})
