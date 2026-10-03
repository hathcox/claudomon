// The pet itself: a Client module, so it animates, blinks and follows the
// pointer on the drawing thread without a round trip through the hooks.

import type { ClientModule, ClientPointerEvent } from 'claude-code'

import { H, W } from './genome'
import type { Genome } from './genome'
import { paint, toRuns } from './paint'
import type { Emote } from './paint'
import type { Activity } from '../types'

export type PetProps = {
  genome: Genome
  activity: Activity
  name: string | null
  level: number
  into: number
  span: number
  label: string
  // Fill half-empty cells whole (Apple Terminal draws bare half blocks thin).
  solid: boolean
}

type Local = {
  frame: number
  pointer: { x: number; y: number; frame: number } | null
  emote: Emote | null
  emoteAt: number
  nextBlink: number
  lastAction: string
  actionAt: number
}

const TICK_MS = 125
const SLEEP_AFTER = (90 * 1000) / TICK_MS
const LOOK_FOR = (3 * 1000) / TICK_MS
const EMOTES: Emote[] = ['jump', 'wiggle', 'heart', 'happy']

const Pet: ClientModule<PetProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const g = props.genome

  if (surface.state === undefined) {
    const start: Local = {
      frame: 0,
      pointer: null,
      emote: null,
      emoteAt: 0,
      nextBlink: 20,
      lastAction: props.activity.action,
      actionAt: 0,
    }
    surface.every(TICK_MS, () => {
      const s = surface.state ?? start
      surface.setState({ ...s, frame: s.frame + 1 })
    })
    surface.onPointer((e: ClientPointerEvent) => {
      const s = surface.state ?? start
      if (e.type === 'leave') {
        surface.setState({ ...s, pointer: null })
        return
      }
      const pointer = { x: e.fine?.x ?? e.x + 0.5, y: e.fine?.y ?? e.y + 0.5, frame: s.frame }
      if (e.type === 'down' && (e.button === 'right' || e.shift || !props.name)) {
        surface.post({ type: 'rename' })
        surface.setState({ ...s, pointer, actionAt: s.frame })
      } else if (e.type === 'down') {
        const emote = EMOTES[(s.emoteAt + s.frame) % EMOTES.length]!
        surface.post({ type: 'petted', emote })
        surface.setState({ ...s, pointer, emote, emoteAt: s.frame, actionAt: s.frame })
      } else {
        surface.setState({ ...s, pointer })
      }
    })
    surface.setState(start)
  }

  const s = surface.state ?? {
    frame: 0, pointer: null, emote: null, emoteAt: 0, nextBlink: 20, lastAction: 'idle', actionAt: 0,
  }
  const f = s.frame

  // Actions and pointer activity keep it awake; long quiet puts it to sleep.
  let actionAt = s.actionAt
  if (props.activity.action !== s.lastAction) {
    actionAt = f
    surface.setState({ ...s, lastAction: props.activity.action, actionAt })
  }
  const isLooking = s.pointer !== null && f - s.pointer.frame < LOOK_FOR
  const sleeping = props.activity.action === 'idle' && !isLooking && f - actionAt > SLEEP_AFTER

  const emoteFrame = f - s.emoteAt
  const emote = s.emote && emoteFrame < 8 ? s.emote : null

  const blinking = f % 37 === 0 || f % 37 === 1 || (f % 101 === 3)

  let gaze: { x: number; y: number } | null = null
  if (isLooking && s.pointer) {
    // Pointer cells -> pixels: one column is one pixel, one row is two.
    const eyeX = (g.eyes.left + g.eyes.right + g.eyes.size) / 2
    const eyeY = g.eyes.y + g.eyes.size / 2
    const px = s.pointer.x
    const py = s.pointer.y * 2
    gaze = {
      x: px < eyeX - 3 ? -1 : px > eyeX + 3 ? 1 : 0,
      y: py < eyeY - 3 ? -1 : py > eyeY + 3 ? 1 : 0,
    }
  }

  const pixels = paint(g, {
    frame: f,
    action: props.activity.action,
    sleeping,
    gaze,
    emote,
    emoteFrame,
    blinking,
  })
  const rows = toRuns(pixels)

  const filled = Math.round((props.into / Math.max(1, props.span)) * 10)
  const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled)
  const status = sleeping ? 'napping' : props.label
  const hint = props.name ? 'click me · right-click to rename' : 'click me to give me a name!'

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={W} height={Math.ceil(H / 2)}>
        {rows.map(runs => (
          <Box flexDirection="row">
            {runs.map(r => (
              <Text color={r.fg} backgroundColor={r.bg}>
                {r.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Text>
          <Text bold color={g.palette.body}>
            {props.name ?? '???'}
          </Text>
          <Text dimColor> the {g.species}</Text>
        </Text>
        <Text>
          <Text>Lv {props.level} </Text>
          <Text color={g.palette.accent}>{bar}</Text>
          <Text dimColor>
            {' '}
            {props.into}/{props.span}
          </Text>
        </Text>
        <Text italic>{status}</Text>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  )
}

export default Pet
