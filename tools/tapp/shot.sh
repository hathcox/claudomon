#!/bin/sh
# Screenshot a real Apple Terminal window: the ground truth termcap can't give
# (Terminal.app's own glyph heights, its lack of synchronized output).
#
#   tools/tapp/shot.sh OUT_DIR "command to run" [frames=6] [interval=0.3] [settle=9] [cols=80] [rows=24]
#
# Opens a Terminal window sized cols x rows, runs the command, waits `settle`
# seconds, captures `frames` PNGs of only that window, then closes it.
set -e
OUT=$1; CMD=$2; FRAMES=${3:-6}; INTERVAL=${4:-0.3}; SETTLE=${5:-9}; COLS=${6:-80}; ROWS=${7:-24}
mkdir -p "$OUT"
ESC=$(printf '%s; exit' "$CMD" | sed 's/\\/\\\\/g; s/"/\\"/g')
WID=$(osascript -e "tell application \"Terminal\"
  do script \"$ESC\"
  delay 0.4
  set w to front window
  set number of columns of w to $COLS
  set number of rows of w to $ROWS
  return id of w
end tell")
sleep "$SETTLE"
i=1
while [ $i -le "$FRAMES" ]; do
  screencapture -x -o -l "$WID" "$OUT/frame-$i.png"
  sleep "$INTERVAL"
  i=$((i + 1))
done
# Stop what we started cleanly (two interrupts, as a person would), so the
# window closes by itself instead of asking to terminate a running process.
TTY=$(osascript -e "tell application \"Terminal\" to get tty of tab 1 of (first window whose id is $WID)" 2>/dev/null || true)
if [ -n "$TTY" ]; then
  pkill -INT -t "${TTY#/dev/}" claude 2>/dev/null || true; sleep 0.4
  pkill -INT -t "${TTY#/dev/}" claude 2>/dev/null || true; sleep 1
fi
osascript -e "tell application \"Terminal\" to close (every window whose id is $WID) saving no" >/dev/null 2>&1 || true
echo "$OUT ($FRAMES frames, window $WID)"
