// U1: a single session serves three identities. An adversary can add or withdraw
// an obligation. Printing it changes no obligation; only an accepted act consumes it.
module worker {
  import contract.* from "./contract"
  const STICKY: bool
  const WRONG_TOKEN: bool

  type Identity = Host | Role | Pipe
  type Session = Online | Parked | Exited
  type Delivery = Empty | Printed({ owner: Identity, token: Identity, current: bool })
  pure val IDENTITIES = Set(Host, Role, Pipe)

  type Worker = { session: Session, queue: List[Identity], delivery: Delivery,
                  heard: Set[Identity], parked: bool, carried: Set[Identity], afterPark: bool,
                  yielded: bool, refused: bool, faulted: bool, crossed: bool, skippedOlder: bool }
  var worker: Worker

  action init = worker' = {
    session: Online, queue: [], delivery: Empty, heard: Set(), parked: false, carried: Set(),
    afterPark: false, yielded: false, refused: false, faulted: false, crossed: false, skippedOlder: false,
  }

  def owed(identity: Identity): bool = worker.queue.indices().exists(i => worker.queue[i] == identity)
  pure def invalidate(delivery: Delivery): Delivery = match delivery {
    | Empty => Empty
    | Printed(step) => Printed({ ...step, current: false })
  }
  action offer = all {
    nondet identity = IDENTITIES.filter(id => not(owed(id))).oneOf()
    worker' = { ...worker, queue: worker.queue.append(identity) },
  }
  action withdraw = all {
    nondet identity = IDENTITIES.filter(owed).oneOf()
    val queue = worker.queue.foldl([], (rest, id) =>
      if (id == identity) rest else rest.append(id))
    val delivery = match worker.delivery {
      | Empty => Empty
      | Printed(step) => if (step.owner == identity) invalidate(worker.delivery) else worker.delivery
    }
    worker' = { ...worker, queue: queue, delivery: delivery, carried: worker.carried.exclude(Set(identity)) },
  }
  action printOldest = all {
    worker.session == Online,
    worker.delivery == Empty,
    worker.queue.length() > 0,
    not(STICKY) or owed(Host),
    val owner = if (STICKY) Host else worker.queue[0]
    val token = if (WRONG_TOKEN and owner != Host) Host else owner
    worker' = { ...worker, delivery: Printed({ owner: owner, token: token, current: true }),
      skippedOlder: worker.skippedOlder or owner != worker.queue[0] },
  }
  def accepts(step: { owner: Identity, token: Identity, current: bool }): bool =
    worker.session == Online and step.current and step.owner == step.token and owed(step.owner)

  // The turn ends after its single act, even on refusal. Another identity may run
  // at the next wait. A withdrawn obligation can return without reviving its old view.
  def printed = match worker.delivery {
    | Empty => { owner: Host, token: Host, current: false }
    | Printed(step) => step
  }
  action submit = all {
    worker.session == Online,
    worker.delivery != Empty,
    val step = printed
    val accepted = accepts(step)
    val queue = worker.queue.foldl([], (rest, id) =>
      if (accepted and id == step.owner) rest else rest.append(id))
    worker' = { ...worker, queue: queue, delivery: Empty,
      heard: if (accepted) worker.heard.union(Set(step.owner)) else worker.heard,
      yielded: worker.yielded or (accepted and queue.length() > 0),
      afterPark: worker.afterPark or (accepted and worker.carried.contains(step.owner)),
      refused: worker.refused or not(accepted),
      crossed: worker.crossed or step.owner != step.token },
  }
  // Both park and exit affect the only session, so all three identities lose
  // delivery together. The printed but uncommitted view carries no claim.
  action park = all {
    worker.session == Online,
    not(worker.parked),
    owed(Host) or owed(Pipe),
    worker' = { ...worker, session: Parked, parked: true,
                carried: Set(Host, Pipe).filter(owed), delivery: invalidate(worker.delivery) },
  }
  action exit = all {
    worker.session == Online,
    not(worker.faulted),
    worker' = { ...worker, session: Exited, faulted: true,
                delivery: invalidate(worker.delivery) },
  }
  action relaunch = all {
    worker.session != Online,
    worker' = { ...worker, session: Online },
  }
  action step = any { offer, withdraw, printOldest, submit, park, exit, relaunch }

  // Even a rejected act must carry its own identity's token.
  val OldestFirst = not(worker.skippedOlder)
  val NoIdentityCrossing = not(worker.crossed)
  // Guard for future changes: no suspended handler occupies the worker; a printed step is eligible to
  // submit or be refused after relaunch, and even refusal returns to wait.
  val NoBlockedOnlyExecutor = match worker.delivery {
    | Empty => true
    | Printed(step) => not(step.current) or worker.session == Online
  }
  val AllIdentitiesHeard = worker.heard == IDENTITIES
  val YieldReached = worker.yielded
  val HeardAfterPark = worker.afterPark
  val StaleRefused = worker.refused
  val NoYield = not(YieldReached)
  val NoAllIdentities = not(AllIdentitiesHeard)
  val NoHeardAfterPark = not(HeardAfterPark)
  val NoStaleRefusal = not(StaleRefused)

  def hearing(identity: Identity): bool = match worker.delivery {
    | Empty => false
    | Printed(step) => step.owner == identity and accepts(step)
  }
  // Fairness is only on the channel operations, not on the adversary.
  temporal SelectionFair = weakFair(printOldest, worker) and weakFair(submit, worker)
                          and weakFair(relaunch, worker)
  temporal G1All = SelectionFair implies all {
    G1(owed(Host), hearing(Host), false),
    G1(owed(Role), hearing(Role), false),
    G1(owed(Pipe), hearing(Pipe), false),
  }
}

// ---- instances
module workerFixed {
  import worker(STICKY = false, WRONG_TOKEN = false).* from "./worker"
}
module workerSticky {
  import worker(STICKY = true, WRONG_TOKEN = false).* from "./worker"
}
module workerWrongToken {
  import worker(STICKY = false, WRONG_TOKEN = true).* from "./worker"
}
