// Flat vs shaded pets, side by side, zoomed and at real terminal size.
//
//   npx -y tsx tools/render/shade-board.ts [--seeds a,b,c] [--out out/shade]
//
// zoom.png: each pixel SCALE square. real.png: each pixel a 7 x 8 block, a
// terminal cell (7 x 16) holding two, as Apple Terminal shows the pet.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { H, W, hashSeed, makeGenome } from '../../plugin/hooks/genome'
import { paint } from '../../plugin/hooks/paint'
import type { Pixels, Pose } from '../../plugin/hooks/paint'
import { shade } from '../../plugin/hooks/shade'
import type { Action } from '../../plugin/types'

const SEEDS = [
  'git@github.com:iggy/claudomon.git', 'squishlings', 'resume-site', 'linux', 'react', 'qux', 'dotfiles', 'game',
]
const BG = [30, 30, 30]

type Image = { w: number; h: number; data: Buffer }

const opts: Record<string, string> = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) opts[argv[i]!.replace(/^--/, '')] = argv[i + 1] ?? ''
const seeds = opts.seeds ? opts.seeds.split(',') : SEEDS
const outDir = opts.out ?? 'out/shade'

const pose = (action: Action, extra: Partial<Pose> = {}): Pose => ({
  frame: 4, action, sleeping: false, gaze: null, emote: null, emoteFrame: 0, blinking: false, ...extra,
})

// Columns: what each pet is shown doing, flat then shaded.
const COLUMNS: [string, Action, Partial<Pose>][] = [
  ['idle', 'idle', {}],
  ['walk', 'idle', { walking: true, frame: 1, gaze: { x: 1, y: 0 } }],
  ['read', 'read', {}],
  ['eat', 'eat', {}],
]

function blit(img: Image, px: Pixels, ox: number, oy: number, pw: number, ph: number) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = px[y * W + x]
      const col = c ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : BG
      for (let dy = 0; dy < ph; dy++) {
        for (let dx = 0; dx < pw; dx++) {
          const X = ox + x * pw + dx
          const Y = oy + y * ph + dy
          if (X < img.w && Y < img.h) img.data.set(col, (Y * img.w + X) * 3)
        }
      }
    }
  }
}

function save(img: Image, path: string) {
  const dir = mkdtempSync(join(tmpdir(), 'shade-'))
  const ppm = join(dir, 'f.ppm')
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${img.w} ${img.h}\n255\n`), img.data]))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, path])
  rmSync(dir, { recursive: true })
}

function sheet(path: string, pw: number, ph: number, gap: number) {
  const cw = W * pw + gap
  const ch = H * ph + gap
  const cols = COLUMNS.length * 2
  const img: Image = { w: cw * cols + gap, h: ch * seeds.length + gap, data: Buffer.alloc(0) }
  img.data = Buffer.alloc(img.w * img.h * 3, 0x12)
  seeds.forEach((seed, r) => {
    const g = makeGenome(hashSeed(seed))
    COLUMNS.forEach(([, action, extra], c) => {
      const flat = paint(g, pose(action, extra))
      blit(img, flat, gap + c * 2 * cw, gap + r * ch, pw, ph)
      blit(img, shade(flat, g), gap + (c * 2 + 1) * cw, gap + r * ch, pw, ph)
    })
  })
  save(img, path)
}

mkdirSync(outDir, { recursive: true })
sheet(join(outDir, 'zoom.png'), 10, 10, 10)
sheet(join(outDir, 'real.png'), 7, 8, 14)
console.log(`columns: ${COLUMNS.map(c => `${c[0]} flat | ${c[0]} shaded`).join(' | ')}`)
console.log(`wrote ${outDir}/zoom.png and ${outDir}/real.png`)
