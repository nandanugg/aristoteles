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

# The seed of a run that found the violation ($4 runs, default 300; 120 steps; one thread:
# with more threads a seed does not reproduce). Seeds come from `bun run spec:stress`.
breaksW() {
  out=$($Q run workenv.qnt --main="$1" --invariant="$2" --max-samples="${4:-300}" --max-steps=120 \
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
FLAGS="PageOffersPersonObs NoActByEnded NoReviewOfOtherResult NoPassUnderOtherVersion
  NoStaleReport NoUnseenReject NoUnseenAccept NoRejectedDraftInEffect NoLostUpdate
  NoFailedTestInEffect EveryRuleHasForm NoBadReference NoDeepChangeWithoutPerson
  NoRoleChangeMisjudged NoPassOfBrokenResult NoPassOfBadResult NoShallowEvaluation
  NoStalePipelineAct NoSplitBrain RevisionHasContext NoUnrevisedResubmit NoUnrecheckedScope
  NoMergedInput NoDoneUnderOldVersion DoneIsCurrent NoDoneBrokenAtEnd NoClaimByEnded
  HostBoundToRunSession C1aConfirmed DashInactiveReal LiveNotInactive NoAcceptNotWaiting
  NoUnacceptedEditChange"
# $2: properties the module is known to break (the store cannot prevent them).
holdsAll() {
  inv=$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed $FLAGS; do
    case " ${2:-} " in *" $f "*) ;; *) printf '%s ' "$f" ;; esac; done)
  out=$($Q run workenv.qnt --main="$1" --invariants $inv --max-samples="${SAMPLES:-150}" \
    --max-steps=100 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[ok\]'; then
    echo "holds  workenv.qnt $1 Sane Told and every flag"
  else
    echo "FAIL   workenv.qnt $1 (expected no violation)"
    echo "$out" | grep -E '❌|^\[' | head -5
    fail=1
  fi
}
holdsAll fixedHonest
holdsAll fixedMaker
holdsAll fixedHost
holdsAll fixedCalm
holdsAll c1b
holdsAll fixedRole NoPassOfBadResult
holdsAll fixedPipe NoShallowEvaluation

if [ "${1:-}" = "--check" ]; then
  # Each property breaks in its mutant (README.md, Properties): module, property, seed, runs.
  breaksW beforeBind HostBoundToRunSession 0x7a47477f765fd81e 1000
  breaksW beforeMove EveryObligationToldOnce 0xc64c6d505bfbdd97 300
  breaksW beforeMove HostBoundToRunSession 0xc0a820bfd8a8a10c 300
  breaksW editNever NoUnacceptedEditChange 0xe80d6164492c0126 300
  breaksW fixedPipe NoShallowEvaluation 0x7fab2f025cd8cd33 300
  breaksW fixedRole NoPassOfBadResult 0x14e0fbf5687beee1 300
  breaksW mutAccept NoAcceptNotWaiting 0xe4025682223b478f 300
  breaksW mutAccept NoRejectedDraftInEffect 0x5892b989ef2f88c 1000
  breaksW mutBuild NoUnseenReject 0x65eb144540cf3a3d 1000
  breaksW mutCrash NoSplitBrain 0x66844b1fcd13e48d 300
  breaksW mutDash DashInactiveReal 0xcdf98e41c2f60e38 300
  breaksW mutDup C1aConfirmed 0xc7786be3a19a4187 1000
  breaksW mutDup NoReviewOfOtherResult 0x500741b2e64a04bd 1000
  breaksW mutDup NoStalePipelineAct 0xeb4cd7185472e26b 300
  breaksW mutDup NoStaleReport 0x7a16b206dc5b8c5e 1000
  breaksW mutMaker NoActByEnded 0xe2ccda6e3803c181 1000
  breaksW mutPage DashEscalationMatches 0x97c0d10fa3573ade 300
  breaksW mutPage DashNoFalseWorking 0x350d8073ac579aec 300
  breaksW mutPage DashQueueActive 0x446e14e05e361201 300
  breaksW mutPage DashRowMatches 0x8bee8b564fe069a5 300
  breaksW mutPage NoUnseenReject 0x73e87a7871706bfd 300
  breaksW mutPipe EveryRuleHasForm 0x95f1e7559eb308c 300
  breaksW mutPipe NoFailedTestInEffect 0xa365bae619fdef9b 300
  breaksW mutPipe NoShallowEvaluation 0x3f87549f00952b43 300
  breaksW mutPipe NoUnrecheckedScope 0x883245973dea6145 300
  breaksW mutPipe NoUnrevisedResubmit 0xbffc085dd238228d 300
  breaksW mutQuiet LiveNotInactive 0xbaf48fd80ca44a3f 300
  breaksW mutRace NoLostUpdate 0x4801f75ba5cb9458 1000
  breaksW mutRef NoBadReference 0x3903932251a665a2 300
  breaksW mutRole NoPassOfBadResult 0x9b47c7c36c525d37 300
  breaksW mutTmux EveryObligationToldOnce 0xb57a4bcc94b588ab 300
  breaksW mutTmux NoMergedInput 0x15f41d898673eb5c 300
  breaksW noDecideRecheck DoneIsCurrent 0x3fe976a2ac1d373a 1000
  breaksW witnessCalm C1bHosted 0x400d2b50291330b6 300
  breaksW witnessCalm NoClaimByEnded 0x11ced95a209d1fb6 1000
fi
exit $fail
