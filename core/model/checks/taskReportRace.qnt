module taskReportRaceCase {
  import lines.* from "../lines"
  const once: bool
  var state: {
    task: Task, copies: Set[int], writes: List[int], interrupted: bool, pending: int
  }
  action init = state' = {
    task: newTask, copies: Set(1, 2), writes: [], interrupted: false, pending: 0
  }
  action begin = all {
    state.task == newTask,
    state' = { ...state, task: beginWork(state.task, 1) }
  }
  action prepare = {
    nondet copy = state.copies.oneOf()
    all {
      state.task != newTask, state.pending == 0,
      state' = { ...state, pending: copy }
    }
  }
  action interrupt = all {
    state.pending > 0, not(state.interrupted),
    state' = { ...state, pending: 0, interrupted: true }
  }
  action commitResult = {
    val nextTask = reportResult(state.task, 1, 1, 7)
    val apply = nextTask != state.task
    all {
      state.pending > 0,
      state' = { ...state, pending: 0, copies: state.copies.exclude(Set(state.pending)),
        task: nextTask, writes: if (apply or not(once)) state.writes.append(7) else state.writes }
    }
  }
  action testCommands = all {
    taskPhase(state.task) == "ReadyToReview",
    state' = { ...state, task: enterReview(state.task, []) }
  }
  action step = any { begin, prepare, interrupt, commitResult, testCommands, state' = state }
  val Safety = state.writes.length() <= 1 and
    (state.writes.length() == 1) == Set("ReadyToReview", "Reviewing").contains(taskPhase(state.task))
  val Success = taskPhase(state.task) == "Reviewing" and state.writes.length() == 1
  val Fault = state.interrupted and state.copies == Set() and state.writes.length() == 1
}
module taskReportRace {
  import taskReportRaceCase(once = true).* from "./taskReportRace"
}
module taskReportRaceMutant {
  import taskReportRaceCase(once = false).* from "./taskReportRace"
}
