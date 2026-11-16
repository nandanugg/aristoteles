// The aristoteles protocol of one task (core/model/README.md).
// Goal (Nanda, 2026-11-16): stall-free by design. Every obligation is TOLD to exactly one actor
// that hears it; the run reaches Done or waits only on the person.
// Each FIX_ flag is one design change; false is the code before it.
module protocol {
  const FIX_PARENT_END: bool      // D4, 713b8a0: a subagent ends with its ended parent
  const FIX_START_READY: bool     // D4, 8462e5d: "start your subagent" is a Do of its parent
  const FIX_ESCALATE_ONCE: bool   // 4bbf1da (B6): a point escalated by anyone is not offered again
  const FIX_ACT_IS_LIFE: bool     // D5, 40ba4ac: a host that acted lately is not gone
  const FIX_BRIEF_VERSION: bool   // D4, 0a8a447: a stale brief is read again before a review
  const FIX_POINT_OWNER: bool     // D2: a point has one owner from its creation
  const FIX_EXIT_ENDS_CLAIM: bool // D6: any exit of a subagent ends its claim
  const SILENT: int
  const MAX_CLOCK: int
  const MAX_IDS: int
  const MAX_TRIES: int            // results a maker may report; then the person evaluates
  const MAX_GRANTS: int           // more tries the person may give in an evaluation
  const MAX_EXITS: int            // subagent exits with no counted act (environment)
  const MAX_DEATHS: int           // deaths of a persistent agent's process (environment)
  const MAX_QUESTIONS: int

  type Role = Lead | Maker | Checker
  type AState = Working | Ended
  type Assign = {
    role: Role,
    parent: int,          // 0 = the host gave it
    state: AState,
    alive: bool,          // its process runs
    brief: int,           // the directions version of the brief it read; -1 = none
    claim: bool,          // it read its brief and holds the work (a subagent)
    escalated: Set[int],  // the points this assignment escalated
  }
  type RState = NoResult | InReview | Accepted | Rejected
  // Fix: the maker's redo answers it. Direction: the director must change a direction.
  type PKind = Fix | Direction
  type Point = { kind: PKind, escalations: int, settled: bool, closed: bool }
  // A question of an agent: the host answers it, or forwards it to the person.
  type Question = { asker: int, toPerson: bool, open: bool }
  type Work = {
    assigns: int -> Assign,
    nextId: int,
    version: int,
    reopens: int,         // person's direction changes so far (bounded: 1)
    result: int,          // results so far
    rstate: RState,
    points: int -> Point, // a point per rejected result
    questions: int -> Question,
    grants: int,          // more tries the person gave
    exits: int,
    deaths: int,
    done: bool,
    blocked: bool,        // the task runs after another task that is open again (t4 after t3)
    needReopened: bool,   // the need opened again once (bounded, so TLC's model is finite)
    staleReview: bool,    // history: a review was made with a brief older than the directions
  }
  type Host = { waits: bool, beat: int, acted: int, gone: bool, falseGone: bool }
  type What =
    | AssignLead | AssignMaker | AssignChecker | StartSub(int)
    | ReadBrief | Report | Review | Escalate(int) | Resolve(int) | ReviseDirection(int)
    | Answer(int) | Forward(int) | Evaluate | Revive(int)
  // What must happen next, from the protocol's state alone (not from the steps).
  type Ob = NeedLead | NeedMaker | NeedChecker | Restart(int) | Make(int) | Check(int)
          | Settle(int) | Decide(int) | AnswerQ(int) | Evaluation | ReviveAgent(int)

  var w: Work
  var h: Host
  var clock: int
  // For model-based testing: each actor's Do steps, and what is owed, in every state.
  var told: int -> Set[What]
  var obligations: Set[Ob]

  pure val HOST = 0
  pure val PERSON = -1
  pure val WATCHER = -2   // the engine's watcher: it revives a persistent agent (P8)

