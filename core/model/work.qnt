// The work model of plan/model/DESIGN.md (locked 2026-11-16): the store and the protocol.
// This module has no variables. It says which acts the store takes (accept), what each act
// does (effect), what each actor is told (dos), and what is owed (obligationsOf).
// workenv.qnt puts the actors and the environment around it. README.md: words and options.
module work {
  // Options. c1Keep and d7 are Nanda's open choices (DESIGN.md section 6). The others are
  // checks the design does not state; each is false in the design as written ("design").
  const OPT: {
    c1Keep: bool,      // C1 b: the host keeps hosting after it remakes the top (false: a, warn)
    d7: int,           // D7: 0 none, 1 a budget of changes, 2 each recheck only shrinks points
    basis: bool,       // an act names the revision it was built on; the store refuses an old one
    build: bool,       // the store refuses an act from an old build of the page
    staleRedo: bool,   // a brief or result under an older direction is made again
    rebase: bool,      // a change in effect sends the other open drafts back to be redone
    harnessTest: bool, // the harness, not the pipeline role, runs a test command on the examples
    classify: bool,    // the store, not the pipeline role, answers "only a standard change?"
    passTests: bool,   // the store refuses a pass while a test command prints lines on the result
    fullBrief: bool,   // a revision carries every earlier point (no context needed)
    idleSeen: bool,    // a process that stops at its prompt counts as an exit
    maxTries: int, maxMakers: int, maxChanges: int, budget: int, maxPts: int, maxLoops: int,
    maxRuleTries: int, maxRemakes: int,
  }

  // ---- actors: ids. Makers get ids from 3 up, one per assignment (a fresh one per task).
  pure val PERSON = -1
  pure val HARNESS = -2  // the engine itself: the terminal pump (exits) and the watcher (revives)
  pure val HOST = 0
  pure val ROLE = 1      // the persistent role (its card): assigns, reviews, raises
  pure val PIPE = 2      // the pipeline role: evaluations, the direction pipeline, review loops
  pure val PERSISTENT = Set(HOST, ROLE, PIPE)
  pure val SLOTS = Set(0, 1)  // two tasks of the top, sent by the host to the role

  // Unsent: not yet sent by the host. Sent: at the role, no maker. Working: the maker makes
  // (first try or a revision). InReview: a result waits for the role's review. Raised: in
  // evaluation and what follows. Done: the review passed (or the person took it as it is).
  type TS = Unsent | Sent | Working | InReview | Raised | Done
  type Verdict = Pass | Fail | RaiseTries | RaiseNoRule | RaiseMisses
  type Level = Split | Fit | Principle | Direct | Standard
  // The life of a raise: evaluation, the pipeline stages, the test check, the draft, the
  // review loop, the person; SPerson: past the D7 budget the person decides.
  type Stage = SEval | SPrinciple | SDirAssess | SStdAssess | SRuleAssess | STest | SDraft
             | SLoop | SAtPerson | SAccepted | SPerson | SClosed
  type Form = NoForm | Mech | Ref | Both   // a rule's evidence: test command, reference, both
  type DKind = DDir | DRole
  type What =
    | OpenTop | EndProject | Reject(int) | Accept(int) | SendBack(int) | Decide(int)  // person
    | SendTask(int) | Reassign | RemakeTop                                           // host
    | AssignDo(int) | Review(int) | Resume(int)                                      // role
    | ReadBrief(int) | Report(int)                                                   // maker
    | Evaluate(int) | Advance(int) | WriteRule(int) | RunTest(int) | Ship(int)
    | LoopReview(int)                                                                // pipeline
    | Revive(int) | Exit(int)                                                        // harness
  // An act as it reaches the store. who: the token (cannot be forged). seen: the revision of
  // its target the sender saw. old: sent by an old build of the page (it names no revision).
  // v, pts, level, flag, form: the act's content (flag: a maker's result breaks a rule; a
  // test command's real behaviour, or the pipeline role's claim of it; a draft's label).
  type Act = { who: int, what: What, seen: int, old: bool, v: Verdict, pts: int, level: Level,
               flag: bool, form: Form }

