// The environment around the store of work.qnt (plan/model/DESIGN.md section 7). Each part is
// its own small state machine and may misbehave: the network of acts (a message soup), the
// terminals, the agents (honest or Byzantine), the web page, the person. README.md has the
// words, the options, and the properties with their tiers.
module workenv {
  const CFG: {
    c1Keep: bool, d7: int, basis: bool, build: bool, staleRedo: bool, rebase: bool,
    harnessTest: bool, classify: bool, passTests: bool, fullBrief: bool, idleSeen: bool,
    maxTries: int, maxMakers: int, maxChanges: int, budget: int, maxPts: int, maxLoops: int,
    maxRuleTries: int, maxRemakes: int,
  }
  // Faults. byz*: that agent is Byzantine within its own token (else honest). crash: terminals
  // die, detach, resume. page: the page shows old views and old builds. person: the person acts.
  // maxFaults bounds the terminal and network faults; maxNet the acts in flight; maxPerson the
  // person's acts.
  const ENV: {
    byzMaker: bool, byzRole: bool, byzPipe: bool, byzHost: bool, crash: bool, page: bool,
    person: bool, maxFaults: int, maxNet: int, maxPerson: int,
  }
  import work(OPT = CFG).* from "./work"

  // A terminal. up: its process runs. attached: the pump sees it (it reports the exit).
  // ctx: the process has the context of its work. stale: it was resumed with an old context
  // and may act once on that old view. idle: it stopped at its prompt without waiting.
  type Term = { up: bool, attached: bool, ctx: bool, stale: bool, idle: bool }
  // The page: the store as the page last showed it, and whether its build is old.
  type Page = { view: Store, oldBuild: bool, acts: int }
  type Event =
    | Start | Posted(Act) | Taken(Act) | Refused(Act) | TakenKept(Act)
    | Crashed(int) | Detached(int) | Reattached(int) | SelfResumed(int) | Stopped(int)
    | Woke(int) | PageRefreshed | PageDeployed | PageReloaded

  var s: Store            // the store: the one truth (an ordered log, kept as its fold)
  var net: Set[Act]       // acts sent and not yet appended or refused (unordered)
  var term: int -> Term   // a terminal per persistent role and per maker
  var page: Page
  var faults: int
  var noContext: bool     // history: a revision was worked by a maker with no context
  var lastEvent: Event    // for witnesses and traces
  // For model-based testing: each actor's Do steps, and what is owed, in every state.
  var told: int -> Set[What]
  var obligations: Set[Ob]

  pure val VERDICTS = Set(Pass, Fail, RaiseTries, RaiseNoRule, RaiseMisses)
  pure val LEVELS = Set(Split, Fit, Principle, Direct, Standard)
  pure val FORMS = Set(NoForm, Mech, Ref, Both)
  pure val BOOLS = Set(true, false)
  pure val FRESH: Term = { up: true, attached: true, ctx: true, stale: false, idle: false }

