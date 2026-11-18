#!/bin/sh
# bun run spec: typecheck every spec, then simulate the design modules (no violation expected).
# bun run spec:check: also each "before" module must break its invariant (a violation expected).
# No JVM here: TLC runs by tlc.sh (bun run spec:tlc) and by hand (README.md).
# Each run is one job; the jobs run in parallel (JOBS, default the number of cores), each
# with its own fixed seed and one thread, so the answer is the same every time.
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
fail=0
MODE=all
[ "${1:-}" = "__job" ] && MODE=job

# workenv.qnt imports work.qnt; each file typechecks on its own.
[ $MODE = job ] || for f in *.qnt; do
  $Q typecheck "$f" >/dev/null 2>&1 || { echo "FAIL   typecheck $f"; fail=1; }
done
[ $fail = 0 ] || exit 1
[ $MODE = job ] || echo "ok     typecheck $(ls *.qnt | tr '\n' ' ')"

# The seed of a run that found the violation ($4 runs, default 300; $5 steps, default 120; one thread:
# with more threads a seed does not reproduce). Seeds come from `bun run spec:stress`.
breaksW() {
  out=$($Q run workenv.qnt --main="$1" --invariant="$2" --max-samples="${4:-300}" \
    --max-steps="${5:-120}" \
    --seed="$3" --n-threads=1 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[violation\]'; then
    echo "breaks workenv.qnt $1 $2"
  else
    echo "FAIL   workenv.qnt $1 $2 (expected a violation)"
    fail=1
  fi
}

# The new work design (work.qnt, tmux.qnt, workenv.qnt): every proposed check on, honest
# agents, every fault. Smoke size until the review of the model is done.
FLAGS="NoActByEnded NoReviewOfOtherResult NoPassUnderOtherVersion NoStaleReport
  NoUnseenReject NoUnseenAccept NoRejectedDraftInEffect NoLostUpdate NoFailedTestInEffect
  EveryRuleHasForm NoBadReference NoDeepChangeWithoutPerson NoRoleChangeMisjudged
  NoPassOfBrokenResult NoPassOfBadResult NoShallowEvaluation NoStalePipelineAct NoSplitBrain
  RevisionHasContext NoUnrevisedResubmit NoUnrecheckedScope NoMergedInput DoneIsCurrent
  NoDoneBrokenAtEnd NoTakenUndone NoWrittenDropped NoClaimByEnded HostBoundToRunSession
  NoAcceptNotWaiting NoUnacceptedEditChange NoRefixAtSameLevel Converges NoEscalationWithoutPerson
  NoAgentChangeAtTop"
# The coverage gate (keys.sh): each checked property's key witness must be reached, else
# "no violation" would mean nothing. The holds runs use a fixed seed and one thread, so the
# gate gives the same answer every time; the broad random runs are in stress.sh.
. ./keys.sh
# $2: properties the module is known to break (no store check can hold them).
# $3: properties whose key witness the module's environment cannot reach (no such fault).
holdsAll() {
  inv=$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed $FLAGS; do
    case " ${2:-} " in *" $f "*) ;; *) printf '%s ' "$f" ;; esac; done)
  # $4: key witnesses reached by the module's take-as-is twin (holdsKeys), not here.
  wit=$(for w in $(witnessesFor "$inv" "${3:-}"); do
    case " ${4:-} " in *" $w "*) ;; *) printf '%s ' "$w" ;; esac; done)
  holdsRun "$1" "$inv" "$wit"
}
# Every property, and only the key witnesses named ($2), from a deep start module.
holdsKeys() {
  inv=$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed $FLAGS; do
    printf '%s ' "$f"; done)
  holdsRun "$1" "$inv" "$2"
}
holdsRun() {
  inv=$2; wit=$3
  out=$($Q run workenv.qnt --main="$1" --invariants $inv --witnesses $wit \
    --max-samples="${SAMPLES:-400}" --max-steps="${STEPS:-300}" --seed="${SEED:-0x2a}" \
    --n-threads=1 --verbosity=1 2>&1)
  zero=$(echo "$out" | grep -E 'witnessed in 0 trace' | awk '{print $1}' | tr '\n' ' ')
  if ! echo "$out" | grep -q '^\[ok\]'; then
    echo "FAIL   workenv.qnt $1 (expected no violation)"
    echo "$out" | grep -E '❌|^\[' | head -5
    fail=1
  elif [ -n "$zero" ]; then
    echo "FAIL   workenv.qnt $1 coverage: never reached $zero"
    fail=1
  else
    echo "holds  workenv.qnt $1 Sane Told and every flag; every key witness reached"
  fi
}
notAtCap() {
  $Q run workenv.qnt --main="$1" --invariant=NotAtCap --max-samples=400 --max-steps=300 \
    --seed=0x2a --n-threads=1 >/dev/null 2>&1 \
    && echo "holds  workenv.qnt $1 NotAtCap" || { echo "FAIL   workenv.qnt $1 NotAtCap"; fail=1; }
}
pageTest() {
  $Q test workenv_test.qnt --main=pageTest --match=pageOffersTest --max-samples=200 \
    >/dev/null 2>&1 \
    && echo "ok     workenv_test.qnt pageTest" || { echo "FAIL   workenv_test.qnt pageTest"; fail=1; }
}
# The two small models (core.qnt, terminals.qnt; README.md "The small models"): a simulator
# smoke here; TLC proves them (tlc.sh, bun run spec:tlc). $1 file, $2 module, $3 invariants.
smallHolds() {
  out=$($Q run "$1" --main="$2" --invariants $3 --max-samples="${SAMPLES:-400}" \
    --max-steps="${STEPS:-200}" --seed=0x2a --n-threads=1 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[ok\]'; then echo "holds  $1 $2 $3"
  else echo "FAIL   $1 $2 (expected no violation)"; echo "$out" | grep -E '❌' | head -3; fail=1; fi
}
# $1 file, $2 module, $3 invariant, $4 seed, $5 runs, $6 steps: a violation expected.
smallBreaks() {
  out=$($Q run "$1" --main="$2" --invariant="$3" --max-samples="$5" --max-steps="$6" \
    --seed="$4" --n-threads=1 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[violation\]'; then echo "breaks $1 $2 $3"
  else echo "FAIL   $1 $2 $3 (expected a violation)"; fail=1; fi
}
CORE_INV="Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed DoneIsCurrent
  NoDoneBrokenAtEnd NoLostUpdate NoTakenUndone NoPassOfBadResult NoRefixAtSameLevel
  NoEscalationWithoutPerson NoAgentChangeAtTop Converges
  NoWaitCycle AskCap"
CORE_INV=$(echo $CORE_INV)
# A job: optional VAR=value settings (SAMPLES, STEPS), then a function and its arguments.
if [ $MODE = job ]; then
  shift
  while [ $# -gt 0 ] && case "$1" in [A-Z]*=*) true ;; *) false ;; esac; do
    export "$1"; shift
  done
  "$@"; exit $fail
fi

CALMX="NoSplitBrain NoMergedInput NoUnseenReject"
FIXEDX="Converges"
PIPEX="$CALMX NoWrittenDropped NoUnacceptedEditChange NoRefixAtSameLevel DoneIsCurrent"
PIPEX="$PIPEX NoTakenUndone NoPassOfBrokenResult Converges NoEscalationWithoutPerson"
PIPEX="$PIPEX NoAgentChangeAtTop"
# One job per line: a function and its arguments.
JOBLIST=$(mktemp)
trap 'rm -f "$JOBLIST"' EXIT
cat > "$JOBLIST" <<EOF2
STEPS=600 holdsAll convFixed NoShallowEvaluation '$CALMX'
holdsAll fixedHonest '' '$FIXEDX'
holdsAll fixedMaker '' '$FIXEDX' 'wDecideFought wDecideRecheck'
holdsAll fixedHost '' '$FIXEDX' 'wDecideFought wDecideRecheck'
holdsKeys fixedMakerTake 'wDecideFought wDecideRecheck'
holdsKeys fixedHostTake 'wDecideFought wDecideRecheck'
holdsAll fixedCalm '' '$CALMX $FIXEDX'
holdsAll fixedRole 'NoPassOfBadResult NoDoneBrokenAtEnd' '$CALMX RevisionHasContext $FIXEDX'
holdsAll fixedPipe 'NoShallowEvaluation NoPassOfBadResult NoDoneBrokenAtEnd' '$PIPEX'
notAtCap tlcCalm
notAtCap tlcCrash
pageTest
smallHolds core.qnt coreTwo '$CORE_INV'
smallHolds core.qnt coreAll '$CORE_INV'
smallHolds core.qnt coreAskCross '$CORE_INV'
smallHolds core.qnt coreAskRogue '$CORE_INV'
smallHolds core.qnt coreCrossOnly 'Converges'
smallHolds terminals.qnt termFixed 'Sane ExactlyOnce'
smallHolds store.qnt storeFixed 'G3Holds'
smallHolds browser.qnt browserFixed 'DashAfterRefresh'
EOF2
# Each property breaks in its mutant (README.md, Properties): module, property, seed, runs,
# steps.
[ "${1:-}" = "--check" ] && cat >> "$JOBLIST" <<'EOF2'
breaksW beforeMove EveryObligationToldOnce 0x5e44fd5e120b1a31 1000 120
breaksW beforeMove HostBoundToRunSession 0x196af6026bb98550 1000 120
breaksW convNeither Converges 0xe3f192323b0e7585 1000 600
breaksW convNeither NoRefixAtSameLevel 0x5b8147c0398a220a 1000 600
breaksW convNoRaise Converges 0xd7e192ecfa2b8144 1000 600
breaksW convNoRaise NoRefixAtSameLevel 0x54e9878dcdc5f957 1000 600
breaksW convNoSplitLimits Converges 0x2e38dc1f0535f7c0 1000 600
breaksW convNoSplitLimits NoRefixAtSameLevel 0xcbed87547e03ee2f 1000 600
breaksW editNever NoUnacceptedEditChange 0x41523ee5dd6b2305 1000 120
breaksW fixedPipe NoShallowEvaluation 0x40766c0862edb302 1000 120
breaksW fixedRole NoPassOfBadResult 0x3252987e3f31c4ad 1000 120
breaksW mutAccept NoAcceptNotWaiting 0xa1c76ccbdb958d04 1000 120
breaksW mutAccept NoRejectedDraftInEffect 0x1a10971dd24e49e2 1000 120
breaksW mutBuild NoUnseenReject 0xf5cd2516e467a41f 3000 200
breaksW mutCrash NoSplitBrain 0x55338bf96b4df1aa 1000 120
breaksW mutCrash RevisionHasContext 0x7ba6f3072a94bf96 1000 120
breaksW mutCrashHi RevisionHasContext 0xc799eb929dfeaafc 3000 250
breaksW mutDup NoReviewOfOtherResult 0x8f23f3490192d1a0 3000 120
breaksW mutDup NoStalePipelineAct 0xa1506874ac5d6a1b 1000 120
breaksW mutDup NoStaleReport 0xb0e910ae6d3c982d 3000 120
breaksW mutMaker NoActByEnded 0xad8cbea383d27f6d 1000 120
breaksW mutPage DashEscalationMatches 0x24c6ada4f57b6fbb 1000 120
breaksW mutPage DashNoFalseWorking 0x7011a078dd76ba83 1000 120
breaksW mutPage DashQueueActive 0x9e03b70c0ebededa 1000 120
breaksW mutPage DashRowMatches 0x369aee38c74e97dc 1000 120
breaksW mutPage NoUnseenAccept 0x35e560c568bf61a3 3000 120
breaksW mutPipe NoDeepChangeWithoutPerson 0x32a939f0841e28f4 3000 120
breaksW mutPipe NoUnrecheckedScope 0x637715a38e57514f 1000 120
breaksW mutPipe NoUnrevisedResubmit 0x453ffd414d39eaef 1000 120
breaksW mutPipeByz EveryRuleHasForm 0xdee7ea7d69d55e04 3000 200
breaksW mutPipeByz NoFailedTestInEffect 0xd5a325ccbf6df97d 3000 200
breaksW mutPipeByz NoRoleChangeMisjudged 0xfe029299ea717485 3000 200
breaksW mutPipeByz NoShallowEvaluation 0xa87e9314f1719c7f 3000 200
breaksW mutPipeByz NoWrittenDropped 0x69ffad3b81f2d1b 3000 200
breaksW mutRace NoLostUpdate 0x41be667d25cf68fe 3000 200
breaksW mutRace NoPassUnderOtherVersion 0xb7d54a4898518610 3000 120
breaksW mutRecheck NoDoneBrokenAtEnd 0xc4d8a8b3f4faa2b6 1000 120
breaksW mutRecheck NoTakenUndone 0x20f6c41b706a0401 3000 200
breaksW mutRefByz NoBadReference 0x59e4a43fc4bdc4d9 3000 200
breaksW mutRole NoPassOfBadResult 0x1dce0eb1215a4de7 1000 120
breaksW mutRole NoPassOfBrokenResult 0xac3dd10f78658144 1000 120
breaksW mutTmux EveryObligationToldOnce 0x3af612b0424659c9 1000 120
breaksW mutTmux NoMergedInput 0x3e3a29c0b8515052 1000 120
breaksW noDecideRecheck DoneIsCurrent 0xa14c79186e288dff 1000 120
breaksW noLadderRoute NoEscalationWithoutPerson 0xcfb09fbf2e25de13 1000 120
breaksW noListOnAttach EveryObligationToldOnce 0x30fc86f22e8856f5 3000 120
breaksW noRecheckBasis NoPassOfBadResult 0xeedb7b8c46a9b2a4 1000 120
breaksW witnessCalm NoClaimByEnded 0xce25f34abbaa781f 1000 120
smallBreaks core.qnt coreNoRaise Converges 0x2a 500 200
smallBreaks core.qnt coreNoCross Converges 0x2a 500 200
smallBreaks core.qnt coreNoSplit Converges 0x2a 500 200
smallBreaks terminals.qnt termNoEvidence ExactlyOnce 0x2a 2000 60
smallBreaks store.qnt storeBlind G3Holds 0x2a 2000 30
EOF2
JOBS=${JOBS:-$(nproc)}
# -d: one job per line, quotes kept for the job's own shell (slow jobs first).
out=$(xargs -d '\n' -P "$JOBS" -I{} sh -c 'sh ./spec.sh __job {}' < "$JOBLIST" 2>&1 | sort)
echo "$out"
echo "$out" | grep -q '^FAIL' && fail=1
exit $fail
