# Claudomon

A Claude Code mod (plugin of TypeScript function hooks): a procedural pixel pet,
hatched from the project's git remote, drawn as an overlay on the transcript.
Public repo: https://github.com/hathcox/claudomon (owner account `hathcox`, author Iggy Krajci).

## OPEN BUG — start here

**The pet is often not visible in Iggy's real session** (Apple Terminal, fullscreen
layout, ~142 columns, a long conversation). Tests pass; the real screen does not.
Last live diagnostic (2026-10-02, build 467cdd4):

```
dock top, whereNow bottom, topRow None, topCandidate None, orderLength 25,
toplessNow true, currentAction think
Spinner cdaf264e cut=undefined here=true   <- the mod believes it draws on the spinner
```

So placement says "spinner", but nothing shows. Suspects, in order:
1. The spinner's site is clipped like the prompt area (overlays there cannot rise out
   of it). The 'above' layout (in-flow sensor + `marginTop: -rows`) may be cut off.
   Early prototypes did draw on the spinner — check what changed.
2. `topCandidate` stays null although 25 rows are in `book.order`: the ordered uuids
   may not match the `requestId`s rows render with (ToolGroup ids are
   `collapsed-<id>`, sometimes a tool_use id, not the appended row's uuid), or those
   rows are never `measured` (their `onScreen` is undefined).
3. In Iggy's session no row ever reports `cut.first > 0` (`topRow` stays null), so the
   real top dock never engages; something unhookable sits at the top of the screen.

Do not claim it is fixed until the **live** diagnostic and Iggy's eyes agree. Passing
scenarios have repeatedly not matched his screen: his session is long, wide (142 cols),
and hot-reloads after every turn; the scenarios are short, 80 cols, and fresh.

## Layout

- `plugin/` — the mod. `hooks/register.tsx` wires hooks only; logic lives in pure,
  unit-tested modules:
  - `genome.ts` seed → creature (24×12 px canvas = 24×6 cells); `levelOf`
  - `paint.ts` pose → pixels → cell runs/strips; `shade.ts` pixel-row shading
  - `stroll.ts` the pet's state machine: wander, drag/drop/docks, launch, typing taps,
    petting/belly rubs, treats, mood-driven poses, hit tests
  - `footing.ts` where it stands: `place()`, `margins()`, `RowBook` (row bookkeeping)
  - `menu.ts` the right-click card (40×7); `activity.ts` tool call → action/xp
  - `sensor.tsx` the one Client: draws the pet + card and receives the pointer
  - `sdf.ts`/`shader.ts`/`fit.ts` shader prototype (not used; it lost to pixel art)
- `tests/unit/` node:test suites (`npx -y tsx --test tests/unit/*.test.ts`)
- `tests/scenarios/` real Claude Code sessions at 80×24 with on-screen assertions
- `tools/check.sh` — run before every sync: type-check, validate, unit tests;
  `--scenarios` adds the scenario runs (needs `CLAUDOMON_SCRATCH` with a trusted git
  project dir `petproj/`, else it makes a temp one and the trust prompt is handled)
- `tools/termcap/` pty + pyte recorder: `type`, `key`, `mouse-move/down/drag/up`,
  `wheel`, `find-color`, `shot`, `film`, `measure` (blanked-cell flicker metric),
  `expect-color`, `expect-no-color`, `expect-blanked`. `newpet.sh` gives a fresh pet.
- `tools/tapp/shot.sh` screenshots a real Terminal.app window (the ground truth for
  glyph rendering); `tools/render/render.ts` offline sheets/GIFs (`poses`, `sheet`, `all`).

## Workflow

1. Edit `plugin/`. Add a test for every bug fixed.
2. `tools/check.sh --scenarios` must pass.
3. Sync into the session's hot-reload folder (`CLAUDOMON_DEV_DIR=... tools/sync.sh`, or
   rsync `plugin/` excluding `.claude-plugin/types`). It reloads when the turn ends.
4. Verify on the live session via the diagnostic (below), then commit and push.

Diagnostics: from a dev hot-reload folder (`/dev-mods/` in its path) the mod writes
`<plugin root>/../claudomon-diag.json` every second (dock, whereNow, topRow,
topCandidate, order, footing, last renders with each row's `cut`). Installed copies
write only with `CLAUDOMON_DIAG=<file>`.

## Hard-won facts about the mod API (build 2.1.288)

- The band above the prompt (`AbovePrompt`) and the prompt hint clip overlays to their
  own rows. Only transcript rows can draw a layer over the conversation, via
  `position: absolute` (negative offsets reach above the row).
- An absolute box hands the pointer to its parent: anything clickable must be drawn
  inside the `Client` (sensor). A Client also clips what it draws to its region.
- A sized container box (`width`+`height`) around absolute pieces is cleared whole on
  every redraw → flicker. Place pieces individually; keep the Client unsized inside.
- Drawing is pure: `$.state` writes inside `ui.render` are refused. Track row facts in
  module variables; write state from hooks or the clock.
- The clock's `$` (from `$.clock.every`) reads a stale snapshot of `$.state`; its
  writes do reach drawings. Hand it inputs through module variables.
- Rows report `onScreen` {first,last,of} only when they redraw; idle screens redraw
  nothing, and after a reload nothing has drawn: call `$.ui.invalidate('ui.render')`.
- `session.start` also fires for side sessions; start the clock only when
  `e.isInteractive`.
- Streaming reply text is not a hookable row until it completes.
- `prompt.edit` fires per keystroke (`e.key`, `e.inputText`): return `next(e)` at once.
- Apple Terminal: block glyphs are shorter than the row (stripes); fill solid cells with
  background-coloured spaces, two-tone cells as `▄` fg=bottom bg=top; quadrants render,
  sextants/octants do not; no kitty images, no sub-cell mouse.
- `$.store` is one JSON file per plugin under `~/.claude/plugins/store/`, shared by all
  sessions. Test runs currently pollute Iggy's real store with `pet:git@github.com:example/pet-*`
  entries — make the harness use its own store (open TODO).

## Iggy's preferences

- Look at results yourself (captures, real Terminal.app screenshots) and show boards;
  don't ask him to describe the screen. Plain, short sentences when talking to him.
- Never push untested changes into his live session; never claim fixed without the
  live check.
- Product direction: pet docked top-right by default, draggable; always taps with
  typing; petting → belly rub; treats and mood; pixel-row shading; next big item is
  bigger, richer pixel art (parts library, ~8–9 rows, expressions, evolution).
