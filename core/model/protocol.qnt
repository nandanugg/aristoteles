// The protocol: the store and what it tells. No variables. For each act, together: when the
// store takes it (allowed: token, legal, basis), what it changes (effect), and what the
// work wait tells an actor to do it (told). Then the store's check and step (accept, take),
// what is told (toldSteps), and what is owed (obligations). check.qnt puts the actors and the
// environment around it. types.qnt has the words; README.md has the options and properties.
module protocol {
  import types.* from "./types"
  const OPTIONS: Options

  // The tasks of the top, the fixes (a task's raise and the person's edit), the ask cap.
  pure val SLOTS = OPTIONS.slots
  pure val FIXIDS = Set(EDIT).union(SLOTS)
  pure val ASK_CAP = 2   // questions per pair; the next is a repeat and raises (AskRaise)

  pure val ZERO: Item -> int = ITEMS.mapBy(record => 0)
  pure val CLOSED: Fix = { stage: Closed, entry: Closed, level: Standard, kind: DirectionDraft,
    form: NoForm, testOk: true, refOk: true, ruleTries: 0, items: Set(), real: Set(),
    roleOnly: false, roleLabel: false, base: ZERO, cardBase: 0, revision: 0, sentBack: Set(),
    needRevise: false, loopRounds: 0, basisStep: 0, wrote: Set(), climbedTo: AtRule, sendBacks: 0,
    trueBase: ZERO, fights: false, contradicted: false }
  pure val NOGHOST: Ghost = { endedActed: false, otherResult: false, otherVersion: false,
    staleReport: false, unseenReject: false, unseenAccept: false, rejectedInEffect: false,
    lostUpdate: false, failedTest: false, noForm: false, badRef: false, deepNoPerson: false,
    roleMisjudged: false, passBroken: false, passDefect: false, shallowEval: false,
    staleFix: false, oldEpoch: false, noContext: false, unchangedResubmit: false,
    takenUndone: false, wroteDropped: false, unrechecked: false, unacceptedChange: false,
    acceptNotWaiting: false, claimByEnded: false, endBroken: false, refix: false,
    fightShipped: false, raisedUp: false, escalatedNoPerson: false, topNoPerson: false,
    askRaised: false, rebaseFired: false, recheckFired: false, reassignEnded: false,
    restartedSlots: Set(), keptChecks: Set(), restartedAssigned: false,
    keptCheckJudged: false, keptFailSlots: Set(), keptFailAssigned: false }
  def freshTask(generation: int, cause: Cause): Task = { generation: generation,
    state: Unsent, tries: 0, maker: NoOne, resultId: NONE, checked: ZERO, pending: Set(),
    badResult: false,
    broken: false, taken: false, cause: cause, sections: OPTIONS.sections, floor: Split }
  // The person opened the top task before the model starts; the host holds it in session 0.
  def initStore(causes: int -> Cause): Store = {
    top: { hostSession: 0, done: false, ended: false }, session: 0,
    tasks: SLOTS.mapBy(slot => freshTask(0, causes.get(slot))), makers: Map(),
    fixes: FIXIDS.mapBy(fixId => CLOSED), versions: ZERO, ruleForm: Set(0, 1).mapBy(number => Ref),
    card: 0, changes: 0, agentChanges: 0, fixDepth: ITEMS.mapBy(record => NONE), down: Set(),
    epochs: PERSISTENT.mapBy(actor => 0), nextMaker: 0, ghost: NOGHOST, asks: Set(),
    answered: Set(), justAnswered: Set(), askCount: Map(),
  }

  // ==== shared reads
  // ---- the records
  def taskOf(store: Store, slot: int): Task = store.tasks.get(slot)
  def fixOf(store: Store, fixId: int): Fix = store.fixes.get(fixId)
  def isMaker(store: Store, actor: Actor): bool = store.makers.keys().contains(actor)
  def makerOf(store: Store, actor: Actor): MakerState = store.makers.get(actor)
  def isLive(store: Store, actor: Actor): bool =
    isMaker(store, actor) and not(makerOf(store, actor).ended)
  def epochOf(store: Store, actor: Actor): int =
    if (store.epochs.keys().contains(actor)) store.epochs.get(actor) else 0
  // The maker a task holds and that has not ended (NoOne: none).
  def liveMaker(store: Store, slot: int): Actor =
    val maker = taskOf(store, slot).maker
    if (isLive(store, maker)) maker else NoOne
  // The host's wait finds the top only through an assignment bound to the run's session.
  def hostFinds(store: Store): bool = store.top.hostSession == store.session
  def allDone(store: Store): bool =
    SLOTS.forall(slot => taskOf(store, slot).state == Done and taskOf(store, slot).pending == Set())

  // ---- the item versions
  // The sum of all versions: it grows with every change (an act's view of the versions).
  def versionSum(store: Store): int =
    ITEMS.fold(0, (sum, record) => sum + store.versions.get(record))
  def itemsFor(slot: int): Set[Item] = ITEMS.filter(record => applies(record, slot))
  // The items of the task changed since its result was checked; of the maker's brief.
  def staleItems(store: Store, slot: int): Set[Item] =
    itemsFor(slot).filter(record =>
      taskOf(store, slot).checked.get(record) < store.versions.get(record))
  def briefStale(store: Store, maker: Actor): bool =
    itemsFor(makerOf(store, maker).slot).exists(record =>
      makerOf(store, maker).brief.get(record) < store.versions.get(record))
  def hasMech(form: Form): bool = form == Mech or form == Both
  def hasRef(form: Form): bool = form == Ref or form == Both
  // A rule rechecked by the harness alone: a test command and no reader (Mech). A rule with
  // both forms needs the role's judgement: the pipeline role rechecks it.
  def testRule(store: Store, record: Item): bool =
    isRule(record) and store.ruleForm.get(ruleNumber(record)) == Mech
  // A rule with only a test command applies to the task: its test catches a bad result.
  def mechCatches(store: Store, slot: int): bool =
    itemsFor(slot).exists(record => testRule(store, record))
  // The items of a done task the pipeline role must recheck, and what its recheck must name.
  def recheckDue(store: Store, slot: int): bool =
    taskOf(store, slot).state == Done
      and taskOf(store, slot).pending.exists(record => not(testRule(store, record)))
  def recheckItems(store: Store, slot: int): Set[Item] =
    taskOf(store, slot).pending.filter(record => not(testRule(store, record)))
  def runRuleDue(store: Store, slot: int): bool =
    taskOf(store, slot).state == Done
      and taskOf(store, slot).pending.exists(record => testRule(store, record))

  // ---- the ladder: split < standard < direction < principle; a role's fit is off it
  def depth(level: Level): int =
    if (level == Principle) 3 else if (level == Direct) 2 else if (level == Standard) 1 else 0
  // A fix at a level removes a cause at that level or below.
  def resolves(level: Level, cause: Cause): bool = match cause {
    | NoCause => true
    | CauseAt(real) =>
        if (real == Fit or level == Fit) level == real else depth(level) >= depth(real)
  }
  def entryOf(level: Level): Stage =
    if (level == Principle) AtPrinciple else if (level == Direct) AtDirection else AtStandard
  def nextStage(stage: Stage): Stage =
    if (stage == AtPrinciple) AtDirection else if (stage == AtDirection) AtStandard else AtRule
  def pipeStage(stage: Stage): bool =
    Set(Evaluating, AtPrinciple, AtDirection, AtStandard, AtRule, Testing, Drafting, InLoop)
      .contains(stage)
  // A repeated failure at one step moves a draft one level up (then the person).
  def upStage(stage: Stage): Stage =
    if (stage == AtRule) AtStandard else if (stage == AtStandard) AtDirection
    else if (stage == AtDirection) AtPrinciple else AtPerson
  def stageLevel(stage: Stage): Level =
    if (stage == AtPrinciple) Principle else if (stage == AtDirection) Direct else Standard
  def deeperEntry(entry: Stage, upper: Stage): Stage =
    if (upper == AtPerson) entry
    else if (depth(stageLevel(upper)) > depth(stageLevel(entry))) upper else entry
  // The depth of the level a draft entered at (1 standard, 2 direction, 3 principle).
  def entryDepth(fix: Fix): int =
    if (fix.entry == AtStandard or fix.entry == AtRule) 1
    else if (fix.entry == AtDirection) 2 else 3
  // A rule failing its own examples again: standard assessment, then direction, principle,
  // then the person.
  def ruleClimb(fix: Fix): Fix =
    val upper = upStage(fix.climbedTo)
    val entry = deeperEntry(fix.entry, upper)
    { ...fix, climbedTo: upper, stage: upper, entry: entry, level: stageLevel(entry), ruleTries: 0,
      loopRounds: 0, kind: if (upper == AtPerson) fix.kind else DirectionDraft }
  // A draft the review loop sends back again: one level up from its entry; a role draft goes
  // to the person.
  def loopClimb(fix: Fix): Fix =
    val upper = if (fix.kind == RoleDraft) AtPerson
               else upStage(if (fix.entry == AtRule) AtStandard else fix.entry)
    if (upper == AtPerson) { ...fix, stage: AtPerson, loopRounds: 0, needRevise: false }
    else { ...fix, stage: upper, entry: upper, level: stageLevel(upper), loopRounds: 0,
           needRevise: false, revision: fix.revision + 1 }
  def levelOf(finding: Finding): Level = match finding {
    | Splits(_) => Split
    | FitsRole(_) => Fit
    | FixAt(fixAt) => fixAt.level
  }

  // ---- the asks
  def executeAsk(asker: Actor, answerer: Actor, about: int): Ask =
    { kind: Execute, from: asker, to: answerer, about: about }
  def checkOf(maker: Actor, slot: int): Ask = { kind: Check, from: maker, to: Role, about: slot }
  def decideOf(fixId: int): Ask = { kind: Decide, from: Pipe, to: Human, about: fixId }
  def question(asker: Actor, answerer: Actor): Ask =
    { kind: Question, from: asker, to: answerer, about: NONE }
  def openAsk(store: Store, ask: Ask): Store = { ...store, asks: store.asks.union(Set(ask)) }
  def closeAsk(store: Store, ask: Ask): Store = { ...store, asks: store.asks.exclude(Set(ask)) }
  def askCountOf(store: Store, asker: Actor, answerer: Actor): int =
    if (store.askCount.keys().contains((asker, answerer))) store.askCount.get((asker, answerer))
    else 0
  // The host's task is open again (a done task rejected, rechecked and failed).
  def reopenHost(store: Store, slot: int): Store = openAsk(store, executeAsk(Host, Role, slot))
  def canAsk(store: Store, actor: Actor): bool =
    (actor == Role or actor == Pipe or actor == Host or isLive(store, actor))
      and not(store.down.contains(actor))
  def canBeAsked(store: Store, actor: Actor): bool =
    actor == Human or actor == Host or actor == Role or actor == Pipe or isLive(store, actor)

