// The shader prototype next to the current pixels, in a real terminal.
//
//   npx -y tsx tools/render/shader-demo.ts            print, then wait (for a screenshot)
//   npx -y tsx tools/render/shader-demo.ts --png out/shader/zoom.png --no-wait
//   npx -y tsx tools/render/shader-demo.ts --time     ms per frame
//
// Three columns per seed: CURRENT (paint + the solid Apple Terminal cells),
// SHADER half (space and ▄ only), SHADER quad (adds ▌▐ and quadrants).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { hashSeed, makeGenome } from '../../plugin/hooks/genome'
import { paint, toRuns } from '../../plugin/hooks/paint'
import type { Run } from '../../plugin/hooks/paint'
import { fitCells } from '../../plugin/hooks/fit'
import { shadePet } from '../../plugin/hooks/shader'
import type { Pose } from '../../plugin/types'

const args = process.argv.slice(2)
const opt = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const seeds = (opt('--seeds') ?? 'git@github.com:iggy/claudomon.git,ed6e908e-fake,linux').split(',')
const solid = !args.includes('--glyph-edges')

const POSE: Pose = {
  frame: 4, action: 'idle', sleeping: false, gaze: null, emote: null, emoteFrame: 0, blinking: false,
}

function petsFor(seed: string): { label: string; rows: Run[][] }[] {
  const g = makeGenome(hashSeed(seed))
  return [
    { label: 'CURRENT', rows: toRuns(paint(g, POSE), true) },
    { label: 'SHADER half', rows: fitCells(shadePet(g, POSE, 1, 1), 'half', solid) },
    { label: 'SHADER quad', rows: fitCells(shadePet(g, POSE, 2, 1), 'quad', solid) },
  ]
}

function ansi(run: Run): string {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(';')
  let s = ''
  if (run.fg) s += `\x1b[38;2;${rgb(run.fg)}m`
  if (run.bg) s += `\x1b[48;2;${rgb(run.bg)}m`
  return s + run.text + '\x1b[0m'
}

function width(rows: Run[][]): number {
  return Math.max(...rows.map(r => r.reduce((n, run) => n + [...run.text].length, 0)))
}

async function printAll() {
  await new Promise(r => setTimeout(r, 1500))
  let out = '\x1b[2J\x1b[H'
  for (const seed of seeds) {
    const pets = petsFor(seed)
    out += pets.map(p => p.label.padEnd(28)).join('') + '\n'
    for (let y = 0; y < 6; y++) {
      for (const p of pets) {
        const row = p.rows[y] ?? []
        out += row.map(ansi).join('')
        out += ' '.repeat(Math.max(0, 28 - row.reduce((n, run) => n + [...run.text].length, 0)))
      }
      out += '\n'
    }
    out += '\n'
  }
  process.stdout.write(out)
  if (!args.includes('--no-wait')) await new Promise(r => setTimeout(r, 25000))
}

// An idealised render: each cell 16 x 32, glyphs drawn exactly.
const MASK: Record<string, number> = {
  ' ': 0, '▘': 1, '▝': 2, '▀': 3, '▖': 4, '▌': 5, '▞': 6, '▛': 7, '▗': 8, '▚': 9, '▐': 10, '▜': 11, '▄': 12, '▙': 13, '▟': 14, '█': 15,
}

function png(path: string) {
  const CW = 16, CH = 32, GAP = 4 * CW
  const all = seeds.map(petsFor)
  const w = 3 * 24 * CW + 2 * GAP
  const h = all.length * (6 * CH + CH)
  const img = Buffer.alloc(w * h * 3, 0x1e)
  const put = (x: number, y: number, c: number[]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    img.set(c, (y * w + x) * 3)
  }
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  all.forEach((pets, si) => {
    pets.forEach((p, pi) => {
      p.rows.forEach((runs, ry) => {
        let cx = 0
        for (const run of runs) {
          for (const ch of run.text) {
            const m = MASK[ch] ?? 0
            for (let yy = 0; yy < CH; yy++) {
              for (let xx = 0; xx < CW; xx++) {
                const bit = (yy < CH / 2 ? 0 : 2) + (xx < CW / 2 ? 0 : 1)
                const isFg = (m >> bit) & 1
                const col = isFg && run.fg ? rgb(run.fg) : run.bg ? rgb(run.bg) : null
                if (col) put(pi * (24 * CW + GAP) + cx * CW + xx, si * (7 * CH) + ry * CH + yy, col)
              }
            }
            cx++
          }
        }
      })
    })
  })
  mkdirSync(dirname(path), { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'shader-'))
  const ppm = join(dir, 'f.ppm')
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), img]))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, path])
  rmSync(dir, { recursive: true })
}

function time() {
  const g = makeGenome(hashSeed(seeds[0]!))
  for (const [label, sub, mode] of [['half', 1, 'half'], ['quad', 2, 'quad']] as const) {
    const t0 = performance.now()
    const n = 60
    for (let f = 0; f < n; f++) fitCells(shadePet(g, { ...POSE, frame: f, walking: true }, sub, 1), mode, solid)
    console.log(`${label}: ${((performance.now() - t0) / n).toFixed(2)} ms per frame`)
  }
}

if (args.includes('--time')) time()
else if (opt('--png')) png(opt('--png')!)
else void printAll()
void width
