// The run of many tasks (core/model/README.md): a top task with two regions, region 1 needs
// region 0 (it runs after it). Direction changes recheck accepted regions; remakes replace a
// region; a remake of the top ends the whole tree. One lead and one checker per region; the
// host directs; the person owns the top.
module tasks {
  const FIX_POINT_OWNER: bool    // D2: a Direction point is the director's at once, blocked or not
  const FIX_CHANGE_BUDGET: bool  // D7 (proposed): past MAX_CHANGES, a Direction point is the person's
  const FIX_PERSON_HEARS: bool   // the person's list counts as told (C1: a legal person wait)
  const MAX_TRIES: int
  const MAX_CHANGES: int         // direction changes and remakes by agents (budget, D7)
  const MAX_TOP_REMAKES: int
  const MAX_PERSON_CHANGES: int

  // Idle: no assignment. Directing: a Direction point waits for a change of a direction.
  // Evaluating: the maker is out of tries; the person evaluates.
  type RS = Idle | Making | Checking | Accepted | Directing | Evaluating
  type Region = { rs: RS, tries: int, escalated: bool }
  type Actor = Person | Host | LeadOf(int) | CheckerOf(int)
  type What = AssignTop | Assign(int) | Report(int) | Review(int) | Escalate(int)
            | Revise(int) | Remake(int) | Evaluate(int)
  type Verdict = Accept | FixPoint | DirectionPoint
  type Ob = OwnTop | NeedLead(int) | Make(int) | Check(int) | Decide(int) | Evaluation(int)
  type Run = {
    regions: int -> Region,
    topAssigned: bool,   // the host holds the top's assignment
    topRemakes: int,
    changes: int,        // direction changes and remakes by agents (saturates at MAX_CHANGES + 1)
    personChanges: int,
  }

  var r: Run
  var told: Actor -> Set[What]
  var obligations: Set[Ob]

  pure val REGIONS = Set(0, 1)
  pure val ACTORS = Set(Person, Host, LeadOf(0), LeadOf(1), CheckerOf(0), CheckerOf(1))
  pure def needOf(i: int): Set[int] = if (i == 1) Set(0) else Set()

  def rg(s: Run, i: int): Region = s.regions.get(i)
  def needOk(s: Run, i: int): bool = needOf(i).forall(j => rg(s, j).rs == Accepted)
  def overBudget(s: Run): bool = FIX_CHANGE_BUDGET and s.changes >= MAX_CHANGES
  def doneOf(s: Run): bool = s.topAssigned and REGIONS.forall(i => rg(s, i).rs == Accepted)
  def hears(s: Run, k: Actor): bool = match k {
    | Person => FIX_PERSON_HEARS
    | Host => true
    | LeadOf(i) => s.topAssigned and rg(s, i).rs != Idle
    | CheckerOf(i) => s.topAssigned and rg(s, i).rs == Checking
  }
  def is(s: Run, i: int, x: RS): bool = s.topAssigned and rg(s, i).rs == x
  // The person decides a Direction point past the budget.
  def personDecides(s: Run, i: int): bool = is(s, i, Evaluating) or (is(s, i, Directing)
    and overBudget(s))

  def allowed(s: Run, k: Actor, x: What): bool = match x {
    | AssignTop => k == Person and not(s.topAssigned)
    | Assign(i) => k == Host and is(s, i, Idle)
    | Report(i) => k == LeadOf(i) and is(s, i, Making) and needOk(s, i)
    | Review(i) => k == CheckerOf(i) and is(s, i, Checking) and needOk(s, i)
    | Escalate(i) => k == LeadOf(i) and is(s, i, Directing) and not(rg(s, i).escalated)
    | Revise(i) => k == Host and is(s, i, Directing) and not(overBudget(s))
    | Remake(i) => k == Host and is(s, i, Directing) and not(overBudget(s))
    | Evaluate(i) => k == Person and personDecides(s, i)
  }

  // The Do steps each actor is told.
  def dos(s: Run, k: Actor): Set[What] = match k {
    | Person =>
        val top = if (not(s.topAssigned)) Set(AssignTop) else Set()
        top.union(REGIONS.filter(i => personDecides(s, i)).map(i => Evaluate(i)))
    | Host =>
        val give = REGIONS.filter(i => is(s, i, Idle)).map(i => Assign(i))
        // Today the director is told only after the lead's escalation (ChangeWaitsForDirector).
        val ds = REGIONS.filter(i => is(s, i, Directing) and not(overBudget(s))
          and (FIX_POINT_OWNER or rg(s, i).escalated))
        give.union(ds.map(i => Revise(i))).union(ds.map(i => Remake(i)))
    | LeadOf(i) =>
        val rep = if (is(s, i, Making) and needOk(s, i)) Set(Report(i)) else Set()
        // Today: the lead escalates a Direction point, but not while its task runs after another.
        val esc = if (not(FIX_POINT_OWNER) and is(s, i, Directing) and not(rg(s, i).escalated)
          and needOk(s, i) and not(overBudget(s))) Set(Escalate(i)) else Set()
        rep.union(esc)
    | CheckerOf(i) => if (is(s, i, Checking) and needOk(s, i)) Set(Review(i)) else Set()
  }
  def toldOf(s: Run): Actor -> Set[What] = ACTORS.mapBy(k => dos(s, k))

