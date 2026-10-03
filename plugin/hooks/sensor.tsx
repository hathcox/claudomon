// Draws the pet and its card, and is the only part that hears the pointer:
// an absolutely placed box hands the pointer to its parent, so the pieces
// must belong to this Client to be clickable.
//
// A drag is handled here, on the drawing thread: the held pet moves with
// every pointer move at once, with no round trip through the hooks, which
// only hear where it was dropped.

import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Run = { text: string; fg?: string; bg?: string; bold?: boolean }
export type Piece = { top: number; left: number; runs: Run[]; isPet?: boolean }
export type PetBox = { left: number; top: number; width: number; height: number }
export type SensorProps = { rows: number; pieces: Piece[]; pet: PetBox | null }

type Held = { startX: number; startY: number; dx: number; dy: number; moved: boolean }
type Local = { held: Held | null }

// The listener outlives the render that set it: it reads the latest props.
let latest: SensorProps = { rows: 0, pieces: [], pet: null }

const Sensor: ClientModule<SensorProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest = props

  if (surface.state === undefined) {
    surface.onPointer((e: ClientPointerEvent) => {
      const x = e.fine?.x ?? e.x + 0.5
      const y = e.fine?.y ?? e.y + 0.5
      const held = surface.state?.held ?? null

      // While a button is held the region keeps the pointer, even past its
      // edges (negative or beyond its size): that is what makes a drag.
      if (held) {
        if (e.type === 'move') {
          const dx = Math.round(x - held.startX)
          const dy = Math.round(y - held.startY)
          const moved = held.moved || dx !== 0 || dy !== 0
          if (dx !== held.dx || dy !== held.dy || moved !== held.moved) {
            surface.setState({ held: { ...held, dx, dy, moved } })
          }
        } else if (e.type === 'up') {
          surface.post(held.moved ? { type: 'drop', dx: held.dx, dy: held.dy } : { type: 'tap', x, y })
          surface.setState({ held: null })
        }
        return
      }

      const pet = latest.pet
      const isOnPet = pet !== null && x >= pet.left && x < pet.left + pet.width && y >= pet.top && y < pet.top + pet.height
      if (e.type === 'down' && (e.button ?? 'left') === 'left' && !e.shift && isOnPet) {
        surface.setState({ held: { startX: x, startY: y, dx: 0, dy: 0, moved: false } })
        surface.post({ type: 'grab' })
        return
      }
      if (e.type === 'leave') {
        surface.post({ type: 'leave' })
        return
      }
      surface.post({
        type: 'pointer',
        kind: e.type,
        x,
        y,
        click: e.type === 'down' ? (e.button ?? 'left') : null,
        shift: e.shift === true,
      })
    })
    surface.setState({ held: null })
  }

  const held = surface.state?.held ?? null
  const petTop = props.pet?.top ?? 0
  const petHeight = props.pet?.height ?? 0
  // Held, the pet follows the pointer; up and down only as far as the
  // region's rows go, since a Client draws nothing outside them.
  const dx = held?.dx ?? 0
  const dy = held ? Math.max(-petTop, Math.min(props.rows - petTop - petHeight, held.dy)) : 0
  const pieces = held?.moved ? props.pieces.filter(p => p.isPet) : props.pieces

  return (
    <Box>
      {pieces.map(p => (
        <Box position="absolute" top={p.top + (p.isPet ? dy : 0)} left={p.left + (p.isPet ? dx : 0)}>
          {p.runs.map(r => (
            <Text color={r.fg} backgroundColor={r.bg} bold={r.bold}>
              {r.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Sensor
