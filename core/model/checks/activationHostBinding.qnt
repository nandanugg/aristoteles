module activationHostBindingCase {
  import activation.* from "../activation"
  const onlyBound: bool
  pure val marked = mark(authorize(initial, true))
  pure val started = observeActive(commit(ack(spawn(reserve(marked, 1), 1), 1), true))
  var state: { record: Record, rejectedPending: bool, interrupted: bool, deniedAfterUse: bool, servedAfterUse: bool }
  action init = state' = { record: started, rejectedPending: false, interrupted: false, deniedAfterUse: false, servedAfterUse: false }
  action loseHost = all {
    state.record.top == 0, state.record.binding == 1, state.record.alive.contains(1),
    state' = { ...state, record: die(state.record, 1) }
  }
  action startReplacement = {
    val record = rebind(state.record, 2)
    all {
      record != state.record,
      state' = { ...state, record: record }
    }
  }
  action launchReplacement = all {
    state.record.pending == 2, not(state.record.acked.contains(2)),
    state' = { ...state, record: ack(spawn(state.record, 2), 2) }
  }
  action chooseBinding = all {
    commitBinding(state.record) != state.record,
    state' = { ...state, record: commitBinding(state.record) }
  }
  action crashBeforeNote = all {
    state.record.pending > 0, state.record.pending == state.record.binding, not(state.interrupted),
    state' = { ...state, interrupted: true }
  }
  action reconcile = all {
    settleBinding(state.record) != state.record,
    state' = { ...state, record: settleBinding(state.record) }
  }
  action openProject = all {
    openTop(state.record) != state.record,
    state' = { ...state, record: openTop(state.record) }
  }
  action collect = {
    nondet launch = Set(1, 2).oneOf()
    val served = canDeliver(state.record, launch, onlyBound)
    val retired = state.record.retired.contains(launch)
    val record = deliver(state.record, launch, onlyBound)
    all {
      state.record.alive.contains(launch) and state.record.acked.contains(launch),
      state' = { ...state, record: record,
        rejectedPending: state.rejectedPending or (record == state.record and
          state.record.pending == launch and state.record.binding != launch),
        deniedAfterUse: state.deniedAfterUse or (retired and not(served)),
        servedAfterUse: state.servedAfterUse or (retired and served) }
    }
  }
  action firstWork = all {
    work(state.record, state.record.binding) != state.record,
    state' = { ...state, record: work(state.record, state.record.binding) }
  }
  action step = any { loseHost, startReplacement, launchReplacement, chooseBinding, crashBeforeNote,
    reconcile, openProject, collect, firstWork, state' = state }
  val Safety = not(state.servedAfterUse) and (state.record.top != 0 implies state.record.top == state.record.binding) and
    (state.record.delivered.contains(2) implies state.record.binding == 2) and
    (state.record.binding == 2 implies state.record.alive.contains(2)) and
    state.record.retired.subseteq(state.record.delivered)
  val Success = state.record.retired.contains(state.record.top) and state.record.top == 1
  val Fault = state.rejectedPending and state.interrupted and state.record.retired.contains(state.record.top) and
    state.record.top == 2 and state.record.pending == 0 and state.deniedAfterUse
}
module activationHostBinding {
  import activationHostBindingCase(onlyBound = true).* from "./activationHostBinding"
}
module activationHostBindingMutant {
  import activationHostBindingCase(onlyBound = false).* from "./activationHostBinding"
}
