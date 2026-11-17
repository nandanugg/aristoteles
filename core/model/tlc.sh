#!/bin/sh
# bun run spec:tlc: TLC on the two small models (README.md "The small models"): every
# reachable state, safety and liveness, by `quint verify --backend=tlc`. One JVM at a time.
# HEAP (default 3G), WORKERS (default 4), OUT (logs; default /tmp/spec-tlc), ONLY (run only
# the lines whose module matches this grep pattern).
# Each job: file, module, the answer expected (holds: no violation; breaks: a violation),
# the invariants (comma-separated, or -) and the temporal properties (comma-separated, or -).
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
OUT=${OUT:-/tmp/spec-tlc}; mkdir -p "$OUT"; rm -f "$OUT/failed"
CFG=$OUT/tlc.json
printf '{"workers":%s,"maxHeap":"-Xmx%s"}\n' "${WORKERS:-4}" "${HEAP:-3G}" > "$CFG"
fail=0
SAFE=Sane,EveryObligationToldOnce,ToldIsAllowed,SomethingOwed,DoneIsCurrent,NoDoneBrokenAtEnd
SAFE=$SAFE,NoLostUpdate,NoTakenUndone,NoPassOfBadResult,NoRefixAtSameLevel
SAFE=$SAFE,NoEscalationWithoutPerson,NoAgentChangeAtTop,Converges
LIVE=CoreProgress,CoreChangesStop
# A copy of the model with only the instance checked: the file up to its "---- instances"
# line, then that module (quint's TLA+ export of a file with many instances overflows).
extract() {
  d=$OUT/src/$2; rm -rf "$d"; mkdir -p "$d"; cp ./*.qnt "$d/"
  end=$(grep -n '^// ---- instances' "$1" | cut -d: -f1)
  { head -n $((end - 1)) "$1"
    awk -v m="module $2 {" '$0==m {p=1} p {print} p && /^}/ {exit}' "$1"; } > "$d/$1"
  echo "$d/$1"
}
run() {
  f=$1; m=$2; want=$3; inv=$4; temp=$5
  log=$OUT/$m-$want.log
  set -- verify "$(extract "$f" "$m")" --main="$m" --backend=tlc --tlc-config "$CFG" --verbosity=3
  [ "$inv" = - ] || set -- "$@" --invariants $(echo "$inv" | tr ',' ' ')
  [ "$temp" = - ] || set -- "$@" --temporal "$temp"
  start=$(date +%s)
  timeout "${TIMEOUT:-7200}" $Q "$@" > "$log" 2>&1
  secs=$(( $(date +%s) - start ))
  n=$(grep -E 'distinct states found' "$log" | tail -1 | sed 's/.*generated, //; s/ distinct.*//')
  if grep -q '^\[ok\]' "$log"; then got=holds
  elif grep -q '^\[violation\]' "$log"; then got=breaks
  else got=error; fi
  if [ "$got" = "$want" ]; then
    echo "$want  $f $m ($n states, ${secs}s)"
  else
    echo "FAIL   $f $m: expected $want, got $got ($n states, ${secs}s; $log)"
    fail=1
  fi
}
jobs() {
  cat <<EOF
terminals.qnt termFixed holds Sane,ExactlyOnce G1All,SendDone
terminals.qnt termNoList breaks - G1All
terminals.qnt termNoReattach breaks - G1All
terminals.qnt termNoPromptArg breaks - G1All
terminals.qnt termNoOutbox breaks - G1All
terminals.qnt termNoOutbox breaks - SendDone
terminals.qnt termNoHostWatch breaks - G1All
terminals.qnt termNoEvidence breaks ExactlyOnce -
core.qnt coreOne holds $SAFE $LIVE
core.qnt coreTwo holds $SAFE $LIVE
core.qnt coreTwoDir holds $SAFE $LIVE
core.qnt coreCrossOnly holds - CoreChangesStop
core.qnt coreNoRaise breaks - CoreChangesStop
core.qnt coreNoCross breaks - CoreChangesStop
core.qnt coreNoSplit breaks - CoreChangesStop
EOF
}
# One run by hand: sh tlc.sh one FILE MODULE holds|breaks INVARIANTS|- TEMPORAL|-
if [ "${1:-}" = one ]; then shift; run "$@"; exit $fail; fi
jobs | grep -E "${ONLY:-.}" | while read -r f m want inv temp; do
  run "$f" "$m" "$want" "$inv" "$temp"
  [ $fail = 0 ] || echo "$m" >> "$OUT/failed"
done
[ -f "$OUT/failed" ] && { rm -f "$OUT/failed"; exit 1; }
exit 0
