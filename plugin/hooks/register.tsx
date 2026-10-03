import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import { H, hashSeed, levelOf, makeGenome } from './genome'
import type { Genome } from './genome'
import { paint, toStrips } from './paint'
import type { PetProps } from './pet'
import type { Piece } from './sensor'
import { LABELS, classify } from './activity'
import { RowBook, margins, place } from './footing'
import type { Cut } from './footing'
import { MENU_ROWS, MENU_WIDTH, buildMenu, hotspotAt } from './menu'
import type { MenuInfo } from './menu'
import { shade } from './shade'
import { HOVER_TICKS, TICK_MS, drop, giveTreat, grab, hitTest, homeOf, isPetted, isRolledOver, isTyping, tap, isPanelOpen, liftOf, pointAt, poseOf, signature, startStroll, tickStroll } from './stroll'
import type { Stroll } from './stroll'
import type { Action, Activity, Dock, PetView, Shown, SpinnerMode } from '../types'

const pet = atom({ plugin: 'claudomon', key: 'pet' } as const, null)
const activity = atom({ plugin: 'claudomon', key: 'activity' } as const, { action: 'idle', detail: null })
const isNaming = atom({ plugin: 'claudomon', key: 'isNaming' } as const, false)
const spinner = atom({ plugin: 'claudomon', key: 'spinnerNarration' } as const, 'off')
const isHidden = atom({ plugin: 'claudomon', key: 'isHidden' } as const, false)
const anchor = atom({ plugin: 'claudomon', key: 'anchor' } as const, null)
const shown = atom({ plugin: 'claudomon', key: 'shown' } as const, null)
const rowOrder = atom({ plugin: 'claudomon', key: 'rowOrder' } as const, [])
const recentRows = atom({ plugin: 'claudomon', key: 'recentRows' } as const, [])
const dock = atom({ plugin: 'claudomon', key: 'dock' } as const, 'top')
const topless = atom({ plugin: 'claudomon', key: 'topless' } as const, false)
const isWorking = atom({ plugin: 'claudomon', key: 'isWorking' } as const, false)

const ANCHORS = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolGroup', 'ToolResult', 'CommandOutput', 'TurnDuration', 'InfoNotice', 'Spinner'] as const
// Rows the conversation shows: what the pet may stand on.
// Short rows only: the pet stands on top of its footing, so a long reply
// would lift it to the reply's first line. A finished turn uses its
// one-line "done" row (TurnDuration) instead.
const SHOWN_DOORS = new Set(['prompt', 'command'])
// Every row the conversation shows, for its order (the top dock's fallback).
const ORDER_DOORS = new Set(['prompt', 'command', 'response', 'tool-result'])

type Stats = {
  prompts: number
  reads: number
  searches: number
  eaten: number
  pooped: number
  tinkers: number
  pets: number
  launches: number
  keys: number
  treats: number
}
type Record = {
  name: string | null
  xp: number
  born: number
  stats?: Partial<Stats>
  // Where the person last dropped it.
  place?: { dock: Dock; x: number }
  bestWpm?: number
  // Happiness and when it was last set: it fades while nobody is around.
  mood?: { value: number; at: number }
  // When it last ate treats (ms), to know when it is full.
  treats?: number[]
}

const NO_STATS: Stats = { prompts: 0, reads: 0, searches: 0, eaten: 0, pooped: 0, tinkers: 0, pets: 0, launches: 0, keys: 0, treats: 0 }

const OVERLAY_ROWS = Math.ceil(H / 2)


let genome: Genome | null = null
let storeKey = ''
let pendingXp = 0
// Stats this session has added and not yet saved, and the totals as last known.
let pendingStats: Partial<Stats> = {}
let statsNow: Stats = { ...NO_STATS }
let bornAt = 0
let bestWpm = 0
// Happiness, 0..100, as of `moodAt` (ms); it fades a point every five minutes.
let moodValue = 60
let moodAt = 0
let nowMs = 0
let treatTimes: number[] = []
const MOOD_FADE_MS = 5 * 60_000
const FULL_AFTER = 4
const FULL_FOR_MS = 20 * 60_000

function moodNow(): number {
  const faded = moodValue - Math.max(0, nowMs - moodAt) / MOOD_FADE_MS
  return Math.max(0, Math.min(100, faded))
}

