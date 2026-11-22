// U2 uses the live core's asks and acts for a task and a person edit to its
// direction. The scheduler owns permits and sessions; it does not consume a
// told step just by preparing it. U1 supplies delivery per logical identity.
module permits {
  import configsBase.* from "./configsBase"
  import types.* from "./types"
  import contract.* from "./contract"
  import protocol(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0, 1), sections: 1, maxTries: 1 })
    .* from "./protocol"

  type RecheckPhase = NoHelper | Checkpointed | ParkRequested | Parked | Deferred |
                      RecheckChild | FreshSession | ResumeParent | ReportReady
  type Context = NoContext | ParentContext | ChildContext | FreshContext
  type Case = ParkCase | DeferCase | ChildCase | SerialCase | AdmissionCase |
              DropParent | RecheckRetained | RecheckIgnored
  type Scheduler = { scenario: Case, phase: RecheckPhase, editOffered: bool, serialReview: bool,
                     source: Context, target: int, badVerdict: bool,
                     parked: bool, resumed: bool, deferred: bool, childRan: bool,
                     freshRan: bool }
  var store: Store
  var scheduling: Scheduler
  val state = (store, scheduling)

  pure def initial(scenario: Case): Scheduler =
    { scenario: scenario, phase: NoHelper, source: NoContext, target: -1,
      badVerdict: false,
      editOffered: false, serialReview: false, parked: false, resumed: false,
      deferred: false, childRan: false, freshRan: false }
  val initialStore = initStore(Map(0 -> NoCause, 1 -> NoCause))
  // Separate init actions keep Quint's TLC init conversion from treating
  // a shared assignment as both an initial predicate and a transition.
  action initPark = all { store' = initialStore, scheduling' = initial(ParkCase) }
  action initDefer = all { store' = initialStore, scheduling' = initial(DeferCase) }
  action initChild = all { store' = initialStore, scheduling' = initial(ChildCase) }
  action initSerial = all { store' = initialStore, scheduling' = initial(SerialCase) }
  action initAdmission = all { store' = initialStore, scheduling' = initial(AdmissionCase) }
  action initDropParent = all { store' = initialStore, scheduling' = initial(DropParent) }
  action initRetained = all { store' = initialStore, scheduling' = initial(RecheckRetained) }
  action initIgnore = all { store' = initialStore, scheduling' = initial(RecheckIgnored) }

  def background = Set(ChildCase, AdmissionCase, DropParent).contains(scheduling.scenario)
  def childAllowance = if (background) 1 else 0
  def canPark = scheduling.scenario != DeferCase
  def dropPermit = scheduling.scenario == DropParent
  def ignoreRecheck = scheduling.scenario == RecheckIgnored

  def roleAttempts = SLOTS.filter(slot =>
    Set(Working, InReview).contains(taskOf(store, slot).state))
  // A maker is a logical actor. With no child allowance, the shared Role
  // worker serves it in the foreground without allocating a child permit.
  def workingMakers = SLOTS.filter(slot =>
    taskOf(store, slot).state == Working and liveMaker(store, slot) != NoOne)
    .map(slot => liveMaker(store, slot))
  def roleChildAllowance = if (scheduling.scenario == SerialCase) 0
    else if (Set(AdmissionCase, DropParent).contains(scheduling.scenario)) 2 else 1
  def onRoleWorker(maker: Actor): bool = isMakerActor(maker) and roleChildAllowance == 0
  def usesRoleChildPermit(maker: Actor): bool =
    isMakerActor(maker) and not(onRoleWorker(maker))
  def roleChildren = SLOTS.filter(slot => usesRoleChildPermit(liveMaker(store, slot))).size()
  def usesChildPermit = scheduling.scenario != RecheckRetained
  def pipeChildren = if (scheduling.phase == RecheckChild and usesChildPermit) 1 else 0
  def recheckPending = SLOTS.exists(slot => recheckDue(store, slot))
  def nextRecheck = if (recheckDue(store, 0)) 0 else 1
  def workerOnline = not(Set(Parked, FreshSession, ResumeParent).contains(scheduling.phase))
  def foregroundOccupied = workingMakers.exists(maker => onRoleWorker(maker) or not(background))
  def workerFree = workerOnline and not(foregroundOccupied)
  def providerSlots = if (workerOnline or scheduling.phase == FreshSession) 1 else 0
  def pipeAttempt = ownToldSteps(store, Pipe).size() > 0 or scheduling.phase != NoHelper
  def rolePermits = roleAttempts.filter(slot =>
    not(dropPermit and workingMakers.contains(liveMaker(store, slot)))).size()
  // Permits are derived from the task state, never independently released.
  // Admission below is what prevents a second task entering that state.
  def pipePermits = if (pipeAttempt) 1 else 0

  // Scheduler-only events preserve the full protocol state, including its
  // asks and recheck basis. Atomic core acts then return to multi-identity wait.
  action keepCore = store' = store
  action phase(destination: RecheckPhase): bool = all {
    keepCore,
    scheduling' = { ...scheduling, phase: destination,
      target: if (scheduling.phase == NoHelper) nextRecheck else scheduling.target,
      source: if (destination == FreshSession) FreshContext
              else if (destination == RecheckChild)
                (if (usesChildPermit) ChildContext else ParentContext)
              else scheduling.source,
      parked: scheduling.parked or destination == Parked,
      deferred: scheduling.deferred or destination == Deferred,
      childRan: scheduling.childRan or destination == RecheckChild,
      freshRan: scheduling.freshRan or destination == FreshSession },
  }

  def canStartAttempt = rolePermits < 1
  def freeChild = roleChildren < roleChildAllowance
  def canStartRole = canStartAttempt and (freeChild or roleChildAllowance == 0)
  def secondStartDenied = roleAttempts.size() == 1 and workingMakers != Set()
    and SLOTS.exists(slot => taskOf(store, slot).state == Sent) and freeChild and not(canStartRole)
  def roleAdmitted(body: Body): bool = match body {
    | Open(ask) => ask.to != NewMaker or canStartRole
    | _ => true
  }
  def recheckAdmitted(body: Body): bool = match body {
    | RecheckDone(recheck) => scheduling.phase == ReportReady and recheck.task == scheduling.target
    | _ => true
  }
  def eligible(actor: Actor): bool =
    if (actor == Harness) true
    else if (isMakerActor(actor)) workerOnline and workingMakers.contains(actor)
    else workerFree
  def admitted(actor: Actor, body: Body): bool =
    (actor != Role or roleAdmitted(body)) and (actor != Pipe or recheckAdmitted(body))

  // One person edit after both tasks finish is enough to exercise a real recheck.
  // Use the protocol's told content except for filling the intended edit.
  def contents(body: Body): Body = match body {
    | Ship(draft) => Ship({ ...draft, items: Set(ItemDirection), real: Set(ItemDirection) })
    | _ => body
  }
  action perform(actor: Actor, body: Body): bool =
    val proposal = actAs(store, actor, contents(body))
    all {
      accept(store, proposal),
      store' = take(match body {
        | Open(ask) => if (ask.to == NewMaker) { ...store, nextMaker: ask.about } else store
        | _ => store
      }, proposal),
      scheduling' = match body {
        | RecheckDone(_) => { ...scheduling, phase: NoHelper, source: NoContext, target: -1,
            badVerdict: scheduling.badVerdict
              or not(Set(ChildContext, FreshContext).contains(scheduling.source)) }
        | Review(judgement) => { ...scheduling, serialReview: scheduling.serialReview
            or (judgement.verdict == Pass and onRoleWorker(judgement.ask.from)
                and not(usesRoleChildPermit(judgement.ask.from))) }
        | AskEdit(_) => { ...scheduling, editOffered: true }
        | _ => scheduling
      },
    }
  action agentsTurn = {
    nondet actor = Set(Host, Role, Pipe, Harness).union(workingMakers).filter(eligible).oneOf()
    nondet body = toldSteps(store, actor).filter(candidate => admitted(actor, candidate)).oneOf()
    perform(actor, body)
  }
  // The human is never a fairness assumption. The edit is offered only once,
  // after the task is Done, and no competing edit changes the helper's basis.
  action humanTurn = {
    val edit = AskEdit({ items: Set(ItemDirection), base: store.versions, trueBase: store.versions })
    val mayEdit = SLOTS.forall(slot => taskOf(store, slot).state == Done)
      and not(store.top.ended) and not(scheduling.editOffered)
    nondet body = toldSteps(store, Human).union(if (mayEdit) Set(edit) else Set()).oneOf()
    perform(Human, body)
  }

  def canChild = background and childAllowance > 0
  action routeRecheck = all {
    workerFree, recheckPending, scheduling.phase == NoHelper, not(ignoreRecheck),
    phase(if (scheduling.scenario == RecheckRetained) RecheckChild else if (canChild) RecheckChild
          else Checkpointed),
  }
  action requestPark = all { scheduling.phase == Checkpointed,
    phase(if (canPark) ParkRequested else Deferred) }
  action confirmPark = all { scheduling.phase == ParkRequested, phase(Parked) }
  // A release can be refused by the provider. The session remains online
  // until an independently confirmed release wakes the deferred request.
  action failPark = all { scheduling.phase == ParkRequested, phase(Deferred) }
  action capacityOffered = all {
    scheduling.phase == Deferred,
    phase(Parked),
  }
  action startFresh = all {
    scheduling.phase == Parked, providerSlots == 0, phase(FreshSession),
  }
  // Helpers report without acting as Pipe. A fresh session releases its slot
  // before the parent resumes and records the actual core verdict.
  action helperReports = all {
    Set(RecheckChild, FreshSession).contains(scheduling.phase),
    phase(if (scheduling.phase == FreshSession) ResumeParent else ReportReady),
  }
  action resumeParent = all {
    scheduling.phase == ResumeParent, providerSlots == 0, keepCore,
    scheduling' = { ...scheduling, phase: ReportReady, resumed: true },
  }
  action composedStep = any {
    agentsTurn, humanTurn,
    routeRecheck, requestPark, confirmPark, failPark, capacityOffered,
    startFresh, helperReports, resumeParent,
  }

  val NoWaitCycle = not(waitClosure(store).exists(edge => edge._1 == edge._2))
  val AsksFollowState = asksMatchState(store)
  // Providers and role allowances are separate. A child uses no provider slot.
  val PermitsNeverExceeded = roleAttempts.size() <= 1
    and rolePermits <= 1 and pipePermits <= 1
    and roleChildren <= roleChildAllowance and pipeChildren <= childAllowance and providerSlots <= 1
  // Check the recorded verdict's source, derived from the allocation at
  // helper time. A fake helper in the resident parent's context breaks it.
  val NoRecheckInParentContext = not(scheduling.badVerdict)
  val NoSecondDenied = not(secondStartDenied)
  val ParkReached = scheduling.parked
  val DeferReached = scheduling.deferred
  val ChildDeniedSerial = scheduling.serialReview
  val ParkResumed = scheduling.resumed and scheduling.freshRan
  val ChildRecheckRan = scheduling.childRan and not(recheckPending)
  val NoPark = not(ParkReached)
  val NoDefer = not(DeferReached)
  val NoSerial = not(ChildDeniedSerial)
  val NoParkResume = not(ParkResumed)
  val NoChild = not(ChildRecheckRan)
  val NoIgnoredRecheck = not(ignoreRecheck and recheckPending)

  temporal SchedulerFair = all {
    weakFair(routeRecheck, state), weakFair(requestPark, state),
    weakFair(confirmPark, state), weakFair(startFresh, state),
    weakFair(helperReports, state), weakFair(resumeParent, state), weakFair(agentsTurn, state),
  }
  temporal CapacityFair = CapacityReturns(scheduling.phase == Deferred,
                                           mustChange(capacityOffered, state))
  temporal ParkedResumes = SchedulerFair implies
    always(scheduling.phase == ResumeParent implies eventually(scheduling.phase == ReportReady))
  temporal DeferredRuns = (SchedulerFair and CapacityFair) implies
    always(scheduling.phase == Deferred implies eventually(not(recheckPending)))
  temporal RechecksProgress = (SchedulerFair and CapacityFair) implies
    always(recheckPending implies eventually(not(recheckPending)))
  // G2 on the resource-admitted run. Fair selection is supplied by U1; the
  // separate engine assumptions here are the core's as before.
  temporal AdmittedProgress = (SchedulerFair and CapacityFair) implies always(eventually(finalOf(store)))
  temporal AdmittedSettles = (SchedulerFair and CapacityFair) implies eventually(always(finalOf(store)))
}
