module activationRollbackCase {
  import activation.* from "../activation"
  const keepEdit: bool
  var state: { record: Record, edited: bool, interrupted: bool, askedAfterCommit: bool, finished: bool, restored: bool }
  action init = state' = { record: authorize(initial, true), edited: false,
    interrupted: false, askedAfterCommit: false, finished: false, restored: false }
  action markFile = all {
    mark(state.record) != state.record,
    state' = { ...state, record: mark(state.record) }
  }
  action editFile = all {
    state.record.phase == Activating, state.record.binding == 0, state.record.file == Marked,
    not(state.edited),
    state' = { ...state, edited: true, record: { ...state.record, file: Newer } }
  }
  action launchHost = {
    val record = ack(spawn(reserve(state.record, 1), 1), 1)
    all {
      record != state.record,
      state' = { ...state, record: record }
    }
  }
  action activate = {
    val withHost = ack(spawn(reserve(state.record, 1), 1), 1)
    val record = observeActive(commit(withHost, true))
    all {
      state.record.phase == Activating, state.record.file == Marked,
      record.phase == Active,
      state' = { ...state, record: record }
    }
  }
  action cancel = all {
    Set(Activating, Active).contains(state.record.phase),
    state' = { ...state, record: rollback(state.record),
      askedAfterCommit: state.askedAfterCommit or state.record.binding > 0 }
  }
  action restoreFile = all {
    state.record.phase == RollingBack, restore(state.record, keepEdit) != state.record,
    state' = { ...state, record: restore(state.record, keepEdit), restored: true }
  }
  action crashDuringCleanup = all {
    state.record.phase == RollingBack, not(state.interrupted),
    state' = { ...state, interrupted: true }
  }
  action finishCleanup = all {
    clean(state.record) != state.record,
    state' = { ...state, record: clean(state.record), finished: true }
  }
  action step = any { markFile, editFile, launchHost, activate, cancel, restoreFile, crashDuringCleanup, finishCleanup,
    state' = state }
  val Safety = (state.edited implies state.record.file == Newer) and
    (state.askedAfterCommit implies state.record.phase == Active and state.record.binding == 1) and
    (state.finished implies state.record.phase == Onboarding and state.record.alive == Set())
  val Success = state.finished and state.restored and state.record.file == Approved
  val Fault = state.finished and state.interrupted and state.edited
}
module activationRollback {
  import activationRollbackCase(keepEdit = true).* from "./activationRollback"
}
module activationRollbackMutant {
  import activationRollbackCase(keepEdit = false).* from "./activationRollback"
}