  type Task = { gen: int, st: TS, tries: int, maker: int, rid: int, rUnder: int,
                rBreaks: bool }
  // A maker in the store. brief: the direction version of the brief it read (-1: none).
  // revs: revisions sent to it. claim: it read its brief and holds the work.
  type Maker = { slot: int, ended: bool, claim: bool, brief: int, revs: int }
  // A raise and what follows it, one per task. truth: the test command really prints lines on
  // the "breaks" example and none on "follows".
  // std: the draft changes only standards and rules. roleOnly: the role draft changes only
  // the role's card. base, cardBase: the versions the draft was built on. step: a counter of
  // the acts on this raise (the basis of those acts).
  type Fix = { stage: Stage, entry: Stage, kind: DKind, form: Form, truth: bool,
               ruleTries: int, std: bool, roleOnly: bool, base: int, cardBase: int, rev: int,
               sentBack: Set[int], loops: int, step: int }
  type Top = { hosted: bool, ended: bool, remakes: int, warned: bool }
  // History flags: each is an impossible state that the store let in (all must stay false).
  type Ghost = {
    endedActed: bool,       // an act of an ended maker was taken
    otherResult: bool,      // a review was applied to a result other than the one read
    otherVersion: bool,     // a result passed under a direction it was not made under
    staleReport: bool,      // a report answered a revision it was not made for
    unseenReject: bool,     // the person's reject hit a result the person did not see
    unseenAccept: bool,     // the person's accept hit a draft the person did not see
    rejectedInEffect: bool, // a draft the person sent back took effect by an earlier accept
    lostUpdate: bool,       // a draft built on an older direction or card took effect
    failedTest: bool,       // a rule took effect whose test command fails its examples
    noForm: bool,           // a rule took effect with neither evidence form
    deepNoPerson: bool,     // more than a standard change took effect without the person
    passBroken: bool,       // a result that breaks a rule's test command passed
    staleFix: bool,         // a pipeline act was applied to a stage it was not made for
  }
  type Store = {
    top: Top, tasks: int -> Task, makers: int -> Maker, fixes: int -> Fix,
    dir: int, card: int, changes: int, ptsBound: int, lastPts: int,
    mechInEffect: bool, down: Set[int], nextMaker: int, g: Ghost,
  }

  pure val CLOSED: Fix = { stage: SClosed, entry: SClosed, kind: DDir, form: NoForm,
    truth: true, ruleTries: 0, std: false, roleOnly: false, base: 0,
    cardBase: 0, rev: 0, sentBack: Set(), loops: 0, step: 0 }
  pure val NOGHOST: Ghost = { endedActed: false, otherResult: false, otherVersion: false,
    staleReport: false, unseenReject: false, unseenAccept: false, rejectedInEffect: false,
    lostUpdate: false, failedTest: false, noForm: false, deepNoPerson: false,
    passBroken: false, staleFix: false }
  pure val FRESH_TASK: Task = { gen: 0, st: Unsent, tries: 0, maker: -1, rid: -1, rUnder: 0,
    rBreaks: false }
  val initStore: Store = {
    // The person opened the top task, and the host holds it.
    top: { hosted: true, ended: false, remakes: 0, warned: false },
    tasks: SLOTS.mapBy(i => FRESH_TASK), makers: Map(),
    fixes: SLOTS.mapBy(i => { ...CLOSED, step: 0 }),
    dir: 0, card: 0, changes: 0, ptsBound: OPT.maxPts, lastPts: OPT.maxPts,
    mechInEffect: false, down: Set(), nextMaker: 3, g: NOGHOST,
  }

