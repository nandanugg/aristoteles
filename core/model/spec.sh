#!/bin/sh
# bun run spec: typecheck every spec, then simulate the design modules (no violation expected).
# bun run spec:check: also each "before" module must break its invariant (a violation expected).
# No JVM here: TLC and Apalache are run by hand (README.md).
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
fail=0

# workenv.qnt imports work.qnt; each file typechecks on its own.
for f in *.qnt; do
  $Q typecheck "$f" >/dev/null 2>&1 || { echo "FAIL   typecheck $f"; fail=1; }
done
[ $fail = 0 ] || exit 1
echo "ok     typecheck $(ls *.qnt | tr '\n' ' ')"

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
  NoAcceptNotWaiting NoUnacceptedEditChange NoRefixAtSameLevel Converges NoEscalationWithoutPerson"
# The coverage gate (keys.sh): each checked property's key witness must be reached, else
# "no violation" would mean nothing. The holds runs use a fixed seed and one thread, so the
# gate gives the same answer every time; the broad random runs are in stress.sh.
. ./keys.sh
# $2: properties the module is known to break (no store check can hold them).
# $3: properties whose key witness the module's environment cannot reach (no such fault).
holdsAll() {
  inv=$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed $FLAGS; do
    case " ${2:-} " in *" $f "*) ;; *) printf '%s ' "$f" ;; esac; done)
  wit=$(witnessesFor "$inv" "${3:-}")
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
CALMX="NoSplitBrain NoMergedInput NoUnseenReject"
# Converges' key witness (near the bound) is required in convFixed only (600 steps).
holdsAll fixedHonest "" Converges
holdsAll fixedMaker "" Converges
holdsAll fixedHost "" Converges
holdsAll fixedCalm "" "$CALMX Converges"
STEPS=600 holdsAll convFixed NoShallowEvaluation "$CALMX"
holdsAll fixedRole "NoPassOfBadResult NoDoneBrokenAtEnd" "$CALMX RevisionHasContext Converges"
# A Byzantine pipeline role seldom carries an edit or a recheck through.
holdsAll fixedPipe "NoShallowEvaluation NoPassOfBadResult NoDoneBrokenAtEnd" \
  "$CALMX NoWrittenDropped NoUnacceptedEditChange NoRefixAtSameLevel DoneIsCurrent NoTakenUndone
  NoPassOfBrokenResult Converges NoEscalationWithoutPerson"
# A regression of the page (it offers every step its view owes the person).
$Q test workenv_test.qnt --main=pageTest --match=pageOffersTest --max-samples=200 \
  >/dev/null 2>&1 \
  && echo "ok     workenv_test.qnt pageTest" || { echo "FAIL   workenv_test.qnt pageTest"; fail=1; }

if [ "${1:-}" = "--check" ]; then
  # Each property breaks in its mutant (README.md, Properties): module, property, seed, runs,
  # steps.
  breaksW beforeMove EveryObligationToldOnce 0x4dffbae5e436cc24 1000 120
  breaksW beforeMove HostBoundToRunSession 0xd09d7b4ff59002d 1000 120
  breaksW convNeither Converges 0xc82db8237ef71886 1000 600
  breaksW convNoRaise Converges 0x6329e11b8bce237b 1000 600
  breaksW convNoScope Converges 0xbbd30cc12b8cad2c 1000 300
  breaksW editNever NoUnacceptedEditChange 0x2ddc9950cc84a442 1000 120
  breaksW fixedPipe NoPassOfBadResult 0xd04d5b41a088c916 1000 120
  breaksW fixedPipe NoShallowEvaluation 0x9d6da3e51e618599 1000 120
  breaksW fixedRole NoPassOfBadResult 0xe8ec111165164ddd 1000 120
  breaksW mutAccept NoAcceptNotWaiting 0xba2a957d6ee03def 1000 120
  breaksW mutAccept NoRejectedDraftInEffect 0x78ec0c1c45532d25 1000 120
  breaksW mutBuild NoUnseenReject 0x793d159d251d3478 3000 200
  breaksW mutCrash NoSplitBrain 0x6e138d285f03a403 1000 120
  breaksW mutDup NoReviewOfOtherResult 0xd4c91b06678774af 3000 120
  breaksW mutDup NoStalePipelineAct 0x962e6919c9994fe3 1000 120
  breaksW mutDup NoStaleReport 0x3242deebe45ce439 3000 120
  breaksW mutMaker NoActByEnded 0x91931fbcbbb7556b 1000 120
  breaksW mutPage DashEscalationMatches 0x56c3c8b5f9d1e4b4 1000 120
  breaksW mutPage DashNoFalseWorking 0xb8ae5ab68f3ac19b 1000 120
  breaksW mutPage DashQueueActive 0xf40aef2bfe329f8a 1000 120
  breaksW mutPage DashRowMatches 0xb84dee0adf8a4718 1000 120
  breaksW mutPage NoUnseenAccept 0x4a718d0b742db6ed 3000 120
  breaksW mutPage NoUnseenReject 0x9e4548d669607b9c 1000 120
  breaksW mutPipe NoDeepChangeWithoutPerson 0xd2ec5c67bff303d8 3000 120
  breaksW mutPipe NoUnrecheckedScope 0xc282319f8b094852 1000 120
  breaksW mutPipe NoUnrevisedResubmit 0x2e9584cab5bc9c1d 1000 120
  breaksW mutPipeByz EveryRuleHasForm 0xa6914d5beabe46d 3000 200
  breaksW mutPipeByz NoFailedTestInEffect 0xeff71ba39965dd3e 3000 200
  breaksW mutPipeByz NoRoleChangeMisjudged 0xe4056a43dbcefbfd 3000 200
  breaksW mutPipeByz NoShallowEvaluation 0x3827b18b6959e5b4 3000 200
  breaksW mutPipeByz NoWrittenDropped 0xee764e4422183171 3000 200
  breaksW mutRace NoLostUpdate 0x5710257864eacbe4 3000 200
  breaksW mutRace NoPassUnderOtherVersion 0xd1fdb79a976aa283 3000 120
  breaksW mutRecheck NoDoneBrokenAtEnd 0xf7a7f5fdc12eaeaf 1000 120
  breaksW mutRefByz NoBadReference 0xffd5c7dcf6030bc6 3000 200
  breaksW mutRole NoPassOfBadResult 0x8f2aa2e3ee38a73 1000 120
  breaksW mutRole NoPassOfBrokenResult 0x10681f5984d8ae48 1000 120
  breaksW mutTmux EveryObligationToldOnce 0xe809e5061af614e3 1000 120
  breaksW mutTmux NoMergedInput 0xd2c1e3ce2ea717bf 1000 120
  breaksW noDecideRecheck DoneIsCurrent 0x9deb2b3146cb611c 1000 120
  breaksW noListOnAttach EveryObligationToldOnce 0x70330eba5fc834c1 3000 120
  breaksW witnessCalm NoClaimByEnded 0xc80a9deda88becc6 1000 120
fi
exit $fail
