// The protocol core model (plan/model/DESIGN.md 2-5, 9, 11-13; the method of 14): G2.
// "From every state someone is told the next step; told steps done lead every run to its
// end." Small on purpose, for TLC with liveness.
// The protocol is work.qnt's, imported, not restated: the store's check (accept), the
// effects (take), the told steps (dos), the obligations, Final, and what an honest agent
// puts in an act (honestOf). This file adds only the actors around it:
// - each agent takes a step it is told, with honest content (a bounded number of mistakes:
//   the pipeline role may evaluate shallower than the real cause); the act takes effect in
//   one step (no network, no stale views: those couplings are the big model's, workenv.qnt);
// - the environment's truths: a maker's slip, a test command's real behaviour, whether a
//   new rule contradicts the other rule (fights), what a change breaks (hits), the real
//   cause of a split part;
// - the person: accepts, sends back, rejects, takes as is, ends; at most maxPerson acts, and
//   never assumed to act (a run that waits only on the person is Final).
// Abstracted away: tmux, terminals, processes, crashes, the network, the page, time, the
// person's direction edit (EditDirection) and run continue (MoveHost).
// The assumptions are the contract's (contract.qnt), each proven by its own model:
// - G1, for each actor: an agent told a step takes it in the end (G1 then A: "hears" is
//   the step itself). terminals.qnt proves G1; A is assumed (DESIGN.md 14). Assumed below.
// - G3: an act takes effect only if it is fresh (store.qnt proves it). It is what lets this
//   model apply each act atomically to the current state: every step below takes an act
//   only if G3 holds of it (a guard that is true of every act built here).
// - G4: what the person owes is, in the end, shown on the person's page (browser.qnt
//   proves it). It is what makes Final's "waits only on the person" an end and not a
//   stall: the person is shown the wait. This model has no page: it relies on G4 there.
module core {
  import contract.* from "./contract"
  // The options of work.qnt (README.md "Options").
  const CFG: {
    crossTest: bool, raiseLevel: bool, recheckBasis: bool, slots: Set[int], basis: bool,
    build: bool, rebase: bool, harnessTest: bool, classify: bool, passTests: bool,
    fullBrief: bool, endedCheck: bool, formCheck: bool, refCheck: bool, epochs: bool,
    reviseCheck: bool, rebind: bool, pumpReattach: bool, hostWatched: bool, promptArg: bool,
    idleSeen: bool, silentSteps: int, reviewSubagents: bool, editBack: int, acceptCheck: bool,
    decideRecheck: bool, briefCheck: bool, strictScope: bool, sections: int,
    listOnAttach: bool, ladderRoute: bool, maxTries: int, maxMakers: int, maxLoops: int,
    maxRuleTries: int,
  }
  // causes: the real causes task 0 may start with, and a split part may get (0 none,
  // 1 split, 2 fit, 3 principle, 4 direct, 5 standard); causes1: those of task 1.
  // maxPerson: the person's acts.
  // maxMistakes: the pipeline role's shallow evaluations. slips: a maker may slip (a bad
  // result with no cause). forms: the rule forms the pipeline role may write (1 a test
  // command, 2 a reference, 3 both). testsFail: a test command may fail its own examples
  // (then the rule is written again; past maxRuleTries only as a reference). reject: the
  // person may reject a result.
  const C: { causes: Set[int], causes1: Set[int], maxPerson: int, maxMistakes: int, slips: bool,
             forms: Set[int], testsFail: bool, reject: bool, maxExits: int, caps: bool }
  import work(OPT = CFG).* from "./work"

  var s: Store
  var persons: int      // the person's acts so far
  var mistakes: int     // the pipeline role's mistakes so far
  var chg: bool         // flips at each agent change (AgentChangesStop)
  var exits: int        // the exits so far (C.maxExits)

