#!/bin/sh
# bun run spec:tlc: TLC on the two small models (README.md "The small models"): every
# reachable state, safety and liveness, by `quint verify --backend=tlc`. One JVM at a time.
# HEAP (default 3G), WORKERS (default 4), OUT (logs; default /tmp/spec-tlc), ONLY (run only
# the lines whose module matches this grep pattern). APALACHE_ENDPOINT overrides the
# default checker endpoint, for independent smoke groups in separate OUT dirs.
# Each job: file, module, the answer expected (holds: no violation; breaks: a violation),
# the invariants (comma-separated, or -) and the temporal properties (comma-separated, or -).
# The whole script is one function, read before it runs (an edit during a run is safe).
main() {
set -u
cd "$(dirname "$0")" || exit 1
QUINT=../../node_modules/.bin/quint
OUT=${OUT:-/tmp/spec-tlc}; mkdir -p "$OUT"; rm -f "$OUT/failed"
CFG=$OUT/tlc.json
printf '{"workers":%s,"maxHeap":"-Xmx%s"}\n' "${WORKERS:-4}" "${HEAP:-3G}" > "$CFG"
fail=0
SAFE=Sane,EveryObligationToldOnce,ToldIsAllowed,SomethingOwed,DoneIsCurrent,NoDoneBrokenAtEnd
SAFE=$SAFE,NoLostUpdate,NoTakenUndone,NoPassOfBadResult,NoRefixAtSameLevel
SAFE=$SAFE,NoEscalationWithoutPerson,NoAgentChangeAtTop,Converges,NoWaitCycle,AskCap
SAFE=$SAFE,NoExecuteToEndedMaker
LIVE=CoreProgress,CoreChangesStop,CoreSettles
PIPE_SAFE=NoKeystrokeTwice,Prefix,AtMostOneWriting,WritingIsMarked
# A copy of the model with only the instance checked: the file up to its "---- instances"
# line, then that module (quint's TLA+ export of a file with many instances overflows).
extract() {
  copy=$OUT/src/$2; rm -rf "$copy"; mkdir -p "$copy"; cp ./*.qnt "$copy/"
  end=$(grep -n '^// ---- instances' "$1" | cut -d: -f1)
  { head -n $((end - 1)) "$1"
    awk -v wanted="module $2 {" '$0==wanted {p=1} p {print} p && /^}/ {exit}' "$1"; } > "$copy/$1"
  echo "$copy/$1"
}
run() {
  file=$1; module=$2; want=$3; inv=$4; temp=$5
  log=$OUT/$module-$want.log
  if [ "$file" = permits.qnt ]; then
    set -- verify "$file" --main=permits --init="init${module#permits}" --step=composedStep
  else
    set -- verify "$(extract "$file" "$module")" --main="$module"
  fi
  set -- "$@" --backend=tlc --tlc-config "$CFG" --verbosity=3
  [ -z "${APALACHE_ENDPOINT:-}" ] || set -- "$@" --server-endpoint "$APALACHE_ENDPOINT"
  [ "$inv" = - ] || set -- "$@" --invariants $(echo "$inv" | tr ',' ' ')
  [ "$temp" = - ] || set -- "$@" --temporal "$temp"
  start=$(date +%s)
  timeout "${TIMEOUT:-7200}" $QUINT "$@" > "$log" 2>&1 < /dev/null
  # Another quint on this machine may hold the Apalache server's port: try once more.
  if grep -q 'Address already in use' "$log"; then
    sleep 20; timeout "${TIMEOUT:-7200}" $QUINT "$@" > "$log" 2>&1 < /dev/null
  fi
  secs=$(( $(date +%s) - start ))
  states=$(grep -E 'distinct states found' "$log" | tail -1 \
    | sed 's/.*generated, //; s/ distinct.*//')
  if grep -q '^\[ok\]' "$log"; then got=holds
  elif grep -q '^\[violation\]' "$log"; then got=breaks
  else got=error; fi
  if [ "$got" = "$want" ]; then
    echo "$want  $file $module ($states states, ${secs}s)"
  else
    echo "FAIL   $file $module: expected $want, got $got ($states states, ${secs}s; $log)"
    fail=1
  fi
}
WORKER_SAFE=OldestFirst,NoIdentityCrossing,NoBlockedOnlyExecutor
PERMIT_SAFE=AsksFollowState,NoWaitCycle,PermitsNeverExceeded,NoRecheckInParentContext,ChildMakersCharged
PERMIT_LIVE=ParkedResumes,DeferredRuns,RechecksProgress,AdmittedProgress,AdmittedSettles
ADMISSION_SAFE=PipeBound,PipeMatchesJobs,Ownership,RoleBound,TaskMatchesPermits,OneSerialTurn,RecheckIndependent,NoSerialWithAllowance
jobs() {
  cat <<EOF
worker.qnt workerFixed holds $WORKER_SAFE G1All
worker.qnt workerSticky breaks - G1All
worker.qnt workerWrongToken breaks NoIdentityCrossing -
permits.qnt permitsPark holds $PERMIT_SAFE $PERMIT_LIVE
permits.qnt permitsDefer holds $PERMIT_SAFE $PERMIT_LIVE
permits.qnt permitsChild holds $PERMIT_SAFE $PERMIT_LIVE
permits.qnt permitsSerial holds $PERMIT_SAFE $PERMIT_LIVE
permits.qnt permitsAdmission holds $PERMIT_SAFE $PERMIT_LIVE
permits.qnt permitsSerial breaks NoSerial -
worker.qnt workerFixed breaks NoYield -
worker.qnt workerFixed breaks NoAllIdentities -
worker.qnt workerFixed breaks NoHeardAfterPark -
worker.qnt workerFixed breaks NoStaleRefusal -
permits.qnt permitsPark breaks NoPark -
permits.qnt permitsPark breaks NoParkResume -
permits.qnt permitsDefer breaks NoDefer -
permits.qnt permitsChild breaks NoChild -
permits.qnt permitsAdmission breaks NoSecondDenied -
permits.qnt permitsDropParent breaks PermitsNeverExceeded -
permits.qnt permitsRetained breaks NoRecheckInParentContext -
permits.qnt permitsIgnore breaks - RechecksProgress
admission.qnt admissionPipeOne holds $ADMISSION_SAFE,NoPipeOverlap -
admission.qnt admissionPipeOne breaks NoRecheckBesideFix -
admission.qnt admissionPipeTwo holds $ADMISSION_SAFE -
admission.qnt admissionPipeTwo breaks NoPipeOverlap -
admission.qnt admissionWait holds $ADMISSION_SAFE,NoSaturatedSerial -
admission.qnt admissionWait breaks NoSaturatedWait -
admission.qnt admissionWait breaks NoFailWait -
admission.qnt admissionZero holds $ADMISSION_SAFE -
admission.qnt admissionZero breaks NoSerialReview -
admission.qnt admissionCollocated holds $ADMISSION_SAFE -
admission.qnt admissionCollocated breaks NoCollocatedOwners -
admission.qnt admissionNoPipeCap breaks PipeBound -
admission.qnt admissionDropsPipe breaks PipeMatchesJobs -
admission.qnt admissionWrongOwner breaks Ownership -
admission.qnt admissionSharedLane breaks RecheckIndependent -
admission.qnt admissionSerialOnFull breaks NoSerialWithAllowance -
terminals.qnt termFixed holds Sane,ExactlyOnce G1All,SendDone
terminals.qnt termFixed3 holds Sane,ExactlyOnce G1All,SendDone
terminals.qnt termNoList breaks - G1All
terminals.qnt termNoReattach breaks - G1All
terminals.qnt termNoPromptArg breaks - G1All
terminals.qnt termNoOutbox breaks - G1All
terminals.qnt termNoOutbox breaks - SendDone
terminals.qnt termNoHostWatch breaks - G1All
terminals.qnt termNoEvidence breaks ExactlyOnce -
terminals.qnt termNoIdleSeen breaks - G1All
store.qnt storeFixed holds G3Holds -
store.qnt storeNoBasis breaks G3Holds -
store.qnt storeNoRecheckBasis breaks G3Holds -
store.qnt storeNoEpochs breaks G3Holds -
store.qnt storeNoBuild breaks G3Holds -
store.qnt storeNoAcceptCheck holds G3Holds -
store.qnt storeBlind breaks G3Holds -
browser.qnt browserFixed holds DashAfterRefresh G4All
activation.qnt activationFixed holds ActivationSafe ActivationEnds,RebindEnds,BoundHostServed
activation.qnt activationFixed breaks - ActivatesOrRollsBack
activation.qnt activationFixed breaks NoActive -
activation.qnt activationFixed breaks NoRolledBack -
activation.qnt activationFixed breaks NoReplacedActive -
activation.qnt activationFixed breaks NoBlockedByEdit -
activation.qnt activationFixed breaks NoReboundWork -
activation.qnt activationFixed breaks NoCancelledByTop -
activation.qnt activationFixed breaks NoLateCollection -
activation.qnt activationFixed breaks NoLateNote -
activation.qnt activationTrustRecord breaks ActiveMeansMarked -
activation.qnt activationTrustRecord breaks NoLostEdit -
activation.qnt activationStaleAck breaks ActivationNeedsCurrentAck -
activation.qnt activationReuseId breaks ActivationNeedsCurrentAck -
activation.qnt activationSpawnFirst breaks NoOrphanHost -
activation.qnt activationNoGuard breaks ActiveNeverRolledBack -
activation.qnt activationOpenStore breaks NoWorkBeforeActive -
activation.qnt activationRebindAfterTop breaks NoRebindAfterTop -
activation.qnt activationDeliverPending breaks NoCredentialToPending -
activation.qnt activationRetireAtOpen breaks - BoundHostServed
activation.qnt activationNoReconcile breaks CommittedNeverCancelled -
browser.qnt browserNoReconnect breaks - G4All
browser.qnt browserNoReload breaks - G4All
browser.qnt browserNoPush breaks - G4All
browser.qnt browserNoPoll breaks - G4All
pipe.qnt pipeFixed holds $PIPE_SAFE ShowsCurrentScreen,NoKeystrokeLost
pipe.qnt pipeNoReattach breaks - ShowsCurrentScreen
pipe.qnt pipeNoReconnect breaks - ShowsCurrentScreen
pipe.qnt pipeNoRedraw breaks - ShowsCurrentScreen
pipe.qnt pipeNoDedup breaks NoKeystrokeTwice -
pipe.qnt pipeMarkAfter breaks NoKeystrokeTwice -
pipe.qnt pipeVolatileMarks breaks NoKeystrokeTwice -
pipe.qnt pipeNoBuffer breaks - NoKeystrokeLost
pipe.qnt pipeNoOutbox breaks - NoKeystrokeLost
configs.qnt coreAsks holds $SAFE $LIVE
configs.qnt coreAsksPipe holds $SAFE $LIVE
configs.qnt coreAskRogue holds $SAFE $LIVE,AnswererFinishes
configs.qnt coreAskReverse breaks NoWaitCycle -
configs.qnt coreTwo holds $SAFE $LIVE
configs.qnt coreTwo breaks - CoreProgressNoPipe
configs.qnt coreTwoExit holds $SAFE $LIVE
configs.qnt coreLoops holds $SAFE $LIVE
configs.qnt coreNoRuleLadder breaks - CoreProgress
configs.qnt coreNoLoopLadder breaks - CoreProgress
configs.qnt corePersonUnbounded breaks - CoreSettles
configs.qnt coreTwoExit breaks - CoreProgressNoEngine
configs.qnt coreTwoDir holds $SAFE $LIVE
configs.qnt coreCrossOnly holds - CoreChangesStop
configs.qnt coreNoRaise breaks - CoreChangesStop
configs.qnt coreNoCross breaks - CoreChangesStop
configs.qnt coreNoSplit breaks - CoreChangesStop
configs.qnt coreWhereContext holds Sane,OutputScopeSound -
configs.qnt coreWhereContext breaks NoAddedOutputScope -
EOF
}
# One run by hand: sh tlc.sh one FILE MODULE holds|breaks INVARIANTS|- TEMPORAL|-
if [ "${1:-}" = one ]; then shift; run "$@"; exit $fail; fi
jobs | grep -E "${ONLY:-.}" | while read -r file module want inv temp; do
  run "$file" "$module" "$want" "$inv" "$temp"
  [ $fail = 0 ] || echo "$module" >> "$OUT/failed"
done
[ -f "$OUT/failed" ] && { rm -f "$OUT/failed"; exit 1; }
exit 0
}
main "$@"
