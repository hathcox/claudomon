# termcap: photograph a real terminal session

Runs a program (normally `claude` with the Claudomon mod) in a pseudo-terminal
at a fixed size, feeds its output through a terminal emulator (`pyte`),
drives it from a script (keys, typing, real SGR mouse events) and renders the
screen to PNG. The point is to see exactly what an 80×24 Apple Terminal shows,
without anyone describing it.

## Setup (once)

```sh
cd tools/termcap
python3 -m venv .venv
.venv/bin/pip install pyte Pillow fonttools
```

## Run

```sh
tools/termcap/.venv/bin/python tools/termcap/termcap.py \
  [--cols 80] [--rows 24] [--out out/termcap] [--cwd <project dir>] [--scale 1] \
  <script.txt> -- claude --plugin-dir <path to the mod>
```

Each `shot NAME` writes `OUT/NAME.png` and `OUT/NAME.txt` (the screen as
text, handy for grepping). `OUT/raw.bin` keeps every byte the program wrote.
A `wait-for` that times out writes `OUT/timeout-<line>.png`. At the end the
DEC private modes the program set are printed (mouse tracking, alt screen…).

Use a scratch project folder as `--cwd` (a git repo with a fixed remote gives
the pet a stable seed). The first run in a new folder shows the trust dialog;
the example scripts answer it.

**Do not send real prompts** in scripts unless you mean to spend tokens:
slash commands such as `/claudomon` are handled locally.

## Script steps

One per line, `#` starts a comment.

| step | does |
| --- | --- |
| `wait <seconds>` | let the program run |
| `wait-for <regex> [timeout]` | until the screen text matches (default 20 s). The prompt's `❯` is followed by a non-breaking space: match `❯\s`, not `❯ ` |
| `type <text>` | send text as typed, no newline |
| `key <name> [count]` | `enter esc tab shift-tab up down left right backspace delete space home end pageup pagedown ctrl-a…ctrl-z` |
| `mouse-move <col> <row>` | SGR 1006 motion, no button (code 35), 1-based cells |
| `mouse-click <col> <row> [left\|right\|middle]` | press + release |
| `shot <name>` | render the screen |
| `dump` | print the screen text to stdout |
| `if <regex> :: <step> [;; <step>…]` | run the steps only when the screen matches |

## Examples

- `examples/pet-tour.txt`: idle, `/claudomon`, `/claudomon big`, mouse, click, back to compact (80×24).
- `examples/eyes.txt`, `examples/eyes-steps.txt`: eye tracking on the full-size pet; run with `--rows 40` so the band has room.

## Things learned the hard way

- **Exit gracefully.** If Claude Code is killed while starting, the next launch
  on this machine uses the *classic* renderer ("fullscreen renderer didn't
  finish starting last time…"), which turns on no mouse tracking at all.
  `termcap` sends ctrl-c twice and waits before it kills anything.
- Claude Code sends `CSI > 4 m` (modifyOtherKeys); pyte reads that as
  "underline on". `sanitize()` drops it, plus the kitty-keyboard, XTVERSION
  and DECXCPR queries pyte would print or crash on.
- The renderer draws block elements (`▀▄█▌▐` and quadrants) as exact
  rectangles, so half-block pixel art comes out pixel-perfect. Other glyphs
  use Menlo, then Apple Symbols / Arial Unicode for what Menlo lacks.
- Child sessions inherit `CLAUDE_CODE_CHILD_SESSION`, so the captured session
  shows a "Transcript saving is off" notice the person's own sessions don't
  have. It also keeps these test sessions out of their history.
