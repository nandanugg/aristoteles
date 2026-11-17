#!/bin/sh
# bun run spec:stress: the long runs, for the check machine (README.md "How to run").
# 1. Each holds module: no violation in 3000 runs of 150 steps, and every key witness reached.
# 2. Each mutant: a seed that breaks its property (runs as given, 120 steps, one thread so
#    the seed reproduces); it prints the line for spec.sh, or "not seen".
# Runs up to $JOBS quint processes at once.
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
[ -x "$Q" ] || Q=quint
JOBS=${JOBS:-12}
OUT=${OUT:-stress-out}
mkdir -p "$OUT"
FLAGS=$(sed -n '/^FLAGS="/,/"$/p' spec.sh | tr -d '"' | sed 's/FLAGS=//')
KEY=$(sed -n 's/^KEY="\(.*\)"$/\1/p' spec.sh)

cat > "$OUT/fns.sh" <<EOF
Q='$Q'; OUT='$OUT'; FLAGS='$(echo $FLAGS)'; KEY='$KEY'
holds() {
  m=\$1; skip=\$(echo "\${2:-}" | tr ',' ' ')
  inv=\$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed \$FLAGS; do
    case " \$skip " in *" \$f "*) ;; *) printf '%s ' "\$f" ;; esac; done)
  r=\$(\$Q run workenv.qnt --main="\$m" --invariants \$inv --witnesses \$KEY --max-samples=3000 \\
    --max-steps=150 --verbosity=1 --out-itf="\$OUT/holds-\$m.itf.json" 2>&1)
  zero=\$(echo "\$r" | grep -E 'witnessed in 0 trace' | awk '{print \$1}' | tr '\n' ' ')
  echo "holds \$m \$(echo "\$r" | grep -E '^\[|❌' | tr '\n' ' ') never reached: \$zero"
}
seed() {
  m=\$1; i=\$2; n=\${3:-1000}; d=\${4:-120}
  r=\$(\$Q run workenv.qnt --main="\$m" --invariant="\$i" --max-samples="\$n" --max-steps="\$d" \\
    --n-threads=1 --verbosity=1 2>&1)
  v=\$(echo "\$r" | grep -oE '^\[(ok|violation)\]'); sd=\$(echo "\$r" | grep -oE '0x[0-9a-f]+' | head -1)
  if [ "\$v" = "[violation]" ]; then echo "  breaksW \$m \$i \$sd \$n \$d"
  else echo "# not seen: \$m \$i (\$n runs)"; fi
}
EOF

grep -v '^#' > "$OUT/jobs" <<'EOF'
holds fixedHonest
holds fixedMaker
holds fixedHost
holds fixedCalm
holds convFixed NoShallowEvaluation
holds fixedRole NoPassOfBadResult,NoDoneBrokenAtEnd
holds fixedPipe NoShallowEvaluation,NoPassOfBadResult,NoDoneBrokenAtEnd
seed mutMaker NoActByEnded
seed witnessCalm NoClaimByEnded
seed mutDup NoReviewOfOtherResult 3000
seed mutDup NoStaleReport 3000
seed mutDup NoStalePipelineAct
seed mutPage NoUnseenReject
seed mutBuild NoUnseenReject
seed mutPage NoUnseenAccept 3000
seed mutAccept NoRejectedDraftInEffect
seed mutAccept NoAcceptNotWaiting
seed mutRace NoLostUpdate
seed mutRace NoPassUnderOtherVersion 3000
seed mutCrash NoSplitBrain
seed mutCrash RevisionHasContext 3000
seed mutPipe NoFailedTestInEffect
seed mutPipe EveryRuleHasForm
seed mutPipe NoDeepChangeWithoutPerson 3000
seed mutPipe NoRoleChangeMisjudged 3000
seed mutPipe NoShallowEvaluation
seed mutPipe NoUnrevisedResubmit
seed mutPipe NoUnrecheckedScope
seed mutPipe NoWrittenDropped 3000
seed mutRecheck NoDoneBrokenAtEnd
seed mutRecheck NoTakenUndone 3000
seed mutRef NoBadReference
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
seed convNoRaise Converges 1000 600
seed convNeither Converges 1000 600
seed convNoCross Converges 1000 600
seed convNoScope Converges 1000 300
seed mutPage DashNoFalseWorking
seed mutPage DashQueueActive
seed mutPage DashEscalationMatches
seed mutPage DashRowMatches
EOF

xargs -P "$JOBS" -I{} sh -c ". $OUT/fns.sh; {}" < "$OUT/jobs" | sort > "$OUT/result.txt"
cat "$OUT/result.txt"
