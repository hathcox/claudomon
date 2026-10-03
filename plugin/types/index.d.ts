export type Action =
  | 'idle'
  | 'think'
  | 'read'
  | 'search'
  | 'eat'
  | 'poop'
  | 'tinker'

export type Emote = 'jump' | 'wiggle' | 'heart' | 'happy' | 'purr'

export type Pose = {
  frame: number
  action: Action
  sleeping: boolean
  // -1, 0 or 1 on each axis; null means "look where the action says".
  gaze: { x: number; y: number } | null
  emote: Emote | null
  emoteFrame: number
  blinking: boolean
  walking?: boolean
  // Typing in the prompt: which paw is down on the keyboard.
  typing?: { side: 0 | 1 } | null
}

// What the pet looks like right now and where it stands.
export type Dock = 'top' | 'bottom'

export type Shown = {
  pose: Pose
  x: number
  dock: Dock
  // Rows the pet is held below (positive) or above its resting row while dragged.
  dragDy: number
  // Rows above its footing, while it flies.
  lift: number
  isHovered: boolean
  isPanelOpen: boolean
  // What the pointer is on inside the open card, for its highlight and tooltip.
  menuHover: string | null
  // Words per minute while the person types; null when they are not typing.
  wpm: number | null
}

export type SpinnerMode = 'text' | 'off'

export type Activity = { action: Action; detail: string | null }

export type PetView = {
  identity: string
  name: string | null
  xp: number
}

declare module 'claude-code' {
  interface PluginState {
    claudomon: {
      pet: PetView | null
      activity: Activity
      isNaming: boolean
      spinnerNarration: SpinnerMode
      isHidden: boolean
      anchor: string | null
      isWorking: boolean
      shown: Shown | null
      dock: Dock
      topless: boolean
      recentRows: string[]
    }
  }
}
