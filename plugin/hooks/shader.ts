// A software shader over the pet's distance fields: each terminal sub-cell is
// sampled SS x SS times, lit like a soft clay figure (key light from the upper
// left, a specular glint, a cool rim from behind, occlusion low down), and
// edged with a darker, hue-shifted outline. The result is a colour and a
// coverage per sub-cell, which fit.ts turns into glyphs and two colours.

import type { Genome } from './genome'
import type { Pose } from '../types'
import { bodyDistance, capsule, circle, ellipse, rig, shapeOf, taper, H, W } from './sdf'
import type { Rig, Shape } from './sdf'

export type Rgb = [number, number, number]

// One shaded image at sub-cell resolution: `cols` x `rows` sub-cells, each a
// colour (0..1 floats) and how much of it the pet covers (0..1).
export type Shaded = { cols: number; rows: number; color: Float32Array; cover: Float32Array }

const SS = 4

// Materials a sample can land on. Features weigh more than skin when a
// sub-cell straddles them, so eyes and mouths survive at this size.
const MAT = { skin: 0, outline: 1, ink: 2, white: 3, blush: 4, accent: 5, leaf: 6, feet: 7 } as const
const MATS = 8
const WEIGHT = [1, 1.15, 1.9, 2.2, 1.2, 1.3, 1.2, 1]
// The material of the last sample (set by sample(), read by its caller).
const hit = { mat: 0 as number }

const INK: Rgb = hex('#1b1b2a')
const WHITE: Rgb = [1, 1, 1]
const MOUTH: Rgb = hex('#5a1a2a')
const BLUSH: Rgb = hex('#ff8fa3')

export function hex(c: string): Rgb {
  const n = parseInt(c.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function toHex(c: Rgb): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

type Paints = {
  body: Rgb
  belly: Rgb
  outline: Rgb
  accent: Rgb
  leaf: Rgb
  rim: Rgb
}

const shapeCache = new Map<number, Shape>()

// `subX` x `subY` sub-cells per genome pixel column / pixel row pair:
// half blocks are 1 x 2 per cell (1 x 1 per pixel), quadrants 2 x 2 per cell.
export function shadePet(g: Genome, pose: Pose, subX: number, subY: number): Shaded {
  let shape = shapeCache.get(g.seed)
  if (!shape) {
    shape = shapeOf(g)
    shapeCache.set(g.seed, shape)
  }
  const r = rig(g, shape, pose)
  const p = g.palette
  const body = hex(p.body)
  const paints: Paints = {
    body,
    belly: hex(p.belly),
    // A darker, slightly cooler outline from the body's own hue.
    outline: mix(mix(hex(p.outline), body, 0.18), [0.12, 0.1, 0.25], 0.15),
    accent: hex(p.accent),
    leaf: hex(p.leaf),
    rim: mix(body, [0.75, 0.85, 1], 0.6),
  }

  const cols = W * subX
  const rows = H * subY
  const color = new Float32Array(cols * rows * 3)
  const cover = new Float32Array(cols * rows)
  const step = 1 / SS
  const sums = new Float32Array(MATS * 3)
  const counts = new Uint16Array(MATS)
  const nearest = new Float32Array(MATS)

  for (let sy = 0; sy < rows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      // Tally samples per material; the sub-cell takes the dominant
      // material's average colour. Averaging across materials at this size
      // turns a face into mush; within one it keeps the lighting smooth.
      sums.fill(0)
      counts.fill(0)
      let hits = 0
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const px = (sx + (i + 0.5) * step) / subX
          const py = (sy + (j + 0.5) * step) / subY
          const c = sample(r, paints, px, py)
          if (!c) continue
          const m = hit.mat
          // Keep the sample nearest the sub-cell's centre for each material:
          // exact palette colours, never an in-between average.
          const off = Math.abs(i - (SS - 1) / 2) + Math.abs(j - (SS - 1) / 2)
          if (counts[m] === 0 || off < nearest[m]!) {
            nearest[m] = off
            sums[m * 3] = c[0]
            sums[m * 3 + 1] = c[1]
            sums[m * 3 + 2] = c[2]
          }
          counts[m] = counts[m]! + 1
          hits++
        }
      }
      const k = sy * cols + sx
      cover[k] = hits / (SS * SS)
      if (hits) {
        let best = 0
        let bestScore = -1
        for (let m = 0; m < MATS; m++) {
          const score = counts[m]! * (WEIGHT[m] ?? 1)
          if (score > bestScore) {
            bestScore = score
            best = m
          }
        }
        color[k * 3] = sums[best * 3]!
        color[k * 3 + 1] = sums[best * 3 + 1]!
        color[k * 3 + 2] = sums[best * 3 + 2]!
      }
    }
  }

  return { cols, rows, color, cover }
}

