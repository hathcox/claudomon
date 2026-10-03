// Offline renders of the pet, straight from the plugin's own painter.
//
//   npx tsx tools/render/render.ts sheet [--seeds a,b,c] [--frame 20] [--out out/sheet.png]
//   npx tsx tools/render/render.ts anim --seed claudomon --action read [--frames 32] [--out out/read.gif]
//   npx tsx tools/render/render.ts all [--seeds a,b,c]   -> out/board/*.gif + sheet.png + board.json
//
// Every pixel is drawn as a SCALE x SCALE square: one terminal cell is one
// pixel wide and two tall, so this is the terminal picture, minus the font.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { H, W, hashSeed, makeGenome } from '../../plugin/hooks/genome'
import { paint } from '../../plugin/hooks/paint'
import type { Emote, Pixels, Pose } from '../../plugin/hooks/paint'
import type { Action } from '../../plugin/types'

const ACTIONS: Action[] = ['idle', 'read', 'eat', 'poop', 'search', 'think', 'tinker']
const DEFAULT_SEEDS = [
  'git@github.com:iggy/claudomon.git', 'squishlings', 'resume-site', 'linux', 'react', 'my-app',
  'foo', 'bar', 'baz', 'qux', 'dotfiles', 'game',
]
const BG_A = [34, 34, 40]
const BG_B = [40, 40, 48]

type Image = { w: number; h: number; data: Buffer }

function args() {
  const [cmd = 'sheet', ...rest] = process.argv.slice(2)
  const opts: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 2) opts[rest[i]!.replace(/^--/, '')] = rest[i + 1] ?? ''
  return { cmd, opts }
}

function canvas(w: number, h: number): Image {
  return { w, h, data: Buffer.alloc(w * h * 3) }
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
}

// Paint one pet frame into `img` at (ox, oy), each pixel `scale` square,
// empty pixels as a faint checker so transparency is visible.
function blit(img: Image, px: Pixels, ox: number, oy: number, scale: number) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = px[y * W + x]
      const col = c ? rgb(c) : (x + y) & 1 ? BG_B : BG_A
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const X = ox + x * scale + dx
          const Y = oy + y * scale + dy
          if (X >= img.w || Y >= img.h) continue
          img.data.set(col, (Y * img.w + X) * 3)
        }
      }
    }
  }
}