  // ---- reads (each a function of a Work, so the next state's can be computed)
  def a(s: Work, k: int): Assign = s.assigns.get(k)
  def working(s: Work, r: Role): Set[int] =
    s.assigns.keys().filter(k => a(s, k).state == Working and a(s, k).role == r)
  def outOfTries(s: Work): bool = s.rstate == Rejected and s.result >= MAX_TRIES + s.grants
  def needsMaker(s: Work): bool = not(s.done) and not(outOfTries(s))
    and (s.rstate == NoResult or s.rstate == Rejected)
  def needsChecker(s: Work): bool = not(s.done) and s.rstate == InReview
  def pt(s: Work, p: int): Point = s.points.get(p)
  def openPoints(s: Work): Set[int] = s.points.keys().filter(p => not(pt(s, p).closed))
  def q(s: Work, i: int): Question = s.questions.get(i)
  def openQs(s: Work): Set[int] = s.questions.keys().filter(i => q(s, i).open)
  def asking(s: Work, k: int): bool = openQs(s).exists(i => q(s, i).asker == k)
  // An actor that can hear its steps: the host, the person (the page), the watcher, and an
  // assignment that works and whose process runs.
  def hears(s: Work, k: int): bool = k <= 0 or (a(s, k).state == Working and a(s, k).alive)
  def actors(s: Work): Set[int] = Set(HOST, PERSON, WATCHER).union(s.assigns.keys())
  def isSub(s: Work, k: int): bool = a(s, k).role != Lead

  // ---- can (core/derived/can.ts)
  def allowed(s: Work, k: int, x: What): bool = match x {
    | AssignLead => k == HOST and not(s.done) and working(s, Lead) == Set()
    | AssignMaker => k > 0 and a(s, k).role == Lead and needsMaker(s)
        and working(s, Maker) == Set()
    | AssignChecker => k > 0 and a(s, k).role == Lead and needsChecker(s)
        and working(s, Checker) == Set()
    // An open claim refuses a new process ("claimed by another subagent").
    | StartSub(c) => k > 0 and s.assigns.keys().contains(c) and a(s, c).parent == k
        and a(s, c).state == Working and not(a(s, c).alive) and not(a(s, c).claim)
    | ReadBrief => k > 0 and a(s, k).state == Working and not(asking(s, k))
    | Report => k > 0 and a(s, k).role == Maker and a(s, k).claim and needsMaker(s)
        and not(s.blocked) and not(asking(s, k))
    | Review => k > 0 and a(s, k).role == Checker and a(s, k).claim and needsChecker(s)
        and not(s.blocked) and not(asking(s, k))
        and (not(FIX_BRIEF_VERSION) or a(s, k).brief == s.version)
    | Escalate(p) => k > 0 and a(s, k).state == Working and openPoints(s).contains(p)
        and pt(s, p).escalations == 0
    | Resolve(p) => k == HOST and openPoints(s).contains(p) and pt(s, p).escalations > 0
        and not(pt(s, p).settled)
    | ReviseDirection(p) => k > 0 and a(s, k).state == Working and a(s, k).role == Lead
        and openPoints(s).contains(p) and pt(s, p).kind == Direction
    | Answer(i) => openQs(s).contains(i)
        and ((k == HOST and not(q(s, i).toPerson)) or (k == PERSON and q(s, i).toPerson))
    | Forward(i) => k == HOST and openQs(s).contains(i) and not(q(s, i).toPerson)
    | Evaluate => k == PERSON and not(s.done) and outOfTries(s)
    | Revive(l) => k == WATCHER and s.assigns.keys().contains(l) and a(s, l).role == Lead
        and a(s, l).state == Working and not(a(s, l).alive)
  }

