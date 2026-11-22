// Decision 3 draft. Projection of accepted C16 boundaries and worker allocation,
// beside (and independent of) the existing permits and worker compositions.
module admission {
  const CASE: str
  const PIPE_CAP: int
  const SERIAL_ON_FULL: bool
  const CHECK_PIPE: bool
  const RELEASE_ON_YIELD: bool
  const WRONG_OWNER: bool

  type Task = Queued | Child | Serial | MakerDown | Checking | Finished
  type Job = Owed | Held | AwaitPerson | Closed
  type Runtime = {
    tasks: int -> Task, owners: int -> int, jobs: int -> Job,
    pipe: Set[int], children: Set[int], role: Set[int],
    deniedPipe: bool, reusedPipe: bool, releasedChild: bool, releasedRole: bool,
    backgroundSerial: bool, serialChecks: Set[int], serialReviewed: bool, collocated: bool,
  }
  var runtime: Runtime

  // Shared worker in both role instances. Logical role 0 has one background
  // child slot. In saturation both attempts belong to role 0 (cap 2).
  pure val taskIds = if (CASE == "pipe") Set() else Set(0, 1)
  pure val jobIds = if (CASE == "pipe") Set(0, 1, 2) else Set()
  pure def owner(task: int): int = if (CASE == "collocated") task else 0
  pure def roleCap(role: int): int = if (CASE == "saturation" and role == 0) 2 else 1
  pure def usesRole(p: Task): bool = Set(Child, Serial, MakerDown, Checking).contains(p)
  pure def usesPipe(p: Job): bool = p == Held
  def roleLoad(role: int): int = runtime.role.filter(t => runtime.owners.get(t) == role).size()
  def childLoad(role: int): int = runtime.children.filter(t => owner(t) == role).size()
  def workerFree: bool = not(taskIds.exists(t => runtime.tasks.get(t) == Serial))
  def pipeFull: bool = runtime.pipe.size() >= PIPE_CAP
  // Jobs 0 and 1 are fixes. Job 2 is a fresh recheck competing for the Pipe cap.
  action init = runtime' = {
    tasks: taskIds.mapBy(_ => Queued), owners: taskIds.mapBy(owner),
    jobs: jobIds.mapBy(_ => Owed), pipe: Set(), children: Set(), role: Set(),
    deniedPipe: false, reusedPipe: false, releasedChild: false, releasedRole: false,
    backgroundSerial: false, serialChecks: Set(), serialReviewed: false, collocated: false,
  }

  // First accepted fix step or durable recheck admission. A queued job and a
  // person's Decide ask are outside the Pipe's active attempt set.
  action startPipe = {
    nondet j = jobIds.filter(j => runtime.jobs.get(j) == Owed).oneOf()
    all {
      not(CHECK_PIPE) or not(pipeFull),
      runtime' = { ...runtime, jobs: runtime.jobs.set(j, Held), pipe: runtime.pipe.union(Set(j)),
        reusedPipe: runtime.reusedPipe or runtime.deniedPipe },
    }
  }
  action waitPipe = all {
    pipeFull, not(runtime.deniedPipe),
    jobIds.exists(j => runtime.jobs.get(j) == Owed),
    runtime' = { ...runtime, deniedPipe: true },
  }
  action yieldPipe = {
    nondet j = runtime.pipe.oneOf()
    runtime' = if (RELEASE_ON_YIELD) { ...runtime, pipe: runtime.pipe.exclude(Set(j)) } else runtime
  }
  // Routing a fix to the person releases it. A completed recheck or a fix
  // resolved without a Decide ask closes. A send-back is new admission.
  action handToPerson = {
    nondet j = runtime.pipe.filter(j => j != 2).oneOf()
    all {
      runtime' = { ...runtime, jobs: runtime.jobs.set(j, AwaitPerson), pipe: runtime.pipe.exclude(Set(j)) },
    }
  }
  action finishPipe = {
    nondet j = runtime.pipe.oneOf()
    all {
      runtime' = { ...runtime, jobs: runtime.jobs.set(j, Closed), pipe: runtime.pipe.exclude(Set(j)) },
    }
  }
  action decide = {
    nondet j = jobIds.filter(j => runtime.jobs.get(j) == AwaitPerson).oneOf()
    nondet outcome = Set(Owed, Closed).oneOf()
    all {
      runtime' = { ...runtime, jobs: runtime.jobs.set(j, outcome) },
    }
  }

  // OpenMake takes an attempt permit for a queued task. A replacement after
  // a fenced maker exit keeps its old attempt and takes only its maker route.
  action openMake = {
    nondet t = taskIds.filter(t =>
      Set(Queued, MakerDown).contains(runtime.tasks.get(t))).oneOf()
    val r = owner(t)
    val held = runtime.tasks.get(t) == MakerDown
    val child = childLoad(r) < 1
    val bound = if (WRONG_OWNER) 0 else r
    val attempts = runtime.role.union(Set(t))
    all {
      workerFree, held or roleLoad(r) < roleCap(r), child or SERIAL_ON_FULL,
      runtime' = { ...runtime, tasks: runtime.tasks.set(t, if (child) Child else Serial),
        role: attempts, owners: runtime.owners.set(t, bound),
        children: if (child) runtime.children.union(Set(t)) else runtime.children,
        backgroundSerial: runtime.backgroundSerial or not(child),
        collocated: runtime.collocated or (CASE == "collocated" and attempts.size() == 2) },
    }
  }
  // Maker Report or confirmed exit releases the child. Checking and a maker
  // restart still belong to the same parent attempt.
  action endMaker = {
    nondet t = taskIds.filter(t => Set(Child, Serial).contains(runtime.tasks.get(t))).oneOf()
    nondet outcome = Set(Checking, MakerDown).oneOf()
    all {
      runtime' = { ...runtime, tasks: runtime.tasks.set(t, outcome),
        children: runtime.children.exclude(Set(t)),
        releasedChild: runtime.releasedChild or runtime.children.contains(t),
        serialChecks: if (runtime.tasks.get(t) == Serial and outcome == Checking)
          runtime.serialChecks.union(Set(t)) else runtime.serialChecks },
    }
  }
  // Review settling or raising the task, or reassignment fencing its maker.
  // A rejected result that continues the same attempt is outside this projection.
  action releaseAttempt = {
    nondet t = runtime.role.oneOf()
    nondet terminal = Set(Finished, Queued).oneOf()
    all {
      workerFree,
      terminal == Queued or runtime.tasks.get(t) == Checking,
      runtime' = { ...runtime, tasks: runtime.tasks.set(t, terminal),
        role: runtime.role.exclude(Set(t)), children: runtime.children.exclude(Set(t)),
        releasedRole: true,
        serialChecks: runtime.serialChecks.exclude(Set(t)),
        serialReviewed: runtime.serialReviewed or (runtime.serialChecks.contains(t) and terminal == Finished) },
    }
  }

  action step = any {
    startPipe, waitPipe, yieldPipe, handToPerson, finishPipe, decide,
    openMake, endMaker, releaseAttempt,
    runtime' = runtime,
  }

  val PipeBound = runtime.pipe.size() <= PIPE_CAP
  val PipeMatchesJobs = runtime.pipe == jobIds.filter(j => usesPipe(runtime.jobs.get(j)))
  val Ownership = taskIds.forall(t => runtime.owners.get(t) == owner(t))
  val RoleBound = Set(0, 1).forall(r => roleLoad(r) <= roleCap(r) and childLoad(r) <= 1)
  val TaskMatchesPermits =
    runtime.role == taskIds.filter(t => usesRole(runtime.tasks.get(t))) and
    runtime.children == taskIds.filter(t => runtime.tasks.get(t) == Child)
  val OneSerialTurn = taskIds.filter(t => runtime.tasks.get(t) == Serial).size() <= 1

  // Expected counterexamples in the corresponding instance are reachability witnesses.
  val NoPipeOverlap = runtime.pipe.filter(j => j != 2).size() < 2
  val NoPipeReuse = not(runtime.reusedPipe and runtime.pipe.contains(2))
  val NoSaturatedSerial = not(runtime.backgroundSerial and runtime.serialReviewed and
    runtime.releasedRole and runtime.releasedChild)
  val NoCollocatedOwners = not(runtime.collocated and runtime.role.size() == 2 and
    roleLoad(0) == 1 and roleLoad(1) == 1)
  val NoSaturatedWait = not(workerFree and childLoad(0) == 1 and roleLoad(0) == 1 and
    taskIds.exists(t => runtime.tasks.get(t) == Queued))
}

