#!/bin/sh
# Give a test project a brand-new identity (so no saved pet state carries
# over between test runs) and print the new pet's outline colour.
#   tools/termcap/newpet.sh <project dir>   ->   #rrggbb
set -e
DIR=$1
NAME="pet-$(date +%s)-$$"
git -C "$DIR" remote set-url origin "git@github.com:example/$NAME.git" 2>/dev/null || git -C "$DIR" remote add origin "git@github.com:example/$NAME.git"
cd "$(dirname "$0")/../.."
TMP=$(mktemp -t newpet).ts
cat > "$TMP" <<TS
import { hashSeed, makeGenome } from '$(pwd)/plugin/hooks/genome.ts'
console.log(makeGenome(hashSeed('git@github.com:example/$NAME.git')).palette.outline)
TS
npx -y tsx "$TMP"
rm -f "$TMP"
