#!/bin/sh
# bun run spec:stress: the long runs, for a big machine (arch-temp; README.md "How to run").
# 1. Every design module with every proposed check: no violation in 3000 runs of 150 steps.
# 2. Each mutant: find a seed that breaks its property (300 or 1000 runs, 120 steps, one
#    thread so the seed reproduces); print the line for spec.sh.
# Runs up to $JOBS quint processes at once.
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
[ -x "$Q" ] || Q=quint
JOBS=${JOBS:-12}
OUT=${OUT:-stress-out}
mkdir -p "$OUT"
FLAGS=$(sed -n '/^FLAGS="/,/"$/p' spec.sh | tr -d '"' | sed 's/FLAGS=//')
export Q FLAGS OUT

holds() {
  m=$1; skip=${2:-}
  inv=$(for f in Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed $FLAGS; do
    case " $skip " in *" $f "*) ;; *) printf '%s ' "$f" ;; esac; done)
  r=$($Q run workenv.qnt --main="$m" --invariants $inv --max-samples=3000 --max-steps=150 \
    --verbosity=1 --out-itf="$OUT/holds-$m.itf.json" 2>&1 | grep -E '^\[|❌' | tr '\n' ' ')
  echo "holds $m $r"
}
seed() {
  m=$1; i=$2; n=${3:-300}
  r=$($Q run workenv.qnt --main="$m" --invariant="$i" --max-samples="$n" --max-steps=120 \
    --n-threads=1 --verbosity=1 2>&1)
  v=$(echo "$r" | grep -oE '^\[(ok|violation)\]'); sd=$(echo "$r" | grep -oE '0x[0-9a-f]+' | head -1)
  if [ "$v" = "[violation]" ]; then echo "  breaksW $m $i $sd $n"; else echo "# not seen: $m $i ($n runs)"; fi
}

{
  for m in fixedHonest fixedMaker fixedHost fixedCalm c1b d7shrink; do echo "holds $m"; done
  echo "holds fixedRole NoPassOfBadResult"
  echo "holds fixedPipe NoShallowEvaluation"
  sed -n 's/^  breaksW \([^ ]*\) \([^ ]*\) .*/seed \1 \2/p' spec.sh
  grep '^# want:' stress.sh | sed 's/^# want: /seed /'
} | while read cmd a b c; do echo "$cmd $a $b $c"; done > "$OUT/jobs"

# POSIX sh has no export -f: each job runs in a fresh sh that sources the two functions.
sed -n '/^holds() {/,/^}/p;/^seed() {/,/^}/p' "$0" > "$OUT/fns.sh"
xargs -P "$JOBS" -I{} sh -c ". $OUT/fns.sh; {}" < "$OUT/jobs" | sort > "$OUT/result.txt"
cat "$OUT/result.txt"

# Mutants still wanted (not yet in spec.sh): module, property, runs.
# want: noDecideRecheck NoDoneUnderOldVersion 1000
# want: noDecideRecheck DoneIsCurrent 1000
# want: mutPipe NoDoneBrokenAtEnd 1000
# want: witnessCalm NoClaimByEnded 1000
# want: mutQuiet LiveNotInactive 300
# want: mutBuild NoUnseenReject 1000
# want: noListOnAttach EveryObligationToldOnce 1000
# want: noShrinkSplit Converges 1000
# want: d7none Converges 1000
# want: mutAccept NoRejectedDraftInEffect 1000
# want: beforeBind HostBoundToRunSession 1000
# want: mutDup NoStaleReport 1000
# want: mutDup NoReviewOfOtherResult 1000
# want: mutDup C1aConfirmed 1000
# want: mutRace NoPassUnderOtherVersion 1000
# want: mutCrash RevisionHasContext 1000
# want: mutPage NoUnseenAccept 1000
# want: mutPipe NoDeepChangeWithoutPerson 1000
# want: mutPipe NoRoleChangeMisjudged 1000