  // ---- reads
  def isByz(k: int): bool =
    if (k == HOST) ENV.byzHost else if (k == ROLE) ENV.byzRole
    else if (k == PIPE) ENV.byzPipe else k >= 3 and ENV.byzMaker
  def hasTerm(k: int): bool = term.keys().contains(k)
  def up(k: int): bool = hasTerm(k) and term.get(k).up
  // An actor hears its Do steps: the person (the page), the harness, and an agent whose
  // process runs and that the store does not hold as down.
  def hears(k: int): bool = k < 0 or (up(k) and not(s.down.contains(k)))
  def busy(k: int): bool = net.exists(a => a.who == k)
  // Every act the model knows, for Byzantine senders (the token check refuses foreign ones).
  def allWhats(st: Store): Set[What] =
    val perSlot = SLOTS.fold(Set(), (acc, i) => acc.union(Set(Reject(i), Accept(i), SendBack(i),
      Decide(i), SendTask(i), AssignDo(i), Review(i), Evaluate(i), Advance(i), WriteRule(i),
      RunTest(i), Ship(i), LoopReview(i))))
    val perMaker = st.makers.keys().fold(Set(), (acc, m) =>
      acc.union(Set(Resume(m), ReadBrief(m), Report(m), Exit(m))))
    Set(OpenTop, EndProject, Reassign, RemakeTop).union(perSlot).union(perMaker)
      .union(PERSISTENT.map(p => Revive(p)))
  // The person ends the project only once all is done (an earlier end stops the model).
  def personWhats: Set[What] = SLOTS.fold(Set(OpenTop).union(
      if (allDone(s)) Set(EndProject) else Set()), (acc, i) =>
    acc.union(Set(Reject(i), Accept(i), SendBack(i), Decide(i))))
  def mkAct(k: int, x: What, seen: int, old: bool, v: Verdict, p: int, l: Level, f: bool,
            fm: Form): Act =
    { who: k, what: x, seen: seen, old: old, v: v, pts: p, level: l, flag: f, form: fm }
  // An honest agent's content: it runs the test command and reports what it printed; it
  // labels a draft by what the draft changes. Its other choices (verdicts, levels, the
  // result's quality) are free: progress must not need a kind reviewer.
  def honestContent(st: Store, a: Act): bool = match a.what {
    | RunTest(i) => a.flag == fx(st, i).truth
    | Ship(i) => a.flag == fx(st, i).std
    | _ => true
  }

  // ---- obligations and told (the told-once tier)
  def toldTo(ob: Ob): Set[int] = toldAny(s, ob).filter(k => hears(k))
  // A legal wait: the one actor told is a process that is down, and the engine owes the next
  // move: the pump reports its exit (not yet in the store), or the harness revives it.
  def waitsLegally(ob: Ob): bool =
    val t = toldAny(s, ob)
    t.size() == 1 and t.forall(k => k >= 0 and not(hears(k))
      and ((not(up(k)) and not(s.down.contains(k))) or PERSISTENT.contains(k)))
  // A told step can be done: some content of it, sent now on the current view, is taken.
  def doable(k: int, x: What): bool =
    VERDICTS.exists(v => 0.to(CFG.maxPts).exists(p => FORMS.exists(fm => BOOLS.exists(f =>
      LEVELS.exists(l => accept(s, mkAct(k, x, cur(s, x), false, v, p, l, f, fm)))))))

  // ---- the commit of a step: every variable, and the derived ones
  action commit(ns: Store, nn: Set[Act], nt: int -> Term, np: Page, nf: int, nc: bool,
                ev: Event): bool = all {
    s' = ns, net' = nn, term' = nt, page' = np, faults' = nf, noContext' = nc,
    lastEvent' = ev, told' = toldOf(ns), obligations' = obligationsOf(ns),
  }
  action init = all {
    s' = initStore, net' = Set(), term' = PERSISTENT.mapBy(k => FRESH),
    page' = { view: initStore, oldBuild: false, acts: 0 }, faults' = 0, noContext' = false,
    lastEvent' = Start, told' = toldOf(initStore), obligations' = obligationsOf(initStore),
  }

