// Genome + what the pet is doing this frame -> a W x H grid of colours,
// then packed two pixels per terminal cell with half blocks.

import { H, W } from './genome'
import type { Genome } from './genome'
import type { Action, Emote, Pose } from '../types'

export type { Emote, Pose }

export type Pixels = (string | null)[]

const INK = '#1b1b2a'
const WHITE = '#ffffff'
const BROWN = '#7a4b2a'
const PAGE = '#f4efe1'
const COOKIE = '#c98a4b'
const CHIP = '#5b3a1e'
const POO = '#7b4a26'
const STINK = '#9fbf6a'
const METAL = '#6b6f7a'
const BELT = '#3a3d45'
const SWEAT = '#7cc7ff'
const HEART = '#ff5c8a'
const SCREEN = '#57e389'
const MOUTH = '#5a1a2a'
const KEYS = '#3b3e4b'
const KEYCAP = '#8d92a6'
const KEYLIT = '#ffffff'
const DESK = '#272a33'

const QUESTION = ['##.', '..#', '.#.', '...', '.#.']
const HEART_SHAPE = ['##.##', '#####', '.###.', '..#..']
const ZED = ['###', '..#', '.#.', '#..', '###']

export function paint(g: Genome, pose: Pose): Pixels {
  const px: Pixels = Array(W * H).fill(null)
  const put = (x: number, y: number, c: string | null) => {
    if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c
  }
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c)
  }
  const glyph = (rows: string[], x: number, y: number, c: string) =>
    rows.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && put(x + i, y + j, c)))

  const { frame, action } = pose
  const p = g.palette
  const codes: Record<string, string> = {
    o: p.outline, b: p.body, l: p.belly, a: p.accent, k: p.blush, g: p.leaf,
  }
  const awake = !pose.sleeping
  const running = awake && action === 'search'
  const stepping = running || (awake && pose.walking === true)
  const right = g.cx + g.halfWidth

  // The body bobs; the feet stay planted unless it is stepping.
  let dx = 0
  let dy = 0
  if (pose.sleeping) dy = frame % 24 < 12 ? 0 : 1
  else if (running) dy = -1 - (frame % 2)
  else if (stepping) dy = -(frame % 2)
  else dy = frame % 16 < 8 ? 0 : -1
  if (pose.emote === 'jump') dy = -([0, 1, 2, 3, 2, 1, 0, 0][pose.emoteFrame] ?? 0)
  if (pose.emote === 'wiggle') dx = [0, 1, 0, -1][pose.emoteFrame % 4] ?? 0
  // Being petted: a slow, contented sway.
  if (pose.emote === 'purr') dx = [0, 0, 1, 1, 0, 0, -1, -1][(pose.emoteFrame >> 1) % 8] ?? 0

  if (running) {
    // A treadmill belt under the feet, its dashes rolling backwards.
    for (let x = g.cx - 9; x <= g.cx + 8; x++) put(x, H - 1, (x + frame) % 3 === 0 ? METAL : BELT)
    rect(g.cx + 8, H - 5, 1, 4, METAL)
    rect(g.cx + 6, H - 5, 2, 1, METAL)
  }

  g.sprite.forEach((row, y) =>
    [...row].forEach((c, x) => c !== '.' && put(x + dx, y + dy, codes[c] ?? null)),
  )

  // Feet sit under the body and travel with it; while stepping they lift in turn.
  const [fl, fr] = g.feet
  const footY = g.bottom + 1 + dy
  const lift = stepping ? frame % 2 : -1
  rect(fl + dx, footY - (lift === 0 ? 1 : 0), 2, 1, p.outline)
  rect(fr + dx, footY - (lift === 1 ? 1 : 0), 2, 1, p.outline)

  // Typing: a little keyboard in front, one paw down on it and one raised,
  // the down paw lighting the key it hit. Each keystroke swaps the paws.
  if (pose.typing && awake) {
    // The keyboard sits at the feet, so the paws work below the face.
    const ky = g.bottom + 1 + Math.max(0, dy)
    const kx = g.cx - 7
    rect(kx - 1, ky + 1, 16, 1, DESK)
    rect(kx, ky, 14, 1, KEYS)
    for (let i = 0; i < 7; i++) put(kx + 1 + 2 * i, ky, KEYCAP)
    const paws: [number, boolean][] = [
      [g.cx - 5, pose.typing.side === 0],
      [g.cx + 3, pose.typing.side === 1],
    ]
    for (const [px, isDown] of paws) {
      const y = isDown ? ky - 2 : ky - 3
      rect(px, y, 2, 2, p.belly)
      rect(px, y + 1, 2, 1, p.outline)
      if (isDown) put(px + (px < g.cx ? 0 : 1), ky, KEYLIT)
    }
  }

  // Eyes.
  const e = g.eyes
  const s = e.size
  const look = pose.gaze ?? defaultGaze(action)
  const shut = pose.sleeping || pose.blinking || action === 'poop'
  for (const ex of [e.left, e.right]) {
    const x = ex + dx
    const y = e.y + dy
    if (pose.emote === 'happy' || pose.emote === 'purr') {
      // Closed, smiling arcs: a top stroke and the outer corner dipping.
      rect(x, y, s, 1, INK)
      put(ex === e.left ? x - 1 : x + s, y + 1, INK)
    } else if (shut) {
      rect(x, y + s - 1, s, 1, INK)
    } else {
      // Up, left and right only: looking down would sink onto the mouth.
      const ly = Math.min(0, look.y)
      rect(x + look.x, y + ly, s, s, INK)
      if (s === 2) put(x + look.x + 1, y + ly, WHITE)
    }
  }

  // Mouth.
  const mx = g.cx - 1 + dx
  const my = g.mouthY + dy
  if (action === 'eat' && awake) {
    const open = frame % 4 < 2
    rect(mx, my, 2, 1, open ? MOUTH : INK)
    if (open) put(mx, my + 1, MOUTH)
  } else if (pose.emote === 'happy' || pose.emote === 'heart' || pose.emote === 'purr') {
    put(mx - 1, my, INK)
    rect(mx, my + 1, 2, 1, INK)
    put(mx + 2, my, INK)
  } else if (pose.sleeping || action === 'think') {
    put(mx + 1, my, INK)
  } else {
    rect(mx, my, 2, 1, INK)
  }

  if (awake && !pose.typing) props(action)
  if (pose.sleeping) glyph(ZED, right + 2, Math.max(0, 2 - ((frame >> 3) % 3)), p.accent)
  if (pose.emote === 'heart') glyph(HEART_SHAPE, right + 1, Math.max(0, 4 - (pose.emoteFrame >> 1)), HEART)
  if (pose.emote === 'purr') {
    // Cheeks flush and a heart drifts up, over and over while it is petted.
    const e2 = g.eyes
    for (const ex of [e2.left - 1, e2.right + e2.size]) put(ex + dx, e2.y + e2.size + dy, p.blush)
    glyph(HEART_SHAPE, right + 1, 4 - ((pose.emoteFrame >> 1) % 5), HEART)
  }

  return px

  function props(a: Action) {
    const front = g.cx - 4 + dx
    if (a === 'read') {
      // A small open book held low, its pages flicking over now and then.
      const y = g.bottom - 1 + dy
      rect(g.cx - 3 + dx, y, 6, 2, BROWN)
      rect(g.cx - 3 + dx, y, 3, 1, PAGE)
      rect(g.cx + dx, y, 3, 1, frame % 24 < 3 ? BROWN : PAGE)
      if (frame % 24 < 3) rect(g.cx - 1 + dx, y - 1, 2, 1, PAGE)
    } else if (a === 'eat') {
      // A cookie held just outside the body, smaller with every bite.
      const bites = (frame >> 3) % 3
      const x = right + dx
      const y = g.mouthY - 1 + dy
      rect(x, y, 2, 2, COOKIE)
      put(x + 1, y, CHIP)
      if (bites >= 1) put(x + 1, y, null)
      if (bites >= 2) put(x + 1, y + 1, null)
      if (frame % 8 < 4) put(x - (frame % 2), y + 3 + (frame % 3 > 0 ? 1 : 0), COOKIE)
    } else if (a === 'poop') {
      // A little pile grows beside it, stink lines wafting.
      const grown = Math.min(3, (frame >> 3) % 6)
      const x = right + 2
      if (grown >= 1) rect(x, H - 1, 3, 1, POO)
      if (grown >= 2) put(x + 1, H - 2, POO)
      if (grown >= 3) {
        const w = frame % 4 < 2 ? 0 : 1
        put(x + w, H - 4, STINK)
        put(x + 2 - w, H - 5, STINK)
      }
    } else if (a === 'search') {
      if (frame % 12 < 6) put(right + dx, g.top + 1 + dy, SWEAT)
    } else if (a === 'think') {
      glyph(QUESTION, right + 1, Math.max(0, g.top - 4 + ((frame >> 2) % 2)), p.accent)
    } else if (a === 'tinker') {
      // A tiny laptop with a cursor racing across it.
      const y = g.bottom - 2 + dy
      rect(front + 1, y, 6, 1, BELT)
      put(front + 2 + ((frame >> 1) % 4), y, SCREEN)
      rect(front, y + 1, 8, 1, METAL)
    }
  }
}