function cheer(delta: number) {
  moodValue = Math.max(0, Math.min(100, moodNow() + delta))
  moodAt = nowMs
}

function isFull(): boolean {
  return treatTimes.filter(t => nowMs - t < FULL_FOR_MS).length >= FULL_AFTER
}
// Keystrokes in the prompt: when (in ticks) and how many characters each typed.
const keyLog: [number, number][] = []
const WPM_WINDOW = 80 // ticks: the last ten seconds
let isAppleTerminal = false
let stroll: Stroll = startStroll()
let columns = 80
let stopTicking: (() => void) | null = null
let menuHover: string | null = null
// The row the window's top edge cuts through, as that row's own drawing last
// said: the top dock stands on it, and falls back to the bottom without one.
let toplessNow = false
// The dock the pet was last drawn in (the top falls back to the bottom).
let whereNow: Dock = 'top'
const BUILD = 'diag-4'
let diagPath: string | null = null
// The last few anchor-row renders: component, id, and whether it drew the pet.
const lastRenders: string[] = []
const starts: string[] = []
const ptrLog: string[] = []
// What the clock needs to know, handed over by the hooks that learn it: the
// clock's own $ reads a snapshot of the session's state, so it never sees
// what other hooks write mid-turn (its own writes do reach the drawing).
let currentAction: Action = 'idle'
let footingNow: string | null = null
// The row the pet belongs on at the bottom, whether or not it is on screen.
// Whether each conversation row is on screen, as its own drawing last said.
// Kept outside $.state because drawing may not write state; read by the tick.
const book = new RowBook()
let orderSaved = 0
// The "done" rows of finished turns, in the order they first drew; and the
// first new one to draw after a turn completes becomes the footing.

// Advance the stroll; publish a new drawing only when it would look different.
async function tick($: EngineInterface) {
  if (!genome) return
  stroll = tickStroll(stroll, genome, currentAction, columns)
  if (stroll.tick % 8 === 0) nowMs = await $.clock.now()
  // Rows only say where they are when they draw. After a (re)load nothing has
  // drawn yet, and an idle screen redraws nothing: so ask every row to draw
  // again, once at the start and then now and then while no row has said the
  // top edge cuts it.
  if (stroll.tick === 2 || (book.topRow === null && stroll.dock === 'top' && stroll.tick % 16 === 0)) {
    $.ui.invalidate('ui.render')
  }
  if ((book.topRow === null) !== toplessNow) {
    toplessNow = book.topRow === null
    await update($, topless, () => toplessNow)
  }
  await heal($)
  if (book.order.length !== orderSaved) {
    orderSaved = book.order.length
    await update($, rowOrder, () => [...book.order])
  }
  await publish($, currentAction)
  if (diagPath && stroll.tick % 8 === 0) await diagnose($, diagPath)
}

// Development aid: writes what the pet believes once a second, so a session
// nobody can screenshot can still be inspected. Off for an installed copy
// unless CLAUDOMON_DIAG=<file> asks for it.
async function diagnose($: EngineInterface, path: string) {
  const footing = footingNow
  const rows = book.recent.slice(-8).map(id => ({ id, visible: book.visible.get(id) ?? null }))
  const state = {
    build: BUILD,
    tick: stroll.tick,
    footing,
    isHidden: await read($, isHidden),
    currentAction,
    shown: await read($, shown),
    columns,
    footingVisible: footing ? (book.visible.get(footing) ?? null) : null,
    rows,
    topRow: book.topRow,
    topCandidate: book.topVisible(),
    orderLength: book.order.length,
    home: book.home,
    toplessNow,
    whereNow,
    lastRenders,
    starts,
    ptrLog,
  }
  await $.fs.write(path, JSON.stringify(state, null, 2))
}

// The pet's footing at the bottom is its home row: the newest conversation
// row (or a finished turn's "done" row). Scrolled off screen, the pet steps
// out of view rather than onto an older row (a tall one would put it above
// the screen); back on screen, it returns. A home row that never draws at
// all (stale after a reload) is replaced by the newest row that does.
async function heal($: EngineInterface) {
  if (stroll.tick < 16) return
  if (book.home === null) book.home = footingNow
  if (stroll.tick % 8 === 0) book.settle()
  const want = book.footing()
  if (want !== footingNow) {
    footingNow = want
    await update($, anchor, () => want)
  }
}