  // ---- agents
  // An honest agent sends one step it is told, on the current view, with honest content, and
  // only when its last act was answered (the CLI call is synchronous).
  action honestSends(k: int): bool = all {
    not(isByz(k)), hears(k), not(term.get(k).idle), not(busy(k)), net.size() < ENV.maxNet,
    nondet x = dos(s, k).oneOf()
    nondet v = VERDICTS.oneOf()
    nondet p = 1.to(CFG.maxPts).oneOf()
    nondet l = LEVELS.oneOf()
    nondet f = BOOLS.oneOf()
    nondet fm = FORMS.oneOf()
    val a = mkAct(k, x, cur(s, x), false, v, p, l, f, fm)
    all { accept(s, a), honestContent(s, a),
          commit(s, net.union(Set(a)), term, page, faults, noContext, Posted(a)) },
  }
  // A process resumed with an old context acts once on it: an act of its own, on an old view.
  action staleSends(k: int): bool = all {
    hasTerm(k), term.get(k).stale, up(k), net.size() < ENV.maxNet,
    nondet x = allWhats(s).filter(y => authority(mkAct(k, y, 0, false, Pass, 1, Fit, true,
      Ref))).oneOf()
    nondet v = VERDICTS.oneOf()
    nondet f = BOOLS.oneOf()
    nondet fm = FORMS.oneOf()
    nondet l = LEVELS.oneOf()
    val a = mkAct(k, x, cur(s, x) - 1, false, v, 1, l, f, fm)
    commit(s, net.union(Set(a)), term.setBy(k, t => { ...t, stale: false }), page, faults,
           noContext, Posted(a)),
  }
  // A Byzantine agent: any act with its own token, any content, built on any view, at any
  // time its process runs. It cannot forge another actor's token.
  action byzSends(k: int): bool = all {
    isByz(k), up(k), net.size() < ENV.maxNet,
    nondet x = allWhats(s).oneOf()
    nondet seen = Set(cur(s, x) - 1, cur(s, x), cur(s, x) + 1).oneOf()
    nondet v = VERDICTS.oneOf()
    nondet p = 0.to(CFG.maxPts).oneOf()
    nondet l = LEVELS.oneOf()
    nondet f = BOOLS.oneOf()
    nondet fm = FORMS.oneOf()
    val a = mkAct(k, x, seen, false, v, p, l, f, fm)
    commit(s, net.union(Set(a)), term, page, faults, noContext, Posted(a)),
  }
  // A Byzantine agent stops at its prompt without waiting, and may go on later.
  action byzStops(k: int): bool = all {
    isByz(k), up(k), not(term.get(k).idle),
    commit(s, net, term.setBy(k, t => { ...t, idle: true }), page, faults, noContext, Stopped(k)),
  }
  action byzWakes(k: int): bool = all {
    isByz(k), up(k), term.get(k).idle,
    commit(s, net, term.setBy(k, t => { ...t, idle: false }), page, faults, noContext, Woke(k)),
  }
  // The harness (the watcher): honest; it sends the revive of a persistent role it is told.
  action harnessSends: bool = all {
    not(busy(HARNESS)), net.size() < ENV.maxNet,
    nondet x = dos(s, HARNESS).oneOf()
    val a = mkAct(HARNESS, x, cur(s, x), false, Pass, 1, Fit, true, Ref)
    all { accept(s, a), commit(s, net.union(Set(a)), term, page, faults, noContext, Posted(a)) },
  }

  // ---- the person, through the page: any person act, at any time, built on the page's view
  action personSends: bool = all {
    ENV.person, page.acts < ENV.maxPerson, net.size() < ENV.maxNet,
    nondet x = personWhats.oneOf()
    val a = mkAct(PERSON, x, cur(page.view, x), page.oldBuild, Pass, 1, Fit, true, Ref)
    commit(s, net.union(Set(a)), term, { ...page, acts: page.acts + 1 }, faults, noContext,
           Posted(a)),
  }
  // The person mostly clicks what the page shows (its told items on the page's view).
  action personClicks: bool = all {
    ENV.person, page.acts < ENV.maxPerson, net.size() < ENV.maxNet,
    nondet x = dos(page.view, PERSON).oneOf()
    val a = mkAct(PERSON, x, cur(page.view, x), page.oldBuild, Pass, 1, Fit, true, Ref)
    commit(s, net.union(Set(a)), term, { ...page, acts: page.acts + 1 }, faults, noContext,
           Posted(a)),
  }
  action pageRefreshes: bool =
    commit(s, net, term, { ...page, view: s }, faults, noContext, PageRefreshed)
  // A new build is deployed; the open page keeps the old one until it reloads.
  action pageDeploys: bool = all {
    ENV.page, not(page.oldBuild),
    commit(s, net, term, { ...page, oldBuild: true }, faults, noContext, PageDeployed),
  }
  action pageReloads: bool = all {
    page.oldBuild,
    commit(s, net, term, { ...page, view: s, oldBuild: false }, faults, noContext, PageReloaded),
  }