function defaultGaze(action: Action): { x: number; y: number } {
  if (action === 'read' || action === 'tinker') return { x: 0, y: 1 }
  if (action === 'think') return { x: 1, y: -1 }
  if (action === 'eat') return { x: 1, y: 0 }

  return { x: 0, y: 0 }
}

export type Run = { text: string; fg?: string; bg?: string }

// Two pixel rows per terminal row. Apple Terminal draws block glyphs
// shorter than the row, which stripes a sprite made of them, but fills a
// cell's background edge to edge: so a solid cell is a space on its
// background, a two-colour cell is ▄ over the top colour, and only cells
// with one empty half need a bare glyph. Adjacent cells of one style merge.
// `solid`: a cell with one empty half is filled whole, for terminals that
// draw a bare half-block as a thin sliver (Apple Terminal).
export function toRuns(px: Pixels, solid = false): Run[][] {
  const rows: Run[][] = []
  for (let y = 0; y < H; y += 2) {
    const runs: Run[] = []
    for (let x = 0; x < W; x++) {
      const top = px[y * W + x] ?? null
      const bot = y + 1 < H ? (px[(y + 1) * W + x] ?? null) : null
      let cell: Run
      if (!top && !bot) cell = { text: ' ' }
      else if (top && !bot) cell = solid ? { text: ' ', bg: top } : { text: '▀', fg: top }
      else if (!top && bot) cell = solid ? { text: ' ', bg: bot } : { text: '▄', fg: bot }
      else if (top === bot) cell = { text: ' ', bg: top! }
      else cell = { text: '▄', fg: bot!, bg: top! }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }

  return rows
}

// The same picture packed for a Raster element.
export function toRasterCells(px: Pixels): string {
  const DEFAULT = 0x01000000
  const hex = (c: string | null) => (c ? parseInt(c.slice(1), 16) : DEFAULT)
  const rows = Math.ceil(H / 2)
  const words = new Uint32Array(W * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < W; x++) {
      const top = px[2 * r * W + x] ?? null
      const bot = 2 * r + 1 < H ? (px[(2 * r + 1) * W + x] ?? null) : null
      const i = (r * W + x) * 3
      if (!top && !bot) {
        words.set([0x20, DEFAULT, DEFAULT], i)
      } else if (!top) {
        words.set([0x2584, hex(bot), DEFAULT], i)
      } else {
        words.set([0x2580, hex(top), hex(bot)], i)
      }
    }
  }

  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

export type Strip = { row: number; left: number; runs: Run[] }

// Like toRuns, but cut into the filled stretches of each row, each placed
// by its own offset: an overlay paints only the pet, never the empty cells
// around it or between its feet, so the text behind shows through.
export function toStrips(px: Pixels, solid = false): Strip[] {
  const strips: Strip[] = []
  toRuns(px, solid).forEach((runs, row) => {
    let x = 0
    let current: Strip | null = null
    for (const run of runs) {
      if (run.fg === undefined && run.bg === undefined) {
        current = null
      } else if (current) {
        current.runs.push(run)
      } else {
        current = { row, left: x, runs: [run] }
        strips.push(current)
      }
      x += run.text.length
    }
  })

  return strips
}
