module reviewEvidenceCase {
  import lines.* from "../lines"
  const evidenceGuard: bool
  var state: { task: Task, lastReportValid: bool, triedBadInput: bool, sawRetry: bool, commandFailed: bool }
  pure val expected = Set(1, 2)
  pure val holdingCommand = { rule: 1, breaks: false, evidence: true }
  pure val failingCommand = { ...holdingCommand, breaks: true }
  pure val holdingPrompt = { rule: 2, breaks: false, evidence: true }
  pure val breakingPrompt = { ...holdingPrompt, breaks: true }
  pure val invalidQuote = { ...holdingPrompt, evidence: false }
  pure val wrongVersion = { ...holdingPrompt, rule: 3 }

  action init = state' = {
    task: beginWork(newTask, 1), lastReportValid: true, triedBadInput: false,
    sawRetry: false, commandFailed: false
  }
  action result = all {
    taskPhase(state.task) == "Working",
    state' = { ...state, task: reportResult(state.task, 1, 1, 7) }
  }
  action commands = {
    nondet outcome = Set(holdingCommand, failingCommand).oneOf()
    all {
      taskPhase(state.task) == "ReadyToReview",
      state' = { ...state, task: enterReview(state.task, [outcome]), commandFailed: outcome.breaks }
    }
  }
  action assignReview = all {
    startReview(state.task, 2) != state.task,
    state' = { ...state, task: startReview(state.task, 2) }
  }
  action report = {
    nondet reports = Set([], [holdingPrompt], [breakingPrompt], [invalidQuote], [wrongVersion],
      [holdingPrompt, holdingPrompt], [holdingCommand]).oneOf()
    nondet finding = Set(false, true).oneOf()
    match state.task {
      | Reviewing(input) => {
          val task = reviewTask(state.task, 2, reports, expected, finding, false, Set(), 1, evidenceGuard)
          val valid = checked(input.commands, reports, expected)
          all {
            input.review == By(2),
            state' = { ...state, task: task,
              triedBadInput: state.triedBadInput or not(valid),
              lastReportValid: task == state.task or valid,
              sawRetry: state.sawRetry or taskPhase(task) == "Working" }
          }
        }
      | _ => all { false, state' = state }
    }
  }
  action step = any { result, commands, assignReview, report, state' = state }
  val Safety = state.lastReportValid and (taskPhase(state.task) != "Done" or not(state.commandFailed))
  val Success = match state.task {
    | Done(done) => done.outcomes == [holdingCommand, holdingPrompt]
    | _ => false
  }
  val Fault = state.triedBadInput and state.sawRetry and state.task == Raised(Misses)
}
module reviewEvidence {
  import reviewEvidenceCase(evidenceGuard = true).* from "./reviewEvidence"
}
module reviewEvidenceMutant {
  import reviewEvidenceCase(evidenceGuard = false).* from "./reviewEvidence"
}