  // ---- the store appends an act in flight, or refuses it. The terminal follows the store:
  // a new maker gets a fresh terminal; a resume or revive starts the process again, with or
  // without its context (with it, the context may be old).
  def termAfter(a: Act, ctx: bool): int -> Term = match a.what {
    | AssignDo(_) => term.put(s.nextMaker, FRESH)
    | Resume(m) => term.put(m, { ...FRESH, ctx: ctx, stale: ctx })
    | Revive(k) => term.put(k, { ...FRESH, ctx: ctx, stale: ctx })
    | Exit(k) => if (hasTerm(k) and term.get(k).idle)
        term.setBy(k, t => { ...t, up: false, idle: false }) else term
    | _ => term
  }
  // A maker works a revision without its context, and the revision does not carry it all.
  def lostContext(a: Act): bool = match a.what {
    | Report(m) => isMaker(s, m) and mk(s, m).revs > 0 and hasTerm(m)
        and not(term.get(m).ctx) and not(CFG.fullBrief)
    | _ => false
  }
  action storeTakes: bool = {
    nondet a = net.oneOf()
    nondet ctx = BOOLS.oneOf()
    all { accept(s, a),
          commit(effect(s, a), net.exclude(Set(a)), termAfter(a, ctx), page, faults,
                 noContext or lostContext(a), Taken(a)) }
  }
  action storeRefuses: bool = {
    nondet a = net.oneOf()
    all { not(accept(s, a)),
          commit(s, net.exclude(Set(a)), term, page, faults, noContext, Refused(a)) }
  }
  // The network delivers an act and keeps a copy that will arrive again (a double send).
  action storeTakesKept: bool = all {
    faults < ENV.maxFaults,
    nondet a = net.oneOf()
    nondet ctx = BOOLS.oneOf()
    all { accept(s, a),
          commit(effect(s, a), net, termAfter(a, ctx), page, faults + 1,
                 noContext or lostContext(a), TakenKept(a)) },
  }

  // ---- terminals
  action crashes(k: int): bool = all {
    ENV.crash, faults < ENV.maxFaults, up(k),
    commit(s, net, term.setBy(k, t => { ...t, up: false, idle: false }), page, faults + 1,
           noContext, Crashed(k)),
  }
  action detaches(k: int): bool = all {
    ENV.crash, faults < ENV.maxFaults, hasTerm(k), term.get(k).attached,
    commit(s, net, term.setBy(k, t => { ...t, attached: false }), page, faults + 1, noContext,
           Detached(k)),
  }
  action reattaches(k: int): bool = all {
    hasTerm(k), not(term.get(k).attached),
    commit(s, net, term.setBy(k, t => { ...t, attached: true }), page, faults, noContext,
           Reattached(k)),
  }
  // A terminal resumes by itself (not by the store): the process runs again with its token.
  action selfResumes(k: int): bool = all {
    ENV.crash, faults < ENV.maxFaults, hasTerm(k), not(up(k)),
    nondet ctx = BOOLS.oneOf()
    commit(s, net, term.setBy(k, t => { ...t, up: true, ctx: ctx, stale: ctx }), page,
           faults + 1, noContext, SelfResumed(k)),
  }
  // The pump reports a process that ended (or, with idleSeen, stopped at its prompt).
  action pumpSendsExit(k: int): bool = all {
    hasTerm(k), term.get(k).attached, not(s.down.contains(k)), not(busy(HARNESS)),
    not(up(k)) or (CFG.idleSeen and term.get(k).idle), net.size() < ENV.maxNet,
    val a = mkAct(HARNESS, Exit(k), -1, false, Pass, 1, Fit, true, Ref)
    commit(s, net.union(Set(a)), term, page, faults, noContext, Posted(a)),
  }

  action agentStep: bool = {
    nondet k = term.keys().oneOf()
    any { honestSends(k), staleSends(k), byzSends(k), byzStops(k), byzWakes(k) }
  }
  action termStep: bool = {
    nondet k = term.keys().oneOf()
    any { crashes(k), detaches(k), reattaches(k), selfResumes(k), pumpSendsExit(k) }
  }
  action step = any {
    agentStep, harnessSends, personSends, personClicks, pageRefreshes, pageDeploys, pageReloads,
    storeTakes, storeRefuses, storeTakesKept, termStep,
  }

