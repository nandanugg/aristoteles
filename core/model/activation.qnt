module activation {
  import lines.* from "./lines"
  type ProjectPhase = Onboarding | Activating | Active | RollingBack | Ended
  type Mark = Approved | Marked | Newer
  type Record = {
    phase: ProjectPhase,
    file: Mark,
    reserved: int,
    alive: Set[int],
    acked: Set[int],
    binding: int,
    pending: int,
    top: int,
    delivered: Set[int],
    retired: Set[int]
  }
  pure val initial: Record = {
    phase: Onboarding, file: Approved, reserved: 0, alive: Set(), acked: Set(),
    binding: 0, pending: 0, top: 0, delivered: Set(), retired: Set()
  }
  type ProjectMove = ActivationNext | ActivationBack | ProjectEnd
  pure val projectLine: Line[ProjectPhase, ProjectMove] = Map(
    Onboarding -> { owes: Owner, moves: Set((ActivationNext, Activating)) },
    Activating -> { owes: Engine, moves: Set((ActivationNext, Active), (ActivationBack, RollingBack)) },
    RollingBack -> { owes: Engine, moves: Set((ActivationBack, Onboarding)) },
    Active -> { owes: Owner, moves: Set((ProjectEnd, Ended)) },
    Ended -> { owes: NoDuty, moves: Set() }
  )
  pure def move(record: Record, label: ProjectMove, nextPhase: ProjectPhase): Record =
    if (allows(projectLine, record.phase, label, nextPhase)) { ...record, phase: nextPhase }
    else record
  pure def endProject(record: Record): Record =
    if (record.alive == Set()) move(record, ProjectEnd, Ended) else record
  pure def authorize(record: Record, approved: bool): Record =
    if (approved and record.file == Approved) move(record, ActivationNext, Activating) else record
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
      // The host session and the Project move are committed in one append.
      move({ ...record, binding: launch }, ActivationNext, Active)
    else record
  }
  pure def rollback(record: Record): Record =
    if (record.binding == 0) move(record, ActivationBack, RollingBack) else record
  pure def restore(record: Record, checkFile: bool): Record =
    if (record.phase == RollingBack and (record.file == Marked or not(checkFile)))
      { ...record, file: Approved }
    else record
  pure def clean(record: Record): Record =
    if (record.phase == RollingBack and record.file != Marked) {
      val stopped = { ...record, reserved: 0, alive: Set(), acked: Set() }
      move(stopped, ActivationBack, Onboarding)
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
    record.phase == Active and not(record.retired.contains(launch)) and
      record.alive.contains(launch) and record.acked.contains(launch) and
      (launch == bound or (not(checkBinding) and launch == record.pending))
  }
  pure def deliver(record: Record, launch: int, checkBinding: bool): Record =
    if (canDeliver(record, launch, checkBinding))
      { ...record, delivered: record.delivered.union(Set(launch)) }
    else record
  pure def work(record: Record, launch: int): Record =
    if (record.phase == Active and record.top == launch and record.alive.contains(launch) and
        record.delivered.contains(launch)) { ...record, retired: record.retired.union(Set(launch)) }
    else record
}
