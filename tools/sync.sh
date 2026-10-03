#!/bin/sh
# Push plugin/ into this session's hot-reload folder (set CLAUDOMON_DEV_DIR).
set -e
cd "$(dirname "$0")/.."
DEST="${CLAUDOMON_DEV_DIR:?set CLAUDOMON_DEV_DIR to the folder your session hot-reloads, e.g. ~/.claude/dev-mods/<session>/claudomon}"
rsync -a --delete --exclude '.claude-plugin/types' plugin/ "$DEST/"
echo "synced -> $DEST"