  val vars = (s, persons, mistakes, chg, exits)
  pure val VERDICTS = Set(Pass, Fail, RaiseTries, RaiseNoRule, RaiseMisses)
  pure val LEVELS = Set(Split, Fit, Principle, Direct, Standard)
  pure val BOOLS = Set(true, false)
  pure def CAUSE_OF(n: int): Cause =
    if (n == 1) CauseAt(Split) else if (n == 2) CauseAt(Fit) else if (n == 3) CauseAt(Principle)
    else if (n == 4) CauseAt(Direct) else if (n == 5) CauseAt(Standard) else NoCause
  def causes: Set[Cause] = C.causes.map(n => CAUSE_OF(n))
  def forms: Set[Form] = C.forms.map(n => if (n == 1) Mech else if (n == 2) Ref else Both)
  // A maker of task i has the id 3 + i (one live maker per task; the store's own ids are
  // renamed to it, see canon).
  def makerOf(i: int): int = 3 + i
  pure val AGENTS_FAIR = Set(HOST, ROLE, PIPE, HARNESS)

  // ---- one canonical store per state (the method's "bound unbounded things"). In this
  // model no act is in flight and no view is old, so the counters that only tell an old act
  // from a current one (a fix's step and revision, a result's id, a maker's revisions, the
  // epochs, the maker ids, a task's generation) carry nothing: they are set to one value.
  // Item versions and the card are compared only with each other: each is shifted so that
  // its smallest copy is 0. Ended makers are dropped (nothing reads them again). The
  // history flags this model does not check are cleared. agentChanges stops at
  // changeBound + 1 (Converges reads it).
  def shifted(m: Item -> int, lo: Item -> int): Item -> int =
    ITEMS.mapBy(x => m.get(x) - lo.get(x))
  def canon(st: Store): Store =
    val live = st.makers.keys().filter(m => not(mk(st, m).ended))
    val mks = live.mapBy(m => { ...mk(st, m), revs: 0,
                                brief: if (mk(st, m).claim) mk(st, m).brief else st.ver })
    val tks = st.tasks.keys().mapBy(i =>
      val t = tk(st, i)
      { ...t, gen: 0, rid: if (t.rid >= 0) 0 else -1,
        checked: if (Set(Done, Raised, InReview).contains(t.st)) t.checked else st.ver })
    val fxs = st.fixes.keys().mapBy(i =>
      val f = fx(st, i)
      val keep = f.stage != SEval and f.kind == DDir
      if (f.stage == SClosed) CLOSED
      else { ...f, step: 0, rev: 0, sentBack: Set(),
             base: if (keep) f.base else st.ver, trueBase: if (keep) f.trueBase else st.ver,
             cardBase: if (f.kind == DRole) f.cardBase else st.card })
    val open = fxs.keys().filter(i => fxs.get(i).stage != SClosed)
    val copies = Set(st.ver).union(tks.keys().map(i => tks.get(i).checked))
      .union(mks.keys().map(m => mks.get(m).brief))
      .union(open.map(i => fxs.get(i).base)).union(open.map(i => fxs.get(i).trueBase))
    val lo = ITEMS.mapBy(x => copies.fold(st.ver.get(x), (acc, m) =>
      if (m.get(x) < acc) m.get(x) else acc))
    val cardLo = open.fold(st.card, (acc, i) =>
      if (fxs.get(i).cardBase < acc) fxs.get(i).cardBase else acc)
    { ...st,
      ver: shifted(st.ver, lo), card: st.card - cardLo,
      tasks: tks.keys().mapBy(i => { ...tks.get(i), checked: shifted(tks.get(i).checked, lo) }),
      makers: mks.keys().mapBy(m => { ...mks.get(m), brief: shifted(mks.get(m).brief, lo) }),
      fixes: fxs.keys().mapBy(i =>
        if (fxs.get(i).stage == SClosed) fxs.get(i)
        else { ...fxs.get(i), base: shifted(fxs.get(i).base, lo),
               trueBase: shifted(fxs.get(i).trueBase, lo),
               cardBase: fxs.get(i).cardBase - cardLo }),
      ep: PERSISTENT.mapBy(k => 0), nextMaker: 3, changes: 0,
      agentChanges: if (st.agentChanges > changeBound) changeBound + 1 else st.agentChanges,
      down: st.down.filter(k => k < 3 or live.contains(k)),
      g: { ...NOGHOST, endBroken: st.g.endBroken, lostUpdate: st.g.lostUpdate,
           takenUndone: st.g.takenUndone, refix: st.g.refix,
           escalatedNoPerson: st.g.escalatedNoPerson, topNoPerson: st.g.topNoPerson,
           passDefect: st.g.passDefect } }

