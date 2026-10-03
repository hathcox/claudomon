// A project's seed -> its mon. Pure and deterministic: the same seed always
// grows the same creature, on every machine.
//
// The canvas is W x H pixels; the terminal shows two pixel rows per cell
// row, so the pet is W columns by H / 2 rows on screen.

export const W = 24
export const H = 12

export type Palette = {
  outline: string
  body: string
  belly: string
  accent: string
  blush: string
  leaf: string
}

export type Genome = {
  seed: number
  species: string
  palette: Palette
  // H rows of W codes: '.' empty, o outline, b body, l belly, a accent,
  // k blush, g leaf. Eyes, mouth and feet are drawn live by the painter.
  sprite: string[]
  cx: number
  top: number
  bottom: number
  halfWidth: number
  eyes: { y: number; left: number; right: number; size: 1 | 2 }
  mouthY: number
  feet: [number, number]
}

export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }

  return h >>> 0
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

function hsl(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) =>
    lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

const PREFIX = ['Blor', 'Squi', 'Mog', 'Pip', 'Zub', 'Fen', 'Glim', 'Tox', 'Wib', 'Nub', 'Kip', 'Lum', 'Drib', 'Bap', 'Quo']
const SUFFIX = ['bit', 'mon', 'let', 'puff', 'ling', 'zor', 'bun', 'chu', 'mite', 'dle', 'kin', 'oo', 'gle', 'nix']

export type EarKind = 'none' | 'cat' | 'bunny' | 'antenna' | 'horns' | 'sprout' | 'tuft'
const EARS: EarKind[] = ['none', 'cat', 'bunny', 'antenna', 'horns', 'sprout', 'tuft']

export function makeGenome(seed: number): Genome {
  const r = mulberry32(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!

  const hue = Math.floor(r() * 360)
  const palette: Palette = {
    outline: hsl(hue, 45, 24),
    body: hsl(hue, 55 + r() * 20, 58 + r() * 8),
    belly: hsl(hue, 50, 84),
    accent: hsl((hue + 150 + r() * 60) % 360, 70, 58),
    blush: '#ff8fa3',
    leaf: '#6cc24a',
  }
  const species = pick(PREFIX) + pick(SUFFIX)

  const halfWidth = 4 + Math.floor(r() * 3)
  const height = 6 + Math.floor(r() * 2)
  const roundness = 1.8 + r() * 1.8
  const flare = r() * 0.3
  const cx = W / 2
  const bottom = H - 2
  const top = bottom - height + 1

  const grid: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('.'))
  const at = (x: number, y: number) => (x >= 0 && x < W && y >= 0 && y < H ? grid[y]![x]! : '.')
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y]![x] = c
  }
  // Pixel x and its mirror across the centre line between cx - 1 and cx.
  const mirror = (x: number, y: number, c: string) => {
    set(x, y, c)
    set(2 * cx - 1 - x, y, c)
  }
  const halfAt = (y: number) => {
    let n = 0
    while (at(cx + n, y) !== '.') n++
    return n
  }

  // Body: a superellipse, wider toward the bottom by `flare`.
  for (let y = top; y <= bottom; y++) {
    const t = (y - top + 0.5) / height
    const v = 2 * t - 1
    const base = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), roundness)), 1 / roundness)
    const half = halfWidth * base * (1 + flare * t)
    for (let i = 0; i + 0.5 <= half + 0.35; i++) mirror(cx + i, y, 'b')
  }

  const ears = pick(EARS)
  if (ears === 'cat') {
    const ex = cx + Math.max(1, halfAt(top + 1) - 3)
    mirror(ex, top, 'b')
    mirror(ex + 1, top, 'b')
    mirror(ex + 1, top - 1, 'b')
  } else if (ears === 'bunny') {
    for (let k = 0; k < 3; k++) {
      mirror(cx + 1, top - k, 'b')
      mirror(cx + 2, top - k, 'b')
    }
  } else if (ears === 'tuft') {
    mirror(cx, top - 1, 'b')
  }

  if (r() < 0.6) {
    for (let y = bottom - 2; y < bottom; y++) {
      for (let i = 0; i < Math.floor(halfWidth * 0.6); i++) {
        if (at(cx + i, y) === 'b') mirror(cx + i, y, 'l')
      }
    }
  }

  const pattern = pick(['none', 'spots', 'cap', 'stripe'] as const)
  if (pattern === 'spots') {
    const x = cx + 2 + Math.floor(r() * Math.max(1, halfWidth - 3))
    if (at(x, top + 1) === 'b') mirror(x, top + 1, 'a')
  } else if (pattern === 'cap') {
    for (let i = 0; i < halfWidth; i++) if (at(cx + i, top + 1) === 'b') mirror(cx + i, top + 1, 'a')
  } else if (pattern === 'stripe') {
    if (at(cx, top + 1) === 'b') mirror(cx, top + 1, 'a')
  }

  // Outline every filled pixel that touches empty space.
  const edge: [number, number][] = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y) === '.') continue
      if (at(x + 1, y) === '.' || at(x - 1, y) === '.' || at(x, y + 1) === '.' || at(x, y - 1) === '.') {
        edge.push([x, y])
      }
    }
  }
  for (const [x, y] of edge) set(x, y, 'o')

  const crown = Math.max(1, halfAt(top) - 1)
  if (ears === 'antenna') {
    mirror(cx + 1, top - 1, 'o')
    mirror(cx + 2, top - 2, 'a')
  } else if (ears === 'horns') {
    mirror(cx + crown, top - 1, 'a')
    mirror(cx + crown + 1, top - 2, 'a')
  } else if (ears === 'sprout') {
    set(cx, top - 1, 'g')
    set(cx + 1, top - 2, 'g')
    set(cx - 1, top - 2, 'g')
  }

  const size = r() < 0.55 ? 2 : 1
  const gap = 1 + (halfWidth > 4 && r() < 0.5 ? 1 : 0)
  const eyeY = top + 2
  const eyes = { y: eyeY, left: cx - gap - size, right: cx + gap, size: size as 1 | 2 }

  if (r() < 0.6) mirror(cx + gap + size, eyeY + size, 'k')

  const footX = Math.max(1, Math.floor(halfWidth / 2))

  return {
    seed,
    species,
    palette,
    sprite: grid.map(row => row.join('')),
    cx,
    top,
    bottom,
    halfWidth,
    eyes,
    mouthY: eyeY + size + (size === 1 ? 1 : 0),
    feet: [cx - footX - 2, cx + footX],
  }
}

export function levelOf(xp: number): { level: number; into: number; span: number } {
  // Level n starts at 25 * n * (n - 1) xp: 0, 50, 150, 300, 500...
  let level = 1
  while (25 * (level + 1) * level <= xp) level++
  const start = 25 * level * (level - 1)
  const next = 25 * (level + 1) * level

  return { level, into: xp - start, span: next - start }
}
