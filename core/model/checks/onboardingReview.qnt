module onboardingReviewCase {
  import lines.* from "../lines"
  import people.* from "../people"
  const liveGuard: bool
  // The host serves its role before any proposal has been accepted.
  pure val assignment: Staffing = {
    assignments: Map(1 -> 1), allowance: Map(1 -> 1), subscription: Map(1 -> 1),
    subscriptionLimit: Map(1 -> 1), version: 1
  }
  var state: {
    proposal: Proposal, session: Session, reviewLifetime: int, child: int,
    reviewLive: bool, staleTried: bool, returnedOnce: bool, acceptedEarly: bool
  }
  action init = state' = { proposal: Drafting(1), session: live(1, 1, 1),
    reviewLifetime: 0, child: 0, reviewLive: false, staleTried: false, returnedOnce: false, acceptedEarly: false
  }
  action submitDraft = all {
    submit(state.proposal) != state.proposal,
    state' = { ...state, proposal: submit(state.proposal) }
  }
  action openFreshChild = {
    nondet lifetime = Set(1, 2).oneOf()
    val subject = { id: 0, role: 1, entered: 1, review: Waiting }
    val staff = reviewStaff(assignment, Set(subject), subject, 1, Set(), true)
    all {
      current(state.session, staff, lifetime), reviewProposal(state.proposal, staff) != state.proposal,
      state' = { ...state, proposal: reviewProposal(state.proposal, staff), reviewLifetime: lifetime, child: lifetime + 1 }
    }
  }
  action exit = all {
    current(state.session, 1, 1), state.child == 2,
    state' = { ...state, session: end(state.session), proposal: crashProposal(state.proposal, 1), child: 0 }
  }
  action recover = all {
    state.session == Ended(1),
    state' = { ...state, session: live(1, 1, 2) }
  }
  action report = {
    nondet holds = Set(false, true).oneOf()
    nondet source = Set((1, 1), (1, 2), (2, 3)).oneOf()
    val fresh = source._2 == state.child and source._1 == state.reviewLifetime and current(state.session, 1, source._1)
    val nextProposal = if (fresh or not(liveGuard)) proposalFacts(state.proposal, 1, holds) else state.proposal
    all {
      proposalPhase(state.proposal) == ProposalReview(NoPayload), state.child > 0,
      state' = { ...state, proposal: nextProposal, child: if (nextProposal == state.proposal) state.child else 0,
        staleTried: state.staleTried or (state.reviewLifetime == 2 and source == (1, 2)),
        reviewLive: if (nextProposal == state.proposal) state.reviewLive else fresh,
        returnedOnce: state.returnedOnce or (nextProposal != state.proposal and not(holds)) }
    }
  }
  action acceptDraft = {
    nondet actor = Set(1, 9).oneOf()
    val nextProposal = ownerChoice(state.proposal, actor, 9, 1, Accept)
    state' = { ...state, proposal: nextProposal,
      acceptedEarly: state.acceptedEarly or (nextProposal != state.proposal and not(state.reviewLive)) }
  }
  action step = any { submitDraft, openFreshChild, exit, recover, report, acceptDraft, state' = state }
  val Safety = not(state.acceptedEarly) and
    ((owed(proposalLine, proposalPhase(state.proposal)) == Owner or proposalPhase(state.proposal) == Accepted(NoPayload)) implies state.reviewLive)
  val Success = state.proposal == Accepted(1) and state.returnedOnce
  val Fault = state.staleTried and current(state.session, 1, 2) and state.proposal == Accepted(1)
}
module onboardingReview {
  import onboardingReviewCase(liveGuard = true).* from "./onboardingReview"
}
module onboardingReviewMutant {
  import onboardingReviewCase(liveGuard = false).* from "./onboardingReview"
}