  // ---- changing the store
  def setTask(store: Store, slot: int, change: Task => Task): Store =
    { ...store, tasks: store.tasks.setBy(slot, change) }
  def setFix(store: Store, fixId: int, change: Fix => Fix): Store =
    { ...store, fixes: store.fixes.setBy(fixId, change) }
  def setMaker(store: Store, actor: Actor, change: MakerState => MakerState): Store =
    if (isMaker(store, actor)) { ...store, makers: store.makers.setBy(actor, change) } else store
  def mark(store: Store, change: Ghost => Ghost): Store = { ...store, ghost: change(store.ghost) }
  def bump(store: Store, fixId: int): Store =
    setFix(store, fixId, fix => { ...fix, basisStep: fix.basisStep + 1 })
  def newEpoch(store: Store, actor: Actor): Store =
    { ...store, epochs: store.epochs.put(actor, epochOf(store, actor) + 1) }
  def counted(store: Store, agent: bool): Store =
    { ...store, changes: store.changes + 1,
      agentChanges: store.agentChanges + if (agent) 1 else 0 }
  // A maker ends: its asks go, its claim ends. NoOne: nothing ends, the person's asks stay.
  def endMaker(store: Store, maker: Actor): Store =
    if (maker == NoOne) store else
    val ended = setMaker(store, maker, row => { ...row, ended: true, claimed: false })
    val keep = ended.askCount.keys().filter(pair => pair._1 != maker and pair._2 != maker)
    // a Check kept across a revive goes with its maker (withdrawn by a reject)
    { ...ended, ghost: { ...ended.ghost,
        keptChecks: ended.ghost.keptChecks.filter(ask => ask.from != maker) }, asks: ended.asks.filter(ask => ask.from != maker and ask.to != maker),
      answered: ended.answered.filter(ask => ask.from != maker and ask.to != maker),
      justAnswered: ended.justAnswered.exclude(Set(maker)),
      askCount: keep.mapBy(pair => ended.askCount.get(pair)) }
  // A raise: the maker ends; the evaluation opens, an Execute to the pipeline role by `by`
  // (the role or the person). What the task still has to recheck (pending) stays for the
  // person's "take as is".
  def raise(store: Store, slot: int, tries: int, by: Actor): Store =
    val ended = setTask(endMaker(store, taskOf(store, slot).maker), slot,
      task => { ...task, state: Raised, tries: tries, maker: NoOne })
    openAsk(setFix(ended, slot, fix => { ...CLOSED, stage: Evaluating, basisStep: fix.basisStep + 1,
                                        base: store.versions, cardBase: store.card }),
            executeAsk(by, Pipe, slot))
  // The work goes back to the role as a task (a fresh maker, no tries used).
  def backToRole(store: Store, fixId: int): Store =
    if (free(fixId)) setFix(store, fixId, fix => { ...CLOSED, basisStep: fix.basisStep + 1 }) else
    setFix(setTask(store, fixId, task => { ...task, state: Sent, tries: 0, maker: NoOne,
                                          pending: Set() }),
           fixId, fix => { ...CLOSED, basisStep: fix.basisStep + 1 })
  def resolveCause(store: Store, fixId: int): Store =
    if (free(fixId)) store else
    val level = fixOf(store, fixId).level
    setTask(store, fixId, task =>
      { ...task, cause: if (resolves(level, task.cause)) NoCause else task.cause })
  // A history flag from the sender's own basis counts only for a sender that is not
  // Byzantine (a Byzantine sender can write any basis).
  def markStaleFix(store: Store, fixId: int, act: Act): Store =
    mark(store, ghost => { ...ghost,
      staleFix: ghost.staleFix
        or (not(act.byzantine) and act.seen != fixOf(store, fixId).basisStep) })

  // ---- putting a change in effect (a draft the person accepted, or a standard change)
  // The items a draft puts in effect: those it names, or with classify those its content
  // changes (the store diffs the records).
  def changedBy(fix: Fix): Set[Item] = if (OPTIONS.classify) fix.real else fix.items
  // A draft at the level of an item already fixed at its level or higher goes one level up:
  // standard -> direction assessment, direction -> principle. Principle reaches the person.
  def refixed(store: Store, fixId: int): bool =
    not(free(fixId)) and fixOf(store, fixId).kind == DirectionDraft
      and entryDepth(fixOf(store, fixId)) < 3
      and changedBy(fixOf(store, fixId)).exists(record =>
        store.fixDepth.get(record) >= entryDepth(fixOf(store, fixId)))
  def raiseUp(store: Store, fixId: int): Store =
    val stage = if (entryDepth(fixOf(store, fixId)) == 1) AtDirection else AtPrinciple
    mark(setFix(store, fixId, fix => { ...fix, stage: stage, entry: stage,
                  level: if (stage == AtDirection) Direct else Principle,
                  basisStep: fix.basisStep + 1 }),
         ghost => { ...ghost, raisedUp: true })
  // Compare and set (with rebase): a draft whose changed items moved since its base is not
  // put in effect; it goes back to its entry to be redone on the new versions.
  def conflict(store: Store, fixId: int): bool =
    val fix = fixOf(store, fixId)
    if (fix.kind == RoleDraft) fix.cardBase < store.card
    else changedBy(fix).exists(record => fix.base.get(record) < store.versions.get(record))
  def casBlocks(store: Store, fixId: int): bool = OPTIONS.rebase and conflict(store, fixId)
  def redo(store: Store, fixId: int): Store =
    mark(setFix(store, fixId, fix => { ...fix, stage: fix.entry, base: store.versions,
                  trueBase: store.versions, cardBase: store.card, revision: fix.revision + 1,
                  basisStep: fix.basisStep + 1 }),
         ghost => { ...ghost, rebaseFired: true })
  // Each changed item gets a new version. Recheck, by what changed: a direction change every
  // active and done task; a standard change the tasks in its `where`; a rule change the tasks
  // it applies to. Never a raised task. Active tasks are rechecked by their running role;
  // done tasks wait for the pipeline role (RecheckDone) or, for a test-command rule, the
  // harness (RunRule). breaksTasks (ghost, the environment's choice): the tasks the change breaks.
  def itemsInEffect(store: Store, fixId: int, agent: bool, breaksTasks: Set[int]): Store =
    val fix = fixOf(store, fixId)
    val changed = changedBy(fix)
    val rules = changed.filter(record => isRule(record))
    // Items the content changes but the store did not version: their tasks are not rechecked.
    val missed = fix.real.exclude(changed)
    // A fix again at the same or a lower level: of an item (refixed), or of the task.
    val again = refixed(store, fixId) or (not(free(fixId))
      and entryDepth(fix) < depth(taskOf(store, fixId).floor))
    val marked = mark(store, ghost => { ...ghost, refix: ghost.refix or again,
      topNoPerson: ghost.topNoPerson
        or (agent and not(free(fixId)) and taskOf(store, fixId).floor == Principle),
      failedTest: ghost.failedTest or (rules != Set() and hasMech(fix.form) and not(fix.testOk)),
      noForm: ghost.noForm or (rules != Set() and fix.form == NoForm),
      badRef: ghost.badRef or (rules != Set() and hasRef(fix.form) and not(fix.refOk)),
      lostUpdate: ghost.lostUpdate
        or fix.real.exists(record => fix.trueBase.get(record) < store.versions.get(record)),
      unrechecked: ghost.unrechecked or SLOTS.exists(other => other != fixId
        and taskOf(store, other).state != Raised and taskOf(store, other).state != Unsent
        and missed.exists(record => applies(record, other))) })
    val versioned = resolveCause(counted({ ...marked,
      fixDepth: if (free(fixId)) store.fixDepth else
        store.fixDepth.keys().mapBy(record =>
          if (changed.contains(record)) entryDepth(fix) else store.fixDepth.get(record)),
      tasks: if (free(fixId)) store.tasks else store.tasks.setBy(fixId, task => { ...task,
        floor: if (entryDepth(fix) >= 2) Principle
               else if (task.floor == Principle) Principle else Direct }),
      versions: store.versions.keys().mapBy(record =>
        store.versions.get(record) + if (changed.contains(record)) 1 else 0),
      ruleForm: store.ruleForm.keys().mapBy(number =>
        if (rules.contains(ItemRule(number))) fix.form else store.ruleForm.get(number)) },
      agent), fixId)
    // A rule that contradicts the other rule of the direction breaks the tasks that rule
    // applies to: their trouble is that rule again (a standard cause).
    val fightsBack = fix.fights and rules != Set()
    val fought = if (not(fightsBack)) versioned else mark(
      SLOTS.fold(versioned, (soFar, other) =>
        if (other != fixId and not(rules.contains(ItemRule(other)))
            and Set(Working, InReview, Done, Raised).contains(taskOf(soFar, other).state))
          // A done task is rechecked against its own rule (the one the change contradicts).
          setTask(soFar, other, task => { ...task, broken: true,
                    badResult: task.badResult or task.state != Working,
                    cause: CauseAt(Standard),
                    pending: if (task.state == Done or task.state == Raised
                                 or task.state == InReview) task.pending.union(Set(ItemRule(other)))
                             else task.pending })
        else soFar), ghost => { ...ghost, fightShipped: true })
    val afterBreaks = SLOTS.fold(fought, (soFar, other) =>
      if (other != fixId and breaksTasks.contains(other)
          and fix.real.exists(record => applies(record, other))
          and Set(Working, InReview, Done, Raised).contains(taskOf(soFar, other).state))
        setTask(soFar, other, task => { ...task, broken: true,
                                      badResult: task.badResult or task.state != Working })
      else soFar)
    val rechecked = SLOTS.fold(afterBreaks, (soFar, other) =>
      val touched = changed.filter(record => applies(record, other))
      if (other != fixId and taskOf(soFar, other).state == Done and touched != Set())
        mark(setTask(soFar, other, task => { ...task, pending: task.pending.union(touched) }),
             ghost => { ...ghost, recheckFired: true })
      else soFar)
    if (not(OPTIONS.rebase)) rechecked else
      FIXIDS.fold(rechecked, (soFar, other) =>
        val behind = fixOf(soFar, other)
        val early = Set(AtPrinciple, AtDirection, AtStandard, AtRule, Testing, Drafting)
          .contains(behind.stage) and changed.contains(ItemDirection)
        val late = (behind.stage == InLoop or behind.stage == AtPerson)
          and behind.kind == DirectionDraft
          and changedBy(behind).exists(record => changed.contains(record))
        if (other != fixId and (early or late))
          mark(setFix(soFar, other, row => { ...row, stage: row.entry, base: soFar.versions,
                         trueBase: soFar.versions, revision: row.revision + 1,
                         basisStep: row.basisStep + 1 }),
               ghost => { ...ghost, rebaseFired: true })
        else soFar)
  // The role's change of its own card takes effect.
  def cardInEffect(store: Store, fixId: int): Store =
    val fix = fixOf(store, fixId)
    val marked = mark(store, ghost =>
      { ...ghost, lostUpdate: ghost.lostUpdate or fix.cardBase < store.card })
    val carded = resolveCause(counted({ ...marked, card: store.card + 1 }, false), fixId)
    if (not(OPTIONS.rebase)) carded else
      FIXIDS.fold(carded, (soFar, other) =>
        if (other != fixId and fixOf(soFar, other).kind == RoleDraft
            and (fixOf(soFar, other).stage == InLoop or fixOf(soFar, other).stage == AtPerson))
          mark(setFix(soFar, other, row => { ...row, stage: InLoop, cardBase: soFar.card,
                         revision: row.revision + 1, basisStep: row.basisStep + 1 }),
               ghost => { ...ghost, rebaseFired: true })
        else soFar)

