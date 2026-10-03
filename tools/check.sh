#!/bin/sh
# Everything that must hold before a change reaches a live session:
#   tools/check.sh              type-check, validate, unit tests (seconds)
#   tools/check.sh --scenarios  ...and the scenario tests: real Claude Code
#                               sessions at 80x24 with on-screen assertions
#                               (some ask Haiku for a short reply)
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEV="${CLAUDOMON_DEV_DIR:-}"
FAILED=0

step() { printf '\n== %s\n' "$1"; }

step "type-check"
# The engine lays its API types beside a mod it has loaded; borrow them.
if [ ! -d plugin/.claude-plugin/types ] && [ -n "$DEV" ] && [ -d "$DEV/.claude-plugin/types" ]; then
  cp -R "$DEV/.claude-plugin/types" plugin/.claude-plugin/types
fi
npx -y -p typescript@5 tsc -p plugin && echo "ok"

step "validate"
claude plugin validate plugin | grep -E "✘|passed"
claude plugin validate plugin | grep -q "Validation passed"

step "unit tests"
npx -y tsx --test tests/unit/*.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|^not ok" || true
npx -y tsx --test tests/unit/*.test.ts >/dev/null 2>&1 || { echo "unit tests FAILED"; exit 1; }

if [ "$1" = "--scenarios" ]; then
  step "scenarios"
  SCRATCH="${CLAUDOMON_SCRATCH:-$(mktemp -d -t claudomon-check)}"
  PROJ="$SCRATCH/petproj"
  if [ ! -d "$PROJ/.git" ]; then mkdir -p "$PROJ" && git -C "$PROJ" init -q && printf '# Pet project\n' > "$PROJ/README.md"; fi
  rm -rf "$SCRATCH/plugin" && rsync -a --exclude .claude-plugin/types --exclude tsconfig.json plugin/ "$SCRATCH/plugin/"
  for script in tests/scenarios/*.txt; do
    name=$(basename "$script" .txt)
    OUTLINE=$(tools/termcap/newpet.sh "$PROJ")
    sed "s/@OUTLINE@/$OUTLINE/g" "$script" > "$SCRATCH/$name.txt"
    if tools/termcap/.venv/bin/python tools/termcap/termcap.py --out "out/scenarios/$name" --cwd "$PROJ" "$SCRATCH/$name.txt" \
        -- env TERM_PROGRAM=Apple_Terminal claude --model haiku --plugin-dir "$SCRATCH/plugin" 2>"out/scenarios/$name.log"; then
      echo "  PASS $name"
    else
      echo "  FAIL $name (see out/scenarios/$name.log and its fail-*.png)"
      grep -E "FAIL" "out/scenarios/$name.log" | sed 's/^/       /'
      FAILED=1
    fi
  done
fi

[ $FAILED -eq 0 ] && printf '\nall checks passed\n' || { printf '\nchecks FAILED\n'; exit 1; }