  // ---- steps (core/derived/steps.ts): the Do steps each actor is TOLD by its wait
  // A child whose process ended: its parent is told to start it, unless its claim is open (the
  // parent waits for the claim's timer, today 10 minutes) or the start is a Wait (before 8462e5d).
  def startDos(s: Work, c: int): Set[What] =
    if (FIX_START_READY and not(a(s, c).claim)) Set(StartSub(c)) else Set()
  def escalateDos(s: Work, k: int): Set[What] =
    if (s.blocked) Set()   // a task that runs after another: its assignments only wait
    else openPoints(s)
      .filter(p => not(FIX_POINT_OWNER and pt(s, p).kind == Direction))
      .filter(p => not(FIX_POINT_OWNER) or a(s, k).role == Maker)   // the owner of a Fix point
      .filter(p => if (FIX_ESCALATE_ONCE) pt(s, p).escalations == 0
                   else not(a(s, k).escalated.contains(p)))
      .map(p => Escalate(p))
  // The director's step for a Direction point: today only after its escalation was settled
  // (ChangeWaitsForDirector); with D2 from its creation, blocked or not.
  def directDos(s: Work): Set[What] =
    openPoints(s)
      .filter(p => pt(s, p).kind == Direction and (FIX_POINT_OWNER or pt(s, p).settled))
      .map(p => ReviseDirection(p))
  def hostDos(s: Work): Set[What] =
    val lead = if (not(s.done) and working(s, Lead) == Set()) Set(AssignLead) else Set()
    val resolves = openPoints(s)
      .filter(p => pt(s, p).escalations > 0 and not(pt(s, p).settled))
      .map(p => Resolve(p))
    val qs = openQs(s).filter(i => not(q(s, i).toPerson))
    lead.union(resolves).union(qs.map(i => Answer(i))).union(qs.map(i => Forward(i)))
  // The person's list on the page: an evaluation, a forwarded question.
  def personDos(s: Work): Set[What] =
    val ev = if (not(s.done) and outOfTries(s)) Set(Evaluate) else Set()
    ev.union(openQs(s).filter(i => q(s, i).toPerson).map(i => Answer(i)))
  def watcherDos(s: Work): Set[What] =
    working(s, Lead).filter(l => not(a(s, l).alive)).map(l => Revive(l))
  def childDos(s: Work, l: int, r: Role): Set[What] =
    working(s, r).filter(c => a(s, c).parent == l and not(a(s, c).alive))
      .fold(Set(), (acc, c) => acc.union(startDos(s, c)))
  def leadDos(s: Work, l: int): Set[What] =
    val maker =
      if (not(needsMaker(s)) or s.blocked) Set()
      else if (working(s, Maker) == Set()) Set(AssignMaker)
      else childDos(s, l, Maker)
    val checker =
      if (not(needsChecker(s)) or s.blocked) Set()
      else if (working(s, Checker) == Set()) Set(AssignChecker)
      else childDos(s, l, Checker)
    maker.union(checker).union(escalateDos(s, l)).union(directDos(s))
  def makerDos(s: Work, m: int): Set[What] =
    val own =
      if (not(needsMaker(s)) or s.blocked or asking(s, m)) Set()
      else if (a(s, m).claim) Set(Report) else Set(ReadBrief)
    own.union(escalateDos(s, m))
  def checkerDos(s: Work, c: int): Set[What] =
    val stale = FIX_BRIEF_VERSION and a(s, c).brief < s.version
    val own =
      if (not(needsChecker(s)) or s.blocked or asking(s, c)) Set()
      else if (not(a(s, c).claim) or stale) Set(ReadBrief)
      else Set(Review)
    own.union(escalateDos(s, c))
  def dos(s: Work, k: int): Set[What] =
    if (k == HOST) hostDos(s)
    else if (k == PERSON) personDos(s)
    else if (k == WATCHER) watcherDos(s)
    else if (a(s, k).state == Ended) Set()
    else match a(s, k).role {
      | Lead => leadDos(s, k)
      | Maker => makerDos(s, k)
      | Checker => checkerDos(s, k)
    }
  def toldOf(s: Work): int -> Set[What] = actors(s).mapBy(k => dos(s, k))
  // An honest actor acts only on what it is told: a Do step, heard, that the engine allows.
  def moves(s: Work, k: int): bool = hears(s, k) and dos(s, k).exists(x => allowed(s, k, x))