  def obligationsOf(s: Run): Set[Ob] =
    if (not(s.topAssigned)) Set(OwnTop)
    else if (doneOf(s)) Set()
    else REGIONS.filter(i => rg(s, i).rs != Accepted).map(i => match rg(s, i).rs {
      | Idle => NeedLead(i)
      | Making => Make(i)
      | Checking => Check(i)
      | Directing => Decide(i)
      | Evaluating => Evaluation(i)
      | Accepted => Evaluation(i)   // not reached: filtered above
    })
  def discharges(ob: Ob, x: What): bool = match ob {
    | OwnTop => x == AssignTop
    | NeedLead(i) => x == Assign(i)
    | Make(i) => x == Report(i)
    | Check(i) => x == Review(i)
    | Decide(i) => x == Escalate(i) or x == Revise(i) or x == Remake(i) or x == Evaluate(i)
    | Evaluation(i) => x == Evaluate(i)
  }
  def toldTo(s: Run, ob: Ob): Set[Actor] =
    ACTORS.filter(k => hears(s, k) and dos(s, k).exists(x => discharges(ob, x)))
  def isPersonOb(s: Run, ob: Ob): bool = match ob {
    | OwnTop => true
    | Evaluation(_) => true
    | Decide(i) => overBudget(s)
    | _ => false
  }
  // The work of a region waits, rightly, while the region it needs is not accepted (the need's
  // movers are in this module and owe their own obligations).
  def waitsOnNeed(s: Run, ob: Ob): bool = match ob {
    | Make(i) => not(needOk(s, i))
    | Check(i) => not(needOk(s, i))
    | _ => false
  }
  def finalOf(s: Run): bool =
    val obs = obligationsOf(s)
    doneOf(s) or (obs.exists(ob => isPersonOb(s, ob))
      and obs.forall(ob => isPersonOb(s, ob) or waitsOnNeed(s, ob)))
  val Final: bool = finalOf(r)

  def bump(s: Run): int = if (s.changes > MAX_CHANGES) s.changes else s.changes + 1
  def setR(s: Run, i: int, f: Region => Region): Run = { ...s, regions: s.regions.setBy(i, f) }
  // A version change: results under the old version no longer count (usedBy: underNow), so
  // every try count starts again, and every accepted region is checked again.
  def recheck(s: Run): int -> Region = s.regions.keys().mapBy(j =>
    val g = rg(s, j)
    { ...g, tries: 0, rs: if (g.rs == Accepted) Checking else g.rs })
  def effect(s: Run, x: What, v: Verdict): Run = match x {
    | AssignTop => { ...s, topAssigned: true }
    | Assign(i) => setR(s, i, g => { rs: Making, tries: 0, escalated: false })
    | Report(i) => setR(s, i, g => { ...g, rs: Checking })
    | Review(i) => setR(s, i, g => match v {
        | Accept => { ...g, rs: Accepted }
        | FixPoint => { ...g, tries: g.tries + 1,
                        rs: if (g.tries + 1 >= MAX_TRIES) Evaluating else Making }
        // A Direction point is no fault of the maker: it uses no try (isFault).
        | DirectionPoint => { ...g, rs: Directing, escalated: false }
      })
    | Escalate(i) => setR(s, i, g => { ...g, escalated: true })
    | Revise(i) =>
        val s1 = { ...s, changes: bump(s), regions: recheck(s) }
        setR(s1, i, g => { rs: Making, tries: 0, escalated: false })
    // A remake replaces the region's task by a new one: no assignment, no tries.
    | Remake(i) => setR({ ...s, changes: bump(s) }, i, g => { rs: Idle, tries: 0, escalated: false })
    // The person accepts the region as it is (or decides the direction itself).
    | Evaluate(i) => setR(s, i, g => { ...g, rs: Accepted })
  }

