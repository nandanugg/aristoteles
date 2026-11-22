// Activation (onboarding v2, ONBOARDING-V2 sections 10-12): the end of onboarding, from the
// person's accepted result to a store that takes work. Small on purpose, for TLC.
// The steps, each atomic and idempotent, each reading the durable record and the world
// before it acts (no step keeps memory across a crash: a crash is any point where the steps
// stop, and a resume is the same steps run again):
//   1. the ACTIVATION RECORD is written (the approved file revisions), only after a preflight
//      finds every instruction file equal to its approved revision;
//   2. the store is created INACTIVE (it refuses every work act);
//   3. each marker line is written from the kept original; a file is DONE when it equals its
//      approved revision plus the marker (the world, not the record, says so);
//   4. a LAUNCH IDENTITY is written to the record BEFORE the host is spawned under it; the host
//      starts in bootstrap mode and acknowledges against its identity; a live unacknowledged
//      launch is reused, a dead one is replaced under a NEW identity (never respawned under
//      the old one, so an old acknowledgement never counts);
//   5. the store is ACTIVATED (one write) only when 1-4 are done and the recorded launch is
//      alive and acknowledged by its current process; the record notes it after.
// Roll back (the person's choice, never fair): only while the store is not active: the
// originals restored, the bootstrap host stopped, the inactive store deleted.
// After activation and before the first top (contract 6c v4, B4-B6): the credential is delivered
// only to the COMMITTED binding (the activated launch, or the last rebind); a host lost before the
// top is relaunched by the person as a PENDING rebind (a new launch reserved, spawned,
// acknowledged), committed only while no top exists; if the person opens the top first, the top
// binds the committed launch and the pending rebind is cancelled (its process stopped).
// The adversary: the host dies (bounded), the person edits an instruction file (bounded) at
// any time, a step runs late. The person's edits are never overwritten.
module activation {
  // The design's choices, each off in one mutant (README, Properties).
  const Design: { checkFiles: bool, ackCurrent: bool, freshIds: bool, recordFirst: bool,
                  rollbackGuard: bool, storeRefuses: bool, rebindGuard: bool,
                  deliverCommitted: bool, retireAtUse: bool, reconcileFirst: bool }
  pure val FILES = Set(0, 1)
  pure val MAX_ID = 3          // launch identities 0..MAX_ID
  pure val MAX_DEATHS = 1
  pure val MAX_EDITS = 1

  type Content = Approved | Marked | Other     // Other: the person changed it
  type StoreState = NoStore | Inactive | Active(int)   // Active(the activated launch)
  type RecordState = NoRecord | Activating | RollingBack | Activated | RolledBack
  type World = {
    files: int -> Content,
    store: StoreState,
    record: RecordState,
    noted: Set[int],          // the record's per-file notes (a cache; the world decides)
    launch: int,              // the recorded launch identity, -1 for none
    spawned: Set[int],        // identities a process was ever started under
    alive: Set[int],          // live host processes, by identity
    acks: Set[int],           // acknowledgements written (durable; an old one stays)
    nextId: int,
    deaths: int, edits: int,
    binding: int,             // the committed launch (Activated, then HostRebound), -1 before
    pending: int,             // a pending rebind's launch, -1 for none
    top: int,                 // the launch the first top bound, -1 before the top
    delivered: Set[int],      // launches that collected the credential
    used: bool,               // the bound host's first authenticated use: retires the delivery
    rebinds: Set[int],        // launches committed by a rebind
    // ghosts (the truth the steps never read)
    ackedNow: Set[int],       // identities whose CURRENT process acknowledged
    worked: bool, workWhileInactive: bool, workByOther: bool,
    activatedStale: bool, activatedUnmarked: bool, overwroteEdit: bool, rolledBackActive: bool,
    replaced: bool, deliveredWrong: bool, rebindAfterTop: bool, rebound: bool, cancelled: bool,
    reboundWorked: bool, lateCollection: bool, stoppedCommitted: bool, notedLate: bool,
  }
  var world: World

