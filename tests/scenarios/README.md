# Scenario tests

Real Claude Code sessions at 80x24 in a pseudo-terminal, driven by
`tools/termcap/termcap.py`, with assertions on what is on screen. Run them all
with `tools/check.sh --scenarios`. `@OUTLINE@` is replaced by each run's fresh
pet's outline colour, so no saved state carries over between runs.

Rows are 0-based; the bottom rows of the screen are the prompt and footer, so
"bottom half" checks use rows 10-17.
