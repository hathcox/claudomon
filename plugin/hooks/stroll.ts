// The pet's wandering, as a pure state machine the hooks module ticks: where
// it stands, which way it faces, when it rests, looks, emotes and dozes.
// The drawing is a function of this state; the hooks redraw only when that
// drawing would change, since each redraw repaints the rows it stands over.

import { H, W } from './genome'
import type { Genome } from './genome'
import type { Action, Dock, Emote, Pose, Shown } from '../types'

export const TICK_MS = 125
// Ticks per step while walking (two steps a second), how long a look at the
// pointer lasts, and how long a quiet pet stays awake.
const STEP = 4
const LOOK = 24
// A pointer resting on the pet sends no moves: trust a hover this long.
export const HOVER_TICKS = 160
const SLEEP_AFTER = (90 * 1000) / TICK_MS
const EMOTE_TICKS = 8
const EMOTES: Emote[] = ['jump', 'wiggle', 'heart', 'happy']
// Its home: the stretch at the right edge where little else is drawn.
const HOME_SPAN = 26
// After a drop it wanders this far either side of where it landed.
const DROP_SPAN = 8
// A click launches it across its home: ticks aloft and peak height in rows.
const FLIGHT_TICKS = 11
const FLIGHT_PEAK = 5
const PANEL_TICKS = 96

