module staffReplacementCase {
  import lines.* from "../lines"
  import people.* from "../people"
  const currentRun: bool
  pure val attempt: Attempt = { number: 1, session: 1, retries: 1, pointedOut: Set(1) }
  pure val commands = [{ rule: 1, breaks: false, evidence: true }]
  pure val result: Result = { artifact: 7, attempt: attempt }
  pure val reviewed = Reviewing({ result: result, commands: commands, review: By(1) })
  pure val proposal = ProposalReview({ draft: 1, review: By(1) })
  var state: {
    session: Session, past: Set[Session], work: Task, review: Task, proposal: Proposal,
    question: Question, crashed: bool, paused: bool, staleTried: bool, staleApplied: bool
  }
  action init = state' = {
    session: live(1, 1, 1), past: Set(), work: Working(attempt), review: reviewed, proposal: proposal,
    question: Answered({ recipient: 1, text: 9 }), crashed: false, paused: false,
    staleTried: false, staleApplied: false
  }
  action crash = all {
    current(state.session, 1, 1), state.work == Working(attempt),
    state' = { ...state, session: end(state.session), work: crashTask(state.work, 1, 1),
      review: crashTask(state.review, 1, 1), proposal: crashProposal(state.proposal, 1), crashed: true }
  }
  action checkpoint = all {
    current(state.session, 1, 1), state.work == Working(attempt),
    state' = { ...state, session: pause(state.session, 8),
      review: crashTask(state.review, 1, 1), proposal: crashProposal(state.proposal, 1), paused: true }
  }
  action replace = all {
    state.session == Ended(1),
    state' = { ...state, past: Set(state.session), session: live(1, 1, 2) }
  }
  action resumeCheckpoint = match state.session {
    | Paused(_) => state' = { ...state, past: Set(state.session),
        session: resume(state.session, 2), work: resumeTask(state.work, 1, 2) }
    | _ => all { false, state' = state }
  }
  action startAgain = all {
    current(state.session, 1, 2), taskPhase(state.work) == "Sent",
    state' = { ...state, work: beginWork(state.work, 2) }
  }
  action finishWork = {
    nondet lifetime = Set(1, 2).oneOf()
    match state.work {
      | Working(active) => {
          val fresh = current(state.session, 1, lifetime)
          val work = if (fresh or not(currentRun))
            reportResult(state.work, active.number, active.session, 11) else state.work
          all {
            current(state.session, 1, 2),
            state' = { ...state, work: work, staleTried: state.staleTried or not(fresh),
              staleApplied: state.staleApplied or (work != state.work and not(fresh)) }
          }
        }
      | _ => all { false, state' = state }
    }
  }
  action step = any { crash, checkpoint, replace, resumeCheckpoint, startAgain, finishWork, state' = state }
  val WorkPreserved = match state.work {
    | Sent(sent) => state.crashed and sent.last == 1 and sent.retries == 1 and sent.pointedOut == Set(1)
    | Working(active) => active.retries == 1 and active.pointedOut == Set(1) and
        (current(state.session, 1, 2) implies
          active.session == 2 and active.number == (if (state.crashed) 2 else 1))
    | ReadyToReview(saved) => saved.attempt.retries == 1 and saved.attempt.session == 2 and
        saved.attempt.number == (if (state.crashed) 2 else 1)
    | _ => false
  }
  val Safety = not(state.staleApplied) and WorkPreserved and
    state.question == Answered({ recipient: 1, text: 9 }) and
    ((state.crashed or state.paused) implies
      state.review == Reviewing({ result: result, commands: commands, review: Waiting }) and
      state.proposal == ProposalReview({ draft: 1, review: Waiting })) and
    state.past.forall(old => not(sessionStaff(old, 1)))
  val Success = state.paused and taskPhase(state.work) == "ReadyToReview"
  val Fault = state.crashed and state.staleTried and taskPhase(state.work) == "ReadyToReview"
}
module staffReplacement {
  import staffReplacementCase(currentRun = true).* from "./staffReplacement"
}
module staffReplacementMutant {
  import staffReplacementCase(currentRun = false).* from "./staffReplacement"
}