  // ==== Properties. Tier 1: safety under Byzantine agents and a faulty environment.
  // Each is an impossible state of the store; none may ever be reached.
  val DoneIsClosed: bool = SLOTS.forall(i => tk(s, i).st == Done implies
    (fx(s, i).stage == SClosed and liveMaker(s, i) < 0))
  val OneMakerPerTask: bool = SLOTS.forall(i =>
    s.makers.keys().filter(m => mk(s, m).slot == i and not(mk(s, m).ended)).size() <= 1)
  val MakerOnlyWhileWorking: bool = SLOTS.forall(i =>
    (liveMaker(s, i) >= 0) iff (tk(s, i).st == Working or tk(s, i).st == InReview))
  val NoOrphanMaker: bool = s.makers.keys().forall(m => not(mk(s, m).ended) implies
    tk(s, mk(s, m).slot).maker == m)
  val ClaimOnlyLive: bool = s.makers.keys().forall(m => mk(s, m).claim implies
    (not(mk(s, m).ended) and not(s.down.contains(m))))
  val RaiseHasOwner: bool = SLOTS.forall(i => (tk(s, i).st == Raised) iff (fx(s, i).stage != SClosed))
  val TopHasOwner: bool = s.top.ended or s.top.hosted or dos(s, PERSON).contains(OpenTop)
  val NoActByEnded: bool = not(s.g.endedActed)
  val NoReviewOfOtherResult: bool = not(s.g.otherResult)
  val NoPassUnderOtherVersion: bool = not(s.g.otherVersion)
  val NoStaleReport: bool = not(s.g.staleReport)
  val NoUnseenReject: bool = not(s.g.unseenReject)
  val NoUnseenAccept: bool = not(s.g.unseenAccept)
  val NoRejectedDraftInEffect: bool = not(s.g.rejectedInEffect)
  val NoLostUpdate: bool = not(s.g.lostUpdate)
  val NoFailedTestInEffect: bool = not(s.g.failedTest)
  val EveryRuleHasForm: bool = not(s.g.noForm)
  val NoDeepChangeWithoutPerson: bool = not(s.g.deepNoPerson)
  val NoPassOfBrokenResult: bool = not(s.g.passBroken)
  val NoStalePipelineAct: bool = not(s.g.staleFix)
  val RevisionHasContext: bool = not(noContext)
  // D7 budget: changes stop at the budget (past it a raise is the person's).
  val ChangesWithinBudget: bool = CFG.d7 != 1 or s.changes <= CFG.budget
  val Safe: bool = DoneIsClosed and OneMakerPerTask and MakerOnlyWhileWorking and NoOrphanMaker
    and ClaimOnlyLive and RaiseHasOwner and TopHasOwner and NoActByEnded
    and NoReviewOfOtherResult and NoPassUnderOtherVersion and NoStaleReport and NoUnseenReject
    and NoUnseenAccept and NoRejectedDraftInEffect and NoLostUpdate and NoFailedTestInEffect
    and EveryRuleHasForm and NoDeepChangeWithoutPerson and NoPassOfBrokenResult
    and NoStalePipelineAct and RevisionHasContext and ChangesWithinBudget

  // ==== Tier 2: told once (the told function; it matters for honest actors).
  val EveryObligationToldOnce: bool =
    obligationsOf(s).forall(ob => waitsLegally(ob) or toldTo(ob).size() == 1)
  val ToldIsAllowed: bool = actorsOf(s).forall(k => dos(s, k).forall(x => doable(k, x)))
  val SomethingOwed: bool = s.top.ended or obligationsOf(s) != Set()
  val Recorded: bool = told == toldOf(s) and obligations == obligationsOf(s)
  val Told: bool = EveryObligationToldOnce and ToldIsAllowed and SomethingOwed and Recorded

