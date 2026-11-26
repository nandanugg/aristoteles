module activation {
  import lines.* from "./lines"
  type Activation = Onboarding | Activating | Active | RollingBack
  type Mark = Approved | Marked | Newer
  type Record = {
    phase: Activation,
    file: Mark,
    reserved: int,
    alive: Set[int],
    acked: Set[int],
    binding: int,
    pending: int,
    top: int,
    delivered: Set[int],
    used: bool
  }
  pure val initial: Record = {
    phase: Onboarding, file: Approved, reserved: 0, alive: Set(), acked: Set(),
    binding: 0, pending: 0, top: 0, delivered: Set(), used: false
  }
  pure val activationLine = Map(
    "Onboarding" -> { owes: Owner, moves: Set(("next", "Activating")) },
    "Activating" -> { owes: Engine, moves: Set(("next", "Active"), ("back", "RollingBack")) },
    "RollingBack" -> { owes: Engine, moves: Set(("back", "Onboarding")) },
    "Active" -> { owes: NoDuty, moves: Set() }
  )
  pure def activationPhase(phase: Activation): str = match phase {
    | Onboarding => "Onboarding"
    | Activating => "Activating"
    | Active => "Active"
    | RollingBack => "RollingBack"
  }
  pure def move(record: Record, label: str, nextPhase: Activation): Record =
    if (allows(activationLine, activationPhase(record.phase), label, activationPhase(nextPhase)))
      { ...record, phase: nextPhase }
    else record
  pure def authorize(record: Record, approved: bool): Record =
    if (approved and record.file == Approved) move(record, "next", Activating) else record
  pure def mark(record: Record): Record =
    if (record.phase == Activating and record.file == Approved) { ...record, file: Marked } else record
  pure def reserve(record: Record, launch: int): Record =
    if (record.phase == Activating and record.binding == 0 and launch > record.reserved and
        not(record.alive.contains(record.reserved))) { ...record, reserved: launch }
    else record
  pure def spawn(record: Record, launch: int): Record =
    if (launch > 0 and (record.phase == Activating and record.binding == 0 and launch == record.reserved or
                      record.pending == launch))
      { ...record, alive: record.alive.union(Set(launch)) }
    else record
  pure def ack(record: Record, launch: int): Record =
    if (record.alive.contains(launch)) { ...record, acked: record.acked.union(Set(launch)) } else record
  pure def die(record: Record, launch: int): Record =
    { ...record, alive: record.alive.exclude(Set(launch)) }
  pure def commit(record: Record, checkAck: bool): Record = {
    val launch = record.reserved
    if (record.phase == Activating and record.binding == 0 and record.file == Marked and
        record.alive.contains(launch) and (if (checkAck) record.acked.contains(launch) else record.acked != Set()))
      { ...record, binding: launch }
    else record
  }
  pure def observeActive(record: Record): Record =
    if (record.binding != 0) move(record, "next", Active) else record
  pure def rollback(record: Record): Record =
    if (record.binding == 0) move(record, "back", RollingBack) else record
  pure def restore(record: Record, checkFile: bool): Record =
    if (record.phase == RollingBack and (record.file == Marked or not(checkFile)))
      { ...record, file: Approved }
    else record
  pure def clean(record: Record): Record =
    if (record.phase == RollingBack and record.file != Marked) {
      val stopped = { ...record, reserved: 0, alive: Set(), acked: Set() }
      move(stopped, "back", Onboarding)
    } else record
  pure def rebind(record: Record, launch: int): Record =
    if (record.phase == Active and record.top == 0 and record.pending == 0 and
        launch > record.binding and not(record.alive.contains(record.binding)))
      { ...record, pending: launch }
    else record
  pure def commitBinding(record: Record): Record =
    if (record.pending > 0 and record.top == 0 and
        record.alive.contains(record.pending) and record.acked.contains(record.pending))
      { ...record, binding: record.pending }
    else record
  pure def settleBinding(record: Record): Record =
    if (record.pending == 0) record
    else if (record.binding == record.pending) { ...record, pending: 0 }
    else if (record.top > 0 or not(record.alive.contains(record.pending)))
      { ...record, pending: 0, alive: record.alive.exclude(Set(record.pending)) }
    else record
  pure def openTop(record: Record): Record =
    if (record.phase == Active and record.top == 0) { ...record, top: record.binding } else record
  pure def canDeliver(record: Record, launch: int, checkBinding: bool): bool = {
    val bound = if (record.top == 0) record.binding else record.top
    record.phase == Active and not(record.used) and
      record.alive.contains(launch) and record.acked.contains(launch) and
      (launch == bound or (not(checkBinding) and launch == record.pending))
  }
  pure def deliver(record: Record, launch: int, checkBinding: bool): Record =
    if (canDeliver(record, launch, checkBinding))
      { ...record, delivered: record.delivered.union(Set(launch)) }
    else record
  pure def work(record: Record, launch: int): Record =
    if (record.phase == Active and record.top == launch and record.alive.contains(launch) and
        record.delivered.contains(launch)) { ...record, used: true }
    else record
}