async function publish($: EngineInterface, action: Action) {
  if (!genome) return
  const isHovered = stroll.isHovered && stroll.pointer !== null && stroll.tick - stroll.pointer.at < HOVER_TICKS
  const next: Shown = {
    pose: poseOf(stroll, genome, action, moodNow()),
    x: stroll.x,
    lift: liftOf(stroll),
    isHovered: isHovered && !stroll.flight,
    isPanelOpen: isPanelOpen(stroll),
    wpm: isTyping(stroll) ? wpmNow() : null,
    mood: Math.round(moodNow()),
    dock: stroll.dock,
    dragDy: 0,
    menuHover: isPanelOpen(stroll) ? menuHover : null,
  }
  const before = await read($, shown)
  if (!before || signature(before) !== signature(next)) await update($, shown, () => next)
}

// Several sessions in one project feed one pet: each adds its own XP to
// what is stored now, never overwriting another session's.
async function flush($: EngineInterface, patch: Partial<Record> = {}) {
  const saved = ((await $.store.get(storeKey)) as Record | undefined) ?? { name: null, xp: 0, born: await $.clock.now() }
  const stats = { ...NO_STATS, ...saved.stats }
  for (const [k, v] of Object.entries(pendingStats)) stats[k as keyof Stats] += v ?? 0
  const next: Record = {
    ...saved,
    ...patch,
    xp: saved.xp + pendingXp,
    stats,
    bestWpm: Math.max(saved.bestWpm ?? 0, bestWpm),
    mood: { value: moodNow(), at: nowMs },
    treats: treatTimes.filter(t => nowMs - t < FULL_FOR_MS),
  }
  pendingXp = 0
  pendingStats = {}
  statsNow = stats
  bornAt = next.born
  await $.store.set(storeKey, next)
  await update($, pet, view => (view ? { ...view, name: next.name, xp: next.xp } : view))
}

function count(key: keyof Stats, n = 1) {
  if (n <= 0) return
  pendingStats[key] = (pendingStats[key] ?? 0) + n
  statsNow = { ...statsNow, [key]: statsNow[key] + n }
}

async function feed($: EngineInterface, xp: number) {
  pendingXp += xp
  await update($, pet, view => (view ? { ...view, xp: view.xp + xp } : view))
}

async function petProps($: EngineInterface): Promise<PetProps | null> {
  const view = await read($, pet)
  if (!view || !genome) return null
  const now = await read($, activity)
  const { level, into, span } = levelOf(view.xp)
  const label = LABELS[now.action] + (now.detail ? ` ${now.detail}` : '')

  return { genome, activity: now, name: view.name, level, into, span, label, solid: isAppleTerminal }
}

// The sensor covers only the pet's corner and the card beside it, so the
// rest of those rows still take the person's clicks and selections.
function regionLeft(): number {
  return Math.max(0, homeOf(columns, stroll).min + (genome ? genome.cx - genome.halfWidth - 1 : 0) - MENU_WIDTH - 2)
}

// The sensor's rows for each dock, and where the pet, its tag and the card
// sit in them. At the bottom the tag rides above the head; at the top, below
// the feet, with room under it for a hop.
function geometry(where: Dock): { rows: number; petTop: number; tagRow: number; menuTop: number } {
  if (where === 'top') return { rows: OVERLAY_ROWS + 4, petTop: 0, tagRow: OVERLAY_ROWS, menuTop: 0 }
  return { rows: OVERLAY_ROWS + 1, petTop: 1, tagRow: 0, menuTop: OVERLAY_ROWS + 1 - MENU_ROWS }
}

// Where the card stands: just left of the pet.
function menuLeft(petX: number): number {
  const petLeft = petX + (genome ? genome.cx - genome.halfWidth - 1 : 0)
  return clampLeft(petLeft - MENU_WIDTH - 1, MENU_WIDTH)
}