  // caps off (a mutant, R6-6): the model's caps on the review loop's revisions and on rule
  // rewrites (OPT.maxLoops, OPT.maxRuleTries) are forgotten: those loops can go on.
  def uncapped(st: Store): Store = if (C.caps) st else
    { ...st, fixes: st.fixes.keys().mapBy(i => { ...fx(st, i), loops: 0, ruleTries: 0 }) }
  action commitE(ns: Store, np: int, nm: int, ne: int): bool = all {
    s' = uncapped(canon(ns)), persons' = np, mistakes' = nm, exits' = ne,
    chg' = if (ns.agentChanges > s.agentChanges) not(chg) else chg,
  }
  action commit(ns: Store, np: int, nm: int): bool = commitE(ns, np, nm, exits)

  action init = {
    nondet c0 = causes.oneOf()
    nondet c1 = C.causes1.map(n => CAUSE_OF(n)).oneOf()
    all { s' = initStore(Map(0 -> c0, 1 -> c1)), persons' = 0, mistakes' = 0, chg' = false,
          exits' = 0 }
  }

  // ---- acts. An act as its sender builds it on the current store (its basis is current).
  def base(k: int, x: What): Act = { ...NOACT, who: k, ep: epOf(s, k), what: x,
    seen: cur(s, x), seenDir: vsum(s), vers: s.ver, realVers: s.ver,
    items: match x { | RecheckDone(i) => tk(s, i).pend.filter(y => not(testRule(s, y)))
                     | _ => Set() } }
  // The tasks a change of task i may break (the environment's truth): none or the other.
  def others(i: int): Set[Set[int]] =
    Set(Set()).union(SLOTS.filter(j => j != i).map(j => Set(j)))
  // The contents an honest agent may choose, and the environment's truths, per act. Only
  // the fields the act uses vary (honestOf then filters).
  def choices(b: Act): Set[Act] = match b.what {
    | Review(_) => VERDICTS.map(v => { ...b, v: v })
    | Evaluate(_) => LEVELS.fold(Set(), (acc, l) => acc.union(
        if (l == Fit) BOOLS.map(f => { ...b, level: l, flag: f, flag2: f })
        else if (l == Split) causes.map(c => { ...b, level: l, cause: c })
        else Set({ ...b, level: l })))
    | WriteRule(_) => forms.fold(Set(), (acc, fm) => acc.union(
        (if (C.testsFail) BOOLS else Set(true)).fold(Set(), (a2, t) =>
        a2.union(BOOLS.map(f3 => { ...b, form: fm, flag: t, flag2: true, flag3: f3 })))))
    // The draft of task i's raise changes items that apply to task i.
    | Ship(i) => ITEMSETS.filter(xs => xs.forall(x => applies(x, i))).fold(Set(), (acc, xs) =>
        acc.union(others(i).map(h => { ...b, items: xs, real: xs, hits: h })))
    | RunTest(_) => BOOLS.fold(Set(), (acc, f) => acc.union(BOOLS.map(f2 =>
        { ...b, flag: f, flag2: f2 })))
    | RecheckDone(_) => BOOLS.map(f => { ...b, flag: f })
    | LoopReview(_) => BOOLS.map(f => { ...b, flag: f })
    | Report(_) => if (C.slips) BOOLS.map(f => { ...b, flag: f }) else Set({ ...b, flag: false })
    | _ => Set(b)
  }
  // A new maker gets its task's id (canon).
  def prep(a: Act): Store = match a.what {
    | AssignDo(i) => { ...s, nextMaker: makerOf(i) }
    | _ => s
  }
  def honestNow(a: Act): bool = honestOf(s, a, mistakes < C.maxMistakes)
  // G3's facts of an act at its append, read from work.qnt's checks. Every act here is
  // sent once (firstTime).
  def fresh(a: Act): Fresh = {
    basisCurrent: basisOk(s, a),
    judgedCurrent: match a.what { | RecheckDone(i) => recheckCurrent(s, i, a) | _ => true },
    firstTime: true, currentEpoch: epochOk(s, a), currentBuild: not(a.old),
    waitsIfAccept: match a.what { | Accept(i) => fx(s, i).stage == SAtPerson | _ => true },
  }
  def makers: Set[int] = SLOTS.map(i => makerOf(i))
  // An agent (or the harness) takes a step it is told, with honest content; not while its
  // exit is recorded (it is revived or resumed first).
  action agentStep(k: int): bool = all {
    not(s.down.contains(k)),
    nondet x = dos(s, k).oneOf()
    nondet a = choices(base(k, x)).filter(a => accept(s, a) and G3(fresh(a)) and honestNow(a))
      .oneOf()
    commit(take(prep(a), a), persons,
           mistakes + if (honestOf(s, a, false)) 0 else 1),
  }
  // A process ends (R6-5): the engine records its exit (work.qnt Exit, the harness's act),
  // at most maxExits times; not fair. Then the harness revives a role, the role resumes its
  // maker, the person starts the host again (work.qnt Revive, Resume, ReviveOb).
  action exitHappens = all {
    exits < C.maxExits,
    nondet k = Set(HOST, ROLE, PIPE).union(s.makers.keys()).filter(j => not(s.down.contains(j)))
      .oneOf()
    val a = base(HARNESS, Exit(k))
    all { accept(s, a), commitE(take(s, a), persons, mistakes, exits + 1) },
  }
  // The person: what the person is told (accept, send back, take as is, end), and a
  // reject of a result. Not fair; at most maxPerson acts.
  def personMoves: Set[What] = dos(s, PERSON).union(if (not(C.reject)) Set() else
    SLOTS.filter(i => tk(s, i).rid >= 0 and (tk(s, i).st == InReview or tk(s, i).st == Done))
      .map(i => Reject(i)))
  action personStep = all {
    persons < C.maxPerson,
    nondet x = personMoves.oneOf()
    // flag: take as is (Decide); flag3: the accepted direction change resolves a
    // contradiction; hits: the tasks the accepted change breaks.
    val fs = match x { | Decide(_) => BOOLS | _ => Set(true) }
    val rs = match x { | Accept(_) => BOOLS | _ => Set(false) }
    val hs = match x { | Accept(i) => others(i) | _ => Set(Set()) }
    nondet f = fs.oneOf()
    nondet r = rs.oneOf()
    nondet h = hs.oneOf()
    val a = { ...base(PERSON, x), flag: f, flag3: r, hits: h }
    all { accept(s, a), G3(fresh(a)), commit(take(s, a), persons + 1, mistakes) },
  }
  action step = any {
    agentStep(HOST), agentStep(ROLE), agentStep(PIPE), agentStep(HARNESS),
    nondet m = makers.oneOf() agentStep(m),
    personStep, exitHappens,
  }

  // ---- properties
  def owes(k: int): bool = dos(s, k) != Set()
  // The assumption, with the same arguments terminals.qnt proves (R6-5): G1 then A, for
  // each agent: an agent told a step takes one in the end, or it is no longer told one; the
  // host may instead wait for the person to start it again (its exit is recorded: a person
  // obligation, work.qnt ReviveOb). A maker whose exit is recorded is told nothing (its
  // resume is the role's step): terminals' "the role hears the resume".
  temporal AgentsG1 = all {
    G1(owes(HOST), mustChange(agentStep(HOST), vars), s.down.contains(HOST)),
    G1(owes(ROLE), mustChange(agentStep(ROLE), vars), false),
    G1(owes(PIPE), mustChange(agentStep(PIPE), vars), false),
    G1(owes(3), mustChange(agentStep(3), vars), false),
    G1(owes(4), mustChange(agentStep(4), vars), false),
  }
  // Engine fairness, not the contract (R6-7): the harness runs a rule's test command it is
  // due to run (RunRule) and revives a role whose exit is recorded (terminals.qnt's watcher).
  temporal EngineFair = G1(owes(HARNESS), mustChange(agentStep(HARNESS), vars), false)
  temporal Assumed = AgentsG1 and EngineFair
  // G2: every run reaches Final (the project ended, or it waits only on the person) and
  // stays there or goes on from it; and agent changes stop.
  temporal Progress = always(eventually(finalOf(s)))
  // With exits: the host whose exit is recorded waits for the person (work.qnt finalOf).
  temporal AgentChangesStop = eventually(always(chg)) or eventually(always(not(chg)))
  temporal CoreProgress = Assumed implies Progress
  temporal CoreChangesStop = Assumed implies AgentChangesStop
  // Sanity (not vacuous): without the pipeline role's part of the assumption, a run can
  // stop short of Final. TLC must break this.
  temporal AssumedNoPipe = all {
    G1(owes(HOST), mustChange(agentStep(HOST), vars), s.down.contains(HOST)),
    G1(owes(ROLE), mustChange(agentStep(ROLE), vars), false),
    G1(owes(3), mustChange(agentStep(3), vars), false),
    G1(owes(4), mustChange(agentStep(4), vars), false),
    EngineFair,
  }
  temporal CoreProgressNoPipe = AssumedNoPipe implies Progress
  // Sanity on runs with exits: without engine fairness (the watcher's revive) a role's exit
  // can stall the run. TLC must break this on coreTwoExit.
  temporal CoreProgressNoEngine = AgentsG1 implies Progress

  // Safety (README.md "Properties"), each one an invariant of TLC.
  val DoneIsClosed: bool = SLOTS.forall(i => tk(s, i).st == Done implies
    (fx(s, i).stage == SClosed and liveMaker(s, i) < 0))
  val OneMakerPerTask: bool = SLOTS.forall(i =>
    s.makers.keys().filter(m => mk(s, m).slot == i and not(mk(s, m).ended)).size() <= 1)
  val RaiseHasOwner: bool =
    SLOTS.forall(i => (tk(s, i).st == Raised) iff (fx(s, i).stage != SClosed))
  val Sane: bool = DoneIsClosed and OneMakerPerTask and RaiseHasOwner
  // Every obligation is told to exactly one actor (everyone hears here: G1).
  val EveryObligationToldOnce: bool =
    obligationsOf(s).forall(ob => toldAny(s, ob).size() == 1)
  // Every step told to an agent has an honest content the store takes.
  val ToldIsAllowed: bool = Set(HOST, ROLE, PIPE, HARNESS).union(s.makers.keys()).forall(k =>
    dos(s, k).forall(x => choices(base(k, x)).exists(a => accept(prep(a), a)
                                                      and honestOf(s, a, false))))
  val SomethingOwed: bool = s.top.ended or obligationsOf(s) != Set()
  val DoneIsCurrent: bool = SLOTS.forall(i => (tk(s, i).st == Done and tk(s, i).pend == Set())
    implies oldFor(s, i) == Set())
  val NoDoneBrokenAtEnd: bool = not(s.g.endBroken)
  val NoLostUpdate: bool = not(s.g.lostUpdate)
  val NoTakenUndone: bool = not(s.g.takenUndone)
  val NoPassOfBadResult: bool = not(s.g.passDefect)
  val NoRefixAtSameLevel: bool = not(s.g.refix)
  val NoEscalationWithoutPerson: bool = not(s.g.escalatedNoPerson)
  val NoAgentChangeAtTop: bool = not(s.g.topNoPerson)
  // The convergence flag: agent changes stay within the bound the config gives.
  val Converges: bool = not(pastBound(s))
}

// FIXED as in workenv.qnt (every proposed check on).
module coreCfgs {
  pure val FIXED_C = { crossTest: true, raiseLevel: true, recheckBasis: true, slots: Set(0, 1),
    basis: true, build: true, rebase: true, harnessTest: true, classify: true,
    passTests: true, fullBrief: true, endedCheck: true, formCheck: true, refCheck: true,
    epochs: true, reviseCheck: true, rebind: true, pumpReattach: true, hostWatched: true,
    promptArg: true, idleSeen: true, silentSteps: 3, reviewSubagents: false, editBack: 1,
    acceptCheck: true, decideRecheck: true, briefCheck: true, strictScope: true, sections: 2,
    listOnAttach: true, ladderRoute: true, maxTries: 2, maxMakers: 6, maxLoops: 1,
    maxRuleTries: 1 }
  pure val ENV_C = { causes: Set(0, 5), causes1: Set(0, 5), maxPerson: 1, maxMistakes: 0, slips: false,
                     forms: Set(1, 2), testsFail: true, reject: false, maxExits: 0,
                     caps: true }
}
// ---- instances (tlc.sh keeps only the one it checks: quint's TLA+ export of a file with
// many instances overflows).
// One task, every real cause, the ladder to the person: the person's acts (accept, send
// back, reject, take as is, end; two), a maker that slips, one shallow evaluation, a test
// command that may fail its examples.
module coreOne {
  import coreCfgs.*
  import core(CFG = { ...FIXED_C, slots: Set(0) },
              C = { ...ENV_C, causes: 0.to(5), causes1: Set(0), maxPerson: 2, maxMistakes: 1,
                    slips: true, reject: true }).* from "./core"
}
// Two tasks: task 0 with a standard cause, task 1 with none. Its rule may contradict task
// 1's (fights), its change may break task 1 (hits): scoped rechecks, rechecks of a done
// task, the person's take as is (one act).
module coreTwo {
  import coreCfgs.*
  import core(CFG = FIXED_C,
              C = { ...ENV_C, causes: Set(5), causes1: Set(0), testsFail: false }).* from "./core"
}
// The same with a direction cause: a direction change, the person, the host's reassign,
// the recheck of every task.
module coreTwoDir {
  import coreCfgs.*
  import core(CFG = FIXED_C,
              C = { ...ENV_C, causes: Set(4), causes1: Set(0), testsFail: false }).* from "./core"
}
// coreTwo with one process end (R6-5): an exit of the host, a role, the pipeline role or
// a maker, its revive (the harness), its resume (the role), the host started again by the
// person (one more person act).
module coreTwoExit {
  import coreCfgs.*
  import core(CFG = FIXED_C, C = { ...ENV_C, causes: Set(5), causes1: Set(0), testsFail: false,
                                   maxPerson: 2, maxExits: 1 }).* from "./core"
}
// R6-6: without the model's caps on the review loop and on rule rewrites (DESIGN.md has
// no rule that ends them), the run need not end: CoreProgress breaks.
module coreNoCaps {
  import coreCfgs.*
  import core(CFG = { ...FIXED_C, slots: Set(0) },
              C = { ...ENV_C, causes: Set(5), causes1: Set(0), maxPerson: 0, caps: false })
    .* from "./core"
}
// The simulator only (too big for TLC): two tasks, every cause, the person's acts.
module coreAll {
  import coreCfgs.*
  import core(CFG = FIXED_C, C = { ...ENV_C, causes: 0.to(5), causes1: 0.to(5), maxPerson: 2,
                                   maxMistakes: 1, slips: true, reject: true }).* from "./core"
}
// The "before" mutants of DESIGN.md 13 and 13.1: TLC must show agent changes that never
// stop (CoreChangesStop and CoreProgress break). No person acts: the loop is the agents'.
// No level raise (raiseLevel off): a contradiction through a reference-only rule (no test
// command, so the cross test cannot see it) ping-pongs between the two tasks' rules.
module coreNoRaise {
  import coreCfgs.*
  import core(CFG = { ...FIXED_C, raiseLevel: false },
              C = { ...ENV_C, causes: Set(5), causes1: Set(5), maxPerson: 0,
                    testsFail: false }).* from "./core"
}
// No cross test and no level raise, every rule with a test command: the ping-pong.
module coreNoCross {
  import coreCfgs.*
  import core(CFG = { ...FIXED_C, crossTest: false, raiseLevel: false },
              C = { ...ENV_C, causes: Set(5), causes1: Set(5), maxPerson: 0, forms: Set(1),
                    testsFail: false }).* from "./core"
}
// Its twin: the cross test alone ends it when every rule has a test command (holds).
module coreCrossOnly {
  import coreCfgs.*
  import core(CFG = { ...FIXED_C, raiseLevel: false },
              C = { ...ENV_C, causes: Set(5), causes1: Set(5), maxPerson: 0, forms: Set(1),
                    testsFail: false }).* from "./core"
}
// No split limit (strictScope and raiseLevel off): a split part splits again, for ever.
module coreNoSplit {
  import coreCfgs.*
  import core(CFG = { ...FIXED_C, slots: Set(0), strictScope: false, raiseLevel: false },
              C = { ...ENV_C, causes: Set(1), causes1: Set(0), maxPerson: 0 }).* from "./core"
}
