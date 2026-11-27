module staffReplacementCase {
  import lines.* from "../lines"
  import people.* from "../people"
  const retainOnPause: bool
  pure val attempt: Attempt = { number: 1, session: 1, retries: 1, pointedOut: Set(1) }
  pure val waiting = Reviewing({ result: { artifact: 7, attempt: attempt },
    commands: [{ rule: 1, breaks: false, evidence: true }], review: Waiting })
  pure val pending = ProposalReview({ draft: 1, review: Waiting })
  var state: {
    session: Session, work: Task, review: Task, proposal: Proposal, question: Question,
    stopped: bool, intervened: bool, resumed: bool, staleTried: bool, staleApplied: bool
  }
  action init = state' = {
    session: live(1, 1, 1), work: Working(attempt), review: startReview(waiting, 1),
    proposal: reviewProposal(pending, 1), question: Answered({ recipient: 1, text: 9 }),
    stopped: false, intervened: false, resumed: false, staleTried: false, staleApplied: false
  }
  action limited = all {
    current(state.session, 1, 1), not(state.stopped), state.work == Working(attempt),
    state' = { ...state, session: pause(state.session),
      work: if (retainOnPause) state.work else crashTask(state.work, 1, 1),
      review: if (retainOnPause) state.review else waiting,
      proposal: if (retainOnPause) state.proposal else pending }
  }
  action reset = match state.session {
    | Paused(_) => all { not(state.stopped), state' = { ...state, session: resume(state.session), resumed: true } }
    | _ => all { false, state' = state }
  }
  action crash = all {
    current(state.session, 1, 1), not(state.stopped), state.work == Working(attempt),
    state' = { ...state, stopped: true }
  }
  action intervene = match state.session {
    | Paused(_) => all { not(state.stopped), state' = { ...state, stopped: true, intervened: true } }
    | _ => all { false, state' = state }
  }
  action retire = all {
    state.stopped, state.work == Working(attempt),
    state' = { ...state, session: end(state.session), work: crashTask(state.work, 1, 1), review: waiting, proposal: pending }
  }
  action replace = all {
    state.session == Ended(1), state' = { ...state, session: live(1, 1, 2) }
  }
  action startAgain = all {
    current(state.session, 1, 2), taskPhase(state.work) == Sent(NoPayload),
    state' = { ...state, work: beginWork(state.work, 2) }
  }
  action finishWork = {
    nondet lifetime = Set(1, 2).oneOf()
    nondet freshRead = Set(false, true).oneOf()
    match state.work {
      | Working(active) => all {
          state.resumed or state.stopped,
          val fresh = freshRead and ((not(state.stopped) and current(state.session, 1, lifetime)) or current(state.session, 1, 2) and lifetime == 2)
          val work = if (fresh) reportResult(state.work, active.number, active.session, 11) else state.work
          state' = { ...state, work: work, staleTried: state.staleTried or not(fresh),
            staleApplied: state.staleApplied or (work != state.work and not(fresh)) }
        }
      | _ => all { false, state' = state }
    }
  }
  action step = any { limited, reset, crash, intervene, retire, replace, startAgain, finishWork, state' = state }
  val ended = state.session == Ended(1) or current(state.session, 1, 2)
  val continued = if (ended) { ...attempt, number: 2, session: 2 } else attempt
  val WorkPreserved = match state.work {
    | Sent(sent) => ended and sent.last == 1 and sent.retries == 1 and sent.pointedOut == Set(1)
    | Working(active) => active == continued
    | ReadyToReview(saved) => saved.attempt == continued
    | _ => false
  }
  val Safety = WorkPreserved and (not(ended) or state.stopped) and not(state.staleApplied) and
    state.review == (if (ended) waiting else startReview(waiting, 1)) and
    state.proposal == (if (ended) pending else reviewProposal(pending, 1)) and
    state.question == Answered({ recipient: 1, text: 9 })
  val Success = state.resumed and not(ended) and state.staleTried and taskPhase(state.work) == ReadyToReview(NoPayload)
  val Fault = ended and not(state.intervened) and state.staleTried and taskPhase(state.work) == ReadyToReview(NoPayload)
  val Intervention = ended and state.intervened and taskPhase(state.work) == ReadyToReview(NoPayload)
}
module staffReplacement {
  import staffReplacementCase(retainOnPause = true).* from "./staffReplacement"
}
module staffReplacementMutant {
  import staffReplacementCase(retainOnPause = false).* from "./staffReplacement"
}