function writeImage(img: Image, out: string) {
  mkdirSync(dirname(out), { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'claudomon-'))
  const ppm = join(dir, 'f.ppm')
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${img.w} ${img.h}\n255\n`), img.data]))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, out])
  rmSync(dir, { recursive: true })
}

function pose(action: Action, frame: number, extra: Partial<Pose> = {}): Pose {
  return {
    frame, action, sleeping: false, gaze: null, emote: null, emoteFrame: 0,
    blinking: frame % 37 < 2, ...extra,
  }
}

function sheet(seeds: string[], frame: number, out: string, scale = 6) {
  const cw = (W + 2) * scale
  const ch = (H + 2) * scale
  const img = canvas(cw * ACTIONS.length, ch * seeds.length)
  img.data.fill(0x1a)
  seeds.forEach((seed, r) => {
    const g = makeGenome(hashSeed(seed))
    ACTIONS.forEach((a, c) => blit(img, paint(g, pose(a, frame)), c * cw, r * ch, scale))
  })
  writeImage(img, out)
}

// An animated GIF of one action; `emote` plays a click reaction instead.
function anim(seed: string, action: Action, frames: number, out: string, scale = 8, emote?: Emote) {
  const g = makeGenome(hashSeed(seed))
  const dir = mkdtempSync(join(tmpdir(), 'claudomon-anim-'))
  for (let f = 0; f < frames; f++) {
    const img = canvas(W * scale, H * scale)
    const extra: Partial<Pose> = emote ? { emote, emoteFrame: f % 8 } : {}
    blit(img, paint(g, pose(action, f, extra)), 0, 0, scale)
    writeFileSync(
      join(dir, `f${String(f).padStart(4, '0')}.ppm`),
      Buffer.concat([Buffer.from(`P6\n${img.w} ${img.h}\n255\n`), img.data]),
    )
  }
  mkdirSync(dirname(out), { recursive: true })
  // 8 fps: the plugin ticks every 125 ms.
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-framerate', '8', '-i', join(dir, 'f%04d.ppm'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none',
    '-loop', '0', out,
  ])
  rmSync(dir, { recursive: true })
}

// Every pose the live pet can show, one column each.
const POSES: [string, Partial<Pose>][] = [
  ['idle', {}],
  ['look-left', { gaze: { x: -1, y: 0 } }],
  ['look-right', { gaze: { x: 1, y: 0 } }],
  ['blink', { blinking: true }],
  ['sleep', { sleeping: true }],
  ['happy', { emote: 'happy', emoteFrame: 2 }],
  ['heart', { emote: 'heart', emoteFrame: 2 }],
  ['jump', { emote: 'jump', emoteFrame: 3 }],
  ['type-L', { typing: { side: 0 } }],
  ['purr', { emote: 'purr', emoteFrame: 4 }],
  ['belly', { emote: 'belly', emoteFrame: 2 }],
  ['treat', { emote: 'treat', emoteFrame: 6 }],
  ['treat-heart', { emote: 'treat', emoteFrame: 16 }],
  ['sad', { emote: 'sad', emoteFrame: 0 }],
  ['type-R', { typing: { side: 1 } }],
]

function poses(seeds: string[], out: string, scale: number) {
  const cw = (W + 2) * scale
  const ch = (H + 2) * scale
  const img = canvas(cw * POSES.length, ch * seeds.length)
  img.data.fill(0x1a)
  seeds.forEach((seed, r) => {
    const g = makeGenome(hashSeed(seed))
    POSES.forEach(([, extra], c) =>
      blit(img, paint(g, { ...pose('idle', 4), blinking: false, ...extra }), c * cw, r * ch, scale),
    )
  })
  writeImage(img, out)
  console.log(POSES.map(p => p[0]).join(' | '))
}

const { cmd, opts } = args()
const seeds = opts.seeds ? opts.seeds.split(',') : DEFAULT_SEEDS

if (cmd === 'sheet') {
  sheet(seeds, Number(opts.frame ?? 20), opts.out ?? 'out/sheet.png', Number(opts.scale ?? 6))
} else if (cmd === 'poses') {
  poses(seeds, opts.out ?? 'out/poses.png', Number(opts.scale ?? 8))
} else if (cmd === 'anim') {
  anim(opts.seed ?? seeds[0]!, (opts.action ?? 'idle') as Action, Number(opts.frames ?? 32), opts.out ?? 'out/anim.gif')
} else if (cmd === 'all') {
  const root = opts.out ?? 'out/board'
  sheet(seeds, 20, join(root, 'sheet.png'))
  const index: { seed: string; species: string; gifs: Record<string, string> }[] = []
  for (const seed of seeds.slice(0, Number(opts.animate ?? 4))) {
    const g = makeGenome(hashSeed(seed))
    const gifs: Record<string, string> = {}
    const slug = g.species.toLowerCase()
    for (const a of ACTIONS) {
      gifs[a] = `${slug}-${a}.gif`
      anim(seed, a, 48, join(root, gifs[a]))
    }
    for (const e of ['jump', 'wiggle', 'heart', 'happy'] as Emote[]) {
      gifs[`emote:${e}`] = `${slug}-emote-${e}.gif`
      anim(seed, 'idle', 16, join(root, gifs[`emote:${e}`]), 8, e)
    }
    index.push({ seed, species: g.species, gifs })
  }
  writeFileSync(join(root, 'board.json'), JSON.stringify(index, null, 2))
  console.log(`wrote ${root}`)
} else {
  console.error(`unknown command ${cmd}`)
  process.exit(1)
}