  action commit(nr: Run): bool = all {
    r' = nr, told' = toldOf(nr), obligations' = obligationsOf(nr),
  }
  action init = {
    val s0 = { regions: REGIONS.mapBy(i => { rs: Idle, tries: 0, escalated: false }),
      topAssigned: true, topRemakes: 0, changes: 0, personChanges: 0 }
    all { r' = s0, told' = toldOf(s0), obligations' = obligationsOf(s0) }
  }
  action actorActs(k: Actor, v: Verdict): bool = all {
    hears(r, k),
    nondet x = oneOf(dos(r, k))
    all { allowed(r, k, x), commit(effect(r, x, v)) },
  }
  action hostActs = actorActs(Host, Accept)
  action leadActs = { nondet i = oneOf(REGIONS) actorActs(LeadOf(i), Accept) }
  // A checker's verdict is free: progress must not need a reviewer to accept.
  action checkerActs = {
    nondet i = oneOf(REGIONS)
    nondet v = oneOf(Set(Accept, FixPoint, DirectionPoint))
    actorActs(CheckerOf(i), v)
  }
  action personActs = actorActs(Person, Accept)   // not fair
  // C1 (live t37): the host remakes the top. Its assignment and the whole tree end; the person
  // assigns the new top. Not a told step: the host's own choice (bounded).
  action remakeTop = all {
    r.topAssigned, not(doneOf(r)), r.topRemakes < MAX_TOP_REMAKES,
    commit({ ...r, topAssigned: false, topRemakes: r.topRemakes + 1,
             regions: REGIONS.mapBy(i => { rs: Idle, tries: 0, escalated: false }) }),
  }
  // The person changes a direction (bounded): accepted regions are checked again.
  action personChanges = all {
    r.personChanges < MAX_PERSON_CHANGES,
    commit({ ...r, personChanges: r.personChanges + 1, regions: recheck(r) }),
  }
  action step = any { hostActs, leadActs, checkerActs, personActs, remakeTop, personChanges }

  // I1 for the run: every obligation is told to exactly one actor that hears it, unless it
  // waits on its need. The person is an actor: its list on the page tells it.
  val EveryObligationToldOnce: bool =
    obligationsOf(r).forall(ob => waitsOnNeed(r, ob) or toldTo(r, ob).size() == 1)
  val ToldIsAllowed: bool = ACTORS.forall(k => dos(r, k).forall(x => allowed(r, k, x)))
  // Convergence, as safety: agents change directions or remake at most MAX_CHANGES times.
  val ChangesWithinBudget: bool = r.changes <= MAX_CHANGES
  val SomethingOwed: bool = doneOf(r) or obligationsOf(r) != Set()
  val Recorded: bool = told == toldOf(r) and obligations == obligationsOf(r)
  val RunSafe: bool = EveryObligationToldOnce and ToldIsAllowed and ChangesWithinBudget
    and SomethingOwed and Recorded

  // Agents act on what they are told; a checker may reject every time. The person is not fair.
  temporal Fairness = all {
    weakFair(hostActs, (r, told, obligations)),
    weakFair(leadActs, (r, told, obligations)),
    weakFair(checkerActs, (r, told, obligations)),
  }
  temporal Progress = always(eventually(Final))
  temporal FairProgress = Fairness implies Progress
}

// The code of 2026-11-16 02:10: no point owner, no budget of changes.
module today {
  import tasks(FIX_POINT_OWNER = false, FIX_CHANGE_BUDGET = false, FIX_PERSON_HEARS = true,
    MAX_TRIES = 2, MAX_CHANGES = 2, MAX_TOP_REMAKES = 1, MAX_PERSON_CHANGES = 1).*
}
// Live v219.1 (00:26) and v271.3 (00:57): a Direction point of a region that waits on its need.
module needDirection {
  import tasks(FIX_POINT_OWNER = false, FIX_CHANGE_BUDGET = true, FIX_PERSON_HEARS = true,
    MAX_TRIES = 2, MAX_CHANGES = 2, MAX_TOP_REMAKES = 1, MAX_PERSON_CHANGES = 1).*
}
// Live 01:41: the Proposed Solution remade five times. Nothing bounds changes and remakes.
module diverge {
  import tasks(FIX_POINT_OWNER = true, FIX_CHANGE_BUDGET = false, FIX_PERSON_HEARS = true,
    MAX_TRIES = 2, MAX_CHANGES = 2, MAX_TOP_REMAKES = 1, MAX_PERSON_CHANGES = 1).*
}
// C1 (live t37) with the person not counted as an actor that is told.
module topRemake {
  import tasks(FIX_POINT_OWNER = true, FIX_CHANGE_BUDGET = true, FIX_PERSON_HEARS = false,
    MAX_TRIES = 2, MAX_CHANGES = 2, MAX_TOP_REMAKES = 1, MAX_PERSON_CHANGES = 1).*
}
module after {
  import tasks(FIX_POINT_OWNER = true, FIX_CHANGE_BUDGET = true, FIX_PERSON_HEARS = true,
    MAX_TRIES = 2, MAX_CHANGES = 2, MAX_TOP_REMAKES = 1, MAX_PERSON_CHANGES = 1).*
}