  // ---- obligations: what must happen for the run to go on (the protocol, not the steps)
  def obligationsOf(s: Work): Set[Ob] =
    if (s.done) Set() else
    val noLead = working(s, Lead) == Set()
    val lead = if (noLead) Set(NeedLead) else Set()
    // A missing maker or checker is the lead's work, once there is a lead.
    val maker = if (not(noLead) and needsMaker(s) and working(s, Maker) == Set())
      Set(NeedMaker) else Set()
    val checker = if (not(noLead) and needsChecker(s) and working(s, Checker) == Set())
      Set(NeedChecker) else Set()
    // A subagent that asked waits for its answer: the answer is what is owed.
    val own = s.assigns.keys().filter(k => a(s, k).state == Working and isSub(s, k)
        and not(asking(s, k))
        and ((a(s, k).role == Maker and needsMaker(s))
          or (a(s, k).role == Checker and needsChecker(s))))
      .map(k => if (a(s, k).alive) (if (a(s, k).role == Maker) Make(k) else Check(k))
                else Restart(k))
    val settle = openPoints(s).filter(p => pt(s, p).escalations > 0 and not(pt(s, p).settled))
      .map(p => Settle(p))
    // A Direction point needs its director's change; it does not wait on the other task.
    val decide = openPoints(s).filter(p => pt(s, p).kind == Direction and
        (pt(s, p).escalations == 0 or pt(s, p).settled)).map(p => Decide(p))
    val answers = openQs(s).map(i => AnswerQ(i))
    val ev = if (outOfTries(s)) Set(Evaluation) else Set()
    val revive = working(s, Lead).filter(l => not(a(s, l).alive)).map(l => ReviveAgent(l))
    lead.union(maker).union(checker).union(own).union(settle).union(decide)
      .union(answers).union(ev).union(revive)
  def discharges(ob: Ob, k: int, x: What): bool = match ob {
    | NeedLead => x == AssignLead
    | NeedMaker => x == AssignMaker
    | NeedChecker => x == AssignChecker
    | Restart(c) => x == StartSub(c)
    | Make(m) => k == m and (x == ReadBrief or x == Report)
    | Check(c) => k == c and (x == ReadBrief or x == Review)
    | Settle(p) => x == Resolve(p)
    | Decide(p) => x == Escalate(p) or x == ReviseDirection(p)
    | AnswerQ(i) => x == Answer(i) or x == Forward(i)
    | Evaluation => x == Evaluate
    | ReviveAgent(l) => x == Revive(l)
  }
  def toldAny(s: Work, ob: Ob): Set[int] =
    actors(s).filter(k => dos(s, k).exists(x => discharges(ob, k, x)))
  // The actors that are told (and hear) a step that discharges ob.
  def toldTo(s: Work, ob: Ob): Set[int] = toldAny(s, ob).filter(k => hears(s, k))
  def isPersonOb(s: Work, ob: Ob): bool = match ob {
    | Evaluation => true
    | AnswerQ(i) => q(s, i).toPerson
    | _ => false
  }
  // Work of the task waits, rightly, while the task runs after another one (whose own movers
  // are outside this module), or while its one owner, a persistent agent, is being revived
  // (ReviveAgent is then owed, and told to the watcher), or while its owner, the director, is
  // not yet assigned (NeedLead is then owed, and told to the host; TLC found this case: a task
  // accepted with a Direction point open, then opened again by a direction change).
  def waitsLegally(s: Work, ob: Ob): bool =
    val other = s.blocked and match ob {
      | Make(_) => true | Check(_) => true | Restart(_) => true
      | NeedMaker => true | NeedChecker => true
      | _ => false
    }
    val t = toldAny(s, ob)
    val revive = t.size() == 1 and t.forall(l => l > 0 and a(s, l).role == Lead
      and a(s, l).state == Working and not(a(s, l).alive))
    val noDirector = working(s, Lead) == Set() and match ob { | Decide(_) => true | _ => false }
    other or revive or noDirector
  // Final for progress: done, or what is owed is owed by the person only.
  def finalOf(s: Work): bool =
    s.done or (obligationsOf(s) != Set() and obligationsOf(s).forall(ob => isPersonOb(s, ob)))
  val Final: bool = finalOf(w)
  // A run that used up MAX_IDS assignments leaves the model (its agents stop): progress is
  // checked only inside the bound.
  val FinalOrBound: bool = Final or w.nextId > MAX_IDS