  // ---- reads
  def tk(s: Store, i: int): Task = s.tasks.get(i)
  def fx(s: Store, i: int): Fix = s.fixes.get(i)
  def isMaker(s: Store, m: int): bool = s.makers.keys().contains(m)
  def mk(s: Store, m: int): Maker = s.makers.get(m)
  def allDone(s: Store): bool = SLOTS.forall(i => tk(s, i).st == Done)
  def hasMech(f: Form): bool = f == Mech or f == Both
  def overBudget(s: Store): bool = OPT.d7 == 1 and s.changes >= OPT.budget
  def pipeStage(st: Stage): bool =
    Set(SEval, SPrinciple, SDirAssess, SStdAssess, SRuleAssess, STest, SDraft, SLoop)
      .contains(st)
  def nextStage(st: Stage): Stage =
    if (st == SPrinciple) SDirAssess else if (st == SDirAssess) SStdAssess else SRuleAssess
  // The live maker of a task (the one the store has not ended), or -1.
  def liveMaker(s: Store, i: int): int =
    val m = tk(s, i).maker
    if (m >= 0 and isMaker(s, m) and not(mk(s, m).ended)) m else -1

  // The revision an act is built on, now (its basis). -1: the act names none.
  def cur(s: Store, x: What): int = match x {
    | Review(i) => tk(s, i).rid
    | Reject(i) => tk(s, i).rid
    | Report(m) => if (isMaker(s, m)) mk(s, m).revs else -1
    | Accept(i) => fx(s, i).step
    | SendBack(i) => fx(s, i).step
    | Decide(i) => fx(s, i).step
    | Evaluate(i) => fx(s, i).step
    | Advance(i) => fx(s, i).step
    | WriteRule(i) => fx(s, i).step
    | RunTest(i) => fx(s, i).step
    | Ship(i) => fx(s, i).step
    | LoopReview(i) => fx(s, i).step
    | _ => -1
  }

