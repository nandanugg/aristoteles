module reviewSlotCase {
  import lines.* from "../lines"
  import people.* from "../people"
  const entryOrder: bool
  pure val staffing: Staffing = {
    assignments: Map(1 -> 1, 2 -> 2), allowance: Map(0 -> 1, 1 -> 0, 2 -> 1),
    subscription: Map(0 -> 0, 1 -> 1, 2 -> 2), subscriptionLimit: Map(0 -> 1, 1 -> 1, 2 -> 1), version: 1
  }
  pure val firstQueued: QueuedReview = { id: 1, role: 1, entered: 1, review: Waiting }
  pure val secondQueued: QueuedReview = { id: 2, role: 1, entered: 2, review: Waiting }
  pure val ownSlotReview: QueuedReview = { id: 3, role: 2, entered: 3, review: Waiting }
  var state: {
    queue: Set[QueuedReview], busy: Set[int], changed: bool, started: List[int],
    triedLater: bool, triedOwnBusy: bool, oldRun: int, liveRun: int, triedOldRun: bool, consumedOld: bool
  }
  action init = state' = {
    queue: Set(firstQueued, secondQueued, ownSlotReview), busy: Set(2), changed: false, started: [],
    triedLater: false, triedOwnBusy: false, oldRun: 0, liveRun: 0, triedOldRun: false, consumedOld: false
  }
  action editOlder = all {
    not(state.changed),
    state' = { ...state, changed: true }
  }
  action assignReview = {
    nondet subject = state.queue.filter(q => q.review == Waiting).oneOf()
    val by = reviewStaff(staffing, state.queue, subject, 0, state.busy, entryOrder)
    all {
      if (by < 0) state' = { ...state,
        triedLater: state.triedLater or (state.changed and subject.id == 2 and state.started == []),
        triedOwnBusy: state.triedOwnBusy or subject.id == 3 }
      else state' = { ...state,
        queue: state.queue.exclude(Set(subject)).union(Set({ ...subject, review: By(by) })),
        busy: state.busy.union(Set(by)), started: state.started.append(subject.id),
        liveRun: if (by == 0) subject.id else state.liveRun }
    }
  }
  action finish = {
    nondet subject = state.queue.filter(q => q.review != Waiting).oneOf()
    nondet childRun = Set(state.liveRun, state.oldRun).oneOf()
    match subject.review {
      | Waiting => all { false, state' = state }
      | By(staff) => {
          val accepted = staff != 0 or (childRun == state.liveRun and childRun == subject.id)
          if (accepted)
            state' = { ...state, queue: state.queue.exclude(Set(subject)),
              busy: state.busy.exclude(Set(staff)),
              oldRun: if (staff == 0) state.liveRun else state.oldRun,
              consumedOld: state.consumedOld or (staff == 0 and childRun == state.oldRun) }
          else state' = { ...state, triedOldRun: state.triedOldRun or (childRun == state.oldRun and childRun > 0) }
        }
    }
  }
  action freeOwn = all {
    state.busy.contains(2), state.queue.contains(ownSlotReview),
    state' = { ...state, busy: state.busy.exclude(Set(2)) }
  }
  action step = any { editOlder, assignReview, finish, freeOwn, state' = state }
  def started(id: int): bool = state.started.foldl(false, (found, other) => found or other == id)
  val hostStarts = state.started.foldl([], (ordered, id) => if (id == 3) ordered else ordered.append(id))
  val Safety = not(state.consumedOld) and (not(started(2)) or hostStarts[0] == 1)
  val Success = started(1) and started(2) and started(3)
  val Fault = state.triedLater and state.triedOwnBusy and state.triedOldRun
}
module reviewSlot {
  import reviewSlotCase(entryOrder = true).* from "./reviewSlot"
}
module reviewSlotMutant {
  import reviewSlotCase(entryOrder = false).* from "./reviewSlot"
}
