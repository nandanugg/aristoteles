#!/bin/sh
# bun run spec: typecheck every spec, then simulate the design modules (no violation expected).
# bun run spec:check: also each "before" module must break its invariant (a violation expected).
# No JVM here: TLC and Apalache are run by hand (README.md).
set -u
cd "$(dirname "$0")" || exit 1
Q=../../node_modules/.bin/quint
fail=0

for f in *.qnt; do
  $Q typecheck "$f" >/dev/null 2>&1 || { echo "FAIL   typecheck $f"; fail=1; }
done
[ $fail = 0 ] || exit 1
echo "ok     typecheck $(ls *.qnt | tr '\n' ' ')"

holds() {
  out=$($Q run "$1" --main="$2" --invariant="$3" --max-samples="${SAMPLES:-5000}" \
    --max-steps=30 2>&1)
  if echo "$out" | grep -q '^\[ok\]'; then
    echo "holds  $1 $2 $3"
  else
    echo "FAIL   $1 $2 $3 (expected no violation)"
    echo "$out" | tail -30
    fail=1
  fi
}
# A violation is expected: the script inverts quint's exit.
breaks() {
  out=$($Q run "$1" --main="$2" --invariant="$3" --max-samples=20000 --max-steps=40 \
    --seed=7 2>&1)
  if echo "$out" | grep -q '^\[violation\]'; then
    echo "breaks $1 $2 $3"
  else
    echo "FAIL   $1 $2 $3 (expected a violation)"
    fail=1
  fi
}

holds protocol.qnt after Safe
holds wait.qnt oneStep Told
holds wait.qnt oneStep ReturnTellsOne
holds tasks.qnt after RunSafe

if [ "${1:-}" = "--check" ]; then
  breaks protocol.qnt before Safe
  breaks protocol.qnt today EveryObligationToldOnce
  breaks protocol.qnt orphan NoOrphan
  breaks protocol.qnt startWait EveryObligationToldOnce
  breaks protocol.qnt churn ToldIsAllowed
  breaks protocol.qnt goneRace NoFalseGone
  breaks protocol.qnt stale NoStaleReview
  breaks protocol.qnt noOwner EveryObligationToldOnce
  breaks protocol.qnt claimHeld ClaimEndsWithExit
  breaks protocol.qnt claimHeld EveryObligationToldOnce
  breaks wait.qnt live ReturnTells
  breaks wait.qnt readyFirst NoHiddenReady
  breaks wait.qnt tokenWait NoHiddenReady
  breaks tasks.qnt today EveryObligationToldOnce
  breaks tasks.qnt needDirection EveryObligationToldOnce
  breaks tasks.qnt diverge ChangesWithinBudget
  breaks tasks.qnt topRemake EveryObligationToldOnce
fi
exit $fail