  action init = world' = {
    files: FILES.mapBy(_ => Approved), store: NoStore, record: NoRecord, noted: Set(),
    launch: -1, spawned: Set(), alive: Set(), acks: Set(), nextId: 0, deaths: 0, edits: 0,
    binding: -1, pending: -1, top: -1, delivered: Set(), used: false, rebinds: Set(),
    ackedNow: Set(), worked: false, workWhileInactive: false, workByOther: false,
    activatedStale: false, activatedUnmarked: false, overwroteEdit: false,
    rolledBackActive: false, replaced: false, deliveredWrong: false, rebindAfterTop: false,
    rebound: false, cancelled: false, reboundWorked: false, lateCollection: false,
    stoppedCommitted: false, notedLate: false,
  }

  def isActive(s: StoreState): bool = match s { | Active(_) => true | _ => false }
  def activeLaunch(s: StoreState): int = match s { | Active(id) => id | _ => -1 }
  def activating = world.record == Activating

  // ---- 1. preflight and the record
  action writeRecord = all {
    world.record == NoRecord,
    FILES.forall(f => world.files.get(f) == Approved),
    world' = { ...world, record: Activating },
  }
  // ---- 2. the inactive store
  action createStore = all {
    activating, world.store == NoStore,
    world' = { ...world, store: Inactive },
  }
  // ---- 3. the marker lines, from the kept originals; then the note
  action markFile = {
    nondet f = FILES.oneOf()
    all {
      activating, world.store != NoStore,
      // the design writes only over the approved revision (a person's edit stops the file)
      Design.checkFiles implies world.files.get(f) == Approved,
      not(Design.checkFiles) implies not(world.noted.contains(f)),
      world.files.get(f) != Marked,
      world' = { ...world, files: world.files.set(f, Marked),
                 overwroteEdit: world.overwroteEdit or world.files.get(f) == Other },
    }
  }
  action noteFile = {
    nondet f = FILES.oneOf()
    all {
      activating, world.files.get(f) == Marked, not(world.noted.contains(f)),
      world' = { ...world, noted: world.noted.union(Set(f)) },
    }
  }
  def filesDone = if (Design.checkFiles) FILES.forall(f => world.files.get(f) == Marked)
                  else world.noted == FILES
  // ---- 4. the launch identity, then the spawn
  def launchDead = world.launch >= 0 and world.spawned.contains(world.launch)
                   and not(world.alive.contains(world.launch))
  // A new identity is recorded when there is none or the recorded one is dead.
  // Only before the commit: once the store is active, a lost host is the person's rebind (resume
  // only notes the activation; it never launches a host the credential will not reach).
  action recordLaunch = all {
    activating, not(isActive(world.store)), world.nextId <= MAX_ID, world.launch < 0 or launchDead,
    Design.recordFirst,
    world' = { ...world, launch: world.nextId, nextId: world.nextId + 1,
               replaced: world.replaced or world.acks.contains(world.launch) },
  }
  // Spawn the recorded identity if no process ever ran under it. (Mutant freshIds off: a
  // dead identity is spawned again under its old name.)
  action spawn = all {
    activating, not(isActive(world.store)), world.launch >= 0, not(world.alive.contains(world.launch)),
    if (Design.freshIds) not(world.spawned.contains(world.launch)) else true,
    world' = { ...world, spawned: world.spawned.union(Set(world.launch)),
               alive: world.alive.union(Set(world.launch)),
               ackedNow: world.ackedNow.exclude(Set(world.launch)) },
  }
  // Mutant recordFirst off: the process is spawned first, its identity recorded after.
  action spawnUnrecorded = all {
    not(Design.recordFirst), activating, world.nextId <= MAX_ID,
    world.launch < 0 or launchDead,
    world' = { ...world, spawned: world.spawned.union(Set(world.nextId)),
               alive: world.alive.union(Set(world.nextId)), nextId: world.nextId + 1 },
  }
  action recordSpawned = {
    nondet id = world.alive.oneOf()
    all {
      not(Design.recordFirst), activating, id != world.launch, world.launch < 0 or launchDead,
      world' = { ...world, launch: id, replaced: world.replaced or world.acks.contains(world.launch) },
    }
  }
  // ---- the host: acknowledges in bootstrap mode, takes work once its store is active
  action hostAcks = {
    nondet id = world.alive.oneOf()
    all {
      not(world.ackedNow.contains(id)),
      world' = { ...world, acks: world.acks.union(Set(id)),
                 ackedNow: world.ackedNow.union(Set(id)) },
    }
  }
  action hostDies = {
    nondet id = world.alive.oneOf()
    all {
      world.deaths < MAX_DEATHS,
      world' = { ...world, alive: world.alive.exclude(Set(id)),
                 ackedNow: world.ackedNow.exclude(Set(id)), deaths: world.deaths + 1 },
    }
  }
  // A work act of a host process (a C16 act: it needs a top): the store takes it only when
  // active, from the launch the top bound, holding the credential; its first one is the first
  // authenticated use, which retires the delivery. (Mutant storeRefuses off: the store takes work
  // from any live host, even inactive.)
  action hostWorks = {
    nondet id = world.alive.oneOf()
    val taken = if (Design.storeRefuses) isActive(world.store) and world.top >= 0
                                          and id == world.top and world.delivered.contains(id)
                else world.store != NoStore
    all {
      taken,
      world' = { ...world, worked: true, used: world.used or id == world.top,
                 workWhileInactive: world.workWhileInactive or not(isActive(world.store)),
                 workByOther: world.workByOther or id != world.top,
                 reboundWorked: world.reboundWorked or world.rebinds.contains(id) },
    }
  }
  // ---- 5. activation, then its note
  def acknowledged = if (Design.ackCurrent)
                       world.alive.contains(world.launch) and world.acks.contains(world.launch)
                     else world.acks != Set()
  action activate = all {
    activating, world.store == Inactive, filesDone, world.launch >= 0, acknowledged,
    world' = { ...world, store: Active(world.launch), binding: world.launch,
      activatedStale: world.activatedStale
        or not(world.alive.contains(world.launch) and world.ackedNow.contains(world.launch)),
      activatedUnmarked: world.activatedUnmarked
        or not(FILES.forall(f => world.files.get(f) == Marked)) },
  }
  action noteActive = all {
    activating, isActive(world.store),
    world' = { ...world, record: Activated },
  }
  // ---- roll back (the person's choice)
  action startRollback = all {
    activating, Design.rollbackGuard implies not(isActive(world.store)),
    world' = { ...world, record: RollingBack,
               rolledBackActive: world.rolledBackActive or isActive(world.store) },
  }
  action restoreFile = {
    nondet f = FILES.oneOf()
    all {
      world.record == RollingBack, world.files.get(f) == Marked,
      world' = { ...world, files: world.files.set(f, Approved),
                 noted: world.noted.exclude(Set(f)) },
    }
  }
  action stopHost = all {
    world.record == RollingBack, world.alive != Set(),
    world' = { ...world, alive: Set(), ackedNow: Set() },
  }
  action deleteStore = all {
    world.record == RollingBack, world.store != NoStore,
    Design.rollbackGuard implies not(isActive(world.store)),
    world' = { ...world, store: NoStore },
  }
  action finishRollback = all {
    world.record == RollingBack, world.store == NoStore, world.alive == Set(),
    FILES.forall(f => world.files.get(f) != Marked),
    world' = { ...world, record: RolledBack },
  }
  // ---- the person edits a file (bounded; any time)
  action personEdits = {
    nondet f = FILES.oneOf()
    all {
      world.edits < MAX_EDITS, world.files.get(f) != Other,
      world' = { ...world, files: world.files.set(f, Other), edits: world.edits + 1 },
    }
  }

  // ---- after activation, before the top (contract 6c v4)
  // The credential goes only to the committed binding (after the top: the launch it bound), until
  // its first authenticated use retires it; opening the top does NOT retire it. (Mutants:
  // deliverCommitted off, a pending launch may collect it too; retireAtUse off, the top retires it.)
  action deliver = {
    nondet id = world.alive.oneOf()
    val bound = if (world.top >= 0) world.top else world.binding
    all {
      isActive(world.store), not(world.delivered.contains(id)), world.acks.contains(id),
      not(world.used),
      if (Design.retireAtUse) true else world.top < 0,
      if (Design.deliverCommitted) id == bound else (id == bound or id == world.pending),
      world' = { ...world, delivered: world.delivered.union(Set(id)),
                 deliveredWrong: world.deliveredWrong or id != bound,
                 lateCollection: world.lateCollection or world.top >= 0 },
    }
  }
  // The person relaunches a host lost before the top: a new launch reserved (pending).
  action startRebind = all {
    world.record == Activated, world.top < 0, world.pending < 0, world.nextId <= MAX_ID,
    not(world.alive.contains(world.binding)),
    world' = { ...world, pending: world.nextId, launch: world.nextId, nextId: world.nextId + 1 },
  }
  action spawnPending = all {
    world.pending >= 0, not(world.spawned.contains(world.pending)),
    world' = { ...world, spawned: world.spawned.union(Set(world.pending)),
               alive: world.alive.union(Set(world.pending)),
               ackedNow: world.ackedNow.exclude(Set(world.pending)) },
  }
  // The commit: under the lock, the same pending launch, acknowledged by its current process and
  // alive, and no top (mutant rebindGuard off: a top is not checked).
  // The append (HostRebound): the binding moves; the record still names the pending launch until
  // the note (a crash may fall between them).
  action commitRebind = all {
    world.pending >= 0, world.pending != world.binding, world.alive.contains(world.pending),
    world.ackedNow.contains(world.pending),
    Design.rebindGuard implies world.top < 0,
    world' = { ...world, binding: world.pending, rebound: true,
               rebinds: world.rebinds.union(Set(world.pending)),
               rebindAfterTop: world.rebindAfterTop or world.top >= 0 },
  }
  // The record notes a committed rebind: any later command reconciles the pending record with the
  // committed event first, and completes the note (the committed launch is kept).
  action noteRebind = all {
    world.pending >= 0, world.pending == world.binding,
    world' = { ...world, pending: -1, notedLate: world.notedLate or world.top >= 0 },
  }
  // A rebind that lost (the top was opened first, or its process died): cancelled, its process
  // stopped; the launch record falls back to the committed binding.
  action cancelRebind = all {
    world.pending >= 0,
    // only an UNCOMMITTED pending launch (mutant reconcileFirst off: a pending record is cancelled
    // without checking the committed event, so a committed launch can be stopped)
    Design.reconcileFirst implies world.pending != world.binding,
    world.top >= 0 or (world.spawned.contains(world.pending) and not(world.alive.contains(world.pending))),
    world' = { ...world, alive: world.alive.exclude(Set(world.pending)),
               ackedNow: world.ackedNow.exclude(Set(world.pending)), pending: -1,
               launch: world.binding, cancelled: world.cancelled or world.top >= 0,
               stoppedCommitted: world.stoppedCommitted or world.pending == world.binding },
  }
  // The person opens the first top: it binds the committed launch, whatever is pending.
  action openTop = all {
    isActive(world.store), world.top < 0,
    world' = { ...world, top: world.binding },
  }

  action activatorStep = any {
    writeRecord, createStore, markFile, noteFile, recordLaunch, spawn, spawnUnrecorded,
    recordSpawned, activate, noteActive,
  }
  action rollbackStep = any { restoreFile, stopHost, deleteStore, finishRollback }
  action rebindStep = any { spawnPending, commitRebind, noteRebind, cancelRebind }
  action step = any {
    activatorStep, rollbackStep, startRollback, hostAcks, hostDies, hostWorks, personEdits,
    deliver, startRebind, rebindStep, openTop,
  }

  // ---- properties (each a ghost the steps never read, or a fact of the world)
  // No work is taken before activation, and only from the activated launch.
  val NoWorkBeforeActive = not(world.workWhileInactive)
  val OnlyActivatedHostWorks = not(world.workByOther)
  // Activation needs the recorded launch alive and acknowledged by its CURRENT process.
  val ActivationNeedsCurrentAck = not(world.activatedStale)
  // At activation every instruction file carries the marker.
  val ActiveMeansMarked = not(world.activatedUnmarked)
  // A person's edit is never overwritten.
  val NoLostEdit = not(world.overwroteEdit)
  // Every live host is the recorded launch: no orphan the resume or the roll back cannot find.
  val NoOrphanHost = world.alive.forall(id => id == world.launch or id == world.binding)
  // The credential reaches only the committed binding, never a pending launch.
  val NoCredentialToPending = not(world.deliveredWrong)
  // A rebind never commits once a top exists: the top's host is the one the workflow ends with.
  val NoRebindAfterTop = not(world.rebindAfterTop)
  // A recovery never stops the launch a committed rebind bound.
  val CommittedNeverCancelled = not(world.stoppedCommitted)
  // An active store is never rolled back; a finished roll back leaves nothing behind.
  val ActiveNeverRolledBack = not(world.rolledBackActive)
  val RolledBackClean = world.record == RolledBack implies
    (world.store == NoStore and world.alive == Set()
     and FILES.forall(f => world.files.get(f) != Marked))
  val ActivationSafe = NoWorkBeforeActive and OnlyActivatedHostWorks
    and ActivationNeedsCurrentAck and ActiveMeansMarked and NoLostEdit and NoOrphanHost
    and ActiveNeverRolledBack and RolledBackClean and NoCredentialToPending and NoRebindAfterTop
    and CommittedNeverCancelled

  // Witnesses (must be reached): activation, a finished roll back, an activation under a
  // replaced launch (the first died after acknowledging: the host dead before activation), work taken, a stop by an edit.
  val NoActive = world.record != Activated
  val NoRolledBack = world.record != RolledBack
  val NoReplacedActive = not(world.replaced and isActive(world.store) and world.worked)
  // Witnesses of v5: a rebound host does C16 work after the top bound it; the host collects its
  // credential after the person opened the top first.
  val NoReboundWork = not(world.reboundWorked)
  // A committed rebind noted only after the top opened (the crash window between append and note).
  val NoLateNote = not(world.notedLate)
  val NoLateCollection = not(world.lateCollection and world.used)
  val NoCancelledByTop = not(world.cancelled)
  val NoBlockedByEdit = not(activating and world.store == Inactive
    and FILES.exists(f => world.files.get(f) == Other) and world.launch >= 0)

  // ---- liveness: the activator's and the host's steps are fair; the person and the
  // faults are not. Then activation ends: active, rolled back, or stopped by the person's
  // edit (a file no longer the approved revision: back to the person).
  temporal Fair = all {
    weakFair(activatorStep, world), weakFair(rollbackStep, world), weakFair(hostAcks, world),
    weakFair(rebindStep, world), weakFair(deliver, world),
  }
  def settled = world.record == Activated or world.record == RolledBack
    or (world.record != RollingBack and world.edits > 0)
  temporal ActivationEnds = Fair implies eventually(settled)
  // Not vacuous: without the edit escape it breaks (an edit really stops activation).
  // A pending rebind ends: committed or cancelled.
  // The bound host, alive and acknowledged, is in the end served its credential (or it is lost:
  // after the top, a lost host is revived as today, outside this model).
  temporal BoundHostServed = Fair implies always(
    (isActive(world.store) and world.top >= 0 and world.alive.contains(world.top)
      and world.acks.contains(world.top))
    implies eventually(world.delivered.contains(world.top) or not(world.alive.contains(world.top))))
  temporal RebindEnds = Fair implies always(world.pending >= 0 implies eventually(world.pending < 0))
  temporal ActivatesOrRollsBack = Fair implies
    eventually(world.record == Activated or world.record == RolledBack)
}

module activationCfgs {
  pure val DESIGN = { checkFiles: true, ackCurrent: true, freshIds: true, recordFirst: true,
                      rollbackGuard: true, storeRefuses: true, rebindGuard: true,
                      deliverCommitted: true, retireAtUse: true, reconcileFirst: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and one choice off each.
module activationFixed {
  import activationCfgs.*
  import activation(Design = DESIGN).* from "./activation"
}
module activationTrustRecord {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, checkFiles: false }).* from "./activation"
}
module activationStaleAck {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, ackCurrent: false }).* from "./activation"
}
module activationReuseId {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, freshIds: false }).* from "./activation"
}
module activationSpawnFirst {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, recordFirst: false }).* from "./activation"
}
module activationNoGuard {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, rollbackGuard: false }).* from "./activation"
}
module activationRebindAfterTop {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, rebindGuard: false }).* from "./activation"
}
module activationDeliverPending {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, deliverCommitted: false }).* from "./activation"
}
module activationRetireAtOpen {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, retireAtUse: false }).* from "./activation"
}
module activationNoReconcile {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, reconcileFirst: false }).* from "./activation"
}
module activationOpenStore {
  import activationCfgs.*
  import activation(Design = { ...DESIGN, storeRefuses: false }).* from "./activation"
}
