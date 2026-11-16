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

# The seed of a run that found the violation (300 runs, 120 steps, one thread:
# with more threads a seed does not reproduce).
breaksW() {
  out=$($Q run workenv.qnt --main="$1" --invariant="$2" --max-samples=300 --max-steps=120 \
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
FLAGS="NoActByEnded NoReviewOfOtherResult NoPassUnderOtherVersion NoStaleReport NoUnseenReject
  NoUnseenAccept NoRejectedDraftInEffect NoLostUpdate NoFailedTestInEffect EveryRuleHasForm
  NoBadReference NoDeepChangeWithoutPerson NoRoleChangeMisjudged NoPassOfBrokenResult
  NoPassOfBadResult NoShallowEvaluation NoStalePipelineAct NoSplitBrain RevisionHasContext
  NoUnrevisedResubmit NoUnrecheckedScope NoMergedInput NoDoneUnderOldVersion
  HostBoundToRunSession C1aConfirmed ChangesWithinBudget DashNoFalseWorking DashInactiveReal
  DashQueueActive DashEscalationMatches DashRowMatches NoAcceptNotWaiting
  NoUnacceptedEditChange"
holdsAll() {
  out=$($Q run workenv.qnt --main="$1" --invariants Sane EveryObligationToldOnce ToldIsAllowed \
    SomethingOwed $FLAGS --max-samples="${SAMPLES:-200}" --max-steps=100 --verbosity=1 2>&1)
  if echo "$out" | grep -q '^\[ok\]'; then
    echo "holds  workenv.qnt $1 Sane Told and every flag"
  else
    echo "FAIL   workenv.qnt $1 (expected no violation)"
    echo "$out" | grep -E '❌|^\[' | head -5
    fail=1
  fi
}
holdsAll fixedHonest

if [ "${1:-}" = "--check" ]; then
  # The new work design: each property breaks in its mutant (README.md, Properties).
  breaksW mutMaker NoActByEnded 0xff427e93af58b980
  breaksW mutDup NoStalePipelineAct 0x5c00ca5e97e94971
  breaksW mutPage NoUnseenReject 0x59871a40ce09d41b
  breaksW mutRace NoLostUpdate 0xc7aa8e27d66a37e6
  breaksW mutCrash NoSplitBrain 0xad7a4dfd5d2e1d5f
  breaksW beforeMove HostBoundToRunSession 0x9cb0eef4da5d2c51
  breaksW beforeMove EveryObligationToldOnce 0xab78ee91234d7614
  breaksW witnessCalm C1bHosted 0xd7f454bb20c28c30
  breaksW mutPage DashNoFalseWorking 0xc1b5d4382172a0
  breaksW mutPage DashEscalationMatches 0xb8bd5b9c88a12e3b
  breaksW mutAccept NoAcceptNotWaiting 0x6261347cac52c859
  breaksW editNever NoUnacceptedEditChange 0x7e2c1e8b5c3c271
  breaksW mutPipe EveryRuleHasForm 0x9d2d1263d2bc4c1e
  breaksW mutPipe NoShallowEvaluation 0x91c9b2c492f01984
  breaksW mutPipe NoFailedTestInEffect 0x58ccc47c6d633b82
  breaksW mutRef NoBadReference 0x57f2a99d802798df
  breaksW mutPipe NoUnrevisedResubmit 0x538f466862dcdd12
  breaksW mutPipe NoUnrecheckedScope 0x1a577c4a0367d4f
  breaksW mutRole NoPassOfBrokenResult 0x8c89db99bcc09c51
  breaksW mutRole NoPassOfBadResult 0x422ffbac13180640
  breaksW fixedRole NoPassOfBadResult 0xb4f481c6c3af2dd1
  breaksW fixedPipe NoShallowEvaluation 0xad73e6680cbcb713
  breaksW mutTmux NoMergedInput 0x7d1cd234bf20dd2a
  breaksW mutTmux EveryObligationToldOnce 0x2b32f2b925922aef
  breaksW mutDash DashInactiveReal 0x8d2da2cc2d856ce6
  breaksW mutPage DashQueueActive 0x70a5cafa530f4337
  breaksW mutPage DashRowMatches 0x85db316609f6879d
fi
exit $fail
