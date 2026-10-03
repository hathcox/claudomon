# Claudomon

A pixel pet that lives on your [Claude Code](https://claude.com/claude-code) screen.
Every project hatches its own mon: the project's git remote seeds its shape,
colours, ears and markings, so your teammates' pets for the same repo match yours,
and every other project gets someone new.

It is a [Claude Code mod](https://claude.com/blog/claude-code-mods): a plugin of
TypeScript function hooks.

## What it does

- **Lives on top of your conversation.** It sits in the top-right corner, where
  there is the least to read, drawn as a layer over the text without moving it.
  Drag it anywhere; drop it high to dock at the top, low to dock at the bottom.
- **Acts out what Claude is doing.** Reading files: it reads a book. Searching:
  it runs on a treadmill. Deleting code: it munches a cookie. Writing code: it
  poops. Thinking: a question mark.
- **Types along with you.** Every key you press in the prompt brings a paw down
  on a little keyboard, at your own speed, with your words per minute overhead.
- **Plays.** Hover for its name, click to launch it across the screen,
  right-click for its card: stats, XP, and buttons to name it, nap or hide.
- **Grows.** Prompts, edits and keystrokes feed it XP. One pet per project, shared
  by every Claude Code session you run there.

## Install

```
/plugin marketplace add OWNER/claudomon
/plugin install claudomon@claudomon
```

Commands: `/claudomon` for stats, `/claudomon name <name>`, `/claudomon hide`.

Built and tuned for the fullscreen terminal layout (Claude Code's default). It
works in Apple Terminal, iTerm2, Ghostty, kitty and WezTerm.

## Developing

```
tools/check.sh               # type-check, validate, unit tests (seconds)
tools/check.sh --scenarios   # plus real Claude Code sessions with on-screen assertions
```

- `plugin/` is the mod. Pure logic (`genome`, `paint`, `stroll`, `footing`,
  `menu`, `activity`) is kept apart from the hooks in `register.tsx` so it can
  be unit-tested.
- `tests/unit/` are `node:test` suites run with `tsx`.
- `tests/scenarios/` drive a real session at 80×24 through `tools/termcap`, a
  pseudo-terminal recorder that renders the screen to PNG, sends mouse and keys,
  and asserts what is on screen.
- `tools/render/` renders sprites and animations offline; `tools/tapp/` captures
  a real Apple Terminal window.

## License

MIT
