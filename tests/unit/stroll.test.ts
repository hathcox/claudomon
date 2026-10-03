import assert from 'node:assert/strict'
import { test } from 'node:test'

import { W, hashSeed, makeGenome } from '../../plugin/hooks/genome'
import { drop, grab, hitTest, homeOf, isPetted, isTyping, liftOf, pointAt, poseOf, startStroll, tap, tickStroll } from '../../plugin/hooks/stroll'
import type { Stroll } from '../../plugin/hooks/stroll'

const g = makeGenome(hashSeed('git@github.com:example/stroll.git'))
const COLS = 80

function run(s: Stroll, ticks: number, action: Parameters<typeof tickStroll>[2] = 'idle'): Stroll {
  for (let i = 0; i < ticks; i++) s = tickStroll(s, g, action, COLS)
  return s
}

test('it starts docked at the top, at the right edge of the window', () => {
  const s = run(startStroll(), 1)
  assert.equal(s.dock, 'top')
  assert.equal(s.x, COLS - W)
})

test('wandering never leaves its home stretch', () => {
  let s = run(startStroll(), 1)
  const { min, max } = homeOf(COLS, s)
  for (let i = 0; i < 3000; i++) {
    s = tickStroll(s, g, 'idle', COLS)
    assert.ok(s.x >= min && s.x <= max, `x=${s.x} outside ${min}..${max} at tick ${i}`)
  }
})

test('busy, it stands still and does its action', () => {
  const s = run(startStroll(), 20)
  const later = run(s, 200, 'read')
  assert.equal(later.x, s.x)
  assert.equal(poseOf(later, g, 'read').walking, false)
})

test('dropped well up it docks at the top, well down at the bottom, else stays', () => {
  const s = grab(run(startStroll(), 5))
  assert.equal(drop(s, -10, -6, COLS).dock, 'top')
  assert.equal(drop({ ...s, dock: 'top' }, -10, 6, COLS).dock, 'bottom')
  assert.equal(drop({ ...s, dock: 'bottom' }, -10, 1, COLS).dock, 'bottom')
})

test('a drop becomes its new home and is clamped to the window', () => {
  const s = grab(run(startStroll(), 5))
  const far = drop(s, -500, 0, COLS)
  assert.equal(far.x, 0)
  assert.equal(far.homeX, 0)
  const home = homeOf(COLS, far)
  assert.ok(home.min === 0 && home.max <= 8)
  assert.equal(drop(s, 500, 0, COLS).x, COLS - W)
  assert.equal(drop(s, 0, 0, COLS).drag, null)
})

test('held, it does not wander', () => {
  const s = grab(run(startStroll(), 5))
  assert.equal(run(s, 100).x, s.x)
})

test('each keystroke brings the other paw down; typing stops after a pause', () => {
  let s = run(startStroll(), 3)
  s = tap(s)
  assert.equal(poseOf(s, g, 'idle').typing?.side, 0)
  s = tap(s)
  assert.equal(poseOf(s, g, 'idle').typing?.side, 1)
  assert.equal(poseOf(s, g, 'idle').walking, false)
  assert.ok(isTyping(s))
  s = run(s, 20)
  assert.ok(!isTyping(s))
  assert.equal(poseOf(s, g, 'idle').typing, null)
})

test('typing wakes it up', () => {
  let s = run(startStroll(), 2000)
  assert.ok(poseOf(s, g, 'idle').sleeping)
  s = tap(s)
  assert.ok(!poseOf(s, g, 'idle').sleeping)
})

test('a launch flies to the far side of home, peaks mid-flight and lands', () => {
  let s = run(startStroll(), 1)
  const { min } = homeOf(COLS, s)
  s = pointAt(s, s.x + g.cx, 4, 'pet', 'launch', COLS)
  assert.ok(s.flight)
  let peak = 0
  for (let i = 0; i < 20; i++) {
    s = tickStroll(s, g, 'idle', COLS)
    peak = Math.max(peak, liftOf(s))
  }
  assert.equal(s.flight, null)
  assert.equal(s.x, min)
  assert.ok(peak >= 4)
})

test('hit testing follows each dock layout', () => {
  const s = { ...run(startStroll(), 1), x: 10 }
  const centre = s.x + g.cx
  // Bottom: tag row 0, pet rows 1..6.
  assert.equal(hitTest(s, g, centre, 0.5, 10, 1, 0), 'tag')
  assert.equal(hitTest(s, g, centre, 3.5, 10, 1, 0), 'pet')
  assert.equal(hitTest(s, g, centre + 20, 3.5, 10, 1, 0), null)
  // Top: pet rows 0..5, tag row 6.
  assert.equal(hitTest(s, g, centre, 0.5, 10, 0, 6), 'pet')
  assert.equal(hitTest(s, g, centre, 6.5, 10, 0, 6), 'tag')
  assert.equal(hitTest(s, g, centre, 8.5, 10, 0, 6), null)
})

function rub(s: Stroll, xs: number[]): Stroll {
  for (const x of xs) {
    s = tickStroll(s, g, 'idle', COLS)
    s = pointAt(s, x, 4, 'pet', null, COLS)
  }
  return s
}

test('rubbing back and forth over it pets it: it purrs, then settles', () => {
  let s = run(startStroll(), 2)
  const c = s.x + g.cx
  s = rub(s, [c - 2, c, c + 2, c, c - 2, c, c + 2, c, c - 2])
  assert.ok(isPetted(s))
  assert.equal(poseOf(s, g, 'idle').emote, 'purr')
  s = run(s, 30)
  assert.ok(!isPetted(s))
  assert.notEqual(poseOf(s, g, 'idle').emote, 'purr')
})

test('just passing over it, or clicking, is not petting', () => {
  let s = run(startStroll(), 2)
  const c = s.x + g.cx
  s = rub(s, [c - 4, c - 2, c, c + 2, c + 4])
  assert.ok(!isPetted(s))
  s = rub(s, [c - 2, c, c + 2, c])
  s = pointAt(s, c, 4, 'pet', 'launch', COLS)
  assert.ok(!isPetted(s))
  // Rubbing off the pet does not count either.
  let t = run(startStroll(), 2)
  for (const x of [1, 3, 1, 3, 1, 3, 1]) t = pointAt(tickStroll(t, g, 'idle', COLS), x, 4, null, null, COLS)
  assert.ok(!isPetted(t))
})
