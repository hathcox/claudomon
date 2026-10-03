// Where the pet stands: which conversation row draws it, and how. Pure, so
// the tests can play scrolls and turns through it; the hooks module feeds it
// what each row's drawing reports about itself.
//
// A row only knows itself: its kind, its id, and `cut`, how much of it the
// window shows (rows scrolled away above it, the last one on screen, and how
// many it has). From that alone each row decides whether the pet is its own.

import type { Dock } from '../types'

export type Cut = { first: number; last: number; of: number } | null | undefined

// How the overlay is laid over the row: just above its first line ('above'),
// from the first line on screen down ('top-cut'), or up to the last line on
// screen ('bottom-cut').
export type Layout = 'above' | 'top-cut' | 'bottom-cut'

export type Place = { where: Dock; layout: Layout }

// The window's top edge cuts through this row: rows of it are scrolled away.
export function isTopCut(cut: Cut, component: string): cut is NonNullable<Cut> {
  return cut != null && cut.first > 0 && component !== 'Spinner'
}

// The window's bottom edge cuts through this row: its last rows are below.
export function isBottomCut(cut: Cut, component: string): cut is NonNullable<Cut> {
  return cut != null && cut.last < cut.of - 1 && component !== 'Spinner'
}

export type PlaceInput = {
  docked: Dock
  // No row is cut by the top edge (a short conversation, or a reply streaming).
  topless: boolean
  working: boolean
  // The row the pet calls home at the bottom while it is on screen; null
  // while it is scrolled away.
  footing: string | null
  // With no row cut by the top edge, the topmost row on screen that has
  // drawn: the top dock stands on its first line instead.
  topCandidate?: string | null
  rowId: string
  component: string
  cut: Cut
}

// Whether this row draws the pet, and how; null when it does not.
export function place(i: PlaceInput): Place | null {
  const topCut = isTopCut(i.cut, i.component)
  if (i.docked === 'top') {
    if (topCut) return { where: 'top', layout: 'top-cut' }
    if (!i.topless) return null
    // No row is cut by the top edge (the top of the screen is something rows
    // cannot be hooked into, or the conversation is short): stand on the
    // topmost row on screen. Failing that, wait while a reply streams in, and
    // stand at the bottom when idle.
    if (i.topCandidate != null) return i.rowId === i.topCandidate && i.cut != null ? { where: 'top', layout: 'top-cut' } : null
    if (i.working) return null
  }
  if (i.working) return i.component === 'Spinner' ? { where: 'bottom', layout: 'above' } : null
  if (i.footing !== null) return i.rowId === i.footing ? { where: 'bottom', layout: 'above' } : null
  // Scrolled up, away from home: the row the bottom edge cuts holds it.
  return isBottomCut(i.cut, i.component) ? { where: 'bottom', layout: 'bottom-cut' } : null
}

// Margins that lay a `rows`-tall overlay over the row without moving the
// conversation: they cancel out, so the row keeps its height. 'above' sits
// before the row's own lines; the cut layouts follow them.
export function margins(layout: Layout, cut: Cut, rows: number): { marginTop: number; marginBottom: number } {
  if (layout === 'above' || !cut) return { marginTop: -rows, marginBottom: 0 }
  if (layout === 'top-cut') {
    const below = cut.of - cut.first
    return { marginTop: -below, marginBottom: below - rows }
  }
  const above = cut.last + 1 - rows - cut.of
  return { marginTop: above, marginBottom: -(above + rows) }
}

export type HomeInput = {
  // The pet's home row: the newest row it was given (a prompt, a command, a
  // finished turn's "done" row); null when it has none yet.
  home: string | null
  // Each row's own last word on whether it is on screen.
  visible: ReadonlyMap<string, boolean>
  // Rows appended since the last turn, oldest first.
  recent: readonly string[]
  // "done" rows in the order they first drew.
  doneRows: readonly string[]
  spinners: ReadonlySet<string>
}

// A home that has never drawn at all is stale (a reload): take the newest row
// that has. A home that has drawn keeps its place even scrolled away.
export function settleHome(i: HomeInput): string | null {
  if (i.home === null || i.visible.has(i.home)) return i.home
  const isShown = (id: string) => i.visible.get(id) === true
  const recent = [...i.recent].reverse().find(isShown)
  const done = [...i.doneRows].reverse().find(isShown)
  const lowest = [...i.visible.entries()].filter(([id, v]) => v && !i.spinners.has(id)).pop()?.[0]
  return recent ?? done ?? lowest ?? i.home
}

// The footing shown: the home row while it is on screen, else none.
export function footingOf(home: string | null, visible: ReadonlyMap<string, boolean>): string | null {
  return home !== null && visible.get(home) === true ? home : null
}

// The bookkeeping behind the pet's footing: what each row's drawing has said
// about itself, and which row is home. One per session; the hooks module
// tells it what happens, in the order it happens.
export class RowBook {
  readonly visible = new Map<string, boolean>()
  readonly spinners = new Set<string>()
  readonly doneRows: string[] = []
  // Rows that say how much of them is on screen (some kinds never do).
  readonly measured = new Set<string>()
  // The row the window's top edge cuts through, as that row last said.
  topRow: string | null = null
  home: string | null = null
  recent: string[] = []

  // A row drew. A "done" row drawing for the first time is the newest row
  // there is (it may draw before the turn is reported complete): home. After
  // a reload every row draws again, top to bottom, so the last one wins.
  drawn(rowId: string, component: string, cut: Cut): void {
    if (component === 'TurnDuration' && !this.visible.has(rowId)) {
      this.doneRows.push(rowId)
      if (this.doneRows.length > 50) this.doneRows.shift()
      this.home = rowId
    }
    this.visible.set(rowId, cut !== null)
    if (cut !== undefined) this.measured.add(rowId)
    if (component === 'Spinner') this.spinners.add(rowId)
    if (this.visible.size > 600) this.visible.delete(this.visible.keys().next().value!)
    if (isTopCut(cut, component)) this.topRow = rowId
    else if (this.topRow === rowId) this.topRow = null
  }

  // A row was added to the conversation (a prompt, a command's output).
  appended(rowId: string): void {
    this.home = rowId
    this.recent = [...this.recent, rowId].slice(-60)
  }

  turnEnded(): void {
    this.recent = []
  }

  // Replace a home that never drew (stale after a reload).
  settle(): void {
    this.home = settleHome({ home: this.home, visible: this.visible, recent: this.recent, doneRows: this.doneRows, spinners: this.spinners })
  }

  footing(): string | null {
    return footingOf(this.home, this.visible)
  }

  // The topmost row on screen: rows enter `visible` in the order they first
  // draw, which is top to bottom, and leave it (false) when scrolled away.
  topVisible(): string | null {
    for (const [id, isShown] of this.visible) if (isShown && this.measured.has(id) && !this.spinners.has(id)) return id
    return null
  }
}
