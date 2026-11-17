#!/bin/sh
# bun run spec:stress: the long runs, for the check machine (README.md "How to run").
# 1. Each holds module: no violation in 3000 runs of 300 steps, and the key witness of every
#    property it checks reached (keys.sh).
# 2. Each mutant: a seed that breaks its property (runs and steps as given, one thread so
#    the seed reproduces); it prints the line for spec.sh, or "not seen".
# 3. The witness sweep: every witness over the witness modules; it prints the ones never
#    reached.
# Runs up to $JOBS quint processes at once.
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
[ -x "$Q" ] || Q=quint
JOBS=${JOBS:-12}
OUT=${OUT:-stress-out}
mkdir -p "$OUT"

cat > "$OUT/fns.sh" <<EOF2
Q='$Q'; OUT='$OUT'
. ./keys.sh
FLAGS=\$(sed -n '/^FLAGS="/,/"\$/p' spec.sh | tr -d '"' | sed 's/FLAGS=//')
# holds module skip-list exempt-list (comma-separated)
holds() {
  m=\$1; skip=\$(echo "\${2:-}" | tr ',' ' '); ex=\$(echo "\${3:-}" | tr ',' ' ')
  inv=\$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed \$FLAGS; do
    case " \$skip " in *" \$f "*) ;; *) printf '%s ' "\$f" ;; esac; done)
  wit=\$(witnessesFor "\$inv" "\$ex")
  r=\$(\$Q run workenv.qnt --main="\$m" --invariants \$inv --witnesses \$wit --max-samples=3000 \\
    --max-steps=\${4:-300} --verbosity=1 --out-itf="\$OUT/holds-\$m.itf.json" 2>&1)
  zero=\$(echo "\$r" | grep -E 'witnessed in 0 trace' | awk '{print \$1}' | tr '\n' ' ')
  echo "holds \$m \$(echo "\$r" | grep -E '^\[|❌' | tr '\n' ' ') never reached: \$zero"
}
seed() {
  m=\$1; i=\$2; n=\${3:-1000}; d=\${4:-120}
  r=\$(\$Q run workenv.qnt --main="\$m" --invariant="\$i" --max-samples="\$n" --max-steps="\$d" \\
    --n-threads=1 --verbosity=1 2>&1)
  v=\$(echo "\$r" | grep -oE '^\[(ok|violation)\]'); sd=\$(echo "\$r" | grep -oE '0x[0-9a-f]+' | head -1)
  if [ "\$v" = "[violation]" ]; then echo "  breaksW \$m \$i \$sd \$n \$d"
  else echo "# not seen: \$m \$i (\$n runs, \$d steps)"; fi
}
sweep() {
  m=\$1
  w=\$(grep -o '^  val w[A-Za-z]*' workenv.qnt | awk '{print \$2}' | tr '\n' ' ')
  \$Q run workenv.qnt --main="\$m" --witnesses \$w --max-samples=1000 --max-steps=200 \\
    --verbosity=1 2>&1 | grep 'witnessed in' | sed "s/^/sweep \$m /"
}
EOF2

X=NoSplitBrain,NoMergedInput,NoUnseenReject
grep -v '^#' > "$OUT/jobs" <<EOF2
holds fixedHonest '' Converges
holds fixedMaker '' Converges
holds fixedHost '' Converges
holds fixedCalm '' $X,Converges
holds convFixed NoShallowEvaluation $X 600
holds fixedRole NoPassOfBadResult,NoDoneBrokenAtEnd $X,RevisionHasContext,Converges
holds fixedPipe NoShallowEvaluation,NoPassOfBadResult,NoDoneBrokenAtEnd $X,NoWrittenDropped,NoUnacceptedEditChange,NoRefixAtSameLevel,DoneIsCurrent,NoTakenUndone,NoPassOfBrokenResult,Converges,NoEscalationWithoutPerson,RaiseChangesBounded
seed convNoCross RaiseChangesBounded 1000 600
seed noLadderRoute NoEscalationWithoutPerson
seed noRecheckBasis NoPassOfBadResult 1000 120
seed mutMaker NoActByEnded
seed witnessCalm NoClaimByEnded
seed mutDup NoReviewOfOtherResult 3000
seed mutDup NoStaleReport 3000
seed mutDup NoStalePipelineAct
seed mutPage NoUnseenReject
seed mutBuild NoUnseenReject 3000 200
seed mutPage NoUnseenAccept 3000
seed mutAccept NoRejectedDraftInEffect
seed mutAccept NoAcceptNotWaiting
seed mutRace NoLostUpdate 3000 200
seed mutRace NoPassUnderOtherVersion 3000
seed mutCrash NoSplitBrain
seed mutCrash RevisionHasContext
seed mutCrashHi RevisionHasContext 3000 250
seed mutPipeByz NoFailedTestInEffect 3000 200
seed mutPipeByz EveryRuleHasForm 3000 200
seed mutPipeByz NoRoleChangeMisjudged 3000 200
seed mutPipeByz NoWrittenDropped 3000 200
seed mutPipeByz NoShallowEvaluation 3000 200
seed mutPipe NoDeepChangeWithoutPerson 3000
seed mutPipe NoUnrevisedResubmit
seed mutPipe NoUnrecheckedScope
seed mutRefByz NoBadReference 3000 200
seed mutRecheck NoDoneBrokenAtEnd
seed mutRecheck NoTakenUndone 3000 200
seed mutRole NoPassOfBrokenResult
seed mutRole NoPassOfBadResult
seed fixedRole NoPassOfBadResult
seed fixedPipe NoShallowEvaluation
seed fixedPipe NoPassOfBadResult
seed mutTmux NoMergedInput
seed mutTmux EveryObligationToldOnce
seed noListOnAttach EveryObligationToldOnce 3000
seed beforeMove HostBoundToRunSession
seed beforeMove EveryObligationToldOnce
seed editNever NoUnacceptedEditChange
seed noDecideRecheck DoneIsCurrent
seed convNoRaise NoRefixAtSameLevel 1000 600
seed convNoRaise Converges 1000 600
seed convNeither NoRefixAtSameLevel 1000 600
seed convNeither Converges 1000 600
seed convNoScope Converges 1000 600
seed convNoSplitLimits Converges 1000 600
seed convNoSplitLimits NoRefixAtSameLevel 1000 600
seed convNoCross Converges 1000 600
seed mutPage DashNoFalseWorking
seed mutPage DashQueueActive
seed mutPage DashEscalationMatches
seed mutPage DashRowMatches
sweep witnessCalm
sweep witnessDone
sweep witnessCrash
sweep witnessFaults
sweep witnessByz
EOF2

xargs -P "$JOBS" -I{} sh -c ". $OUT/fns.sh; {}" < "$OUT/jobs" | sort > "$OUT/result.txt"
grep -v '^sweep' "$OUT/result.txt"
# The witness sweep: the witnesses never reached in any witness module.
grep '^sweep' "$OUT/result.txt" | awk '{n=$6+0; w=$3; if(!(w in b) || n>b[w]) b[w]=n}
  END {for (w in b) if (b[w]==0) print "never reached: " w}'
