// The pet as signed distance fields: smooth shapes for the same creature
// genome.ts grows as pixels. Distances are in genome pixels (the W x H
// canvas), negative inside. A shader samples these many times per terminal
// sub-cell, which is what lets edges and lighting come out smooth.

import { H, W } from './genome'
import type { EarKind, Genome } from './genome'
import type { Pose } from '../types'

// What genome.ts decides but does not return, re-derived from the seed by
// replaying its random draws in the same order.
export type Shape = {
  roundness: number
  flare: number
  ears: EarKind
  hasBelly: boolean
  pattern: 'none' | 'spots' | 'cap' | 'stripe'
  hasBlush: boolean
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const EARS: EarKind[] = ['none', 'cat', 'bunny', 'antenna', 'horns', 'sprout', 'tuft']
const PATTERNS = ['none', 'spots', 'cap', 'stripe'] as const

export function shapeOf(g: Genome): Shape {
  const r = mulberry32(g.seed)
  // hue, body saturation, body lightness, accent, species prefix, suffix,
  // half width, height: the draws before the ones we need.
  for (let i = 0; i < 8; i++) r()
  const roundness = 1.8 + r() * 1.8
  const flare = r() * 0.3
  const ears = EARS[Math.floor(r() * EARS.length)]!
  const hasBelly = r() < 0.6
  const pattern = PATTERNS[Math.floor(r() * PATTERNS.length)]!
  // Blush is the only 'k' at or below the eyes (a bunny's inner ears are above).
  const hasBlush = g.sprite.slice(g.eyes.y).some(row => row.includes('k'))

  return { roundness, flare, ears, hasBelly, pattern, hasBlush }
}

// --- distance primitives -------------------------------------------------

export function circle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r
}

// An ellipse's distance, approximated (good near the edge, which is what
// coverage needs).
export function ellipse(px: number, py: number, cx: number, cy: number, rx: number, ry: number): number {
  const x = (px - cx) / rx
  const y = (py - cy) / ry
  const k = Math.hypot(x, y)
  return ((k - 1) * Math.min(rx, ry))
}

export function capsule(px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number): number {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

// A capsule whose radius runs from ra at a to rb at b (a horn).
export function taper(px: number, py: number, ax: number, ay: number, bx: number, by: number, ra: number, rb: number): number {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h) - (ra + (rb - ra) * h)
}

export function triangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const e0x = bx - ax, e0y = by - ay, e1x = cx - bx, e1y = cy - by, e2x = ax - cx, e2y = ay - cy
  const v0x = px - ax, v0y = py - ay, v1x = px - bx, v1y = py - by, v2x = px - cx, v2y = py - cy
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const h0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y))
  const h1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y))
  const h2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y))
  const q0x = v0x - e0x * h0, q0y = v0y - e0y * h0
  const q1x = v1x - e1x * h1, q1y = v1y - e1y * h1
  const q2x = v2x - e2x * h2, q2y = v2y - e2y * h2
  const s = Math.sign(e0x * e2y - e0y * e2x)
  const d0 = q0x * q0x + q0y * q0y, s0 = s * (v0x * e0y - v0y * e0x)
  const d1 = q1x * q1x + q1y * q1y, s1 = s * (v1x * e1y - v1y * e1x)
  const d2 = q2x * q2x + q2y * q2y, s2 = s * (v2x * e2y - v2y * e2x)
  const d = Math.min(d0, d1, d2)
  const inside = Math.min(s0, s1, s2) > 0
  return inside ? -Math.sqrt(d) : Math.sqrt(d)
}

// Smooth union: shapes melt into each other over `k` pixels.
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}

// --- the creature ------------------------------------------------------------

// Everything a frame needs, worked out once per frame (not per sample).
export type Rig = {
  g: Genome
  shape: Shape
  dx: number
  dy: number
  cx: number
  // Body box: superellipse centred at (cx, cy) with semi-axes a (x) and b (y).
  cy: number
  a: number
  b: number
  top: number
  bottom: number
  feetY: number
  feet: [{ x: number; lift: number }, { x: number; lift: number }]
  eyes: { x: number; y: number; rx: number; ry: number; side: -1 | 1 }[]
  look: { x: number; y: number }
  eyeState: 'open' | 'shut' | 'happy'
  mouth: 'line' | 'open' | 'smile' | 'dot'
  mouthY: number
}

