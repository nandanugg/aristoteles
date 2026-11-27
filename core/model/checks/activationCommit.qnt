module activationCommitCase {
  import activation.* from "../activation"
  const currentAck: bool
  var state: { record: Record, interrupted: bool, offeredStale: bool, earlyWork: bool }
  action init = state' = {
    record: initial, interrupted: false, offeredStale: false, earlyWork: false
  }
  action approve = all {
    state.record.phase == Onboarding,
    state' = { ...state, record: authorize(state.record, true) }
  }
  action markFile = all {
    mark(state.record) != state.record, state.record.binding == 0,
    state' = { ...state, record: mark(state.record) }
  }
  action startHost = {
    nondet launch = Set(1, 2).oneOf()
    val record = reserve(state.record, launch)
    all {
      record != state.record,
      state' = { ...state, record: record }
    }
  }
  action launchHost = all {
    spawn(state.record, state.record.reserved) != state.record,
    state' = { ...state, record: spawn(state.record, state.record.reserved) }
  }
  action acknowledge = all {
    ack(state.record, state.record.reserved) != state.record,
    state' = { ...state, record: ack(state.record, state.record.reserved) }
  }
  action loseHost = all {
    state.record.binding == 0, state.record.acked.contains(1), state.record.alive.contains(1),
    state' = { ...state, record: die(state.record, 1) }
  }
  action tryCommit = {
    val record = commit(state.record, currentAck)
    val stale = state.record.reserved == 2 and state.record.alive.contains(2) and
      state.record.acked == Set(1)
    all {
      state.record.phase == Activating,
      state' = { ...state, record: record, offeredStale: state.offeredStale or stale }
    }
  }
  action crashBeforeNote = all {
    state.record.binding > 0, state.record.phase == Activating, not(state.interrupted),
    state' = { ...state, interrupted: true }
  }
  action note = all {
    observeActive(state.record) != state.record,
    state' = { ...state, record: observeActive(state.record) }
  }
  action probeWork = all {
    state.record.phase != Active,
    state' = { ...state, earlyWork: state.earlyWork or work(state.record, 1).used }
  }
  action step = any { approve, markFile, startHost, launchHost, acknowledge, loseHost,
    tryCommit, crashBeforeNote, note, probeWork, state' = state }
  val Safety = not(state.earlyWork) and (state.record.phase != Active implies endProject(state.record) == state.record) and
    (state.record.binding > 0 implies state.record.file == Marked and
      state.record.alive.contains(state.record.binding) and state.record.acked.contains(state.record.binding)) and
    (state.record.phase == Active implies state.record.binding > 0) and
    state.record.alive.subseteq(Set(state.record.reserved))
  val Success = state.record.phase == Active and state.record.binding == 1
  val Fault = state.offeredStale and state.interrupted and state.record.phase == Active and state.record.binding == 2
}
module activationCommit {
  import activationCommitCase(currentAck = true).* from "./activationCommit"
}
module activationCommitMutant {
  import activationCommitCase(currentAck = false).* from "./activationCommit"
}
