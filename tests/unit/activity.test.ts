import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classify } from '../../plugin/hooks/activity'

const cases: [Record<string, unknown>, string][] = [
  [{ tool: 'Read', file_path: '/a/b/c.ts' }, 'read'],
  [{ tool: 'WebFetch', url: 'x' }, 'read'],
  [{ tool: 'Edit', file_path: 'x.ts', old_string: 'a\nb\nc', new_string: 'a' }, 'eat'],
  [{ tool: 'Edit', file_path: 'x.ts', old_string: 'a', new_string: 'a\nb\nc' }, 'poop'],
  [{ tool: 'Write', file_path: 'x.ts', content: 'hello\nworld' }, 'poop'],
  [{ tool: 'Bash', command: 'rg -n foo .' }, 'search'],
  [{ tool: 'Bash', command: 'qgrep -rn foo src' }, 'search'],
  [{ tool: 'Bash', command: 'git log --oneline' }, 'search'],
  [{ tool: 'Bash', command: 'cat README.md' }, 'read'],
  [{ tool: 'Bash', command: 'rm -rf build' }, 'eat'],
  [{ tool: 'Bash', command: 'npm test' }, 'tinker'],
  [{ tool: 'Agent', prompt: 'x' }, 'think'],
  [{ tool: 'SomethingNew' }, 'tinker'],
]

test('each tool call becomes the action the pet acts out', () => {
  for (const [call, action] of cases) assert.equal(classify(call as { tool: string }).action, action, JSON.stringify(call))
})

test('edits count the lines eaten and pooped, and feed at most 40 xp', () => {
  const eat = classify({ tool: 'Edit', file_path: 'x', old_string: 'a\nb\nc\nd', new_string: 'a' })
  assert.equal(eat.eaten, 4)
  assert.equal(eat.pooped, 1)
  const big = classify({ tool: 'Write', file_path: 'x', content: 'l\n'.repeat(500) })
  assert.equal(big.xp, 40)
  assert.equal(classify({ tool: 'Read', file_path: '/very/deep/file.tsx' }).detail, 'file.tsx')
})