export function rig(g: Genome, shape: Shape, pose: Pose): Rig {
  const { frame, action } = pose
  const awake = !pose.sleeping
  const running = awake && action === 'search'
  const stepping = running || (awake && pose.walking === true)

  // The same body motion as paint(): a bob, a hop while stepping, emotes.
  let dx = 0
  let dy = 0
  if (pose.sleeping) dy = frame % 24 < 12 ? 0 : 0.5
  else if (running) dy = -1 - (frame % 2)
  else if (stepping) dy = -(frame % 2) * 0.6
  else dy = frame % 16 < 8 ? 0 : -0.5
  if (pose.emote === 'jump') dy = -([0, 1, 2, 3, 2, 1, 0, 0][pose.emoteFrame] ?? 0)
  if (pose.emote === 'wiggle') dx = [0, 0.7, 0, -0.7][pose.emoteFrame % 4] ?? 0

  const bottom = g.bottom + 1 + dy
  const top = g.top + dy
  const height = bottom - top
  const lift = stepping ? frame % 2 : -1
  const feetY = bottom + 0.45
  const footLeft = g.feet[0] + 1 + dx
  const footRight = g.feet[1] + 1 + dx

  const e = g.eyes
  const rx = e.size === 2 ? 1.0 : 0.62
  const ry = e.size === 2 ? 1.2 : 0.8
  const look = pose.gaze ?? defaultGaze(action)
  const shut = pose.sleeping || pose.blinking || action === 'poop'

  return {
    g,
    shape,
    dx,
    dy,
    cx: g.cx + dx,
    cy: top + height / 2,
    a: g.halfWidth + 0.15,
    b: height / 2,
    top,
    bottom,
    feetY,
    feet: [
      { x: footLeft, lift: lift === 0 ? 0.9 : 0 },
      { x: footRight, lift: lift === 1 ? 0.9 : 0 },
    ],
    eyes: [
      { x: e.left + e.size / 2 + dx, y: e.y + e.size / 2 + dy, rx, ry, side: -1 },
      { x: e.right + e.size / 2 + dx, y: e.y + e.size / 2 + dy, rx, ry, side: 1 },
    ],
    look: { x: look.x, y: Math.min(0, look.y) },
    eyeState: pose.emote === 'happy' ? 'happy' : shut ? 'shut' : 'open',
    mouth:
      action === 'eat' && awake
        ? frame % 4 < 2 ? 'open' : 'line'
        : pose.emote === 'happy' || pose.emote === 'heart'
          ? 'smile'
          : pose.sleeping || action === 'think'
            ? 'dot'
            : 'line',
    mouthY: g.mouthY + 0.5 + dy,
  }
}

function defaultGaze(action: Pose['action']): { x: number; y: number } {
  if (action === 'read' || action === 'tinker') return { x: 0, y: 1 }
  if (action === 'think') return { x: 1, y: -1 }
  if (action === 'eat') return { x: 1, y: 0 }

  return { x: 0, y: 0 }
}

// The body's superellipse, widening toward the bottom by the genome's flare.
export function bodyDistance(r: Rig, px: number, py: number): number {
  const t = Math.max(0, Math.min(1, (py - r.top) / (r.bottom - r.top)))
  const a = r.a * (1 + r.shape.flare * t * 0.8)
  const u = Math.abs(px - r.cx) / a
  const v = Math.abs(py - r.cy) / r.b
  const p = r.shape.roundness
  const k = Math.pow(Math.pow(u, p) + Math.pow(v, p), 1 / p)
  let d = (k - 1) * Math.min(a, r.b)

  // Body-coloured ears melt into the head.
  const ears = r.shape.ears
  for (const side of [-1, 1]) {
    if (ears === 'cat') {
      const ex = r.cx + side * (r.a * 0.58)
      const e = triangle(px, py, ex - side * 1.3, r.top + 1.3, ex + side * 1.1, r.top + 0.9, ex + side * 0.9, r.top - 1.5)
      d = smin(d, e - 0.15, 0.8)
    } else if (ears === 'bunny') {
      const e = capsule(px, py, r.cx + side * 1.9, r.top + 1, r.cx + side * 2.1, r.top - 2.3, 0.95)
      d = smin(d, e, 0.6)
    }
  }
  if (ears === 'tuft') d = smin(d, circle(px, py, r.cx + 0.2, r.top - 0.1, 0.75), 0.7)

  return d
}

export { H, W }
