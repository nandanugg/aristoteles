# Sourced by spec.sh and stress.sh: the coverage gate. Each property has a key witness: a
# state that exercises what the property guards. A holds module must reach the key witness
# of every property it checks, except the ones its environment cannot exercise ($2).
PROPWIT="NoActByEnded:wReport NoClaimByEnded:wReadBrief NoReviewOfOtherResult:wRevision
  NoPassUnderOtherVersion:wReviewPass NoStaleReport:wRevision NoUnseenReject:wReject
  NoUnseenAccept:wAccept NoRejectedDraftInEffect:wSendBack NoLostUpdate:wRebase
  NoFailedTestInEffect:wRunTest EveryRuleHasForm:wWriteRule NoBadReference:wWriteRule
  NoDeepChangeWithoutPerson:wShipStandard NoRoleChangeMisjudged:wRoleDraft
  NoUnrecheckedScope:wRecheck NoPassOfBrokenResult:wRunRule NoPassOfBadResult:wRecheckDone
  NoShallowEvaluation:wEvaluate NoStalePipelineAct:wAdvance NoSplitBrain:wSelfResume
  RevisionHasContext:wSecondRevision NoUnrevisedResubmit:wSendBack NoMergedInput:wTyped
  DoneIsCurrent:wDecideRecheck NoDoneBrokenAtEnd:wEndProject NoTakenUndone:wTakenRechecked
  NoWrittenDropped:wEditInEffect NoAcceptNotWaiting:wAccept NoUnacceptedEditChange:wEditInEffect
  HostBoundToRunSession:wMoveHost NoRefixAtSameLevel:wTaskFloor
  Converges:wNearBound NoEscalationWithoutPerson:wEscalatedLoop
  RaiseChangesBounded:wTaskFloor NoDoneBrokenAtEnd:wDecideFought"
# witnessesFor "props" "exempt": the key witnesses (no duplicates).
witnessesFor() {
  for pw in $PROPWIT; do
    p=${pw%%:*}; w=${pw##*:}
    case " $1 " in *" $p "*) ;; *) continue ;; esac
    case " $2 " in *" $p "*) continue ;; esac
    echo "$w"
  done | sort -u | tr '\n' ' '
}