// The colour at one point, or null where the pet is not.
function sample(r: Rig, c: Paints, px: number, py: number): Rgb | null {
  const shape = r.shape
  const db = bodyDistance(r, px, py)

  // Feet first: they sit behind the body's lower edge.
  let behind: Rgb | null = null
  for (const f of r.feet) {
    const d = ellipse(px, py, f.x, r.feetY - f.lift, 1.15, 0.62)
    if (d < 0) {
      behind = mix(c.outline, c.body, 0.15 + smooth(0, -0.4, d) * 0.1)
      hit.mat = MAT.feet
    }
  }
  // Accessories that rise from the head, also behind the body.
  for (const side of [-1, 1]) {
    if (shape.ears === 'antenna') {
      if (capsule(px, py, r.cx + side * 1.2, r.top + 0.4, r.cx + side * 2.1, r.top - 1.5, 0.25) < 0) {
        behind = c.outline
        hit.mat = MAT.outline
      }
      const ball = circle(px, py, r.cx + side * 2.2, r.top - 1.7, 0.66)
      if (ball < 0) {
        behind = mix(c.accent, WHITE, ball < -0.35 && px < r.cx + side * 2.2 && py < r.top - 1.8 ? 0.45 : 0)
        hit.mat = MAT.accent
      }
    } else if (shape.ears === 'horns') {
      const hx = r.cx + side * (r.a * 0.55)
      const d = taper(px, py, hx, r.top + 0.6, hx + side * 1.2, r.top - 1.7, 0.55, 0.15)
      if (d < 0) {
        behind = mix(c.accent, WHITE, smooth(-0.1, -0.4, d) * (side < 0 ? 0.35 : 0.1))
        hit.mat = MAT.accent
      }
    }
  }
  if (shape.ears === 'sprout') {
    if (capsule(px, py, r.cx, r.top + 0.3, r.cx, r.top - 1.1, 0.25) < 0) {
      behind = c.leaf
      hit.mat = MAT.leaf
    }
    for (const side of [-1, 1]) {
      const d = ellipse(px, py, r.cx + side * 0.95, r.top - 1.45, 0.85, 0.5)
      if (d < 0) {
        behind = mix(c.leaf, WHITE, smooth(0, -0.3, d) * 0.25)
        hit.mat = MAT.leaf
      }
    }
  }

  if (db >= 0) return behind

  // --- the body, lit ---
  let base = c.body
  if (shape.hasBelly) {
    const d = ellipse(px, py, r.cx, r.bottom - 0.9, r.a * 0.62, 1.7)
    if (d < 0) base = mix(base, c.belly, smooth(0.1, -0.35, d))
  }
  if (shape.pattern === 'cap' && py < r.top + 1.9 && py > r.top - 0.1) base = c.accent
  if (shape.pattern === 'stripe' && capsule(px, py, r.cx, r.top + 0.8, r.cx, r.top + 1.6, 0.5) < 0) base = c.accent
  if (shape.pattern === 'spots') {
    for (const side of [-1, 1]) if (circle(px, py, r.cx + side * (r.a * 0.55), r.top + 1.4, 0.55) < 0) base = c.accent
  }
  if (shape.ears === 'bunny') {
    for (const side of [-1, 1]) {
      if (capsule(px, py, r.cx + side * 1.95, r.top + 0.4, r.cx + side * 2.1, r.top - 1.8, 0.3) < 0) base = mix(base, BLUSH, 0.7)
    }
  }

  // A dome normal from the body's own coordinates.
  const nx = Math.max(-0.95, Math.min(0.95, ((px - r.cx) / (r.a + 0.6)) * 0.95))
  const ny = Math.max(-0.95, Math.min(0.95, ((py - r.cy) / (r.b + 0.8)) * 0.95))
  const nz = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny))
  // Key light from the upper left and towards the viewer.
  const lx = -0.5, ly = -0.68, lz = 0.54
  const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz)
  // Blinn half-vector against a viewer straight ahead.
  const hl = Math.hypot(lx, ly, lz + 1)
  const spec = Math.pow(Math.max(0, (nx * lx + ny * ly + nz * (lz + 1)) / hl), 28)
  const rim = Math.pow(1 - nz, 2.2) * Math.max(0, nx * 0.6 + ny * 0.5)
  const ao = smooth(r.bottom - 2.2, r.bottom + 0.2, py) * 0.22

  // Cel shading: three clean bands read better at this size than a smooth
  // ramp, which comes out as a mosaic of near-equal cells.
  const band = diffuse > 0.72 ? 1.1 : diffuse > 0.38 ? 0.95 : 0.8
  let lit: Rgb = [base[0] * band, base[1] * band, base[2] * band]
  const isMarking = base === c.accent
  void rim
  // One glint, and a shadow band low down where the body meets the feet.
  if (!isMarking && spec > 0.55) lit = mix(lit, WHITE, 0.55)
  if (ao > 0.11) lit = mix(lit, c.outline, 0.22)

  // Outline: a band just inside the silhouette.
  // Thinner on ears and tufts above the head, or they would be all outline.
  const edge = py < r.top + 0.4 ? smooth(-0.42, -0.24, db) : smooth(-0.7, -0.48, db)
  let out = edge > 0.5 ? c.outline : lit
  hit.mat = edge > 0.5 ? MAT.outline : base === c.accent ? MAT.accent : MAT.skin

  // --- the face ---
  if (shape.hasBlush) {
    for (const e of r.eyes) {
      const d = ellipse(px, py, e.x + e.side * (e.rx + 0.55), e.y + e.ry + 0.5, 0.72, 0.42)
      if (d < 0) {
        out = mix(out, BLUSH, 0.75)
        hit.mat = MAT.blush
      }
    }
  }
  for (const e of r.eyes) {
    const ex = e.x + r.look.x * 0.45
    const ey = e.y + r.look.y * 0.45
    if (r.eyeState === 'open') {
      const d = ellipse(px, py, ex, ey, e.rx, e.ry)
      if (d < 0) {
        out = INK
        hit.mat = MAT.ink
        // A glint up and to the left.
        if (circle(px, py, ex - e.rx * 0.3, ey - e.ry * 0.36, Math.max(0.3, e.rx * 0.38)) < 0) {
          out = WHITE
          hit.mat = MAT.white
        }
      }
    } else if (r.eyeState === 'shut') {
      if (capsule(px, py, ex - e.rx, ey + 0.25, ex + e.rx, ey + 0.25, 0.3) < 0) {
        out = INK
        hit.mat = MAT.ink
      }
    } else {
      // Happy: a little arch.
      const d = Math.abs(circle(px, py, ex, ey + e.ry * 0.7, e.rx * 1.05)) - 0.22
      if (d < 0 && py < ey + e.ry * 0.5) {
        out = INK
        hit.mat = MAT.ink
      }
    }
  }
  const mx = r.cx
  const my = r.mouthY
  if (r.mouth === 'line') {
    if (capsule(px, py, mx - 0.6, my, mx + 0.6, my, 0.32) < 0) {
      out = INK
      hit.mat = MAT.ink
    }
  } else if (r.mouth === 'dot') {
    if (circle(px, py, mx, my, 0.36) < 0) {
      out = INK
      hit.mat = MAT.ink
    }
  } else if (r.mouth === 'open') {
    const d = ellipse(px, py, mx, my + 0.2, 0.7, 0.62)
    if (d < 0) {
      out = d < -0.25 ? MOUTH : INK
      hit.mat = MAT.ink
    }
  } else {
    const d = Math.abs(circle(px, py, mx, my - 0.9, 1.2)) - 0.24
    if (d < 0 && py > my - 0.35) {
      out = INK
      hit.mat = MAT.ink
    }
  }

  return out
}