  // ---- the effect of an act (core/actions/*: one event, then fold)
  def newAssign(s: Work, r: Role, parent: int): Work =
    val x = { role: r, parent: parent, state: Working, alive: true, brief: -1, claim: false,
              escalated: Set() }
    { ...s, assigns: s.assigns.put(s.nextId, x), nextId: s.nextId + 1 }
  def setA(s: Work, k: int, f: Assign => Assign): Work = { ...s, assigns: s.assigns.setBy(k, f) }
  def accepted(s: Work): Work =
    val ends = s.assigns.keys().filter(k => a(s, k).state == Working and
      (a(s, k).role == Lead or FIX_PARENT_END))
    { ...s, rstate: Accepted, done: true,
      assigns: s.assigns.keys().mapBy(k =>
        if (ends.contains(k)) { ...a(s, k), state: Ended, alive: false, claim: false }
        else a(s, k)) }
  // A redo answers the Fix points of the task.
  def closeFixes(ps: int -> Point): int -> Point =
    ps.keys().mapBy(p => if (ps.get(p).kind == Fix) { ...ps.get(p), closed: true } else ps.get(p))
  // A counted act of a subagent ends its claim and its process.
  def counted(s: Work, k: int): Work = setA(s, k, x => { ...x, claim: false, alive: false })

  def effect(s: Work, k: int, x: What, accept: bool, kind: PKind, grant: bool): Work = match x {
    | AssignLead => newAssign(s, Lead, 0)
    | AssignMaker => newAssign(s, Maker, k)
    | AssignChecker => newAssign(s, Checker, k)
    | StartSub(c) => setA(s, c, y => { ...y, alive: true })
    | ReadBrief => setA(s, k, y => { ...y, brief: s.version, claim: true })
    | Report => { ...counted(s, k), result: s.result + 1, rstate: InReview,
                  points: closeFixes(s.points) }
    | Review =>
        val stale = s.staleReview or a(s, k).brief < s.version
        if (accept) { ...accepted(counted(s, k)), staleReview: stale }
        else { ...counted(s, k), rstate: Rejected, staleReview: stale,
               points: s.points.put(s.result,
                 { kind: kind, escalations: 0, settled: false, closed: false }) }
    | Escalate(p) => { ...setA(s, k, y => { ...y, escalated: y.escalated.union(Set(p)) }),
        points: s.points.setBy(p, z => { ...z, escalations: z.escalations + 1 }) }
    | Resolve(p) => { ...s, points: s.points.setBy(p, z =>
        { ...z, settled: true, closed: z.kind == Fix }) }
    | ReviseDirection(p) => { ...s, version: s.version + 1,
        points: s.points.setBy(p, z => { ...z, closed: true }) }
    | Answer(i) => { ...s, questions: s.questions.setBy(i, z => { ...z, open: false }) }
    | Forward(i) => { ...s, questions: s.questions.setBy(i, z => { ...z, toPerson: true }) }
    // The person gives one more try, or accepts the task as it is.
    | Evaluate => if (grant and s.grants < MAX_GRANTS) { ...s, grants: s.grants + 1 }
                  else accepted(s)
    | Revive(l) => setA(s, l, y => { ...y, alive: true })
  }

