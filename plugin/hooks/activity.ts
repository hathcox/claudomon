// What a tool call looks like to the pet, and how much it feeds it. Pure:
// the hooks module calls it; the tests hold it to its rules.

import type { Action, Activity } from '../types'

export const LABELS: { [A in Action]: string } = {
  idle: 'hanging out',
  think: 'thinking',
  read: 'reading',
  search: 'running on the treadmill',
  eat: 'munching deleted code',
  poop: 'pooping out fresh code',
  tinker: 'tinkering',
}

const SEARCH = /^\s*(rg|grep|qgrep|fd|find|ls|tree|sym|git\s+(log|grep|ls-files|status|show|diff))\b/
const LOOK = /^\s*(cat|head|tail|less|sed\s+-n|wc|jq)\b/
const DELETE = /^\s*(rm|git\s+rm|trash)\b/

const lines = (text: string) => (text === '' ? 0 : text.split('\n').length)
const base = (path: string) => path.split('/').pop() ?? path

// What a tool call looks like to the pet, and how much it feeds it.
export function classify(e: { tool: string; [k: string]: unknown }): Activity & { xp: number; eaten?: number; pooped?: number } {
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  switch (e.tool) {
    case 'Read':
      return { action: 'read', detail: base(str('file_path')), xp: 1 }
    case 'WebFetch':
    case 'WebSearch':
      return { action: 'read', detail: 'the internet', xp: 1 }
    case 'Edit': {
      const removed = lines(str('old_string'))
      const added = lines(str('new_string'))
      const action = removed > added ? 'eat' : 'poop'
      return { action, detail: base(str('file_path')), xp: Math.min(40, removed + added), eaten: removed, pooped: added }
    }
    case 'Write':
    case 'NotebookEdit':
      return { action: 'poop', detail: base(str('file_path') || str('notebook_path')), xp: Math.min(40, Math.ceil(lines(str('content')) / 2)), pooped: lines(str('content')) }
    case 'Bash': {
      const cmd = str('command')
      const head = cmd.trim().split(/\s+/).slice(0, 2).join(' ')
      if (DELETE.test(cmd)) return { action: 'eat', detail: head, xp: 2 }
      if (SEARCH.test(cmd)) return { action: 'search', detail: head, xp: 1 }
      if (LOOK.test(cmd)) return { action: 'read', detail: head, xp: 1 }
      return { action: 'tinker', detail: head, xp: 1 }
    }
    case 'ToolSearch':
    case 'Glob':
    case 'Grep':
      return { action: 'search', detail: null, xp: 1 }
    case 'Agent':
    case 'TodoWrite':
      return { action: 'think', detail: null, xp: 1 }
    default:
      return { action: 'tinker', detail: e.tool, xp: 1 }
  }
}
