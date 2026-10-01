#!/bin/sh
# Escape from Barbi Blue: builds the whole house kit on this machine, one job at a time (the bakes use every core, so they
# queue; every job runs at the lowest priority, so the game tests keep the CPU). Each step skips itself when its outputs are
# newer than its script, kitlib.py, defs.py and js/kitdefs.js, so a rerun only redoes what changed. Asset scripts that don't
# exist yet are skipped. Then pack.py (only the stale files) and check_kit.py, whose failure fails the build.
#   tools/blender/kit/build_all.sh [--preview] [--force] [--only <id>] [--sheets]
#   (PY=... to use another Blender Python; --sheets also renders contact sheets of every real asset)
set -e
cd "$(dirname "$0")/../../.."
PY=${PY:-/tmp/claude-0/bpyenv/bin/python}
K=tools/blender/kit
LOG=/tmp/efbb-kit/build.log; mkdir -p /tmp/efbb-kit
SHEETS=0; ARGS=""
for a in "$@"; do if [ "$a" = "--sheets" ]; then SHEETS=1; else ARGS="$ARGS $a"; fi; done
run() { echo "== $(date +%H:%M:%S) $*" | tee -a "$LOG"; nice -n 19 "$PY" "$@" >> "$LOG" 2>&1 || { echo "FAILED: $* (see $LOG)"; exit 1; }; }
start=$(date +%s)
run $K/placeholder.py $(echo "$ARGS" | sed 's/--only [^ ]*//')
# the asset scripts, in the order of the spec's work packages (B13) (when two provide the same node, pack.py takes the newer build)
for s in surfaces2 trims doors windows modules wardrobes fixtures furn_wood furn_tile furn_concrete furn_attic furn_workshop clutter \
         decals sky env glass cookies ao_profiles doll2 lookdev rocking_chair; do
  if [ -f $K/$s.py ]; then run $K/$s.py $ARGS; fi
done
run $K/pack.py all all --if-stale
if nice -n 19 "$PY" $K/check_kit.py --quiet > /tmp/efbb-kit/check.txt 2>&1; then ok=1; else ok=0; fi
tee -a "$LOG" < /tmp/efbb-kit/check.txt
[ $ok = 1 ] || { echo "FAILED: check_kit"; exit 1; }
if [ $SHEETS = 1 ]; then
  for f in wood tile concrete attic workshop common; do run $K/contact_sheets.py --file $f --real; done
fi
echo "kit built in $(( $(date +%s) - start ))s"
