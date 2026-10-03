// Shading over paint()'s flat colours. Every pixel of a cell can take its own
// colour, so the pet gains form from light, not from more pixels: a key light
// from the upper left, a rim of shade along the lower right inside the
// outline, one specular glint, and an outline tinted lighter where the light
// falls. Levels are stepped, never smooth, so it stays crisp pixel art and
// nothing shimmers as the body bobs a pixel.
//
// Only the pet's own body, belly and outline colours are touched; eyes,
// mouth, blush, markings and every prop keep the colours paint() gave them.

import { H, W } from './genome'
import type { Genome } from './genome'
import type { Pixels } from './paint'

export type Light = { x: number; y: number }

// Where the light comes from, as a direction across the body's box: (-1, -1)
// is the upper-left corner.
const KEY: Light = { x: -0.55, y: -0.85 }

export function shade(px: Pixels, g: Genome, light: Light = KEY): Pixels {
  const p = g.palette
  const out = px.slice()
  const at = (x: number, y: number) => (x >= 0 && x < W && y >= 0 && y < H ? px[y * W + x] ?? null : null)
  const isSkin = (c: string | null) => c === p.body || c === p.belly
  const isOutline = (c: string | null) => c === p.outline

  // The body's box, wherever this frame put it (it bobs, jumps, wiggles).
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isSkin(at(x, y))) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) return out
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hw = Math.max(1, (x1 - x0) / 2)
  const hh = Math.max(1, (y1 - y0) / 2)
  const len = Math.hypot(light.x, light.y) || 1
  const lx = light.x / len
  const ly = light.y / len
  // How much a point faces the light, -1 (away) to 1 (toward).
  const facing = (x: number, y: number) => ((x - cx) / hw) * lx + ((y - cy) / hh) * ly

  // Light by height, a whole pixel row at a time: rows are the terminal's
  // own grain (half a cell each), so a stepped top-to-bottom ramp reads as a
  // rounded body where per-pixel bands at this size read as speckle. The
  // light's sideways lean only tips the right edge into shade.
  for (let y = 0; y < H; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0)
    for (let x = 0; x < W; x++) {
      const c = at(x, y)
      if (!isSkin(c)) continue
      const base = c!
      let colour = base
      if (t <= 0.25) colour = mix(base, '#ffffff', 0.24)
      // The belly is pale: the same shade would turn it grey.
      else if (t >= 0.8) colour = mix(base, p.outline, c === p.belly ? 0.14 : 0.3)
      else if (t >= 0.6 && c === p.body) colour = mix(base, p.outline, 0.12)
      // The side away from the light: the last skin pixel of a row.
      if (lx < 0 && t > 0.25 && !isSkin(at(x + 1, y)) && x > cx) colour = mix(base, p.outline, 0.3)
      out[y * W + x] = colour
    }
  }

  // One glint where the light lands: the first plain-body pixel inside the
  // outline toward the light, off the eyes' row.
  const gx = Math.round(cx + lx * hw * 0.62)
  const gy = Math.round(cy + ly * hh * 0.62)
  const glint = nearest(gx, gy, (x, y) => at(x, y) === p.body && y !== g.eyes.y && y !== g.eyes.y + 1)
  if (glint) {
    const [x, y] = glint
    out[y * W + x] = mix(p.body, '#ffffff', 0.62)
  }

  return out
}

function nearest(x: number, y: number, ok: (x: number, y: number) => boolean): [number, number] | null {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (ok(x + dx, y + dy)) return [x + dx, y + dy]
      }
    }
  }

  return null
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const va = (pa >> shift) & 255
    const vb = (pb >> shift) & 255
    return Math.round(va + (vb - va) * t)
  }
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0)

  return `#${v.toString(16).padStart(6, '0')}`
}