  // ---- the store's check: the token's authority (no forgery)
  def authority(a: Act): bool = match a.what {
    | OpenTop => a.who == PERSON
    | EndProject => a.who == PERSON
    | Reject(_) => a.who == PERSON
    | Accept(_) => a.who == PERSON
    | SendBack(_) => a.who == PERSON
    | Decide(_) => a.who == PERSON
    | SendTask(_) => a.who == HOST
    | Reassign => a.who == HOST
    | RemakeTop => a.who == HOST
    | AssignDo(_) => a.who == ROLE
    | Review(_) => a.who == ROLE
    | Resume(_) => a.who == ROLE
    | ReadBrief(m) => a.who == m
    | Report(m) => a.who == m
    | Evaluate(_) => a.who == PIPE
    | Advance(_) => a.who == PIPE
    | WriteRule(_) => a.who == PIPE
    | RunTest(_) => a.who == PIPE
    | Ship(_) => a.who == PIPE
    | LoopReview(_) => a.who == PIPE
    | Revive(_) => a.who == HARNESS
    | Exit(_) => a.who == HARNESS
  }
  // ---- the store's check: the act is legal in the state at its append
  def makerAt(s: Store, m: int): bool = isMaker(s, m) and not(mk(s, m).ended)
    and not(s.down.contains(m)) and tk(s, mk(s, m).slot).st == Working
    and tk(s, mk(s, m).slot).maker == m
  def reviewOk(s: Store, i: int, a: Act): bool =
    val t = tk(s, i)
    val ptsOk = a.pts >= 1 and a.pts <= OPT.maxPts and (OPT.d7 != 2 or a.pts <= s.ptsBound)
    t.st == InReview and match a.v {
      | Pass => not(OPT.passTests and t.rBreaks and s.mechInEffect)
      | Fail => t.tries + 1 < OPT.maxTries and ptsOk
      | RaiseTries => t.tries + 1 >= OPT.maxTries and ptsOk
      | RaiseNoRule => ptsOk
      | RaiseMisses => ptsOk
    }
  def legal(s: Store, a: Act): bool = match a.what {
    | OpenTop => not(s.top.hosted)
    | EndProject => true
    | Reject(i) => tk(s, i).rid >= 0 and (tk(s, i).st == InReview or tk(s, i).st == Done)
    | Accept(i) => fx(s, i).stage == SAtPerson
    | SendBack(i) => fx(s, i).stage == SAtPerson
    | Decide(i) => fx(s, i).stage == SPerson
    | SendTask(i) => s.top.hosted and tk(s, i).st == Unsent
    | Reassign => s.top.hosted and SLOTS.exists(i => fx(s, i).stage == SAccepted)
    | RemakeTop => s.top.hosted and not(allDone(s)) and s.top.remakes < OPT.maxRemakes
    | AssignDo(i) => s.top.hosted and tk(s, i).st == Sent
    | Review(i) => reviewOk(s, i, a)
    | Resume(m) => isMaker(s, m) and not(mk(s, m).ended) and s.down.contains(m)
    | ReadBrief(m) => makerAt(s, m)
    | Report(m) => makerAt(s, m) and mk(s, m).claim
        and (not(OPT.staleRedo) or mk(s, m).brief == s.dir)
    | Evaluate(i) => fx(s, i).stage == SEval
    | Advance(i) => Set(SPrinciple, SDirAssess, SStdAssess).contains(fx(s, i).stage)
    // Schema: a rule has an evidence form. Past maxRuleTries the model makes it a reference
    // rule (the design has no bound on rewrites; README "left out").
    | WriteRule(i) => fx(s, i).stage == SRuleAssess and a.form != NoForm
        and (fx(s, i).ruleTries < OPT.maxRuleTries or a.form == Ref)
    | RunTest(i) => fx(s, i).stage == STest
    | Ship(i) => fx(s, i).stage == SDraft
    | LoopReview(i) => fx(s, i).stage == SLoop and (a.flag or fx(s, i).loops < OPT.maxLoops)
    | Revive(k) => PERSISTENT.contains(k) and s.down.contains(k)
    | Exit(k) => not(s.down.contains(k))
  }
  def basisOk(s: Store, a: Act): bool =
    not(OPT.basis) or a.old or cur(s, a.what) < 0 or a.seen == cur(s, a.what)
  def accept(s: Store, a: Act): bool =
    (not(s.top.ended) or a.who == HARNESS) and authority(a) and legal(s, a) and basisOk(s, a)
      and not(OPT.build and a.old)