  // ==== Tier 3: progress. Fair: an honest agent does what it is told; the store answers
  // every act in flight; the pump reports exits; a detached terminal is attached again; the
  // harness revives. Byzantine agents and the person are not fair.
  val FinalOrBound: bool = finalOf(s) or pastBound(s)
  action honestMakerSends: bool = {
    nondet m = s.makers.keys().oneOf()
    honestSends(m)
  }
  action pumpStep: bool = { nondet k = term.keys().oneOf() pumpSendsExit(k) }
  action reattachStep: bool = { nondet k = term.keys().oneOf() reattaches(k) }
  action deliver: bool = any { storeTakes, storeRefuses }
  temporal Fairness = all {
    weakFair(honestSends(HOST), (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(honestSends(ROLE), (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(honestSends(PIPE), (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(honestMakerSends, (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(harnessSends, (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(deliver, (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(pumpStep, (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
    weakFair(reattachStep, (s, net, term, page, faults, noContext, lastEvent, told, obligations)),
  }
  temporal Progress = always(eventually(FinalOrBound))
  temporal FairProgress = Fairness implies Progress

  // ==== Witnesses: one per action (reached in > 0 traces with --witnesses).
  def taken(p: What => bool): bool = match lastEvent {
    | Taken(a) => p(a.what)
    | TakenKept(a) => p(a.what)
    | _ => false
  }
  val wOpenTop = taken(x => x == OpenTop) and s.top.remakes > 0
  val wEndProject = taken(x => x == EndProject)
  val wReject = taken(x => match x { | Reject(_) => true | _ => false })
  val wAccept = taken(x => match x { | Accept(_) => true | _ => false })
  val wSendBack = taken(x => match x { | SendBack(_) => true | _ => false })
  val wDecide = taken(x => match x { | Decide(_) => true | _ => false })
  val wSendTask = taken(x => match x { | SendTask(_) => true | _ => false })
  val wReassign = taken(x => x == Reassign)
  val wRemakeTop = taken(x => x == RemakeTop) and s.top.remakes > 0
  val wAssignDo = taken(x => match x { | AssignDo(_) => true | _ => false })
  val wReviewPass = taken(x => match x { | Review(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).st == Done)
  val wRevision = taken(x => match x { | Review(_) => true | _ => false })
    and s.makers.keys().exists(m => mk(s, m).revs > 0)
  val wRaise = taken(x => match x { | Review(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).st == Raised)
  val wResume = taken(x => match x { | Resume(_) => true | _ => false })
  val wReadBrief = taken(x => match x { | ReadBrief(_) => true | _ => false })
  val wReport = taken(x => match x { | Report(_) => true | _ => false })
  val wEvaluate = taken(x => match x { | Evaluate(_) => true | _ => false })
  val wSplit = taken(x => match x { | Evaluate(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).gen > 0)
  val wAdvance = taken(x => match x { | Advance(_) => true | _ => false })
  val wWriteRule = taken(x => match x { | WriteRule(_) => true | _ => false })
  val wRunTest = taken(x => match x { | RunTest(_) => true | _ => false })
  val wShipStandard = taken(x => match x { | Ship(_) => true | _ => false }) and s.dir > 0
  val wLoopReview = taken(x => match x { | LoopReview(_) => true | _ => false })
  val wRevive = taken(x => match x { | Revive(_) => true | _ => false })
  val wExit = taken(x => match x { | Exit(_) => true | _ => false })
  val wCardChange = s.card > 0
  val wRefused = match lastEvent { | Refused(_) => true | _ => false }
  val wTakenKept = match lastEvent { | TakenKept(_) => true | _ => false }
  val wSent = match lastEvent { | Posted(_) => true | _ => false }
  val wStaleSent = match lastEvent { | Posted(a) => a.who >= 0 and a.seen < cur(s, a.what)
                                      | _ => false }
  val wCrash = match lastEvent { | Crashed(_) => true | _ => false }
  val wDetach = match lastEvent { | Detached(_) => true | _ => false }
  val wReattach = match lastEvent { | Reattached(_) => true | _ => false }
  val wSelfResume = match lastEvent { | SelfResumed(_) => true | _ => false }
  val wStop = match lastEvent { | Stopped(_) => true | _ => false }
  val wWake = match lastEvent { | Woke(_) => true | _ => false }
  val wPageRefresh = match lastEvent { | PageRefreshed => true | _ => false }
  val wPageDeploy = match lastEvent { | PageDeployed => true | _ => false }
  val wPageReload = match lastEvent { | PageReloaded => true | _ => false }
  val wFinal = finalOf(s) and not(s.top.ended)
  // To see a trace to a witness: run its negation as an invariant.
  val notFinal = not(wFinal)
}

// ---- Instances. "design": DESIGN.md as written (every unstated check off), C1 a, no D7.
// "fixed": every proposed check on, C1 a, D7 budget. Faults: everything on.
module design {
  import workenv(
    CFG = { c1Keep: false, d7: 0, basis: false, build: false, staleRedo: false, rebase: false,
      harnessTest: false, classify: false, passTests: false, fullBrief: false, idleSeen: false,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: true, byzRole: true, byzPipe: true, byzHost: true, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
module designHonest {
  import workenv(
    CFG = { c1Keep: false, d7: 0, basis: false, build: false, staleRedo: false, rebase: false,
      harnessTest: false, classify: false, passTests: false, fullBrief: false, idleSeen: false,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: false, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
module fixed {
  import workenv(
    CFG = { c1Keep: false, d7: 1, basis: true, build: true, staleRedo: true, rebase: true,
      harnessTest: true, classify: true, passTests: true, fullBrief: true, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: true, byzRole: true, byzPipe: true, byzHost: true, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
module fixedHonest {
  import workenv(
    CFG = { c1Keep: false, d7: 1, basis: true, build: true, staleRedo: true, rebase: true,
      harnessTest: true, classify: true, passTests: true, fullBrief: true, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: false, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
// The open options on the fixed checks: C1 b (the host keeps hosting), D7 shrink, D7 none.
module c1b {
  import workenv(
    CFG = { c1Keep: true, d7: 1, basis: true, build: true, staleRedo: true, rebase: true,
      harnessTest: true, classify: true, passTests: true, fullBrief: true, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: true, byzRole: true, byzPipe: true, byzHost: true, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
module d7shrink {
  import workenv(
    CFG = { c1Keep: false, d7: 2, basis: true, build: true, staleRedo: true, rebase: true,
      harnessTest: true, classify: true, passTests: true, fullBrief: true, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: true, byzRole: true, byzPipe: true, byzHost: true, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
module d7none {
  import workenv(
    CFG = { c1Keep: false, d7: 0, basis: true, build: true, staleRedo: true, rebase: true,
      harnessTest: true, classify: true, passTests: true, fullBrief: true, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: false, crash: true,
      page: true, person: true, maxFaults: 3, maxNet: 3, maxPerson: 4 }).*
}
// Witness coverage: honest role and pipeline (so the run goes deep), a Byzantine host and
// maker (so a remake of the top and a stop at the prompt happen), the design's checks off.
module witness {
  import workenv(
    CFG = { c1Keep: false, d7: 1, basis: false, build: false, staleRedo: false, rebase: false,
      harnessTest: false, classify: false, passTests: false, fullBrief: false, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: true, crash: true,
      page: true, person: true, maxFaults: 2, maxNet: 3, maxPerson: 40 }).*
}
// Witness coverage of the deep protocol (drafts at the person, reassign, card change): the
// same, with no terminal faults and no old builds, so random runs go deep.
module witnessCalm {
  import workenv(
    CFG = { c1Keep: false, d7: 1, basis: false, build: false, staleRedo: false, rebase: false,
      harnessTest: false, classify: false, passTests: false, fullBrief: false, idleSeen: true,
      maxTries: 2, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
      maxRuleTries: 1, maxRemakes: 1 },
    ENV = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: false, crash: false,
      page: false, person: true, maxFaults: 1, maxNet: 3, maxPerson: 40 }).*
}