function menuInfo(name: string | null, species: string, xp: number, now: number): MenuInfo {
  const { level, into, span } = levelOf(xp)
  const ageDays = Math.max(0, Math.floor((now - bornAt) / 86_400_000))
  return { name, species, level, into, span, ageDays, stats: statsNow, bestWpm, mood: moodNow() }
}

// The pointer inside the open card: hover lights a hotspot and its tooltip,
// a click runs it. Returns false when the pointer is not on the card.
async function onMenu($: EngineInterface, p: { x: number; y: number; click: string | null }): Promise<boolean> {
  if (!genome) return false
  const row = Math.floor(p.y) - geometry(whereNow).menuTop
  const col = Math.floor(p.x) - menuLeft(stroll.x)
  if (row < 0 || row >= MENU_ROWS || col < 0 || col >= MENU_WIDTH) {
    menuHover = null
    return false
  }
  const view = await read($, pet)
  const menu = buildMenu(menuInfo(view?.name ?? null, genome.species, view?.xp ?? 0, 0), genome.palette, null)
  const spot = hotspotAt(menu, row, col)
  menuHover = spot
  // Keep the card open while the pointer is on it.
  stroll = { ...stroll, panelAt: stroll.tick, pointer: { x: p.x, y: 0, at: stroll.tick }, isHovered: true }
  if (p.click !== 'left' || !spot) return true
  menuHover = null
  if (spot === 'close') stroll = { ...stroll, panelAt: null }
  if (spot === 'rename') {
    stroll = { ...stroll, panelAt: null }
    await update($, isNaming, () => true)
  }
  if (spot === 'launch') {
    count('launches')
    await feed($, 1)
    stroll = pointAt({ ...stroll, panelAt: null }, stroll.x + genome.cx, 4, 'pet', 'launch', columns)
  }
  if (spot === 'treat') {
    // Eaten with delight, unless it has had a few too many lately.
    const full = isFull()
    stroll = giveTreat(stroll, full)
    if (!full) {
      treatTimes.push(nowMs)
      count('treats')
      cheer(15)
      await feed($, 3)
    }
  }
  if (spot === 'nap') stroll = { ...stroll, panelAt: null, isHovered: false, pointer: null, quietSince: stroll.tick - 100_000 }
  if (spot === 'hide') {
    stroll = { ...stroll, panelAt: null }
    await update($, isHidden, () => true)
  }
  return true
}

// Words per minute over the last ten seconds of typing: five characters a word.
function wpmNow(): number {
  while (keyLog.length && stroll.tick - keyLog[0]![0] > WPM_WINDOW) keyLog.shift()
  if (keyLog.length < 2) return 0
  const chars = keyLog.reduce((n, [, c]) => n + c, 0)
  const span = Math.max(16, stroll.tick - keyLog[0]![0]) * (TICK_MS / 1000)
  const wpm = Math.round((chars / 5) * (60 / span))
  if (wpm > bestWpm && keyLog.length >= 20) bestWpm = wpm
  return wpm
}

// Keeps an overlay of `width` cells inside the window.
function clampLeft(left: number, width: number): number {
  return Math.max(0, Math.min(columns - width, left))
}