// ---- instances ----
module admissionPipeOne {
  import admission(CASE = "pipe", PIPE_CAP = 1, SERIAL_ON_FULL = true, CHECK_PIPE = true,
    RELEASE_ON_YIELD = false, WRONG_OWNER = false).* from "./admission"
}
module admissionPipeTwo {
  import admission(CASE = "pipe", PIPE_CAP = 2, SERIAL_ON_FULL = true, CHECK_PIPE = true,
    RELEASE_ON_YIELD = false, WRONG_OWNER = false).* from "./admission"
}
module admissionSaturation {
  import admission(CASE = "saturation", PIPE_CAP = 1, SERIAL_ON_FULL = true, CHECK_PIPE = true,
    RELEASE_ON_YIELD = false, WRONG_OWNER = false).* from "./admission"
}
module admissionWait {
  import admission(CASE = "saturation", PIPE_CAP = 1, SERIAL_ON_FULL = false, CHECK_PIPE = true,
    RELEASE_ON_YIELD = false, WRONG_OWNER = false).* from "./admission"
}
module admissionCollocated {
  import admission(CASE = "collocated", PIPE_CAP = 1, SERIAL_ON_FULL = true, CHECK_PIPE = true,
    RELEASE_ON_YIELD = false, WRONG_OWNER = false).* from "./admission"
}
module admissionNoPipeCap {
  import admission(CASE = "pipe", PIPE_CAP = 1, SERIAL_ON_FULL = true, CHECK_PIPE = false,
    RELEASE_ON_YIELD = false, WRONG_OWNER = false).* from "./admission"
}
module admissionDropsPipe {
  import admission(CASE = "pipe", PIPE_CAP = 1, SERIAL_ON_FULL = true, CHECK_PIPE = true,
    RELEASE_ON_YIELD = true, WRONG_OWNER = false).* from "./admission"
}
module admissionWrongOwner {
  import admission(CASE = "collocated", PIPE_CAP = 1, SERIAL_ON_FULL = true, CHECK_PIPE = true,
    RELEASE_ON_YIELD = false, WRONG_OWNER = true).* from "./admission"
}
