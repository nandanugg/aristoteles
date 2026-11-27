module fixOwnerChoiceCase {
  import lines.* from "../lines"
  type Resolution = Unresolved | SentAgain | Taken | Dropped
  type Missed = Unassessed | StaffMiss | GuidanceMiss | MovingTarget
  const basisGuard: bool
  const retryGuard: bool
  var state: {
    phase: Resolution, missed: Missed, retained: bool, retries: int, proposal: Proposal,
    declinedRetry: bool, badBasis: bool
  }
  action init = {
    nondet retained = Set(false, true).oneOf()
    state' = { phase: Unresolved, missed: Unassessed, retained: retained, retries: 0,
      proposal: Removed, declinedRetry: false, badBasis: false }
  }
  action assess = {
    nondet missed = Set(StaffMiss, GuidanceMiss, MovingTarget).oneOf()
    all { state.phase == Unresolved, state.retained, state.missed == Unassessed,
      state' = { ...state, missed: missed } }
  }
  action tryAgain = all {
    state.phase == Unresolved, state.missed == StaffMiss, state.proposal == Removed,
    state' = if (state.retries == 0 or not(retryGuard)) { ...state, phase: SentAgain, retries: state.retries + 1 }
      else { ...state, declinedRetry: true }
  }
  action raiseAgain = all {
    state.phase == SentAgain, state.proposal == Removed,
    state' = { ...state, phase: Unresolved, missed: Unassessed }
  }
  action submitFix = all {
    state.phase == Unresolved, state.proposal == Removed,
    state.missed == GuidanceMiss or (state.missed == StaffMiss and state.retries == 1),
    state' = { ...state, proposal: submit(Drafting(1)) }
  }
  action resubmit = all { state.proposal == Drafting(2),
    state' = { ...state, proposal: submit(state.proposal) } }
  action review = {
    val proposal = proposalFacts(reviewProposal(state.proposal, 1), 1, true)
    all { proposal != state.proposal, state' = { ...state, proposal: proposal } }
  }
  action sendBack = all { state.proposal == WaitingForOwner(1),
    state' = { ...state, proposal: ownerChoice(state.proposal, 9, 9, 1, SendBack) } }
  action accept = {
    nondet actor = Set(8, 9).oneOf()
    nondet read = Set(1, 2).oneOf()
    val current = if (state.proposal == WaitingForOwner(2)) 2 else 1
    val proposal = ownerChoice(state.proposal, actor, 9, if (basisGuard) read else current, Accept)
    all { state.phase == Unresolved,
      state' = if (proposal != state.proposal) { ...state, phase: SentAgain,
        proposal: proposal, badBasis: read != current } else state }
  }
  action takeAsIs = {
    nondet actor = Set(8, 9).oneOf()
    all { state.phase == Unresolved,
      state' = if (actor == 9 and state.retained) { ...state, phase: Taken, proposal: Removed } else state }
  }
  action drop = {
    nondet actor = Set(8, 9).oneOf()
    all { state.phase == Unresolved,
      state' = if (actor == 9) { ...state, phase: Dropped, proposal: Removed } else state }
  }
  action step = any { assess, tryAgain, raiseAgain, submitFix, resubmit, review, sendBack,
    accept, takeAsIs, drop, state' = state }
  val Safety = state.retries <= 1 and not(state.badBasis) and (state.phase == Taken implies state.retained)
  val Success = state.phase == SentAgain and state.missed == GuidanceMiss and state.proposal == Accepted(2)
  val Fault = state.declinedRetry and state.proposal == WaitingForOwner(1) and state.missed == StaffMiss
}
module fixOwnerChoice {
  import fixOwnerChoiceCase(basisGuard = true, retryGuard = true).* from "./fixOwnerChoice"
}
module fixOwnerChoiceMutant {
  import fixOwnerChoiceCase(basisGuard = true, retryGuard = false).* from "./fixOwnerChoice"
}
module fixOwnerChoiceBasisMutant {
  import fixOwnerChoiceCase(basisGuard = false, retryGuard = true).* from "./fixOwnerChoice"
}
