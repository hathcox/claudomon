// The card a right-click opens: header, XP, a grid of stat icons and a row of
// buttons, with a footer line that explains whatever the pointer is on.
// Pure layout: rows of styled runs plus the hotspots the pointer can hit.

import type { Palette } from './genome'

export type Run = { text: string; fg?: string; bg?: string; bold?: boolean }
export type Hotspot = { id: string; row: number; from: number; to: number }
export type Menu = { width: number; rows: Run[][]; spots: Hotspot[] }

export type MenuInfo = {
  name: string | null
  species: string
  level: number
  into: number
  span: number
  ageDays: number
  stats: {
    prompts: number
    reads: number
    searches: number
    eaten: number
    pooped: number
    tinkers: number
    launches: number
    keys: number
  }
  bestWpm: number
}

export const MENU_WIDTH = 38
export const MENU_ROWS = 7

const PANEL = '#20212b'
const RAISED = '#2d2f3d'
const TEXT = '#e8e9f2'
const DIM = '#9497ab'

// Each icon is a single astral-plane emoji: two cells wide, and two UTF-16
// units long, so a string's length is its width in cells throughout.
const STATS: { id: string; icon: string; key: keyof MenuInfo['stats'] | 'age' | 'wpm'; tip: string }[] = [
  { id: 'reads', icon: '📖', key: 'reads', tip: 'Files read: every Read, cat, head and tail' },
  { id: 'searches', icon: '🔍', key: 'searches', tip: 'Searches: laps on the treadmill (rg, grep, find)' },
  { id: 'prompts', icon: '💬', key: 'prompts', tip: 'Prompts fed: 10 xp each' },
  { id: 'keys', icon: '🎹', key: 'keys', tip: 'Keys typed in the prompt: a paw for every one' },
  { id: 'eaten', icon: '🍪', key: 'eaten', tip: 'Lines of code eaten: removed by edits' },
  { id: 'pooped', icon: '💩', key: 'pooped', tip: 'Lines of code pooped: written or added' },
  { id: 'wpm', icon: '🏁', key: 'wpm', tip: 'Your best typing speed, in words per minute' },
  { id: 'age', icon: '🎂', key: 'age', tip: 'Days since it hatched in this project' },
]

export const BUTTONS: { id: string; label: string; tip: string }[] = [
  { id: 'rename', label: '📝 Name', tip: 'Give it a name' },
  { id: 'launch', label: '🚀 Fly', tip: 'Launch it across the corner' },
  { id: 'nap', label: '💤 Nap', tip: 'Let it doze until you come back' },
  { id: 'hide', label: '🙈 Hide', tip: 'Tuck it away; /claudomon hide brings it back' },
]

const CLOSE = { id: 'close', label: ' ✕ ', tip: 'Close this card' }

function compact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function buildMenu(info: MenuInfo, p: Palette, hover: string | null): Menu {
  const W = MENU_WIDTH
  const rows: Run[][] = []
  const spots: Hotspot[] = []
  const fill = (runs: Run[], bg = PANEL): Run[] => {
    const used = runs.reduce((n, r) => n + r.text.length, 0)
    return used < W ? [...runs, { text: ' '.repeat(W - used), bg }] : runs
  }

  // Header: name and level on the pet's own outline colour, close at the right.
  const title = info.name ? `${info.name} the ${info.species}` : `an unnamed ${info.species}`
  const lv = `Lv ${info.level} `
  const room = W - lv.length - CLOSE.label.length - 1
  const head = ` ${title}`.slice(0, room).padEnd(room)
  rows.push([
    { text: head, fg: '#ffffff', bg: p.outline, bold: true },
    { text: lv, fg: p.belly, bg: p.outline, bold: true },
    { text: ' ', bg: p.outline },
    { text: CLOSE.label, fg: hover === 'close' ? '#1b1b2a' : '#ffffff', bg: hover === 'close' ? p.body : p.outline, bold: true },
  ])
  spots.push({ id: 'close', row: 0, from: W - CLOSE.label.length, to: W })

  // XP bar, drawn with background cells so it fills solidly in any terminal.
  const barWidth = 20
  const filled = Math.round((info.into / Math.max(1, info.span)) * barWidth)
  const xpText = ` ${info.into}/${info.span} xp`
  rows.push(
    fill([
      { text: ' ', bg: PANEL },
      { text: ' '.repeat(filled), bg: p.accent },
      { text: ' '.repeat(barWidth - filled), bg: RAISED },
      { text: xpText, fg: DIM, bg: PANEL },
    ]),
  )
  spots.push({ id: 'xp', row: 1, from: 1, to: 1 + barWidth })

  // Two rows of four stat cells: icon and value, each cell 9 wide.
  const cellWidth = 9
  for (let r = 0; r < 2; r++) {
    const runs: Run[] = [{ text: ' ', bg: PANEL }]
    let col = 1
    for (const s of STATS.slice(r * 4, r * 4 + 4)) {
      const value = s.key === 'age' ? `${info.ageDays}d` : s.key === 'wpm' ? `${info.bestWpm}` : compact(info.stats[s.key])
      const isHover = hover === s.id
      const bg = isHover ? RAISED : PANEL
      const body = `${s.icon} ${value}`
      runs.push({ text: body, fg: isHover ? '#ffffff' : TEXT, bg, bold: isHover })
      runs.push({ text: ' '.repeat(Math.max(0, cellWidth - body.length)), bg })
      spots.push({ id: s.id, row: 2 + r, from: col, to: col + cellWidth })
      col += cellWidth
    }
    rows.push(fill(runs))
  }

  // Buttons: raised chips; the hovered one lights up in the pet's colour.
  const buttons: Run[] = [{ text: ' ', bg: PANEL }]
  let col = 1
  BUTTONS.forEach((b, i) => {
    const isHover = hover === b.id
    const chip = ` ${b.label} `
    buttons.push({ text: chip, fg: isHover ? '#1b1b2a' : TEXT, bg: isHover ? p.body : RAISED, bold: isHover })
    if (i < BUTTONS.length - 1) buttons.push({ text: ' ', bg: PANEL })
    spots.push({ id: b.id, row: 4, from: col, to: col + chip.length })
    col += chip.length + 1
  })
  rows.push(fill(buttons))

  // A blank row, then the tooltip footer for whatever is hovered.
  rows.push(fill([]))
  const tip =
    [...STATS, ...BUTTONS, CLOSE].find(x => x.id === hover)?.tip ??
    (hover === 'xp' ? `${info.span - info.into} xp to level ${info.level + 1}` : 'Hover an icon for details')
  rows.push(fill([{ text: ` ${tip}`.slice(0, W), fg: hover ? TEXT : DIM, bg: PANEL }]))

  return { width: W, rows, spots }
}

export function hotspotAt(menu: Menu, row: number, col: number): string | null {
  return menu.spots.find(s => s.row === row && col >= s.from && col < s.to)?.id ?? null
}