  // ==== the acts, in the order of the work: ask, make, check, fix, decide, close
  // Each act's allowed ends with its basis: the store refuses an act built on an older view
  // of its target (basisOk). basis: the target's revision now (NONE: no revision);
  // byVersions: the item versions the sender saw must be the current ones.
  def basisOk(store: Store, act: Act, basis: int, byVersions: bool): bool =
    not(OPTIONS.basis) or act.old
      or ((basis < 0 or act.seen == basis)
          and (not(byVersions) or act.seenVersions == versionSum(store)))

  // ---- Open: a question; the host sends a task; the role makes a maker; the person rejects
  // A question: a live host, role, pipeline role or maker asks a live actor; one open or
  // answered per pair, at most ASK_CAP per pair, past it AskRaise. A send: the host's task.
  // A make: the role's Execute to a new maker (the store gives it its id). A reject: the
  // person's Execute to the pipeline role on a result, named by the result's id.
  def openBasis(store: Store, ask: Ask): int =
    if (ask.kind == Execute and ask.to == Pipe and SLOTS.contains(ask.about))
      taskOf(store, ask.about).resultId
    else NONE
  def executeAllowed(store: Store, ask: Ask): bool =
    if (ask.to == Pipe)
      ask.from == Human and SLOTS.contains(ask.about) and taskOf(store, ask.about).resultId >= 0
        and (taskOf(store, ask.about).state == InReview or taskOf(store, ask.about).state == Done)
    else if (ask.from == Host)
      ask.to == Role and SLOTS.contains(ask.about) and taskOf(store, ask.about).state == Unsent
    else if (ask.from == Role)
      ask.to == NewMaker and SLOTS.contains(ask.about) and taskOf(store, ask.about).state == Sent
    else OPTIONS.makerAsks and ask.to == Role and isLive(store, ask.from)
      and makerAt(store, ask.from) and makerOf(store, ask.from).slot == ask.about
  def openAllowed(store: Store, act: Act, ask: Ask): bool =
    act.who == ask.from and (match ask.kind {
      | Question => ask.about == NONE and canAsk(store, ask.from) and canBeAsked(store, ask.to)
          and ask.from != ask.to and not(store.asks.contains(ask))
          and not(store.answered.contains(ask)) and askCountOf(store, ask.from, ask.to) < ASK_CAP
      | Execute => executeAllowed(store, ask)
      // a Check and a Decide are opened by the steps that make them, never by an Open
      | Check => false
      | Decide => false })
      and basisOk(store, act, openBasis(store, ask), false)
  def openEffect(store: Store, act: Act, ask: Ask): Store =
    if (ask.kind == Question)
      { ...store, asks: store.asks.union(Set(ask)),
        askCount: store.askCount.put((ask.from, ask.to), askCountOf(store, ask.from, ask.to) + 1) }
    else if (ask.to == Pipe) rejectEffect(store, act, ask.about)
    else if (ask.from == Host) sendTask(store, ask.about)
    else if (ask.from == Role) assignMaker(store, ask.about)
    else openAsk(store, ask)   // the mutant's: a maker's Execute to its role
  def sendTask(store: Store, slot: int): Store =
    openAsk(setTask(store, slot, task => { ...task, state: Sent }), executeAsk(Host, Role, slot))
  // A fresh maker takes the task: its Execute is open. The id is fresh for each assignment
  // (nextMaker counts up); the checking model sets it to the task's slot before the act and
  // drops ended makers (check.qnt, canon.qnt), so in the checked states the id carries no state.
  def assignMaker(store: Store, slot: int): Store =
    val maker = Maker(store.nextMaker)
    val made = { ...store, nextMaker: store.nextMaker + 1, epochs: store.epochs.put(maker, 0),
      makers: store.makers.put(maker,
        { slot: slot, ended: false, claimed: false, brief: ZERO, revisions: 0 }) }
    val assigned = mark(made, ghost => { ...ghost,
      restartedAssigned: ghost.restartedAssigned or ghost.restartedSlots.contains(slot),
      restartedSlots: ghost.restartedSlots.exclude(Set(slot)),
      keptFailAssigned: ghost.keptFailAssigned or ghost.keptFailSlots.contains(slot),
      keptFailSlots: ghost.keptFailSlots.exclude(Set(slot)) })
    openAsk(setTask(assigned, slot, task => { ...task, state: Working, tries: 0, maker: maker }),
            executeAsk(Role, maker, slot))
  // The person's reject of a result (a done task opens the top again): the task is raised.
  def rejectEffect(store: Store, act: Act, slot: int): Store =
    val task = taskOf(store, slot)
    val marked = mark(store, ghost => { ...ghost,
      unseenReject: ghost.unseenReject or act.seen != task.resultId })
    val reopened = if (task.state == Done)
        reopenHost({ ...marked, top: { ...marked.top, done: false } }, slot)
      else marked
    raise(reopened, slot, task.tries, Human)
  // Told: the host sends the tasks not sent; the role makes a maker for each task sent.
  def openTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Host and hostFinds(store))
      SLOTS.filter(slot => taskOf(store, slot).state == Unsent)
        .map(slot => Open(executeAsk(Host, Role, slot)))
    else if (actor == Role)
      SLOTS.filter(slot => taskOf(store, slot).state == Sent)
        .map(slot => Open(executeAsk(Role, NewMaker, slot)))
    else Set()

  // ---- AskEdit: the person's direction edit enters the pipeline as the fix EDIT
  // Built on the item versions the page showed (an old build names none: the store's).
  // items: what the person wrote.
  def editAllowed(store: Store, act: Act, edit: Edit): bool =
    act.who == Human and fixOf(store, EDIT).stage == Closed and edit.items.contains(ItemDirection)
  def editEffect(store: Store, act: Act, edit: Edit): Store =
    openAsk(setFix(store, EDIT, fix => { ...CLOSED, stage: AtDirection, entry: AtDirection,
              level: Direct, kind: DirectionDraft, base: if (act.old) store.versions else edit.base,
              trueBase: edit.trueBase, wrote: edit.items, basisStep: fix.basisStep + 1 }),
            executeAsk(Human, Pipe, EDIT))
  // Told: none (the page offers it).

  // ---- AnswerQuestion, Hear, AskRaise: the questions between actors
  // An answer alternates with a step of the answerer's own. The asker hears the answer later.
  // A maker past the cap raises its task as a problem no rule covers.
  def answerQuestionAllowed(store: Store, act: Act, ask: Ask): bool =
    act.who == ask.to and ask.kind == Question and store.asks.contains(ask)
      and (not(store.justAnswered.contains(ask.to)) or ownToldSteps(store, ask.to) == Set())
  def answerQuestionEffect(store: Store, act: Act, ask: Ask): Store =
    { ...store, asks: store.asks.exclude(Set(ask)), answered: store.answered.union(Set(ask)) }
  def answerQuestionTold(store: Store, actor: Actor): Set[Body] =
    store.asks.filter(ask => ask.kind == Question and ask.to == actor)
      .map(ask => AnswerQuestion(ask))
  def hearAllowed(store: Store, act: Act, ask: Ask): bool =
    act.who == ask.from and store.answered.contains(ask)
  def hearEffect(store: Store, act: Act, ask: Ask): Store =
    { ...store, answered: store.answered.exclude(Set(ask)) }
  def hearTold(store: Store, actor: Actor): Set[Body] =
    store.answered.filter(ask => ask.from == actor).map(ask => Hear(ask))
  def askRaiseAllowed(store: Store, act: Act, ask: Ask): bool =
    act.who == ask.from and makerAt(store, ask.from)
      and askCountOf(store, ask.from, ask.to) >= ASK_CAP
  def askRaiseEffect(store: Store, act: Act, ask: Ask): Store =
    val slot = makerOf(store, ask.from).slot
    mark(raise(store, slot, taskOf(store, slot).tries, Role),
         ghost => { ...ghost, askRaised: true })
  // Told: none (the maker's own repeat).

  // ---- ReadBrief, Resume: a maker reads its brief; the role resumes a maker that exited
  // A maker act: on a working task; with endedCheck, only by its live maker.
  def makerAt(store: Store, actor: Actor): bool =
    isMaker(store, actor) and not(store.down.contains(actor))
      and taskOf(store, makerOf(store, actor).slot).state == Working
      and (not(OPTIONS.endedCheck) or (not(makerOf(store, actor).ended)
           and taskOf(store, makerOf(store, actor).slot).maker == actor))
  // The maker is told something now: it holds the working task and is up.
  def makerLive(store: Store, actor: Actor): bool =
    isMaker(store, actor) and not(makerOf(store, actor).ended) and not(store.down.contains(actor))
      and taskOf(store, makerOf(store, actor).slot).state == Working
      and taskOf(store, makerOf(store, actor).slot).maker == actor
  def readAllowed(store: Store, act: Act, maker: Actor): bool =
    act.who == maker and makerAt(store, maker)
  // A read by a maker the store ended (endedCheck off): a claim on an ended maker.
  def readEffect(store: Store, act: Act, maker: Actor): Store =
    mark(setMaker(store, maker, row => { ...row, claimed: true, brief: store.versions }),
         ghost => { ...ghost, claimByEnded: ghost.claimByEnded or makerOf(store, maker).ended })
  def readTold(store: Store, actor: Actor): Set[Body] =
    if (makerLive(store, actor)
        and (not(makerOf(store, actor).claimed) or briefStale(store, actor)))
      Set(ReadBrief({ maker: actor }))
    else Set()
  def resumeAllowed(store: Store, act: Act, maker: Actor): bool =
    act.who == Role and isMaker(store, maker) and not(makerOf(store, maker).ended)
      and store.down.contains(maker)
  def resumeEffect(store: Store, act: Act, maker: Actor): Store =
    newEpoch({ ...store, down: store.down.exclude(Set(maker)) }, maker)
  def resumeTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Role)
      SLOTS.map(slot => liveMaker(store, slot)).filter(maker => maker != NoOne
        and store.down.contains(maker)).map(maker => Resume({ maker: maker }))
    else Set()

  // ---- Report: the maker answers its Execute with its result, a Check ask to the role
  // The ask must be open (with endedCheck: an ended maker's is gone); a report made under an
  // old brief is refused (briefCheck).
  def reportBasis(store: Store, report: Result): int =
    if (isMaker(store, report.ask.to)) makerOf(store, report.ask.to).revisions else NONE
  def reportAllowed(store: Store, act: Act, report: Result): bool =
    val ask = report.ask
    act.who == ask.to and ask.kind == Execute and ask.from == Role and isMaker(store, ask.to)
      and makerOf(store, ask.to).slot == ask.about
      and (store.asks.contains(ask) or not(OPTIONS.endedCheck))
      and makerAt(store, ask.to) and (makerOf(store, ask.to).claimed or not(OPTIONS.endedCheck))
      and not(OPTIONS.briefCheck and briefStale(store, ask.to))
      and basisOk(store, act, reportBasis(store, report), true)
  // A result made under an old brief keeps the work a change broke.
  def reportEffect(store: Store, act: Act, report: Result): Store =
    val maker = makerOf(store, report.ask.to)
    val task = taskOf(store, maker.slot)
    val marked = mark(store, ghost => { ...ghost,
      staleReport: ghost.staleReport
        or (not(act.byzantine) and not(act.old) and act.seen != maker.revisions),
      endedActed: ghost.endedActed or maker.ended or task.maker != report.ask.to,
      noContext: ghost.noContext
        or (not(act.byzantine) and maker.revisions > 0 and not(act.hadContext)
            and not(OPTIONS.fullBrief)) })
    val stale = briefStale(store, report.ask.to)
    val reviewed = setTask(marked, maker.slot, row => { ...row, state: InReview,
      resultId: row.resultId + 1, checked: maker.brief, broken: row.broken and stale,
      taken: false, badResult: report.slipped or row.cause != NoCause or (row.broken and stale) })
    // The answer closes the maker's Execute; the result is a Check ask to the role.
    openAsk(closeAsk(reviewed, report.ask), checkOf(report.ask.to, maker.slot))
  def reportTold(store: Store, actor: Actor): Set[Body] =
    if (makerLive(store, actor) and makerOf(store, actor).claimed and not(briefStale(store, actor)))
      Set(Report({ ask: executeAsk(Role, actor, makerOf(store, actor).slot), slipped: false }))
    else Set()

  // ---- Review: the role's verdict on a check (pass, fail, or a raise)
  // A pass is refused while a test-command rule catches the result; a fail needs a try left,
  // a raise for tries needs none left.
  def reviewBasis(store: Store, review: Judgement): int =
    if (SLOTS.contains(review.ask.about)) taskOf(store, review.ask.about).resultId else NONE
  def verdictAllowed(store: Store, slot: int, verdict: Verdict): bool =
    val task = taskOf(store, slot)
    task.state == InReview and match verdict {
      | Pass => not(OPTIONS.passTests and task.badResult and mechCatches(store, slot))
      | Fail => task.tries + 1 < OPTIONS.maxTries
      | RaiseTries => task.tries + 1 >= OPTIONS.maxTries
      | RaiseNoRule => true
      | RaiseMisses => true
    }
  def reviewAllowed(store: Store, act: Act, review: Judgement): bool =
    val ask = review.ask
    act.who == ask.to and ask.kind == Check and ask.to == Role and SLOTS.contains(ask.about)
      and store.asks.contains(ask) and verdictAllowed(store, ask.about, review.verdict)
      and basisOk(store, act, reviewBasis(store, review), true)
  def reviewEffect(store: Store, act: Act, review: Judgement): Store =
    val slot = review.ask.about
    val task = taskOf(store, slot)
    val closed = closeAsk(store, checkOf(task.maker, slot))
    val marked = mark(closed, ghost => { ...ghost,
      keptCheckJudged: ghost.keptCheckJudged or ghost.keptChecks.contains(review.ask),
      keptChecks: ghost.keptChecks.exclude(Set(review.ask)),
      otherResult: ghost.otherResult or (not(act.byzantine) and act.seen != task.resultId) })
    match review.verdict {
      | Pass =>
          val passed = mark(marked, ghost => { ...ghost,
            otherVersion: ghost.otherVersion
              or (not(act.byzantine) and act.seenVersions != versionSum(store)),
            passBroken: ghost.passBroken or (task.badResult and mechCatches(store, slot)),
            passDefect: ghost.passDefect or task.badResult })
          closeAsk(setTask(endMaker(passed, task.maker), slot, row => { ...row, state: Done,
                     maker: NoOne, checked: store.versions, pending: Set() }),
                   executeAsk(Host, Role, slot))
      // The revision goes to the same maker. A rechecked task has none: a fresh one.
      | Fail =>
          if (liveMaker(store, slot) == NoOne)
            setTask(mark(marked, ghost => { ...ghost, keptFailSlots: ghost.keptFailSlots.union(
                      if (store.ghost.keptChecks.contains(review.ask)) Set(slot) else Set()) }),
                    slot, row => { ...row, state: Sent, tries: row.tries + 1 })
          else openAsk(setMaker(setTask(marked, slot,
                          row => { ...row, state: Working, tries: row.tries + 1 }),
                          task.maker, row => { ...row, revisions: row.revisions + 1 }),
                       executeAsk(Role, task.maker, slot))
      | RaiseTries => raise(marked, slot, task.tries + 1, Role)
      | RaiseNoRule => raise(marked, slot, task.tries, Role)
      | RaiseMisses => raise(marked, slot, task.tries, Role)
    }
  def reviewTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Role)
      store.asks.filter(ask => ask.kind == Check and ask.to == Role)
        .map(ask => Review({ ask: ask, verdict: Pass }))
    else Set()

  // ---- Evaluate: the pipeline role finds the level of a raise
  // Not below the task's floor (raiseLevel); a one-section task is not split (strictScope);
  // a role draft (Fit) is off the ladder. With strictScope a split part owns one section less.
  // Agents never remake the top: a too big task, the top included, is split.
  def evaluateAllowed(store: Store, act: Act, evaluation: Evaluation): bool =
    val level = levelOf(evaluation.finding)
    act.who == Pipe and fixOf(store, evaluation.fix).stage == Evaluating
      and not(OPTIONS.raiseLevel and level != Fit
              and depth(level) < depth(taskOf(store, evaluation.fix).floor))
      and not(OPTIONS.strictScope and level == Split
              and taskOf(store, evaluation.fix).sections <= 1)
      and basisOk(store, act, fixOf(store, evaluation.fix).basisStep, true)
  def evaluateEffect(store: Store, act: Act, evaluation: Evaluation): Store =
    val fixId = evaluation.fix
    val task = taskOf(store, fixId)
    val level = levelOf(evaluation.finding)
    val marked = mark(bump(markStaleFix(store, fixId, act), fixId), ghost => { ...ghost,
      shallowEval: ghost.shallowEval or not(resolves(level, task.cause)) })
    val leveled = setFix(marked, fixId, fix => { ...fix, level: level })
    match evaluation.finding {
      | Splits(split) =>
          // A split of a split part (raiseLevel off) is the same fix again.
          val counting = mark(counted(leveled, true),
                              ghost => { ...ghost, refix: ghost.refix or task.floor == Standard })
          setFix(setTask(counting, fixId, row => { ...freshTask(row.generation + 1, split.cause),
                   state: Sent, floor: Standard,
                   sections: if (OPTIONS.strictScope) row.sections - 1 else row.sections }),
                 fixId, fix => { ...CLOSED, basisStep: fix.basisStep })
      | FitsRole(fit) =>
          setFix(leveled, fixId, fix => { ...fix, kind: RoleDraft, stage: InLoop, entry: InLoop,
                   roleLabel: fit.label, roleOnly: fit.only, cardBase: store.card })
      | FixAt(fixAt) =>
          setFix(leveled, fixId, fix => { ...fix, kind: DirectionDraft, stage: entryOf(level),
                   entry: entryOf(level), base: fixAt.base, trueBase: fixAt.trueBase })
    }
  def evaluateTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      FIXIDS.filter(fixId => fixOf(store, fixId).stage == Evaluating).map(fixId =>
        Evaluate({ fix: fixId, finding: FixAt({ level: Standard, base: store.versions,
                                                trueBase: store.versions }) }))
    else Set()

  // ---- Advance: the draft goes down one stage of the ladder (principle, direction, standard)
  def advanceAllowed(store: Store, act: Act, fixId: int): bool =
    act.who == Pipe
      and Set(AtPrinciple, AtDirection, AtStandard).contains(fixOf(store, fixId).stage)
      and basisOk(store, act, fixOf(store, fixId).basisStep, false)
  def advanceEffect(store: Store, act: Act, fixId: int): Store =
    setFix(bump(markStaleFix(store, fixId, act), fixId), fixId,
           fix => { ...fix, stage: nextStage(fix.stage) })
  def advanceTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      FIXIDS.filter(fixId => Set(AtPrinciple, AtDirection, AtStandard)
                              .contains(fixOf(store, fixId).stage))
        .map(fixId => Advance({ fix: fixId }))
    else Set()

  // ---- WriteRule: the pipeline role writes a rule in a form
  // With formCheck a rule has an evidence form; with refCheck a reference form names a
  // reference that exists. A rule with a test command goes to its test, else to the draft.
  def writeRuleAllowed(store: Store, act: Act, draft: RuleDraft): bool =
    act.who == Pipe and fixOf(store, draft.fix).stage == AtRule
      and (not(OPTIONS.formCheck) or draft.form != NoForm)
      and (not(OPTIONS.refCheck) or not(hasRef(draft.form)) or draft.refOk)
      and basisOk(store, act, fixOf(store, draft.fix).basisStep, false)
  def writeRuleEffect(store: Store, act: Act, draft: RuleDraft): Store =
    setFix(bump(markStaleFix(store, draft.fix, act), draft.fix), draft.fix, fix =>
      { ...fix, form: draft.form, testOk: draft.testOk, refOk: draft.refOk,
        fights: draft.fights, contradicted: fix.contradicted and draft.fights,
        stage: if (hasMech(draft.form)) Testing else Drafting })
  def writeRuleTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      FIXIDS.filter(fixId => fixOf(store, fixId).stage == AtRule).map(fixId =>
        WriteRule({ fix: fixId, form: Ref, testOk: true, refOk: true, fights: false }))
    else Set()

  // ---- RunTest: the test command runs on the rule's examples (and the other rules')
  // passed: the pipeline role's claim that the test passed; contradicts: its claim that a test
  // failed on another rule's example. With harnessTest the truth decides, not the claim; with
  // crossTest the other rules' examples run too (a reference-only rule has no test command).
  // A rule failing its own examples is written again, climbing the ladder when it repeats. A
  // contradiction goes to direction assessment; a draft already at direction goes on, marked,
  // and its Ship goes to the person.
  def runTestAllowed(store: Store, act: Act, testRun: TestRun): bool =
    act.who == Pipe and fixOf(store, testRun.fix).stage == Testing
      and basisOk(store, act, fixOf(store, testRun.fix).basisStep, false)
  def runTestEffect(store: Store, act: Act, testRun: TestRun): Store =
    val fix = fixOf(store, testRun.fix)
    val contradicts =
      if (OPTIONS.harnessTest) OPTIONS.crossTest and fix.fights else testRun.contradicts
    val passes = if (OPTIONS.harnessTest) fix.testOk else testRun.passed
    val marked = bump(markStaleFix(store, testRun.fix, act), testRun.fix)
    if (not(passes)) setFix(marked, testRun.fix, row =>
      if (OPTIONS.ruleLadder and row.ruleTries >= 1) ruleClimb(row)
      else { ...row, stage: AtRule, ruleTries: 1 })
    else if (contradicts and fix.entry != AtDirection and fix.entry != AtPrinciple)
      setFix(marked, testRun.fix, row => { ...row, kind: DirectionDraft, level: Direct,
                                       stage: AtDirection, entry: AtDirection,
                                       contradicted: true })
    else if (contradicts) setFix(marked, testRun.fix, row => { ...row, stage: Drafting,
                                                           contradicted: true })
    else setFix(marked, testRun.fix, row => { ...row, stage: Drafting })
  def runTestTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      FIXIDS.filter(fixId => fixOf(store, fixId).stage == Testing).map(fixId =>
        RunTest({ fix: fixId, passed: true, contradicts: false }))
    else Set()

  // ---- Ship: the draft is shipped: a standard change takes effect, else it goes to the loop
  // items: the items the draft names; real: those its content changes. "Only a standard
  // change?" is read from the named items (with classify: from the content). A draft entered
  // at direction or principle goes to the loop whatever it names (ladderRoute).
  def shipAllowed(store: Store, act: Act, shipment: Shipment): bool =
    act.who == Pipe and fixOf(store, shipment.fix).stage == Drafting
      and basisOk(store, act, fixOf(store, shipment.fix).basisStep, false)
  def shipEffect(store: Store, act: Act, shipment: Shipment): Store =
    val fixId = shipment.fix
    val shipped = setFix(bump(markStaleFix(store, fixId, act), fixId), fixId,
                         fix => { ...fix, items: shipment.items, real: shipment.real })
    val escalated = fixOf(store, fixId).entry == AtDirection
      or fixOf(store, fixId).entry == AtPrinciple
    val named = if (OPTIONS.classify) shipment.real else shipment.items
    val isStandard = not(named.contains(ItemDirection)) and not(OPTIONS.ladderRoute and escalated)
    if (fixId == EDIT) shipEdit(shipped, act, shipment)
    else if (isStandard)
      shipStandard(mark(shipped, ghost => { ...ghost,
        deepNoPerson: ghost.deepNoPerson or shipment.real.contains(ItemDirection),
        escalatedNoPerson: ghost.escalatedNoPerson or escalated }), fixId, shipment.breaksTasks)
    // Raised up the ladder before the person sees it, else to the loop.
    else if (OPTIONS.raiseLevel and refixed(shipped, fixId)) raiseUp(shipped, fixId)
    else setFix(shipped, fixId, fix => { ...fix, stage: InLoop })
  // A standard change is in effect at once.
  def shipStandard(store: Store, fixId: int, breaksTasks: Set[int]): Store =
    if (casBlocks(store, fixId)) redo(store, fixId)
    else if (OPTIONS.raiseLevel and refixed(store, fixId)) raiseUp(store, fixId)
    else backToRole(itemsInEffect(store, fixId, true, breaksTasks), fixId)
  // The person's edit after the pipeline role carried it down. editBack 0: back to the
  // person always; 1: only when the change has items the person did not write (as the store
  // sees them); 2: never. A change that leaves out what the person wrote goes back too. A
  // change in effect with items the person did not write and did not accept is the history
  // flag unacceptedChange.
  def shipEdit(store: Store, act: Act, shipment: Shipment): Store =
    val fix = fixOf(store, EDIT)
    val seen = if (OPTIONS.classify) shipment.real else shipment.items
    val back = OPTIONS.editBack == 0 or (OPTIONS.editBack == 1 and seen.exclude(fix.wrote) != Set())
      or not(fix.wrote.forall(record => seen.contains(record))) or fix.contradicted
    if (back) setFix(store, EDIT, row => { ...row, stage: InLoop })
    else if (casBlocks(store, EDIT)) redo(store, EDIT)
    // In effect at once; then, as after the person's accept, the host reassigns roles.
    else setFix(itemsInEffect(mark(store, ghost => { ...ghost,
                              unacceptedChange: ghost.unacceptedChange
                                or shipment.real.exclude(fix.wrote) != Set(),
                              wroteDropped: ghost.wroteDropped
                                or not(fix.wrote.forall(record =>
                                         shipment.real.contains(record))) }),
                            EDIT, false, shipment.breaksTasks),
                    EDIT, row => { ...row, stage: Accepted })
  def shipTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      FIXIDS.filter(fixId => fixOf(store, fixId).stage == Drafting).map(fixId =>
        Ship({ fix: fixId, items: Set(), real: Set(), breaksTasks: Set() }))
    else Set()

  // ---- LoopReview: the review loop sends the draft to the person, or back to be revised
  // A draft the person sent back reaches the person only revised (reviseCheck); sent back
  // again, it goes one level up (loopLadder).
  def loopAllowed(store: Store, act: Act, loop: Loop): bool =
    act.who == Pipe and fixOf(store, loop.fix).stage == InLoop
      and not(OPTIONS.reviseCheck and loop.toPerson and fixOf(store, loop.fix).needRevise)
      and basisOk(store, act, fixOf(store, loop.fix).basisStep, false)
  def loopEffect(store: Store, act: Act, loop: Loop): Store =
    val fix = fixOf(store, loop.fix)
    val marked = mark(bump(markStaleFix(store, loop.fix, act), loop.fix), ghost => { ...ghost,
      unchangedResubmit: ghost.unchangedResubmit or (loop.toPerson and fix.needRevise) })
    setFix(marked, loop.fix, row =>
      if (loop.toPerson) { ...row, stage: AtPerson }
      else if (OPTIONS.loopLadder and row.loopRounds >= 1) loopClimb(row)
      // (loopRounds 1 and 2 alternate without the ladder: each revision is a new state)
      else { ...row, revision: row.revision + 1, loopRounds: if (row.loopRounds == 1) 2 else 1,
             needRevise: false })
  def loopTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      FIXIDS.filter(fixId => fixOf(store, fixId).stage == InLoop).map(fixId =>
        LoopReview({ fix: fixId, toPerson: true }))
    else Set()

  // ---- Decide: the person's reply to a draft: accept, send back, take as is, or again
  // Take and again are for a task's raise (the person takes the result as it is, or sends the
  // raise back to evaluation). Without acceptCheck the store takes the reply to an ask that is
  // gone; without it an accept needs no escalation waiting for the person.
  def atPerson(store: Store, fixId: int): bool =
    if (OPTIONS.acceptCheck) fixOf(store, fixId).stage == AtPerson
    else fixOf(store, fixId).stage != Closed
  def takeAllowed(store: Store, fixId: int): bool =
    not(free(fixId)) and fixOf(store, fixId).stage == AtPerson
  def decideBasis(store: Store, decision: Decision): int =
    if (FIXIDS.contains(decision.ask.about)) fixOf(store, decision.ask.about).basisStep else NONE
  def decideAllowed(store: Store, act: Act, decision: Decision): bool =
    val ask = decision.ask
    act.who == ask.to and ask.kind == Decide and ask.to == Human and FIXIDS.contains(ask.about)
      and (store.asks.contains(ask) or not(OPTIONS.acceptCheck))
      and (if (decision.reply == TakeAsIs or decision.reply == EvaluateAgain)
             takeAllowed(store, ask.about)
           else atPerson(store, ask.about))
      and basisOk(store, act, decideBasis(store, decision), false)
  def decideEffect(store: Store, act: Act, decision: Decision): Store = match decision.reply {
    | AcceptIt => acceptEffect(store, act, decision)
    | SendItBack => sendBackEffect(store, act, decision.ask.about)
    | TakeAsIs => takeEffect(store, decision)
    | EvaluateAgain => takeEffect(store, decision)
  }
  // The accepted draft takes effect (its changes, or the role's card). A contradicted draft:
  // whether its direction change resolves the contradiction is the environment's truth
  // (`resolves`); if not, the rule still fights. Then: a conflict redoes it, a refix goes up,
  // a role change only goes back to the card; else the host reassigns.
  def acceptEffect(store: Store, act: Act, decision: Decision): Store =
    val fixId = decision.ask.about
    val fix = fixOf(store, fixId)
    val marked = mark(store, ghost => { ...ghost,
      acceptNotWaiting: ghost.acceptNotWaiting or fix.stage != AtPerson,
      unseenAccept: ghost.unseenAccept or act.seen != fix.basisStep,
      rejectedInEffect: ghost.rejectedInEffect
        or (fix.sentBack.contains(fix.revision) and act.seen < fix.basisStep) })
    val settled = if (fix.contradicted and decision.resolvesFight)
        setFix(marked, fixId, row => { ...row, fights: false })
      else marked
    val inEffect = bump(if (fix.kind == DirectionDraft)
                          itemsInEffect(settled, fixId, false, decision.breaksTasks)
                        else cardInEffect(marked, fixId), fixId)
    // "Only a role change?" yes: back to the card, the work goes on. no: host reassigns.
    val roleOnly = fix.kind == RoleDraft and (if (OPTIONS.classify) fix.roleOnly else fix.roleLabel)
    val judged = mark(inEffect, ghost => { ...ghost,
      roleMisjudged: ghost.roleMisjudged or (roleOnly and not(fix.roleOnly)) })
    if (casBlocks(marked, fixId)) redo(marked, fixId)
    else if (OPTIONS.raiseLevel and refixed(marked, fixId)) raiseUp(marked, fixId)
    else if (roleOnly) backToRole(judged, fixId)
    else setFix(judged, fixId, row => { ...row, stage: Accepted })
  def sendBackEffect(store: Store, act: Act, fixId: int): Store =
    setFix(store, fixId, fix => { ...fix, stage: InLoop,
      sentBack: fix.sentBack.union(Set(fix.revision)), needRevise: true, loopRounds: 0,
      sendBacks: fix.sendBacks + 1, basisStep: fix.basisStep + 1 })
  // Take as is: the task is done (with decideRecheck first rechecked against the changes
  // since its result was checked: they land on raised tasks without a recheck). Again: the
  // raise goes back to evaluation.
  def takeEffect(store: Store, decision: Decision): Store =
    val slot = decision.ask.about
    if (decision.reply == TakeAsIs)
      closeAsk(setFix(setTask(store, slot, task => { ...task, state: Done, taken: true,
                   pending: if (OPTIONS.decideRecheck) staleItems(store, slot).union(task.pending)
                            else Set() }), slot,
                   fix => { ...CLOSED, basisStep: fix.basisStep + 1 }),
               executeAsk(Host, Role, slot))
    else setFix(store, slot, fix => { ...CLOSED, stage: Evaluating, basisStep: fix.basisStep + 1 })
  def decideTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Human)
      store.asks.filter(ask => ask.kind == Decide).map(ask =>
        Respond({ ask: ask, reply: AcceptIt, resolvesFight: false, breaksTasks: Set() }))
    else Set()

  // ---- Reassign, TopDone: the host reassigns the roles, and returns the done top
  // The accepted raises go back to the role, the role's open work is sent again to the new
  // role (its makers end). Not a change of the items. The host keeps hosting after TopDone.
  def reassignAllowed(store: Store, act: Act): bool =
    act.who == Host and FIXIDS.exists(fixId => fixOf(store, fixId).stage == Accepted)
  def reassignEffect(store: Store, act: Act): Store =
    FIXIDS.fold(store, (soFar, fixId) =>
      if (fixOf(soFar, fixId).stage == Accepted) backToRole(soFar, fixId)
      else if (free(fixId)) soFar
      else if (taskOf(soFar, fixId).state == Working or taskOf(soFar, fixId).state == InReview)
        mark(setTask(endMaker(soFar, taskOf(soFar, fixId).maker), fixId,
                     task => { ...task, state: Sent, tries: 0, maker: NoOne }),
             ghost => { ...ghost, reassignEnded: true })
      else soFar)
  def reassignTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Host and hostFinds(store)
        and FIXIDS.exists(fixId => fixOf(store, fixId).stage == Accepted)) Set(Reassign)
    else Set()
  def topDoneAllowed(store: Store, act: Act): bool =
    act.who == Host and allDone(store) and not(store.top.done)
  def topDoneEffect(store: Store, act: Act): Store =
    { ...store, top: { ...store.top, done: true } }
  def topDoneTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Host and hostFinds(store) and allDone(store) and not(store.top.done))
      Set(TopDone)
    else Set()

  // ---- RecheckDone: the pipeline role rechecks a done task against the changed items
  // The recheck names the items it judged (items) at the versions it saw (base): they must be
  // what is pending now, at the current versions (recheckBasis). It judges what the change
  // broke (`broken`), not a defect the person took as it is. holds: it still holds. A failed
  // recheck sends the task back to the role and reopens the top.
  def recheckCurrent(store: Store, recheck: Recheck): bool =
    val pending = recheckItems(store, recheck.task)
    recheck.items == pending
      and pending.forall(record => recheck.base.get(record) == store.versions.get(record))
  def recheckAllowed(store: Store, act: Act, recheck: Recheck): bool =
    act.who == Pipe and recheckDue(store, recheck.task)
      and not(OPTIONS.recheckBasis and not(recheckCurrent(store, recheck)))
      and basisOk(store, act, taskOf(store, recheck.task).resultId, false)
  def recheckEffect(store: Store, act: Act, recheck: Recheck): Store =
    val task = taskOf(store, recheck.task)
    val judged = if (OPTIONS.recheckBasis) recheck.items else recheckItems(store, recheck.task)
    val marked = mark(store, ghost => { ...ghost,
      passDefect: ghost.passDefect or (recheck.holds and task.broken),
      takenUndone: ghost.takenUndone or (not(recheck.holds) and task.taken and not(task.broken)) })
    if (recheck.holds) setTask(marked, recheck.task, row => { ...row,
      pending: row.pending.exclude(judged),
      checked: row.checked.keys().mapBy(record =>
        if (judged.contains(record)) store.versions.get(record) else row.checked.get(record)) })
    else reopenHost({ ...setTask(marked, recheck.task, row => { ...row, state: Sent, tries: 0,
                                                              maker: NoOne, pending: Set() }),
                      top: { ...store.top, done: false } }, recheck.task)
  def recheckTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Pipe)
      SLOTS.filter(slot => recheckDue(store, slot)).map(slot =>
        RecheckDone({ task: slot, holds: true, items: recheckItems(store, slot),
                      base: store.versions }))
    else Set()

  // ---- RunRule: the harness runs the test commands of the changed rules on a done result
  // They catch what the change broke: the same as a recheck, for rules with a test command.
  def runRuleAllowed(store: Store, act: Act, slot: int): bool =
    act.who == Harness and runRuleDue(store, slot)
  def runRuleEffect(store: Store, act: Act, slot: int): Store =
    val task = taskOf(store, slot)
    val judged = task.pending.filter(record => testRule(store, record))
    if (not(task.broken)) setTask(store, slot, row => { ...row,
      pending: row.pending.exclude(judged),
      checked: row.checked.keys().mapBy(record =>
        if (judged.contains(record)) store.versions.get(record) else row.checked.get(record)) })
    else reopenHost({ ...setTask(store, slot, row => { ...row, state: Sent, tries: 0,
                                                       maker: NoOne, pending: Set() }),
                      top: { ...store.top, done: false } }, slot)
  def runRuleTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Harness)
      SLOTS.filter(slot => runRuleDue(store, slot)).map(slot => RunRule({ task: slot }))
    else Set()

  // ---- Revive, Exit: a process ends (the engine records it) and is started again
  // An exit is appended by the pump or a hook. A maker is a subagent inside the role's
  // process: the role's exit is the exit of its makers too. Every exit ends a claim. The
  // host's pane is the person's own tmux: the person starts it again; the engine revives the
  // roles.
  def reviveAllowed(store: Store, act: Act, actor: Actor): bool =
    act.who == (if (actor == Host) Human else Harness) and PERSISTENT.contains(actor)
      and store.down.contains(actor)
  // The revived role has lost its makers: they end (their questions and answers go too). A
  // working task goes back to Sent, so the role assigns a fresh maker (it starts at 0 tries, as
  // after any assign: the tries kept by the revive are moot); its
  // Execute to the old maker closes. A task in review keeps its Check: the role checks the
  // result itself. The host and the pipeline role are revived as they were.
  def reviveEffect(store: Store, act: Act, actor: Actor): Store =
    val revived = newEpoch({ ...store, down: store.down.exclude(Set(actor)) }, actor)
    if (actor == Role) SLOTS.fold(revived, (soFar, slot) => loseMaker(soFar, slot)) else revived
  def loseMaker(store: Store, slot: int): Store =
    val maker = liveMaker(store, slot)
    if (maker == NoOne) store
    else if (taskOf(store, slot).state == InReview)
      mark(openAsk(endMaker(store, maker), checkOf(maker, slot)),
           ghost => { ...ghost, keptChecks: ghost.keptChecks.union(Set(checkOf(maker, slot))) })
    else mark(setTask(endMaker(store, maker), slot, task => { ...task, state: Sent, maker: NoOne }),
              ghost => { ...ghost, restartedSlots: ghost.restartedSlots.union(Set(slot)) })
  def reviveTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Human and store.down.contains(Host)) Set(Revive({ actor: Host }))
    else if (actor == Harness)
      Set(Role, Pipe).filter(process => store.down.contains(process))
        .map(process => Revive({ actor: process }))
    else Set()
  def exitAllowed(store: Store, act: Act, actor: Actor): bool =
    act.who == Harness and not(store.down.contains(actor))
  def exitEffect(store: Store, act: Act, actor: Actor): Store =
    val gone = if (actor == Role)
        Set(actor).union(SLOTS.map(slot => liveMaker(store, slot)).filter(maker => maker != NoOne))
      else Set(actor)
    gone.fold({ ...store, down: store.down.union(gone) }, (soFar, process) =>
      setMaker(soFar, process, row => { ...row, claimed: false }))
  // Told: none (an exit is the engine's observation).

  // ---- EndProject, MoveHost: the person ends the project; run continue moves the host
  // Run continue: the run's host moves to a new session (a new host process).
  def endAllowed(store: Store, act: Act): bool =
    act.who == Human and store.top.done and allDone(store)
  def endEffect(store: Store, act: Act): Store =
    val broken = SLOTS.exists(slot =>
      taskOf(store, slot).state == Done and taskOf(store, slot).broken)
    mark({ ...store, top: { ...store.top, ended: true } },
         ghost => { ...ghost, endBroken: ghost.endBroken or broken })
  def endTold(store: Store, actor: Actor): Set[Body] =
    if (actor == Human and store.top.done and allDone(store)) Set(EndProject) else Set()
  def moveAllowed(store: Store, act: Act): bool = act.who == Human
  def moveEffect(store: Store, act: Act): Store =
    val moved = newEpoch({ ...store, session: store.session + 1 }, Host)
    if (OPTIONS.rebind)
      { ...moved, top: { ...store.top, hostSession: store.session + 1 } }
    else moved
  // Told: none (the person's own).

  // ==== the store: accept, take
  // Every act is checked in the state at the append: the token (no forgery), the epoch,
  // the act's own allowed (legal in the state, then the basis).
  def epochOk(store: Store, act: Act): bool =
    not(OPTIONS.epochs) or not(hasEpoch(act.who)) or act.epoch >= epochOf(store, act.who)
  def allowed(store: Store, act: Act): bool = match act.body {
    | EndProject => endAllowed(store, act)
    | MoveHost => moveAllowed(store, act)
    | Open(ask) => openAllowed(store, act, ask)
    | AskEdit(edit) => editAllowed(store, act, edit)
    | AskRaise(ask) => askRaiseAllowed(store, act, ask)
    | Hear(ask) => hearAllowed(store, act, ask)
    | AnswerQuestion(ask) => answerQuestionAllowed(store, act, ask)
    | Report(result) => reportAllowed(store, act, result)
    | Review(judgement) => reviewAllowed(store, act, judgement)
    | Respond(decision) => decideAllowed(store, act, decision)
    | Reassign => reassignAllowed(store, act)
    | TopDone => topDoneAllowed(store, act)
    | Resume(resume) => resumeAllowed(store, act, resume.maker)
    | ReadBrief(read) => readAllowed(store, act, read.maker)
    | Evaluate(evaluation) => evaluateAllowed(store, act, evaluation)
    | Advance(advance) => advanceAllowed(store, act, advance.fix)
    | WriteRule(draft) => writeRuleAllowed(store, act, draft)
    | RunTest(testRun) => runTestAllowed(store, act, testRun)
    | Ship(shipment) => shipAllowed(store, act, shipment)
    | LoopReview(loop) => loopAllowed(store, act, loop)
    | RecheckDone(recheck) => recheckAllowed(store, act, recheck)
    | RunRule(rule) => runRuleAllowed(store, act, rule.task)
    | Revive(revive) => reviveAllowed(store, act, revive.actor)
    | Exit(exit) => exitAllowed(store, act, exit.actor)
  }
  def accept(store: Store, act: Act): bool =
    (not(store.top.ended) or act.who == Harness) and epochOk(store, act)
      and allowed(store, act) and not(OPTIONS.build and act.old)
  def effect(store: Store, act: Act): Store = match act.body {
    | EndProject => endEffect(store, act)
    | MoveHost => moveEffect(store, act)
    | Open(ask) => openEffect(store, act, ask)
    | AskEdit(edit) => editEffect(store, act, edit)
    | AskRaise(ask) => askRaiseEffect(store, act, ask)
    | Hear(ask) => hearEffect(store, act, ask)
    | AnswerQuestion(ask) => answerQuestionEffect(store, act, ask)
    | Report(result) => reportEffect(store, act, result)
    | Review(judgement) => reviewEffect(store, act, judgement)
    | Respond(decision) => decideEffect(store, act, decision)
    | Reassign => reassignEffect(store, act)
    | TopDone => topDoneEffect(store, act)
    | Resume(resume) => resumeEffect(store, act, resume.maker)
    | ReadBrief(read) => readEffect(store, act, read.maker)
    | Evaluate(evaluation) => evaluateEffect(store, act, evaluation)
    | Advance(advance) => advanceEffect(store, act, advance.fix)
    | WriteRule(draft) => writeRuleEffect(store, act, draft)
    | RunTest(testRun) => runTestEffect(store, act, testRun)
    | Ship(shipment) => shipEffect(store, act, shipment)
    | LoopReview(loop) => loopEffect(store, act, loop)
    | RecheckDone(recheck) => recheckEffect(store, act, recheck)
    | RunRule(rule) => runRuleEffect(store, act, rule.task)
    | Revive(revive) => reviveEffect(store, act, revive.actor)
    | Exit(exit) => exitEffect(store, act, exit.actor)
  }
  // Every taken act: an act of an older epoch of its actor is a split brain. An answerer
  // that answered a question alternates it with a step of its own (justAnswered).
  def take(store: Store, act: Act): Store =
    val marked = mark(store, ghost => { ...ghost,
      oldEpoch: ghost.oldEpoch or (hasEpoch(act.who) and act.epoch < epochOf(store, act.who)) })
    val taken = sweep(effect(marked, act))
    match act.body {
      | AnswerQuestion(ask) => { ...taken, justAnswered: taken.justAnswered.union(Set(ask.to)) }
      // any other act: its actor has taken a step of its own
      | _ => { ...taken, justAnswered: taken.justAnswered.exclude(Set(act.who)) }
    }
  // The asks follow the state. The store keeps the pipeline's asks with the fix's stage: an
  // Execute to the pipeline role while the fix is in its stages or at the person, a Decide
  // while it waits for the person (a change that sends a draft back withdraws it).
  def sweep(store: Store): Store =
    val dead = store.asks.filter(ask =>
      (ask.kind == Execute and ask.to == Pipe
        and not(pipeStage(fixOf(store, ask.about).stage)
                or fixOf(store, ask.about).stage == AtPerson))
      or (ask.kind == Decide and fixOf(store, ask.about).stage != AtPerson))
    val drafts = FIXIDS.filter(fixId => fixOf(store, fixId).stage == AtPerson)
      .map(fixId => decideOf(fixId))
    { ...store, asks: store.asks.exclude(dead).union(drafts) }
  // The revision (or none) an act of this body names as its basis: what its sender saw.
  def basisOf(store: Store, body: Body): int = match body {
    | Open(ask) => openBasis(store, ask)
    | Report(result) => reportBasis(store, result)
    | Review(judgement) => reviewBasis(store, judgement)
    | Respond(decision) => decideBasis(store, decision)
    | Evaluate(evaluation) => fixOf(store, evaluation.fix).basisStep
    | Advance(advance) => fixOf(store, advance.fix).basisStep
    | WriteRule(draft) => fixOf(store, draft.fix).basisStep
    | RunTest(testRun) => fixOf(store, testRun.fix).basisStep
    | Ship(shipment) => fixOf(store, shipment.fix).basisStep
    | LoopReview(loop) => fixOf(store, loop.fix).basisStep
    | RecheckDone(recheck) => taskOf(store, recheck.task).resultId
    | EndProject => NONE
    | MoveHost => NONE
    | AskEdit(_) => NONE
    | AskRaise(_) => NONE
    | Hear(_) => NONE
    | AnswerQuestion(_) => NONE
    | Reassign => NONE
    | TopDone => NONE
    | Resume(_) => NONE
    | ReadBrief(_) => NONE
    | Revive(_) => NONE
    | Exit(_) => NONE
    | RunRule(_) => NONE
  }
  // Acts that also name the item versions their sender saw (the others name only a revision).
  def versioned(body: Body): bool = match body {
    | Report(_) => true | Review(_) => true | Evaluate(_) => true
    | _ => false }   // the default is the rule: only these three
  // Is the basis of the act the current one (the part of allowed that reads the basis)?
  def basisCurrent(store: Store, act: Act): bool =
    basisOk(store, act, basisOf(store, act.body), versioned(act.body))
  // An act as its sender builds it on the current store: its basis is current.
  def actAs(store: Store, who: Actor, body: Body): Act =
    { who: who, epoch: epochOf(store, who), seen: basisOf(store, body),
      seenVersions: versionSum(store), old: false, byzantine: false, hadContext: true, body: body }

  // ==== told: the steps each actor's wait prints, from the store alone
  // What an actor is told: its own steps (ownToldSteps) and the questions it owes an answer; while
  // it has just answered a question and has a step of its own, only the own steps. A told
  // step names the act; its content (a verdict, a level) is the sender's, here a neutral one.
  def toldSteps(store: Store, actor: Actor): Set[Body] =
    if (store.top.ended) Set() else
    val own = ownToldSteps(store, actor)
    if (store.justAnswered.contains(actor) and own != Set()) own
    else own.union(answerQuestionTold(store, actor))
  def ownToldSteps(store: Store, actor: Actor): Set[Body] =
    if (store.top.ended) Set() else
    openTold(store, actor).union(hearTold(store, actor)).union(readTold(store, actor))
      .union(reportTold(store, actor)).union(resumeTold(store, actor))
      .union(reviewTold(store, actor)).union(evaluateTold(store, actor))
      .union(advanceTold(store, actor)).union(writeRuleTold(store, actor))
      .union(runTestTold(store, actor)).union(shipTold(store, actor))
      .union(loopTold(store, actor)).union(decideTold(store, actor))
      .union(reassignTold(store, actor)).union(topDoneTold(store, actor))
      .union(recheckTold(store, actor)).union(runRuleTold(store, actor))
      .union(reviveTold(store, actor)).union(endTold(store, actor))
  def actorsOf(store: Store): Set[Actor] =
    Set(Human, Harness).union(PERSISTENT).union(store.makers.keys())

  // ==== the asks follow the state, and who waits for whom
  // The asks the state implies; a raise to the pipeline role is named by its about only
  // (asksMatchState checks its asker).
  def asksOfState(store: Store): Set[Ask] =
    val host = SLOTS.filter(slot => taskOf(store, slot).state != Unsent
                                    and taskOf(store, slot).state != Done)
      .map(slot => executeAsk(Host, Role, slot))
    val makes = SLOTS.filter(slot => taskOf(store, slot).state == Working
                                     and taskOf(store, slot).maker != NoOne)
      .map(slot => executeAsk(Role, taskOf(store, slot).maker, slot))
    val checks = SLOTS.filter(slot => taskOf(store, slot).state == InReview
                                      and taskOf(store, slot).maker != NoOne)
      .map(slot => checkOf(taskOf(store, slot).maker, slot))
    val raises = FIXIDS.filter(fixId => pipeStage(fixOf(store, fixId).stage)
                                        or fixOf(store, fixId).stage == AtPerson)
      .map(fixId => executeAsk(Role, Pipe, fixId))
    val drafts = FIXIDS.filter(fixId => fixOf(store, fixId).stage == AtPerson)
      .map(fixId => decideOf(fixId))
    host.union(makes).union(checks).union(raises).union(drafts)
  // The open protocol asks are those the state implies. A raise to the pipeline role is the
  // person's (a reject, the edit: the edit only) or the role's (a slot's).
  def asksMatchState(store: Store): bool =
    val open = store.asks.filter(ask => ask.kind != Question
      and not(OPTIONS.makerAsks and ask.kind == Execute and isMakerActor(ask.from)))
    val want = asksOfState(store)
    open.filter(ask => ask.to != Pipe) == want.filter(ask => ask.to != Pipe)
      and open.filter(ask => ask.to == Pipe).map(ask => ask.about)
          == want.filter(ask => ask.to == Pipe).map(ask => ask.about)
      and open.filter(ask => ask.to == Pipe).forall(ask =>
            ask.from == Human or (ask.from == Role and not(free(ask.about))))
  // An asker waits for its open Execute, Check and Decide asks, never for a question; the
  // person is not event-driven and never waits. The edges go from parent to child in the
  // protocol's order: host -> role (the task), role -> maker (make it), maker -> role (the
  // check of its result), role or pipeline role -> pipeline role (a raise), pipeline role ->
  // person (the draft); never the reverse at once.
  def waitsFor(store: Store): Set[(Actor, Actor)] =
    store.asks.filter(ask => ask.kind != Question and ask.from != Human)
      .map(ask => (ask.from, ask.to))
  def waitStep(store: Store, reach: Set[(Actor, Actor)]): Set[(Actor, Actor)] =
    reach.fold(reach, (soFar, edge) =>
      soFar.union(waitsFor(store).filter(onward => onward._1 == edge._2)
                  .map(onward => (edge._1, onward._2))))
  def waitClosure(store: Store): Set[(Actor, Actor)] =
    1.to(actorsOf(store).size()).fold(waitsFor(store), (soFar, _) => waitStep(store, soFar))

  // ==== obligations: what must happen next, from the protocol's state alone
  // An open ask is a step owed by its `to`, the innermost open ask of a subject (its `about`)
  // first: a Decide over a Check over an Execute (to the role, a maker or the pipeline role)
  // over the host's Execute, which waits for them. So an actor is owed exactly the ask it can
  // act on now. A task not yet sent is the host's SendOb.
  type Obligation = EndOb | TopDoneOb | SendOb(int) | AskOb(Ask) | ResumeOb(Actor) | PipeOb(int)
          | ReassignOb | ReviveOb(Actor) | RecheckOb(int) | RuleRunOb(int) | HearOb(Ask)
  def depthOf(ask: Ask): int =
    if (ask.kind == Decide) 3 else if (ask.kind == Check) 2 else if (ask.from == Host) 0 else 1
  def innermost(store: Store, ask: Ask): bool =
    not(store.asks.exists(other => other.kind != Question and other.about == ask.about
                                   and depthOf(other) > depthOf(ask)))
  def askObs(store: Store, ask: Ask): Set[Obligation] =
    if (ask.kind == Question) Set(AskOb(ask))
    else if (not(innermost(store, ask))) Set()
    else if (ask.kind == Execute and isMakerActor(ask.from)) Set()   // the mutant's: no step
    // The host's Execute, with the pipeline done (the fix accepted): the host's Reassign.
    else if (depthOf(ask) == 0 and taskOf(store, ask.about).state != Sent) Set()
    else if (ask.to == Pipe)
      (if (pipeStage(fixOf(store, ask.about).stage)) Set(PipeOb(ask.about)) else Set())
    else if (ask.kind == Execute and isMakerActor(ask.to) and store.down.contains(ask.to))
      Set(ResumeOb(ask.to))
    else Set(AskOb(ask))
  def slotObs(store: Store, slot: int): Set[Obligation] =
    val task = taskOf(store, slot)
    if (task.state == Unsent) Set(SendOb(slot))
    else if (task.state == Done)
      (if (recheckDue(store, slot)) Set(RecheckOb(slot)) else Set())
        .union(if (runRuleDue(store, slot)) Set(RuleRunOb(slot)) else Set())
    else Set()
  // Every branch owes rechecks, the pipeline and revives (the host and roles live as long as
  // the project).
  def obligationsOf(store: Store): Set[Obligation] =
    if (store.top.ended) Set() else
    val revive = PERSISTENT.filter(process => store.down.contains(process))
      .map(process => ReviveOb(process))
    val top = if (allDone(store)) Set(if (store.top.done) EndOb else TopDoneOb) else Set()
    val reassign = if (FIXIDS.exists(fixId => fixOf(store, fixId).stage == Accepted))
                     Set(ReassignOb) else Set()
    val asked = store.asks.fold(Set(), (soFar, ask) => soFar.union(askObs(store, ask)))
    val heard = store.answered.map(ask => HearOb(ask))
    SLOTS.fold(revive.union(top).union(reassign).union(asked).union(heard),
               (soFar, slot) => soFar.union(slotObs(store, slot)))
  // The ask a step closes: an answer of its kind (the default is the rule: no other act
  // answers an ask).
  def answersAsk(body: Body, ask: Ask): bool = match body {
    | AnswerQuestion(other) => other == ask
    | Report(result) => result.ask == ask
    | Review(judgement) => judgement.ask == ask
    | Respond(decision) => decision.ask == ask
    | _ => false
  }
  // The fix a pipeline role's step is about (the default is the rule: no other act has one).
  def stepFix(body: Body): int = match body {
    | Evaluate(evaluation) => evaluation.fix
    | Advance(advance) => advance.fix
    | WriteRule(draft) => draft.fix
    | RunTest(testRun) => testRun.fix
    | Ship(shipment) => shipment.fix
    | LoopReview(loop) => loop.fix
    | _ => NONE
  }
  // Does `body`, done by `actor`, discharge the obligation? The defaults `_ => false` below
  // are the rule: a body discharges an obligation only by the acts named for it.
  def discharges(obligation: Obligation, actor: Actor, body: Body): bool = match obligation {
    | EndOb => body == EndProject
    | TopDoneOb => body == TopDone
    | SendOb(slot) => body == Open(executeAsk(Host, Role, slot))
    | AskOb(ask) =>
        if (ask.kind == Execute and ask.from == Host)   // the role makes it: an Execute to a maker
          (match body { | Open(other) => other.kind == Execute and other.from == Role
                                        and other.about == ask.about
                        | _ => false })
        else if (ask.kind == Execute)
          actor == ask.to and (body == ReadBrief({ maker: ask.to }) or answersAsk(body, ask))
        else answersAsk(body, ask)
    | ResumeOb(maker) => body == Resume({ maker: maker })
    | PipeOb(fixId) => actor == Pipe and stepFix(body) == fixId
    | ReassignOb => body == Reassign
    | ReviveOb(process) => body == Revive({ actor: process })
    | RecheckOb(slot) => match body { | RecheckDone(recheck) => recheck.task == slot | _ => false }
    | RuleRunOb(slot) => match body { | RunRule(rule) => rule.task == slot | _ => false }
    | HearOb(ask) => body == Hear(ask)
  }
  // The person owes what is asked of the person (a question, a decide), the end, the host's
  // start again. The default is the rule: no other obligation is the person's.
  def isPersonOb(obligation: Obligation): bool = match obligation {
    | EndOb => true
    | ReviveOb(process) => process == Host
    | AskOb(ask) => ask.to == Human
    | _ => false
  }
  def toldAny(store: Store, obligation: Obligation): Set[Actor] =
    actorsOf(store).filter(actor =>
      toldSteps(store, actor).exists(body => discharges(obligation, actor, body)))
  // Final: the project ended, or what is owed is owed by the person only (a step of the host
  // whose exit is recorded waits for the person, who starts it again: Revive(Host)).
  def waitsOnPerson(store: Store, obligation: Obligation): bool =
    isPersonOb(obligation)
      or (store.down.contains(Host) and toldAny(store, obligation).contains(Host))
  def finalOf(store: Store): bool =
    store.top.ended or (obligationsOf(store) != Set()
                        and obligationsOf(store).forall(obligation =>
                              waitsOnPerson(store, obligation)))
  // The model's bound on agent changes, from the options: per task, sections - 1 splits
  // (strict scope) and then one standard change (its floor goes to direction, which reaches
  // the person; a split is below it). Past it is not a success.
  def changeBound: int = SLOTS.size() * OPTIONS.sections
  def pastBound(store: Store): bool = store.agentChanges > changeBound
}