export type Stroll = {
  tick: number
  x: number
  dir: 1 | -1
  pause: number
  quietSince: number
  pointer: { x: number; y: number; at: number } | null
  emote: { kind: Emote; at: number } | null
  // The pointer is over the pet or its name tag.
  isHovered: boolean
  flight: { from: number; to: number; at: number } | null
  panelAt: number | null
  // Where the person dropped it: the centre of its wandering, and its dock.
  homeX: number | null
  dock: Dock
  // Held by the pointer: where it was grabbed and where the pointer is now.
  drag: { grabDx: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null
  // The person's last keystroke in the prompt, and which paw it brought down.
  typing: { lastTick: number; side: 0 | 1 } | null
  // The pointer rubbing back and forth over it: where it last was, which way
  // it was going, and how many times it turned around (and when).
  rub: { x: number; dir: -1 | 0 | 1; turns: number[] } | null
  // Since when it has been being petted, while it is.
  pettedAt: number | null
}

export function startStroll(): Stroll {
  return { tick: 0, x: -1, dir: -1, pause: 0, quietSince: 0, pointer: null, emote: null, isHovered: false, flight: null, panelAt: null, homeX: null, dock: 'top', drag: null, typing: null, rub: null, pettedAt: null }
}

export function poseOf(s: Stroll, g: Genome, action: Action): Pose {
  const typing = isTyping(s) ? { side: s.typing!.side } : null
  if (isPetted(s) && !s.drag) {
    return { frame: s.tick, action, sleeping: false, walking: false, gaze: null, emote: 'purr', emoteFrame: s.tick - s.pettedAt!, blinking: false, typing: null }
  }
  if (s.drag) {
    // Dangling from the pointer: a wiggle, looking down at where it may land.
    return { frame: s.tick, action, sleeping: false, walking: false, gaze: { x: 0, y: 0 }, emote: 'wiggle', emoteFrame: s.tick % 4, blinking: false }
  }
  const busy = action !== 'idle'
  const emoteFrame = s.emote ? s.tick - s.emote.at : 0
  const isEmoting = s.emote !== null && emoteFrame < EMOTE_TICKS
  const looking = s.pointer && s.tick - s.pointer.at < LOOK ? s.pointer : null
  const sleeping = !busy && !looking && !isEmoting && s.tick - s.quietSince > SLEEP_AFTER
  const isHeld = s.isHovered && s.pointer !== null && s.tick - s.pointer.at < HOVER_TICKS
  const walking = !busy && !sleeping && !isEmoting && !isHeld && !typing && s.pause === 0 && s.flight === null
  const eyeX = s.x + (g.eyes.left + g.eyes.right + g.eyes.size) / 2
  const eyeY = g.eyes.y + g.eyes.size / 2
  const gaze = looking
    ? {
        x: looking.x < eyeX - 3 ? -1 : looking.x > eyeX + 3 ? 1 : 0,
        y: looking.y < eyeY - 3 ? -1 : 0,
      }
    : walking
      ? { x: s.dir, y: 0 }
      : null

  return {
    // Each animation advances on its own beat, not every tick.
    frame: isEmoting ? s.tick : walking ? Math.floor(s.tick / STEP) : Math.floor(s.tick / 3),
    action,
    sleeping,
    walking,
    gaze,
    emote: isEmoting ? s.emote!.kind : null,
    emoteFrame,
    blinking: !sleeping && s.tick % 41 < 2,
    typing: sleeping ? null : typing,
  }
}

// Typing counts as going on for a second and a half after the last key.
const TYPING_TICKS = 12

export function isTyping(s: Stroll): boolean {
  return s.typing !== null && s.tick - s.typing.lastTick < TYPING_TICKS
}

// A keystroke in the prompt: the other paw comes down, and it wakes up.
export function tap(s: Stroll): Stroll {
  const side: 0 | 1 = s.typing?.side === 0 ? 1 : 0
  return { ...s, typing: { lastTick: s.tick, side }, quietSince: s.tick }
}

// One tick: advance the clock, walk a step on the beat, bounce off the ends.
// Its wandering range: around where it was dropped, else the right edge.
export function homeOf(columns: number, s?: Stroll): { min: number; max: number } {
  const edge = Math.max(0, columns - W)
  if (s?.homeX != null) {
    const centre = Math.max(0, Math.min(edge, s.homeX))
    return { min: Math.max(0, centre - DROP_SPAN), max: Math.min(edge, centre + DROP_SPAN) }
  }
  return { min: Math.max(0, edge - HOME_SPAN), max: edge }
}

export function tickStroll(s: Stroll, g: Genome, action: Action, columns: number): Stroll {
  const next = { ...s, tick: s.tick + 1 }
  if (action !== 'idle') next.quietSince = next.tick
  if (next.drag) return next
  const { min, max } = homeOf(columns, next)
  // First tick (or a narrower window): start at the right edge of home.
  if (next.x < 0 || next.x > max) next.x = max
  if (next.panelAt !== null && next.tick - next.panelAt > PANEL_TICKS) next.panelAt = null
  if (next.flight) {
    const t = (next.tick - next.flight.at) / FLIGHT_TICKS
    if (t >= 1) {
      // Touchdown: a happy little landing.
      next.x = next.flight.to
      next.flight = null
      next.emote = { kind: 'happy', at: next.tick }
      next.pause = 12
    } else {
      next.x = Math.round(next.flight.from + (next.flight.to - next.flight.from) * t)
    }
    return next
  }
  const pose = poseOf(next, g, action)
  const isHeld = next.isHovered && next.pointer !== null && next.tick - next.pointer.at < HOVER_TICKS
  if (isHeld) {
    // Stands still under the pointer, so it can be clicked.
  } else if (next.pause > 0) {
    next.pause--
  } else if (pose.walking && next.tick % STEP === 0) {
    next.x += next.dir
    if (next.x <= min || next.x >= max) next.dir = next.dir === 1 ? -1 : 1
    // Now and then it stops to look around.
    if ((next.tick * 7919) % 53 === 0) next.pause = 16 + (next.tick % 24)
  }
  next.x = Math.max(min, Math.min(max, next.x))

  return next
}

// How high it is: a parabola over the flight, in rows.
export function liftOf(s: Stroll): number {
  if (!s.flight) return 0
  const t = Math.min(1, (s.tick - s.flight.at) / FLIGHT_TICKS)
  return Math.round(4 * FLIGHT_PEAK * t * (1 - t))
}

export function isPanelOpen(s: Stroll): boolean {
  return s.panelAt !== null
}

export type Hit = 'pet' | 'tag' | null

// What is under a pointer at (x, row) of the sensor strip: row 0 is the name
// tag's row above the pet's head, rows 1.. are the pet.
export function hitTest(s: Stroll, g: Genome, x: number, row: number, tagWidth: number, petTop = 1, tagRow = 0): Hit {
  const centre = s.x + g.cx
  const r = Math.floor(row)
  if (r === tagRow) return Math.abs(x - centre) <= tagWidth / 2 + 1 ? 'tag' : null
  if (r >= petTop && r < petTop + H / 2) return Math.abs(x - centre) <= g.halfWidth + 1 ? 'pet' : null
  return null
}

// The pointer moved over (or clicked) the strip the pet walks in; `x` in
// cells, `y` in the pet's pixel rows. It holds still while it is hovered.
export type Click = 'launch' | 'panel' | null

// Petting is rubbing: the pointer turning around over the pet three times
// within two seconds. It lasts while the rubbing goes on, and a moment after.
const RUB_TURNS = 3
const RUB_WINDOW = 16
const PET_LINGER = 10

export function isPetted(s: Stroll): boolean {
  return s.pettedAt !== null && s.rub !== null && s.tick - (s.rub.turns.at(-1) ?? -Infinity) < PET_LINGER + RUB_WINDOW / 2
}

function rubbed(s: Stroll, x: number, hit: Hit, click: Click): Pick<Stroll, 'rub' | 'pettedAt'> {
  if (hit !== 'pet' || click !== null) return { rub: null, pettedAt: null }
  const rub = s.rub ?? { x, dir: 0, turns: [] }
  const step = Math.round(x) - Math.round(rub.x)
  if (step === 0) return { rub, pettedAt: s.pettedAt }
  const dir = step > 0 ? 1 : -1
  const turns = (rub.dir !== 0 && dir !== rub.dir ? [...rub.turns, s.tick] : rub.turns).filter(t => s.tick - t < RUB_WINDOW)
  const isRubbing = turns.length >= RUB_TURNS
  return { rub: { x, dir, turns }, pettedAt: isRubbing ? (s.pettedAt ?? s.tick) : s.pettedAt }
}

export function pointAt(s: Stroll, x: number, y: number, hit: Hit, click: Click, columns: number): Stroll {
  const next: Stroll = { ...s, quietSince: s.tick, pointer: { x, y, at: s.tick }, isHovered: hit !== null, ...rubbed(s, x, hit, click) }
  if (hit !== null) next.pause = Math.max(next.pause, 12)
  if (click === 'panel' && hit !== null) next.panelAt = next.panelAt === null ? s.tick : null
  if (click === 'launch' && hit === 'pet' && !s.flight) {
    // Up and over to the far side of home.
    const { min, max } = homeOf(columns, s)
    const to = s.x - min > (max - min) / 2 ? min : max
    next.flight = { from: s.x, to, at: s.tick }
    next.emote = { kind: 'jump', at: s.tick }
    next.dir = to < s.x ? -1 : 1
    next.isHovered = false
    next.panelAt = null
  }

  return next
}

export { EMOTES }

// Pointer down on the pet: the sensor holds it; here it just stops wandering.
export function grab(s: Stroll): Stroll {
  return { ...s, drag: { grabDx: 0, startX: 0, startY: 0, x: 0, y: 0, moved: false }, isHovered: true, panelAt: null }
}

// Dropped `dx` columns and `dy` rows from where it was picked up. Dragged
// well up it docks at the top of the window, well down at the bottom.
export function drop(s: Stroll, dx: number, dy: number, columns: number): Stroll {
  const edge = Math.max(0, columns - W)
  const x = Math.max(0, Math.min(edge, s.x + dx))
  const dock: Dock = dy < -3 ? 'top' : dy > 3 ? 'bottom' : s.dock
  return { ...s, drag: null, x, homeX: x, dock, pause: 16, emote: { kind: 'happy', at: s.tick } }
}

export function signature(shown: Shown): string {
  const p = shown.pose
  return `${shown.pose.typing?.side ?? '-'}|${shown.pose.emote === 'purr' ? shown.pose.emoteFrame : ''}|${shown.wpm}|${shown.dock}|${shown.dragDy}|${shown.isHovered}|${shown.isPanelOpen}|${shown.menuHover}|${shown.lift}|${shown.x}|${p.frame}|${p.walking}|${p.sleeping}|${p.blinking}|${p.emote}|${p.emoteFrame}|${p.gaze?.x},${p.gaze?.y}|${p.action}`
}
