#!/bin/sh
# bun run spec: typecheck every spec, then simulate the small models (no violation expected).
# bun run spec:check: also each "before" module must break its invariant (a violation expected).
# No JVM here: TLC runs by tlc.sh (bun run spec:tlc) and by hand (README.md).
# Each run is one job; the jobs run in parallel (JOBS, default the number of cores), each
# with its own fixed seed and one thread, so the answer is the same every time.
set -u
cd "$(dirname "$0")" || exit 1
QUINT=../../node_modules/.bin/quint
fail=0
MODE=all
[ "${1:-}" = "__job" ] && MODE=job

# Each file typechecks on its own (configs.qnt imports properties, which imports check).
[ $MODE = job ] || for file in *.qnt; do
  $QUINT typecheck "$file" >/dev/null 2>&1 || { echo "FAIL   typecheck $file"; fail=1; }
done
[ $fail = 0 ] || exit 1
[ $MODE = job ] || echo "ok     typecheck $(ls *.qnt | tr '\n' ' ')"

# The small models (configs.qnt, terminals.qnt, store.qnt, browser.qnt, pipe.qnt; README.md
# "The small models"): a simulator smoke here; TLC proves them (tlc.sh, bun run spec:tlc).
# $1 file, $2 module, $3 invariants.
smallHolds() {
  out=$($QUINT run "$1" --main="$2" --invariants $3 --max-samples="${SAMPLES:-400}" \
    --max-steps="${STEPS:-200}" --seed=0x2a --n-threads=1 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[ok\]'; then echo "holds  $1 $2 $3"
  else echo "FAIL   $1 $2 (expected no violation)"; echo "$out" | grep -E '❌' | head -3; fail=1; fi
}
# $1 file, $2 module, $3 invariant, $4 seed, $5 runs, $6 steps: a violation expected.
smallBreaks() {
  out=$($QUINT run "$1" --main="$2" --invariant="$3" --max-samples="$5" --max-steps="$6" \
    --seed="$4" --n-threads=1 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[violation\]'; then echo "breaks $1 $2 $3"
  else echo "FAIL   $1 $2 $3 (expected a violation)"; fail=1; fi
}
pipeWitnesses() {
  witnesses="ReplayedAfterRestart ReplayRetired InterruptedWrite
    BufferedKeySurvivesReload GapDrained"
  out=$($QUINT run pipe.qnt --main=pipeWitnesses --witnesses $witnesses --max-samples=8000 \
    --max-steps=200 --seed=0x2a --n-threads=1 --verbosity=1 2>&1)
  if ! echo "$out" | grep -q '^\[ok\]'; then
    echo "FAIL   pipe.qnt pipeFixed witnesses"; echo "$out"; fail=1; return
  fi
  for witness in $witnesses; do
    if echo "$out" | grep -Eq "^$witness was witnessed in [1-9][0-9]* trace"; then
      echo "$out" | grep "^$witness "
    else
      echo "FAIL   pipe.qnt pipeFixed $witness (expected a witness)"; fail=1
    fi
  done
}
CORE_INV="Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed DoneIsCurrent
  NoDoneBrokenAtEnd NoLostUpdate NoTakenUndone NoPassOfBadResult NoRefixAtSameLevel
  NoEscalationWithoutPerson NoAgentChangeAtTop Converges
  NoWaitCycle AskCap NoExecuteToEndedMaker"
CORE_INV=$(echo $CORE_INV)
PIPE_INV="NoKeystrokeTwice NotStuck Prefix AtMostOneWriting WritingIsMarked"
# A job: optional VAR=value settings (SAMPLES, STEPS), then a function and its arguments.
if [ $MODE = job ]; then
  shift
  while [ $# -gt 0 ] && case "$1" in [A-Z]*=*) true ;; *) false ;; esac; do
    export "$1"; shift
  done
  "$@"; exit $fail
fi

# One job per line: a function and its arguments.
JOBLIST=$(mktemp)
trap 'rm -f "$JOBLIST"' EXIT
cat > "$JOBLIST" <<EOF2
smallHolds configs.qnt coreTwo '$CORE_INV'
smallHolds configs.qnt coreTwoDir '$CORE_INV'
smallHolds configs.qnt coreTwoExit '$CORE_INV'
smallHolds configs.qnt coreLoops '$CORE_INV'
smallHolds configs.qnt coreAll '$CORE_INV'
smallHolds configs.qnt coreAsks '$CORE_INV'
smallHolds configs.qnt coreAsksPipe '$CORE_INV'
smallHolds configs.qnt coreAskRogue '$CORE_INV'
smallHolds configs.qnt coreCrossOnly 'Converges'
smallHolds terminals.qnt termFixed 'Sane ExactlyOnce'
smallHolds store.qnt storeFixed 'G3Holds'
smallHolds browser.qnt browserFixed 'DashAfterRefresh'
smallHolds pipe.qnt pipeFixed '$PIPE_INV'
pipeWitnesses
EOF2
# Each property breaks in its mutant (README.md, Properties): file, module, property, seed,
# runs, steps.
[ "${1:-}" = "--check" ] && cat >> "$JOBLIST" <<'EOF2'
smallBreaks configs.qnt coreAskReverse NoWaitCycle 0x2a 500 60
smallBreaks configs.qnt coreTwoExit NoRestartAssigned 0x2a 2000 60
smallBreaks configs.qnt coreTwoExit NoKeptCheckJudged 0x2a 2000 60
smallBreaks configs.qnt coreTwoExit NoKeptFailAssigned 0x2a 2000 60
smallBreaks configs.qnt coreNoRaise Converges 0x2a 2000 200
smallBreaks configs.qnt coreNoCross Converges 0x2a 500 200
smallBreaks configs.qnt coreNoSplit Converges 0x2a 500 200
smallBreaks terminals.qnt termNoEvidence ExactlyOnce 0x2a 5000 200
smallBreaks store.qnt storeBlind G3Holds 0x2a 2000 30
smallBreaks pipe.qnt pipeNoDedup NoKeystrokeTwice 0x2a 2000 100
smallBreaks pipe.qnt pipeMarkAfter NoKeystrokeTwice 0x2a 5000 150
smallBreaks pipe.qnt pipeVolatileMarks NoKeystrokeTwice 0x2a 5000 150
smallBreaks pipe.qnt pipeNoReattach NotStuck 0x2a 2000 200
smallBreaks pipe.qnt pipeNoReconnect NotStuck 0x2a 2000 200
smallBreaks pipe.qnt pipeNoRedraw NotStuck 0x2a 2000 200
EOF2
JOBS=${JOBS:-$(nproc)}
# -d: one job per line, quotes kept for the job's own shell.
out=$(xargs -d '\n' -P "$JOBS" -I{} sh -c 'sh ./spec.sh __job {}' < "$JOBLIST" 2>&1 | sort)
echo "$out"
echo "$out" | grep -q '^FAIL' && fail=1
exit $fail