  // ---- effects
  def setT(s: Store, i: int, f: Task => Task): Store = { ...s, tasks: s.tasks.setBy(i, f) }
  def setF(s: Store, i: int, f: Fix => Fix): Store = { ...s, fixes: s.fixes.setBy(i, f) }
  def setM(s: Store, m: int, f: Maker => Maker): Store =
    if (isMaker(s, m)) { ...s, makers: s.makers.setBy(m, f) } else s
  def endMaker(s: Store, m: int): Store = setM(s, m, y => { ...y, ended: true, claim: false })
  def ghost(s: Store, f: Ghost => Ghost): Store = { ...s, g: f(s.g) }
  // A change in effect counts toward D7. Shrink: the next points must be fewer.
  def counted(s: Store): Store =
    { ...s, changes: s.changes + 1,
      ptsBound: if (OPT.d7 == 2) s.lastPts - 1 else s.ptsBound }
  // A raise opens the task's evaluation (or, past the budget, the person's decision).
  def raise(s: Store, i: int, tries: int): Store =
    val s1 = endMaker(s, tk(s, i).maker)
    val s2 = setT(s1, i, t => { ...t, st: Raised, tries: tries })
    val st = if (overBudget(s)) SPerson else SEval
    setF(s2, i, f => { ...CLOSED, stage: st, step: f.step + 1, base: s.dir, cardBase: s.card })
  // The work goes back to the role as a task (a fresh maker, no tries used).
  def backToRole(s: Store, i: int): Store =
    setF(setT(s, i, t => { ...t, st: Sent, tries: 0, maker: -1 }), i,
         f => { ...CLOSED, step: f.step + 1 })
  // A direction (or standards) change takes effect.
  def dirInEffect(s: Store, i: int): Store =
    val f = fx(s, i)
    val s0 = ghost(s, g => { ...g,
      failedTest: g.failedTest or (hasMech(f.form) and not(f.truth)),
      noForm: g.noForm or f.form == NoForm,
      lostUpdate: g.lostUpdate or f.base < s.dir })
    val s1 = counted({ ...s0, dir: s.dir + 1, mechInEffect: s.mechInEffect or hasMech(f.form) })
    val s2 = if (not(OPT.staleRedo)) s1 else
      SLOTS.fold(s1, (acc, j) =>
        if (tk(acc, j).st == InReview and tk(acc, j).rUnder < acc.dir)
          setM(setT(acc, j, t => { ...t, st: Working }), tk(acc, j).maker,
               y => { ...y, revs: y.revs + 1 })
        else acc)
    if (not(OPT.rebase)) s2 else
      SLOTS.fold(s2, (acc, j) =>
        if (j != i and fx(acc, j).kind == DDir and fx(acc, j).stage != SClosed
            and fx(acc, j).entry != SClosed
            and Set(SPrinciple, SDirAssess, SStdAssess, SRuleAssess, STest, SDraft, SLoop,
                    SAtPerson).contains(fx(acc, j).stage))
          setF(acc, j, z => { ...z, stage: z.entry, base: acc.dir, rev: z.rev + 1,
                              step: z.step + 1 })
        else acc)
  def cardInEffect(s: Store, i: int): Store =
    val f = fx(s, i)
    val s0 = ghost(s, g => { ...g, lostUpdate: g.lostUpdate or f.cardBase < s.card })
    val s1 = counted({ ...s0, card: s.card + 1 })
    if (not(OPT.rebase)) s1 else
      SLOTS.fold(s1, (acc, j) =>
        if (j != i and fx(acc, j).kind == DRole
            and (fx(acc, j).stage == SLoop or fx(acc, j).stage == SAtPerson))
          setF(acc, j, z => { ...z, stage: SLoop, cardBase: acc.card, rev: z.rev + 1,
                              step: z.step + 1 })
        else acc)
  def staleFixAct(s: Store, i: int, a: Act): Store =
    ghost(s, g => { ...g, staleFix: g.staleFix or (not(a.old) and a.seen != fx(s, i).step) })
  def bump(s: Store, i: int): Store = setF(s, i, f => { ...f, step: f.step + 1 })