  // ---- actions: each computes the next Work and Host, then commits them with told/obligations
  action commit(nw: Work, nh: Host, nc: int): bool = all {
    w' = nw, h' = nh, clock' = nc, told' = toldOf(nw), obligations' = obligationsOf(nw),
  }
  action init = {
    val s0 = { assigns: Map(), nextId: 1, version: 0, reopens: 0, result: 0, rstate: NoResult,
      points: Map(), questions: Map(), grants: 0, exits: 0, deaths: 0, done: false,
      blocked: false, needReopened: false, staleReview: false }
    all {
      w' = s0, h' = { waits: false, beat: 0, acted: 0, gone: false, falseGone: false },
      clock' = 0, told' = toldOf(s0), obligations' = obligationsOf(s0),
    }
  }
  action agentActs = all {
    w.nextId <= MAX_IDS,
    nondet k = oneOf(w.assigns.keys().filter(k => moves(w, k)))
    nondet x = oneOf(dos(w, k))
    nondet accept = oneOf(Set(true, false))
    nondet kind = oneOf(Set(Fix, Direction))
    all { allowed(w, k, x), commit(effect(w, k, x, accept, kind, false), h, clock) },
  }
  action hostActs = all {
    not(h.waits),
    nondet x = oneOf(dos(w, HOST))
    all { allowed(w, HOST, x), commit(effect(w, HOST, x, true, Fix, false),
      { ...h, acted: clock }, clock) },
  }
  action watcherActs = {
    nondet x = oneOf(dos(w, WATCHER))
    all { allowed(w, WATCHER, x), commit(effect(w, WATCHER, x, true, Fix, false), h, clock) }
  }
  // The person acts when it chooses (not fair): a waiting on the person is Final.
  action personActs = {
    nondet x = oneOf(dos(w, PERSON))
    nondet grant = oneOf(Set(true, false))
    all { allowed(w, PERSON, x), commit(effect(w, PERSON, x, true, Fix, grant), h, clock) }
  }
  // A subagent with work asks a question (its own choice, not a told step).
  action agentAsks = all {
    w.questions.keys().size() < MAX_QUESTIONS,
    nondet k = oneOf(w.assigns.keys().filter(k => hears(w, k) and isSub(w, k)
      and not(asking(w, k))))
    val i = w.questions.keys().size()
    commit({ ...w, questions: w.questions.put(i, { asker: k, toPerson: false, open: true }) },
      h, clock),
  }
  // A subagent's process ends with no counted act (its AI CLI stopped; live 00:40: a judge was
  // told "claimed by another subagent", STOP). With D6 its claim ends with it.
  action subExits = all {
    w.exits < MAX_EXITS,
    nondet k = oneOf(w.assigns.keys().filter(k => hears(w, k) and isSub(w, k)))
    commit({ ...setA(w, k, y => { ...y, alive: false,
               claim: y.claim and not(FIX_EXIT_ENDS_CLAIM) }), exits: w.exits + 1 }, h, clock),
  }
  // The claim timer (FREE_AFTER_MS, 10 minutes): a claim of a subagent with no process is freed.
  action timerFrees = {
    nondet k = oneOf(w.assigns.keys().filter(k => a(w, k).state == Working
      and not(a(w, k).alive) and a(w, k).claim))
    commit(setA(w, k, y => { ...y, claim: false }), h, clock)
  }
  // A persistent agent's process dies (environment); the watcher revives it.
  action leadDies = all {
    w.deaths < MAX_DEATHS,
    nondet l = oneOf(working(w, Lead).filter(l => a(w, l).alive))
    commit({ ...setA(w, l, y => { ...y, alive: false }), deaths: w.deaths + 1 }, h, clock),
  }
  // An honest host waits again when it has nothing it may do.
  action hostWaits = all {
    not(h.waits), not(dos(w, HOST).exists(x => allowed(w, HOST, x))),
    commit(w, { ...h, waits: true }, clock),
  }
  action hostReturns = all {
    h.waits, dos(w, HOST) != Set(),
    commit(w, { ...h, waits: false, beat: clock }, clock),
  }
  // The person changes a direction (once): an accepted task is checked again.
  action newVersion = all {
    w.reopens < 1,
    commit(if (w.done) { ...w, version: w.version + 1, reopens: 1, done: false,
                         rstate: InReview }
           else { ...w, version: w.version + 1, reopens: 1 }, h, clock),
  }
  // The task's need (t3) opens again (once), and later is done again (its own movers).
  action needReopens = all {
    not(w.blocked), not(w.done), not(w.needReopened),
    commit({ ...w, blocked: true, needReopened: true }, h, clock),
  }
  action needDone = all { w.blocked, commit({ ...w, blocked: false }, h, clock) }
  action tick = all { clock < MAX_CLOCK, commit(w, h, clock + 1) }
  action supervise = all {
    not(h.gone), not(h.waits),
    val life = if (h.acted > h.beat) h.acted else h.beat
    val sign = if (FIX_ACT_IS_LIFE) life else h.beat
    all {
      clock - sign > SILENT,
      commit(w, { ...h, gone: true, falseGone: clock - life <= SILENT }, clock),
    },
  }
  action step = any {
    agentActs, hostActs, watcherActs, personActs, agentAsks, subExits, timerFrees, leadDies,
    hostWaits, hostReturns, newVersion, needReopens, needDone, tick, supervise,
  }

