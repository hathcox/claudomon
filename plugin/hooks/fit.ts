// From a shaded image to terminal cells: for each cell, the glyph and two
// colours that reproduce its sub-cells best. 'half' uses only what the
// current pipeline uses (a space on a background, ▄ over a top colour);
// 'quad' adds ▌▐ and the 2x2 quadrant glyphs. Apple Terminal fills a cell's
// background edge to edge but draws glyphs a little short of the cell, so a
// solid cell wins small ties and a bare glyph only paints where the pet is.

import { shadePet, toHex } from './shader'
import type { Shaded } from './shader'
import type { Genome } from './genome'
import type { Run, Strip } from './paint'
import type { Pose } from '../types'

export type FitMode = 'half' | 'quad'

// Sub-cell bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
const GLYPH = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']

// Error added per glyph kind, so a near-tie goes to the glyph that renders
// most faithfully: a solid cell, then the horizontal split, then the rest.
// Measured in Apple Terminal: split and quadrant cells show seams, so a
// gradient steps a whole cell at a time and only real detail splits one.
const BIAS = { solid: 0, split: 0.035, vertical: 0.06, quadrant: 0.09 }

type Px = { c: [number, number, number]; on: boolean }

function err(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]
  return 0.3 * dr * dr + 0.55 * dg * dg + 0.15 * db * db
}

function mean(px: Px[], mask: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < 4; i++) {
    if (!(mask & (1 << i))) continue
    r += px[i]!.c[0]; g += px[i]!.c[1]; b += px[i]!.c[2]; n++
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0]
}

function biasOf(mask: number): number {
  if (mask === 12 || mask === 3) return BIAS.split
  if (mask === 5 || mask === 10) return BIAS.vertical
  return BIAS.quadrant
}

// The best glyph for a cell whose four sub-cells are all to be painted.
function fitOpaque(px: Px[], mode: FitMode): Run {
  const all = mean(px, 15)
  let best: Run = { text: ' ', bg: toHex(all) }
  let bestErr = px.reduce((s, p) => s + err(p.c, all), 0)
  // Diagonals (▚▞) read as noise in Apple Terminal, so they are left out.
  const masks = mode === 'half' ? [12] : [1, 2, 4, 8, 5, 12]
  for (const m of masks) {
    // ▄ is painted over the top colour; any other glyph paints `m` in fg.
    const fg = mean(px, m)
    const bg = mean(px, 15 ^ m)
    let e = biasOf(m)
    for (let i = 0; i < 4; i++) e += err(px[i]!.c, m & (1 << i) ? fg : bg)
    if (e < bestErr) {
      bestErr = e
      best = { text: GLYPH[m]!, fg: toHex(fg), bg: toHex(bg) }
    }
  }

  return best
}

// `solid`: a cell the pet covers at least half of is painted whole (empty
// sub-cells take the nearest pet colour); otherwise only its covered
// sub-cells are drawn as a bare glyph.
export function fitCells(img: Shaded, mode: FitMode, solid = true): Run[][] {
  const subX = mode === 'quad' ? 2 : 1
  const cellCols = img.cols / subX
  const cellRows = img.rows / 2
  const rows: Run[][] = []
  const at = (x: number, y: number): Px => {
    const k = y * img.cols + x
    return { c: [img.color[k * 3]!, img.color[k * 3 + 1]!, img.color[k * 3 + 2]!], on: img.cover[k]! >= 0.5 }
  }

  for (let cy = 0; cy < cellRows; cy++) {
    const runs: Run[] = []
    for (let cx = 0; cx < cellCols; cx++) {
      const x0 = cx * subX
      const x1 = mode === 'quad' ? x0 + 1 : x0
      const px = [at(x0, cy * 2), at(x1, cy * 2), at(x0, cy * 2 + 1), at(x1, cy * 2 + 1)]
      let mask = 0
      px.forEach((p, i) => p.on && (mask |= 1 << i))
      let cell: Run
      if (mask === 0) {
        cell = { text: ' ' }
      } else if (mask === 15 || (solid && popcount(mask) >= 2)) {
        // Fill empty sub-cells from a covered neighbour in the same cell.
        const fill = mean(px, mask)
        const filled = px.map(p => (p.on ? p : { c: fill, on: true }))
        cell = fitOpaque(filled, mode)
      } else if (mode === 'quad' && solid) {
        // A lone covered quarter would be a thin speck on the edge.
        cell = { text: ' ' }
      } else {
        // A bare glyph over the empty part: in half mode it can only be a
        // top or bottom half.
        const m = mode === 'half' ? (mask & 3 ? 3 : 12) : mask
        cell = { text: GLYPH[m]!, fg: toHex(mean(px, mask)) }
      }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }

  return rows
}

function popcount(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)
}

// Rows of runs cut into the filled stretches of each row, each placed by its
// own offset, the same shape paint.ts's toStrips returns.
export function stripsOf(rows: Run[][]): Strip[] {
  const strips: Strip[] = []
  rows.forEach((runs, row) => {
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

// The drop-in for `toStrips(paint(g, pose), solid)`.
export function shaderStrips(g: Genome, pose: Pose, mode: FitMode = 'quad', solid = true): Strip[] {
  return stripsOf(fitCells(shadePet(g, pose, mode === 'quad' ? 2 : 1, 1), mode, solid))
}