  def effect(s: Store, a: Act): Store = match a.what {
    | OpenTop => { ...s, top: { ...s.top, hosted: true, warned: false } }
    | EndProject => { ...s, top: { ...s.top, ended: true } }
    | Reject(i) =>
        val s1 = ghost(s, g => { ...g, unseenReject: g.unseenReject or a.seen != tk(s, i).rid })
        raise({ ...s1, lastPts: s.ptsBound }, i, tk(s, i).tries)
    | Accept(i) =>
        val f = fx(s, i)
        val s1 = ghost(s, g => { ...g,
          unseenAccept: g.unseenAccept or a.seen != f.step,
          rejectedInEffect: g.rejectedInEffect or (f.sentBack.contains(f.rev) and a.seen < f.step) })
        val s2 = bump(if (f.kind == DDir) dirInEffect(s1, i) else cardInEffect(s1, i), i)
        // "only a role change?" yes: back to the card, the work goes on. no: host reassigns.
        if (f.kind == DRole and f.roleOnly) backToRole(s2, i)
        else setF(s2, i, z => { ...z, stage: SAccepted })
    | SendBack(i) => setF(s, i, f => { ...f, stage: SLoop, sentBack: f.sentBack.union(Set(f.rev)),
                                       step: f.step + 1 })
    | Decide(i) =>
        setF(setT(s, i, t => { ...t, st: Done }), i, f => { ...CLOSED, step: f.step + 1 })
    | SendTask(i) => setT(s, i, t => { ...t, st: Sent })
    | Reassign =>
        val s1 = counted(s)
        SLOTS.fold(s1, (acc, j) =>
          if (fx(acc, j).stage == SAccepted) backToRole(acc, j)
          else if (tk(acc, j).st == Working or tk(acc, j).st == InReview)
            setT(endMaker(acc, tk(acc, j).maker), j, t => { ...t, st: Sent, tries: 0, maker: -1 })
          else acc)
    | RemakeTop =>
        if (not(OPT.c1Keep) and not(s.top.warned)) { ...s, top: { ...s.top, warned: true } }
        else
          val s1 = counted(s.makers.keys().fold(s, (acc, m) => endMaker(acc, m)))
          { ...s1,
            top: { ...s.top, hosted: OPT.c1Keep, warned: false, remakes: s.top.remakes + 1 },
            tasks: SLOTS.mapBy(i => { ...FRESH_TASK, gen: tk(s, i).gen + 1 }),
            fixes: SLOTS.mapBy(i => { ...CLOSED, step: fx(s, i).step + 1 }) }
    | AssignDo(i) =>
        val m = s.nextMaker
        val s1 = { ...s, nextMaker: m + 1, makers: s.makers.put(m,
          { slot: i, ended: false, claim: false, brief: -1, revs: 0 }) }
        setT(s1, i, t => { ...t, st: Working, tries: 0, maker: m })
    | Review(i) =>
        val t = tk(s, i)
        val s1 = ghost(s, g => { ...g, otherResult: g.otherResult or a.seen != t.rid })
        match a.v {
          | Pass =>
              val s2 = ghost(s1, g => { ...g,
                otherVersion: g.otherVersion or t.rUnder != s.dir,
                passBroken: g.passBroken or (t.rBreaks and s.mechInEffect) })
              setT(endMaker(s2, t.maker), i, z => { ...z, st: Done })
          // The revision goes to the same maker, which keeps its claim and context.
          | Fail => setM(setT({ ...s1, lastPts: a.pts }, i,
                              z => { ...z, st: Working, tries: z.tries + 1 }),
                         t.maker, y => { ...y, revs: y.revs + 1 })
          | RaiseTries => raise({ ...s1, lastPts: a.pts }, i, t.tries + 1)
          | RaiseNoRule => raise({ ...s1, lastPts: a.pts }, i, t.tries)
          | RaiseMisses => raise({ ...s1, lastPts: a.pts }, i, t.tries)
        }
    | Resume(m) => { ...s, down: s.down.exclude(Set(m)) }
    | ReadBrief(m) => setM(s, m, y => { ...y, claim: true, brief: s.dir })
    | Report(m) =>
        val y = mk(s, m)
        val s1 = ghost(s, g => { ...g, staleReport: g.staleReport or (not(a.old) and a.seen != y.revs),
                                 endedActed: g.endedActed or y.ended })
        setT(s1, y.slot, t => { ...t, st: InReview, rid: t.rid + 1, rUnder: y.brief,
                                rBreaks: a.flag })
    | Evaluate(i) =>
        val s1 = bump(staleFixAct(s, i, a), i)
        match a.level {
          | Split =>
              val s2 = counted(s1)
              setF(setT(s2, i, t => { ...t, gen: t.gen + 1, st: Sent, tries: 0, maker: -1 }), i,
                   f => { ...CLOSED, step: f.step })
          | Fit => setF(s1, i, f => { ...f, kind: DRole, stage: SLoop, entry: SLoop,
                                      roleOnly: a.flag, cardBase: s.card })
          | Principle => setF(s1, i, f => { ...f, kind: DDir, stage: SPrinciple,
                                            entry: SPrinciple, std: false, base: s.dir })
          | Direct => setF(s1, i, f => { ...f, kind: DDir, stage: SDirAssess,
                                         entry: SDirAssess, std: false, base: s.dir })
          | Standard => setF(s1, i, f => { ...f, kind: DDir, stage: SStdAssess,
                                           entry: SStdAssess, std: true, base: s.dir })
        }
    | Advance(i) => setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, stage: nextStage(f.stage) })
    | WriteRule(i) =>
        setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, form: a.form, truth: a.flag,
          stage: if (hasMech(a.form)) STest else SDraft })
    | RunTest(i) =>
        val f = fx(s, i)
        val ok = if (OPT.harnessTest) f.truth else a.flag
        setF(bump(staleFixAct(s, i, a), i), i, z => { ...z,
          stage: if (ok) SDraft else SRuleAssess, ruleTries: z.ruleTries + if (ok) 0 else 1 })
    | Ship(i) =>
        val f = fx(s, i)
        val s1 = bump(staleFixAct(s, i, a), i)
        val isStd = if (OPT.classify) f.std else a.flag
        if (isStd)
          // "only a standard change?" yes: in effect at once; the work goes back to the role.
          backToRole(dirInEffect(ghost(s1, g => { ...g, deepNoPerson: g.deepNoPerson or not(f.std) }),
                                 i), i)
        else setF(s1, i, z => { ...z, stage: SLoop })
    | LoopReview(i) =>
        setF(bump(staleFixAct(s, i, a), i), i, f =>
          if (a.flag) { ...f, stage: SAtPerson }
          else { ...f, rev: f.rev + 1, loops: f.loops + 1 })
    | Revive(k) => { ...s, down: s.down.exclude(Set(k)) }
    // The terminal's exit, appended by the pump. Every exit ends the maker's claim (rule D6
    // of the earlier specs, kept: DESIGN.md does not speak of claims).
    | Exit(k) => setM({ ...s, down: s.down.union(Set(k)) }, k, y => { ...y, claim: false })
  }
  // ---- told: the Do steps each actor's wait prints, from the store alone
  def pipeDo(st: Stage, i: int): Set[What] =
    if (st == SEval) Set(Evaluate(i))
    else if (Set(SPrinciple, SDirAssess, SStdAssess).contains(st)) Set(Advance(i))
    else if (st == SRuleAssess) Set(WriteRule(i))
    else if (st == STest) Set(RunTest(i))
    else if (st == SDraft) Set(Ship(i))
    else if (st == SLoop) Set(LoopReview(i))
    else Set()
  def makerDos(s: Store, m: int): Set[What] =
    if (not(makerAt(s, m))) Set()
    else if (not(mk(s, m).claim) or (OPT.staleRedo and mk(s, m).brief < s.dir)) Set(ReadBrief(m))
    else Set(Report(m))
  def dos(s: Store, k: int): Set[What] =
    if (s.top.ended) Set()
    else if (k == PERSON)
      val top = if (not(s.top.hosted)) Set(OpenTop) else Set()
      val end = if (s.top.hosted and allDone(s)) Set(EndProject) else Set()
      val drafts = SLOTS.filter(i => fx(s, i).stage == SAtPerson)
      val decide = SLOTS.filter(i => fx(s, i).stage == SPerson).map(i => Decide(i))
      top.union(end).union(drafts.map(i => Accept(i))).union(drafts.map(i => SendBack(i)))
        .union(decide)
    else if (k == HOST)
      if (not(s.top.hosted)) Set() else
      val sends = SLOTS.filter(i => tk(s, i).st == Unsent).map(i => SendTask(i))
      sends.union(if (SLOTS.exists(i => fx(s, i).stage == SAccepted)) Set(Reassign) else Set())
    else if (k == ROLE)
      if (not(s.top.hosted)) Set() else
      val assigns = SLOTS.filter(i => tk(s, i).st == Sent).map(i => AssignDo(i))
      val reviews = SLOTS.filter(i => tk(s, i).st == InReview).map(i => Review(i))
      val resumes = SLOTS.map(i => liveMaker(s, i)).filter(m => m >= 0 and s.down.contains(m))
        .map(m => Resume(m))
      assigns.union(reviews).union(resumes)
    else if (k == PIPE) SLOTS.fold(Set(), (acc, i) => acc.union(pipeDo(fx(s, i).stage, i)))
    else if (k == HARNESS) PERSISTENT.filter(p => s.down.contains(p)).map(p => Revive(p))
    else makerDos(s, k)
  def actorsOf(s: Store): Set[int] =
    Set(PERSON, HARNESS).union(PERSISTENT).union(s.makers.keys())
  def toldOf(s: Store): int -> Set[What] = actorsOf(s).mapBy(k => dos(s, k))

  // ---- obligations: what must happen next, from the protocol's state alone
  type Ob = OpenTopOb | EndOb | SendOb(int) | AssignOb(int) | MakeOb(int) | ResumeOb(int)
          | ReviewOb(int) | PipeOb(int) | DraftOb(int) | DecideOb(int) | ReassignOb
          | ReviveOb(int)
  def slotObs(s: Store, i: int): Set[Ob] =
    val t = tk(s, i)
    val st = fx(s, i).stage
    if (t.st == Unsent) Set(SendOb(i))
    else if (t.st == Sent) Set(AssignOb(i))
    else if (t.st == Working)
      if (t.maker >= 0 and s.down.contains(t.maker)) Set(ResumeOb(t.maker)) else Set(MakeOb(t.maker))
    else if (t.st == InReview) Set(ReviewOb(i))
    else if (t.st == Raised)
      if (pipeStage(st)) Set(PipeOb(i))
      else if (st == SAtPerson) Set(DraftOb(i))
      else if (st == SPerson) Set(DecideOb(i))
      else if (st == SAccepted) Set(ReassignOb)
      else Set()
    else Set()
  def obligationsOf(s: Store): Set[Ob] =
    if (s.top.ended) Set()
    else if (not(s.top.hosted)) Set(OpenTopOb)
    else if (allDone(s)) Set(EndOb)
    else
      val revive = PERSISTENT.filter(p => s.down.contains(p)).map(p => ReviveOb(p))
      SLOTS.fold(revive, (acc, i) => acc.union(slotObs(s, i)))
  def discharges(ob: Ob, k: int, x: What): bool = match ob {
    | OpenTopOb => x == OpenTop
    | EndOb => x == EndProject
    | SendOb(i) => x == SendTask(i)
    | AssignOb(i) => x == AssignDo(i)
    | MakeOb(m) => k == m and (x == ReadBrief(m) or x == Report(m))
    | ResumeOb(m) => x == Resume(m)
    | ReviewOb(i) => x == Review(i)
    | PipeOb(i) => k == PIPE and Set(Evaluate(i), Advance(i), WriteRule(i), RunTest(i), Ship(i),
        LoopReview(i)).contains(x)
    | DraftOb(i) => x == Accept(i) or x == SendBack(i)
    | DecideOb(i) => x == Decide(i)
    | ReassignOb => x == Reassign
    | ReviveOb(p) => x == Revive(p)
  }
  def isPersonOb(ob: Ob): bool = match ob {
    | OpenTopOb => true
    | EndOb => true
    | DraftOb(_) => true
    | DecideOb(_) => true
    | _ => false
  }
  def toldAny(s: Store, ob: Ob): Set[int] =
    actorsOf(s).filter(k => dos(s, k).exists(x => discharges(ob, k, x)))
  // Final for progress: the project ended, or what is owed is owed by the person only.
  def finalOf(s: Store): bool =
    s.top.ended or (obligationsOf(s) != Set() and obligationsOf(s).forall(ob => isPersonOb(ob)))
  // The model's bounds: a run past them leaves the model (progress is checked inside them).
  def pastBound(s: Store): bool =
    s.nextMaker > OPT.maxMakers + 2 or s.changes > OPT.maxChanges
}