  // ---- invariants (safety: every reachable state)
  // I1, THE central invariant: every obligation is told to exactly one actor that hears it,
  // unless it waits rightly (on the other task; on its owner's revive).
  val EveryObligationToldOnce: bool =
    obligationsOf(w).forall(ob => waitsLegally(w, ob) or toldTo(w, ob).size() == 1)
  // I2: an actor is told only acts the engine allows.
  val ToldIsAllowed: bool =
    actors(w).forall(k => dos(w, k).forall(x => allowed(w, k, x)))
  // I3: a working subagent has a working parent.
  val NoOrphan: bool = w.assigns.keys().forall(k =>
    (a(w, k).state == Working and a(w, k).parent != 0) implies a(w, a(w, k).parent).state == Working)
  val NoFalseGone: bool = not(h.falseGone)   // I4
  val NoStaleReview: bool = not(w.staleReview)   // I5
  // I6 (ClaimEndsWithExit): a claim is held only by a subagent whose process runs; every exit,
  // a counted act or not, ends it.
  val ClaimEndsWithExit: bool = w.assigns.keys().forall(k =>
    a(w, k).claim implies (a(w, k).state == Working and a(w, k).alive))
  // I7: an open task always owes something (else nobody could ever move it).
  val SomethingOwed: bool = w.done or obligationsOf(w) != Set()
  // The variables for MBT agree with the state.
  val Recorded: bool = told == toldOf(w) and obligations == obligationsOf(w)
  val Safe: bool = EveryObligationToldOnce and ToldIsAllowed and NoOrphan and NoFalseGone
    and NoStaleReview and ClaimEndsWithExit and SomethingOwed and Recorded

  // ---- progress (liveness): from every state, the run reaches Final.
  // Fairness: an action that stays enabled is taken in the end: a told agent acts, the watcher
  // revives, the claim timer fires, the other task's movers end it. The person is not fair.
  temporal Fairness = all {
    weakFair(agentActs, (w, h, clock, told, obligations)),
    weakFair(hostActs, (w, h, clock, told, obligations)),
    weakFair(hostReturns, (w, h, clock, told, obligations)),
    weakFair(watcherActs, (w, h, clock, told, obligations)),
    weakFair(timerFrees, (w, h, clock, told, obligations)),
    weakFair(needDone, (w, h, clock, told, obligations)),
  }
  temporal Progress = always(eventually(FinalOrBound))
  temporal FairProgress = Fairness implies Progress
}

// All fixes off: the code before 2026-11-15 evening.
module before {
  import protocol(FIX_PARENT_END = false, FIX_START_READY = false, FIX_ESCALATE_ONCE = false,
    FIX_ACT_IS_LIFE = false, FIX_BRIEF_VERSION = false, FIX_POINT_OWNER = false,
    FIX_EXIT_ENDS_CLAIM = false, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
// The code of 2026-11-16 02:10 (db66a7e): no point owner; a claim outlives a silent exit.
module today {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = false,
    FIX_EXIT_ENDS_CLAIM = false, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
// The design: every fix on (D2, D4, D5, D6).
module after {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
// TLC on all new features at once did not finish in 30 min at 2 GB (2.5M states, growing).
// So two models split them: A has subagent exits and the person's grants; B has a death of the
// persistent agent and a question.
module afterTlcA {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 1, MAX_CLOCK = 2, MAX_IDS = 6, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 0, MAX_QUESTIONS = 0).*
}
module afterTlcB {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 1, MAX_CLOCK = 2, MAX_IDS = 6, MAX_TRIES = 2,
    MAX_GRANTS = 0, MAX_EXITS = 0, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
// One fix off at a time, for a short counterexample each.
module orphan {
  import protocol(FIX_PARENT_END = false, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
module startWait {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = false, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
module churn {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = false,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = false,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
module goneRace {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = false, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
module stale {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = false, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
// Live 00:40 (b3e5183, 01f098c): a subagent stops with its claim open; its parent waits.
module claimHeld {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = true,
    FIX_EXIT_ENDS_CLAIM = false, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
// Live 00:2x (v219.1) and 00:57 (v271.3): a Direction point of a task that waits on another.
module noOwner {
  import protocol(FIX_PARENT_END = true, FIX_START_READY = true, FIX_ESCALATE_ONCE = true,
    FIX_ACT_IS_LIFE = true, FIX_BRIEF_VERSION = true, FIX_POINT_OWNER = false,
    FIX_EXIT_ENDS_CLAIM = true, SILENT = 2, MAX_CLOCK = 5, MAX_IDS = 8, MAX_TRIES = 2,
    MAX_GRANTS = 1, MAX_EXITS = 1, MAX_DEATHS = 1, MAX_QUESTIONS = 1).*
}
