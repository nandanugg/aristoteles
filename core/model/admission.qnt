// Remaining Pass 9 model: two fix admissions and the separate recheck lane.
module admission {
  const PIPE_CAP: int
  const SEPARATE_LANE: bool   // mutant SharedLane: a recheck takes a fix's Pipe permit
  const CHECK_PIPE: bool
  const RELEASE_ON_YIELD: bool

  type Job = Owed | Held | AwaitPerson | Closed
  type Runtime = {
    jobs: int -> Job, pipe: Set[int], lane: Set[int],
    deniedPipe: bool, reusedPipe: bool, recheckBehindFix: bool, recheckBesideFix: bool,
  }
  var runtime: Runtime
  pure val jobIds = Set(0, 1, 2)
  pure val RECHECK = 2
  def pipeFull: bool = runtime.pipe.size() >= PIPE_CAP
  // Jobs 0 and 1 are fixes. Job 2 is a fresh recheck: its own lane (mutant SharedLane: the Pipe cap).
  def isFix(j: int): bool = j != RECHECK or not(SEPARATE_LANE)
  action init = runtime' = {
    jobs: jobIds.mapBy(_ => Owed), pipe: Set(), lane: Set(),
    deniedPipe: false, reusedPipe: false, recheckBehindFix: false, recheckBesideFix: false,
  }

  // First accepted fix step or durable recheck admission. A queued job and a
  // person's Decide ask are outside the Pipe's active attempt set.
  action startPipe = {
    nondet j = jobIds.filter(j => isFix(j) and runtime.jobs.get(j) == Owed).oneOf()
    all {
      not(CHECK_PIPE) or not(pipeFull),
      runtime' = { ...runtime, jobs: runtime.jobs.set(j, Held), pipe: runtime.pipe.union(Set(j)),
        reusedPipe: runtime.reusedPipe or runtime.deniedPipe },
    }
  }
  // A recheck in its own lane (one at a time), whatever the fixes hold.
  action startRecheck = all {
    SEPARATE_LANE, jobIds.contains(RECHECK), runtime.jobs.get(RECHECK) == Owed, runtime.lane == Set(),
    runtime' = { ...runtime, jobs: runtime.jobs.set(RECHECK, Held), lane: Set(RECHECK),
      recheckBesideFix: runtime.recheckBesideFix or pipeFull },
  }
  action finishRecheck = all {
    runtime.lane.contains(RECHECK),
    runtime' = { ...runtime, jobs: runtime.jobs.set(RECHECK, Closed), lane: Set() },
  }
  // An owed job waits on the full Pipe cap; a recheck waiting so is behind a fix (mutant SharedLane).
  action waitPipe = all {
    pipeFull, not(runtime.deniedPipe),
    jobIds.exists(j => isFix(j) and runtime.jobs.get(j) == Owed),
    runtime' = { ...runtime, deniedPipe: true,
      recheckBehindFix: runtime.recheckBehindFix or
        (jobIds.contains(RECHECK) and not(SEPARATE_LANE) and runtime.jobs.get(RECHECK) == Owed) },
  }
  action yieldPipe = {
    nondet j = runtime.pipe.oneOf()
    runtime' = if (RELEASE_ON_YIELD) { ...runtime, pipe: runtime.pipe.exclude(Set(j)) } else runtime
  }
  // Routing a fix to the person releases it. A completed recheck or a fix
  // resolved without a Decide ask closes. A send-back is new admission.
  action handToPerson = {
    nondet j = runtime.pipe.filter(j => j != RECHECK).oneOf()
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

  action step = any {
    startPipe, startRecheck, finishRecheck, waitPipe, yieldPipe, handToPerson, finishPipe, decide,
    runtime' = runtime,
  }

  val PipeBound = runtime.pipe.size() <= PIPE_CAP
  val PipeMatchesJobs = runtime.pipe ==
    jobIds.filter(j => runtime.jobs.get(j) == Held and not(runtime.lane.contains(j)))
  // (a) a recheck never waits behind a fix's Pipe permit.
  val RecheckIndependent = not(runtime.recheckBehindFix)
  // Expected counterexamples in the corresponding instance are reachability witnesses.
  val NoPipeOverlap = runtime.pipe.filter(j => j != 2).size() < 2
  // Witness of (a): the recheck runs while the fixes fill the Pipe cap.
  val NoRecheckBesideFix = not(runtime.recheckBesideFix)
}

// ---- instances ----
module admissionPipeOne {
  import admission(PIPE_CAP = 1, SEPARATE_LANE = true, CHECK_PIPE = true, RELEASE_ON_YIELD = false).* from "./admission"
}
module admissionPipeTwo {
  import admission(PIPE_CAP = 2, SEPARATE_LANE = true, CHECK_PIPE = true, RELEASE_ON_YIELD = false).* from "./admission"
}
module admissionNoPipeCap {
  import admission(PIPE_CAP = 1, SEPARATE_LANE = true, CHECK_PIPE = false, RELEASE_ON_YIELD = false).* from "./admission"
}
module admissionDropsPipe {
  import admission(PIPE_CAP = 1, SEPARATE_LANE = true, CHECK_PIPE = true, RELEASE_ON_YIELD = true).* from "./admission"
}
module admissionSharedLane {
  import admission(PIPE_CAP = 1, SEPARATE_LANE = false, CHECK_PIPE = true, RELEASE_ON_YIELD = false).* from "./admission"
}