// The name tag shown over the pet's head while the pointer is on it.
function tagText(name: string | null, species: string, xp: number): string {
  return name ? ` ${name} · Lv${levelOf(xp).level} ✎ ` : ` ${species} · click to name ✎ `
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const repo = await $.session.repo()
    const identity = repo?.remote ?? repo?.root ?? (await $.session.root())
    genome = makeGenome(hashSeed(identity))
    isAppleTerminal = (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal'
    await update($, isNaming, () => false)
    footingNow = await read($, anchor)
    book.home = footingNow
    book.recent = await read($, recentRows)
    book.order = [...(await read($, rowOrder))]
    // In a dev hot-reload folder it always writes, beside the mod; an installed
    // copy writes only when asked.
    const isDev = $.plugin.root.includes('/dev-mods/')
    diagPath = (await $.env.get('CLAUDOMON_DIAG')) ?? (isDev ? `${$.plugin.root}/../claudomon-diag.json` : null)
    starts.push(`${await $.session.id()} interactive=${e.isInteractive} surface=${e.surface}`)
    // Only the session a person is at owns the pet's clock: side sessions
    // (a title, a summary) start too, and must not take the timer over.
    if (e.isInteractive) {
      stopTicking?.()
      const timer = $.clock.every(TICK_MS, () => void tick($))
      stopTicking = () => timer.cancel()
    }
    storeKey = `pet:${identity}`
    const saved = (await $.store.get(storeKey)) as Record | undefined
    const view: PetView = { identity, name: saved?.name ?? null, xp: saved?.xp ?? 0 }
    statsNow = { ...NO_STATS, ...saved?.stats }
    if (saved?.place) stroll = { ...stroll, dock: saved.place.dock, homeX: saved.place.x, x: saved.place.x }
    await update($, dock, () => stroll.dock)
    bornAt = saved?.born ?? (await $.clock.now())
    bestWpm = saved?.bestWpm ?? 0
    nowMs = await $.clock.now()
    moodValue = saved?.mood?.value ?? 60
    moodAt = saved?.mood?.at ?? nowMs
    treatTimes = saved?.treats ?? []
    await update($, pet, () => view)
    await $.command.register({
      name: 'claudomon',
      description: 'Your pet: stats, `name <name>`, `spinner text|off`, `hide`',
    })

    return next(e)
  })

  on('command.run', { command: 'claudomon' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'name' && rest.length > 0) {
      await flush($, { name: rest.join(' ') })
      return { text: `Your pet is now called ${rest.join(' ')}.` }
    }
    if (verb === 'hide') {
      const hidden = await update($, isHidden, v => !v)
      return { text: hidden ? 'Pet tucked away. /claudomon hide brings it back.' : 'Pet is back.' }
    }
    if (verb === 'spinner' && ['text', 'off'].includes(rest[0] ?? '')) {
      await update($, spinner, () => rest[0] as SpinnerMode)
      return { text: `Spinner mode: ${rest[0]}.` }
    }
    const view = await read($, pet)
    if (!view || !genome) return { text: 'No pet yet.' }
    const { level, into, span } = levelOf(view.xp)
    return {
      text: `${view.name ?? 'Your unnamed pet'} the ${genome.species}: level ${level}, ${into}/${span} xp to next (${view.xp} total). Seed ${genome.seed.toString(16)}.`,
    }
  })

  // Every keystroke in the prompt brings a paw down: it types along at the
  // person's own speed. The edit goes on at once; the redraw follows.
  on('prompt.edit', ($, e, next) => {
    if (e.key && genome) {
      stroll = tap(stroll)
      keyLog.push([stroll.tick, e.inputText.length])
      count('keys')
      void publish($, currentAction)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await feed($, 10)
    await update($, isNaming, () => false)
    await update($, isWorking, () => true)
    count('prompts')
    cheer(2)
    currentAction = 'think'
    await update($, activity, (): Activity => ({ action: 'think', detail: null }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const seen = classify(e as unknown as { tool: string })
    currentAction = seen.action
    await update($, activity, (): Activity => ({ action: seen.action, detail: seen.detail }))
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await feed($, seen.xp)
      count('eaten', seen.eaten)
      count('pooped', seen.pooped)
      if (seen.action === 'read') count('reads')
      if (seen.action === 'search') count('searches')
      if (seen.action === 'tinker') count('tinkers')
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    currentAction = 'idle'
    await update($, activity, (): Activity => ({ action: 'idle', detail: null }))
    await update($, isWorking, () => false)
    book.turnEnded()
    await flush($)

    return next(e)
  })

  // The newest shown row of the main conversation is the pet's footing.
  on('session.append', async ($, e, next) => {
    const row = await next(e)
    if (!e.agentId && !e.message.isMeta && ORDER_DOORS.has(e.door) && !SHOWN_DOORS.has(e.door)) book.ordered(e.uuid)
    if (!e.agentId && !e.message.isMeta && SHOWN_DOORS.has(e.door)) {
      footingNow = e.uuid
      book.appended(e.uuid)
      await update($, anchor, () => e.uuid)
      await update($, recentRows, () => book.recent)
      await update($, rowOrder, () => book.order)
    }

    return row
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: string } | null
    if (data?.type === 'rename') await update($, isNaming, () => true)
    if (data?.type === 'leave') {
      menuHover = null
      lastRenders.push('PTR leave')
      stroll = { ...stroll, isHovered: false }
      await publish($, currentAction)
    }
    // The sensor holds a drag itself and reports only its ends.
    if (data?.type === 'grab') {
      stroll = grab(stroll)
      await publish($, currentAction)
    }
    if (data?.type === 'drop' && genome) {
      const d = e.data as { dx: number; dy: number }
      const before = stroll.dock
      stroll = drop(stroll, d.dx, d.dy, columns)
      if (stroll.dock !== before) await update($, dock, () => stroll.dock)
      await flush($, { place: { dock: stroll.dock, x: stroll.x } })
      await publish($, currentAction)
    }
    if (data?.type === 'tap' && genome) {
      // Picked up and let go in place: a click, which launches it.
      count('launches')
      await feed($, 1)
      stroll = pointAt({ ...stroll, drag: null }, stroll.x + genome.cx, 4, 'pet', 'launch', columns)
      await publish($, currentAction)
    }
    if (data?.type === 'pointer' && genome) {
      const raw = e.data as { kind?: string; x: number; y: number; click: string | null; shift?: boolean }
      // The sensor starts at regionLeft(); hit tests work in screen columns.
      const p = { ...raw, x: raw.x + regionLeft() }
      const geo = geometry(whereNow)
      if (isPanelOpen(stroll) && (await onMenu($, p))) {
        await publish($, currentAction)
      } else {
        const view = await read($, pet)
        const tagWidth = tagText(view?.name ?? null, genome.species, view?.xp ?? 0).length
        const hit = hitTest(stroll, genome, p.x, p.y, tagWidth, geo.petTop, geo.tagRow)
        const wantsPanel = p.click === 'right' || (p.click === 'left' && p.shift === true)
        ptrLog.push(`${raw.kind} x=${p.x} y=${p.y} click=${p.click} hit=${hit} strollX=${stroll.x}`)
        if (ptrLog.length > 40) ptrLog.shift()
        if (p.click === 'left' && !wantsPanel && hit === 'tag') await update($, isNaming, () => true)
        const wasPetted = isPetted(stroll)
        const wasRolled = isRolledOver(stroll)
        stroll = pointAt(stroll, p.x, (p.y - geo.petTop) * 2, hit, wantsPanel && hit !== null ? 'panel' : null, columns)
        if (!wasPetted && isPetted(stroll)) {
          // A good pet: it counts, it feeds a little, and it cheers it up.
          count('pets')
          cheer(6)
          await feed($, 2)
        }
        if (!wasRolled && isRolledOver(stroll)) cheer(4)
        await publish($, currentAction)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'terminal') return next(e)
    const props = await petProps($)
    if (!props) return next(e)
    if (!(await read($, isNaming))) return next(e)
    const { Input } = $.ui.resolve(e)

    return (
      <Input
        key="name"
        label="Name your pet"
        placeholder={props.genome.species}
        autoFocus
        submitLabel="name"
        onSubmit={async (value: string) => {
          const name = value.trim()
          if (name) await flush($, { name })
          await update($, isNaming, () => false)
        }}
      />
    )
  })

  // The pet rides on the newest line of the conversation: drawn from inside
  // that row as an absolute layer, so it stands over the text above it.
  // While a turn runs, the spinner is the newest line.
  on('ui.render', { component: ANCHORS }, async ($, e, next) => {
    const own = e.component === 'Spinner' ? await next(await narrate($, e)) : await next(e)
    if (e.surface !== 'terminal') return own
    // A row's drawing re-runs whenever how much of it is on screen changes;
    // absent (the main screen), everything drawn counts as on screen.
    const onScreen = (e.props as { onScreen?: unknown }).onScreen
    const rowId = e.requestId.replace(/^collapsed-/, '')
    const cut = onScreen as Cut
    book.drawn(rowId, e.component, cut, stroll.tick > 16)
    // Reading these subscribes the row: it redraws when any of them changes.
    const placed = place({
      docked: await read($, dock),
      topless: await read($, topless),
      working: await read($, isWorking),
      footing: await read($, anchor),
      topCandidate: book.topRow === null ? book.topVisible() : null,
      rowId,
      component: e.component,
      cut,
    })
    const where: Dock = placed?.where ?? 'bottom'
    const isHere = placed !== null
    lastRenders.push(`${stroll.tick} ${e.component} ${e.requestId.slice(0, 8)} cut=${cut ? `${cut.first}/${cut.last}/${cut.of}` : cut} dock=${where} here=${isHere}`)
    if (lastRenders.length > 20) lastRenders.shift()
    if (!isHere || (await read($, isHidden))) return own
    // Only the row the pet stands on follows its every move.
    const drawing = await read($, shown)
    const props = await petProps($)
    if (!props || !drawing) return own
    columns = e.viewport?.columns ?? columns
    const { Box, Client } = $.ui.resolve(e)
    const geo = geometry(where)
    whereNow = where
    const strips = toStrips(shade(paint(props.genome, drawing.pose), props.genome), props.solid)
    const xp = (await read($, pet))?.xp ?? 0
    const tag = tagText(props.name, props.genome.species, xp)
    const pieces: Piece[] = []
    const origin = regionLeft()
    // A launch arcs up from the bottom dock and down from the top one.
    const rise = where === 'top' ? -drawing.lift : drawing.lift
    if (drawing.wpm !== null && drawing.wpm > 0 && !drawing.isPanelOpen) {
      const label = ` ${drawing.wpm} wpm `
      pieces.push({
        top: geo.tagRow - (where === 'bottom' ? rise : 0),
        left: clampLeft(drawing.x + props.genome.cx - Math.floor(label.length / 2), label.length),
        runs: [{ text: label, fg: '#1b1b2a', bg: props.genome.palette.accent, bold: true }],
      })
    } else if (drawing.isHovered && !drawing.isPanelOpen && !drawing.dragDy) {
      pieces.push({
        top: geo.tagRow - (where === 'bottom' ? rise : 0),
        left: clampLeft(drawing.x + props.genome.cx - Math.floor(tag.length / 2), tag.length),
        runs: [{ text: tag, fg: '#ffffff', bg: props.genome.palette.outline, bold: true }],
      })
    }
    // The card stands beside the pet, to its left, inside the sensor's rows:
    // a Client clips what it draws to its own region.
    if (drawing.isPanelOpen) {
      const menu = buildMenu(menuInfo(props.name, props.genome.species, xp, await $.clock.now()), props.genome.palette, drawing.menuHover)
      const left = menuLeft(drawing.x)
      menu.rows.forEach((runs, i) => pieces.push({ top: geo.menuTop + i, left, runs }))
    }
    for (const strip of strips) {
      pieces.push({ top: geo.petTop + strip.row - rise, left: drawing.x + strip.left, runs: strip.runs, isPet: true })
    }
    const petBox = {
      left: drawing.x + props.genome.cx - props.genome.halfWidth - 1 - origin,
      top: geo.petTop - rise,
      width: 2 * props.genome.halfWidth + 2,
      height: OVERLAY_ROWS,
    }
    // Pieces were placed in screen columns; the sensor starts at `origin`.
    for (const piece of pieces) piece.left -= origin
    const sensor = (
      <Client key="sensor" module="./sensor.tsx" props={{ rows: geo.rows, pieces, pet: petBox }} width={columns - origin} height={geo.rows} />
    )

    // Margins that cancel out lay the overlay over the row's lines without
    // moving the conversation.
    const m = margins(placed!.layout, cut, geo.rows)
    if (placed!.layout === 'above') {
      return (
        <Box flexDirection="column" marginTop={m.marginTop}>
          <Box marginLeft={origin}>{sensor}</Box>
          {own}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {own}
        <Box marginTop={m.marginTop} marginBottom={m.marginBottom} marginLeft={origin}>
          {sensor}
        </Box>
      </Box>
    )
  })
}

async function narrate<E extends RenderInput<'Spinner'>>($: EngineInterface, e: E): Promise<E> {
  const mode = await read($, spinner)
  const props = await petProps($)
  if (mode === 'off' || !props) return e
  const who = props.name ?? `your ${props.genome.species}`
  const doing =
    props.activity.action === 'idle' || props.activity.action === 'think'
      ? e.props.mode === 'responding'
        ? 'writing back'
        : 'thinking'
      : props.label

  return { ...e, props: { ...e.props, message: `${who} is ${doing}` } }
}
