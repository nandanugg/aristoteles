// The environment around the store of work.qnt (plan/model/DESIGN.md sections 7 and 8).
// Its own machines: the network of acts (a message soup), the processes (agents, honest or
// Byzantine, each with its own view), tmux (tmux.qnt), the web page, the person.
// README.md has the words, the options, the properties with their tiers, and the limits.
module workenv {
  const CFG: {
    crossTest: bool, raiseLevel: bool, recheckBasis: bool, slots: Set[int], basis: bool, build: bool, rebase: bool, harnessTest: bool,
    classify: bool, passTests: bool, fullBrief: bool,
    endedCheck: bool, formCheck: bool, refCheck: bool, epochs: bool, reviseCheck: bool,
    rebind: bool, pumpReattach: bool, hostWatched: bool, promptArg: bool, idleSeen: bool,
    silentSteps: int, reviewSubagents: bool,
    editBack: int, acceptCheck: bool, decideRecheck: bool, briefCheck: bool,
    strictScope: bool, sections: int, listOnAttach: bool,
    ladderRoute: bool, maxTries: int, maxMakers: int, maxLoops: int,
    maxRuleTries: int,
  }
  // byz*: that agent class is Byzantine (else honest). crash: processes die and resume.
  // tmuxFaults: server kill, lost socket, pump detached or closed, the person typing.
  // page: old builds. head: honest agents read only the first line of their wait.
  // reject: the person rejects results. causes: the real causes a new task may have
  // (0 none, 1 split, 2 fit, 3 principle, 4 direct, 5 standard; CAUSE_OF).
  // maxFaults: environment faults; maxNet: acts in flight; maxPerson: the person's acts.
  // printsOften: the assumption that a live terminal prints or renews its wait beat at least
  // once in x ticks (its AI CLI streams output; `work wait` beats); false only in a mutant.
  // starts: the starting states the run may begin in (START_OF): 0 two new tasks; 1 both
  // done and the top returned; 2 a standards draft about to ship; 3 a direction draft at the
  // person; 4 rules with only a test command in effect; 5 a task the person took as is, with
  // a recheck pending; 6 a done task with a recheck pending; 7 a done task with a recheck
  // pending that the change did not break, and a direction draft of the other task at the
  // person (its accept may break the done task while a recheck is in flight); 8 a direction
  // draft of task 0 at the person while a standards draft of the other task, on task 0's
  // standard, is about to ship (the person may take task 0 as is after the change); 9 task 0
  // in revision: its maker (id 3, process 3) holds its claim after one failed review; 10 near
  // the change bound: task 0 a split part (one section, a standard cause) and task 1 done
  // after its standard change (2 agent changes; one more is changeBound - 1); 11 a direction
  // draft of task 0 at the person while task 1's standards draft, a reference-only rule that
  // contradicts task 0's rule (crossTest cannot see it), is about to ship; 12 both tasks at
  // the top rung (floor principle): task 0's principle draft, a fighting reference-only rule,
  // about to ship, task 1 done.
  // liars: the actors (HOST, ROLE, PIPE; 3 for makers) that are honest except for lies: an
  // act with any content, at most maxLies lies, only on the act kinds in lieOn (KIND_OF;
  // empty: any). dups: the network may deliver an act twice. bounded: every counter stops at
  // its cap (maxProcs, maxVer, maxStep), for TLC. misjudge: an honest pipeline role may evaluate
  // shallower than the real cause (a mistake, not a lie).
  const ENV: {
    byzMaker: bool, byzRole: bool, byzPipe: bool, byzHost: bool, crash: bool,
    tmuxFaults: bool, page: bool, head: bool, reject: bool, maxFaults: int, maxNet: int,
    maxPerson: int, causes: Set[int], starts: Set[int], printsOften: bool, liars: Set[int],
    misjudge: bool, dups: bool, maxLies: int, lieOn: Set[int], bounded: bool, maxProcs: int,
    maxVer: int, maxStep: int,
  }
  import work(OPT = CFG).* from "./work"
  import tmux.* from "./tmux"

  // A process of an actor. ep: its token's epoch. gen: the agents' server it started in
  // (-1: the person's tmux, or inside the role's process). starting: its prompt is not yet
  // read. ctx: it has the context of its work. stale: it was resumed with that context and
  // may act on its old view and repeat its last act until it reads again. view, todo: the
  // store and the steps as of its last read. last: its last act. waiting: for the answer.
  // limited: the AI CLI hit its usage limit (it shows the message and stops). unseen: it
  // ended while the pump was not attached (a control client sees only the ends it is
  // attached for).
  type Proc = { actor: int, ep: int, gen: int, up: bool, idle: bool, starting: bool,
                ctx: bool, stale: bool, view: Store, todo: Set[What], last: Set[Act],
                waiting: bool, wakes: int, limited: bool, unseen: bool }
  type ReadMode = Full | Head | Drop
  type Page = { view: Store, oldBuild: bool, acts: int }
  type Event =
    | Start | Posted(Act) | Repeated(Act) | Taken(Act) | TakenKept(Act) | Refused(Act)
    | Read((int, ReadMode)) | Crashed(int) | SelfResumed(int) | Stopped(int) | Woke(int)
    | ServerKilled | SocketLost | ServerRecreated | PumpStolen | PageServerRestarted
    | PumpAttached | Typed(int) | Cleared(int) | PromptRead((int, bool))
    | PageRefreshed | PageDeployed | PageReloaded | Polled(int) | Ticked | Printed(int)
    | Limited(int) | LimitLifted(int) | Rebooted

  var s: Store
  var net: Set[Act]            // acts sent and not yet appended or refused (unordered)
  var procs: int -> Proc       // every process ever started, by process id
  var tm: Tmux
  var page: Page
  var faults: int
  var merged: bool             // history: a prompt merged with the person's typing was read
  // Wait markers: per persistent role, the ticks since its process last polled its wait.
  var silence: int -> int
  // Per persistent role, the ticks since its terminal last printed (it acted or read).
  var quiet: int -> int
  var lies: int                // lies told so far (ENV.maxLies)
  var lastEvent: Event
  // For model-based testing: each actor's Do steps, and what is owed, in every state.
  var told: int -> Set[What]
  var obligations: Set[Ob]

  pure val VERDICTS = Set(Pass, Fail, RaiseTries, RaiseNoRule, RaiseMisses)
  pure val LEVELS = Set(Split, Fit, Principle, Direct, Standard)
  // Act kinds a liar may lie on (ENV.lieOn).
  pure def KIND_OF(x: What): int = match x {
    | Review(_) => 0 | Evaluate(_) => 1 | WriteRule(_) => 2 | RunTest(_) => 3 | Ship(_) => 4
    | LoopReview(_) => 5 | RecheckDone(_) => 6 | Report(_) => 7 | _ => 8 }
  pure def CAUSE_OF(n: int): Cause =
    if (n == 1) CauseAt(Split) else if (n == 2) CauseAt(Fit) else if (n == 3) CauseAt(Principle)
    else if (n == 4) CauseAt(Direct) else if (n == 5) CauseAt(Standard) else NoCause
  def envCauses: Set[Cause] = ENV.causes.map(n => CAUSE_OF(n))
  pure val FORMS = Set(NoForm, Mech, Ref, Both)
  pure val BOOLS = Set(true, false)
  // The tasks a change may break (the environment's truth).
  pure val HITS = Set(Set(), Set(0), Set(1), Set(0, 1))
  pure val PANES = PERSISTENT   // a pane per persistent role; makers live in the role's
  pure val MAKER_IDS = 3.to(8)

  // ---- reads
  def isByz(k: int): bool =
    if (k == HOST) ENV.byzHost else if (k == ROLE) ENV.byzRole
    else if (k == PIPE) ENV.byzPipe else k >= 3 and ENV.byzMaker
  def pr(p: int): Proc = procs.get(p)
  def procsOf(k: int): Set[int] = procs.keys().filter(p => pr(p).actor == k)
  def active(p: int): bool = pr(p).up and not(pr(p).starting)
  // A process hears its steps while it runs past its prompt and within its usage limit.
  def runs(k: int): bool = procsOf(k).exists(p => active(p) and not(pr(p).limited))
  // An actor hears its Do steps: the person (the page), the harness, an agent with a running
  // process past its prompt (a property of the model, not something an agent reads).
  def hears(k: int): bool = k < 0 or runs(k)
  // Acts of sender k in flight (each sender has at most ENV.maxNet).
  def sent(k: int): int = net.filter(a => a.who == k).size()
  def polled(k: int): int -> int = if (silence.keys().contains(k)) silence.set(k, 0) else silence
  def printed(k: int): int -> int = if (quiet.keys().contains(k)) quiet.set(k, 0) else quiet
  def latest(k: int): Set[int] =
    procsOf(k).filter(p => procsOf(k).forall(q => q <= p))
  // The first line a wait prints (head): the lowest rank.
  def rank(x: What): int = match x {
    | Resume(m) => m | Review(i) => 10 + i | AssignDo(i) => 20 + i | SendTask(i) => 30 + i
    | Evaluate(i) => 40 + i | Advance(i) => 40 + i | WriteRule(i) => 40 + i
    | RunTest(i) => 40 + i | Ship(i) => 40 + i | LoopReview(i) => 40 + i
    | Accept(i) => 50 + i | SendBack(i) => 60 + i | Decide(i) => 70 + i
    | Revive(k) => 80 + k | _ => 90
  }
  def headOf(xs: Set[What]): Set[What] = xs.filter(x => xs.forall(y => rank(x) <= rank(y)))
  def mkAct(k: int, ep: int, x: What, seen: int, seenDir: int, old: bool, byz: bool, ctx: bool,
            pid: int): Act =
    { who: k, ep: ep, what: x, seen: seen, seenDir: seenDir, old: old, v: Pass,
      level: Standard, flag: true, flag2: true, flag3: false, form: Ref, cause: NoCause,
      items: Set(),
      real: Set(), hits: Set(), vers: ZERO, realVers: ZERO, byz: byz, ctx: ctx, pid: pid }
  // Every content an act x may carry (only the fields x uses vary).
  def variants(b: Act): Set[Act] = whatVariants(b, b.what)
  def whatVariants(b: Act, x: What): Set[Act] = match x {
    | Review(_) => VERDICTS.map(v => { ...b, v: v })
    | Evaluate(_) => LEVELS.fold(Set(), (acc, l) => acc.union(BOOLS.fold(Set(), (a2, f) =>
        a2.union(BOOLS.fold(Set(), (a3, f2) => a3.union(envCauses.map(c =>
          { ...b, level: l, flag: f, flag2: f2, cause: c })))))))
    | WriteRule(_) => FORMS.fold(Set(), (acc, fm) => acc.union(BOOLS.fold(Set(), (a2, f) =>
        a2.union(BOOLS.fold(Set(), (a3, f2) => a3.union(BOOLS.map(f3 =>
          { ...b, form: fm, flag: f, flag2: f2, flag3: f3 })))))))
    | Ship(_) => ITEMSETS.fold(Set(), (acc, xs) => acc.union(ITEMSETS.fold(Set(), (a2, ys) =>
        a2.union(HITS.map(h => { ...b, items: xs, real: ys, hits: h })))))
    | Accept(_) => HITS.map(h => { ...b, hits: h })
    | _ => BOOLS.fold(Set(), (acc, f) => acc.union(BOOLS.map(f2 => { ...b, flag: f, flag2: f2 })))
  }
  // An honest agent's content, on its own view: it reviews correctly (it runs the test
  // commands; on a rule with both forms it judges the candidates), evaluates at the real
  // cause, reports its test runs as they printed, labels a draft by its content, revises a
  // draft the person sent back, writes real references. Its maker's slips, the test
  // command's real behaviour and the real causes of new tasks are the environment's choice.
  def honestContent(v: Store, a: Act): bool = match a.what {
    | Review(i) =>
        val t = tk(v, i)
        val left = t.tries + 1 < CFG.maxTries
        if (not(t.rBad)) a.v == Pass
        else if (t.cause == NoCause) a.v == (if (left) Fail else RaiseTries)
        else a.v != Pass and (a.v != Fail or left) and (a.v != RaiseTries or not(left))
    // At the real cause (with misjudge: possibly shallower), and one level up after a fix
    // (raiseLevel): the floor wins when it is deeper.
    | Evaluate(i) =>
        val t = tk(v, i)
        val atCause = match t.cause {
          | NoCause => true
          | CauseAt(c) => a.level == c
              or (ENV.misjudge and depth(a.level) < depth(c) and a.level != Fit) }
        // With raiseLevel the task's floor wins: a level below it is refused, and the floor
        // itself is taken when the cause is below it.
        val floored = CFG.raiseLevel and a.level != Fit
        val atFloor = floored and a.level == t.floor and match t.cause {
          | CauseAt(c) => c != Fit and depth(c) < depth(t.floor) | NoCause => true }
        or { atCause, atFloor }
          and not(floored and depth(a.level) < depth(t.floor))
          and (a.level != Fit or a.flag == a.flag2)
    | WriteRule(_) => a.form != NoForm and a.flag2
    | RunTest(i) => a.flag == fx(v, i).truth and a.flag2 == (CFG.crossTest and fx(v, i).fights)
    | Ship(i) => a.real.contains(IDir) == (fx(v, i).entry != SStdAssess) and a.items == a.real
        and fx(v, i).wrote.forall(x => a.real.contains(x))
    | RecheckDone(i) => a.flag == not(tk(v, i).broken)
    | LoopReview(i) => not(a.flag and fx(v, i).needRevise)
    | _ => true
  }
  // What the page lets the person do, on the page's view (a reject only of a result shown).
  def personWhats(v: Store): Set[What] =
    val end = if (v.top.done and allDone(v)) Set(EndProject) else Set()
    val per = SLOTS.fold(Set(), (acc, i) => acc
      .union(if (ENV.reject and tk(v, i).rid >= 0
                 and (tk(v, i).st == InReview or tk(v, i).st == Done))
               Set(Reject(i)) else Set())
      .union(if (fx(v, i).stage == SAtPerson) Set(Accept(i), SendBack(i)) else Set())
      .union(if (legal(v, { ...NOACT, what: Decide(i) })) Set(Decide(i)) else Set()))
    // Run continue: once per model run (a bound of the model).
    val edit = if (fx(v, EDIT).stage == SClosed) Set(EditDirection) else Set()
    val acc = FIXIDS.filter(i => free(i) and fx(v, i).stage == SAtPerson)
      .fold(Set(), (a2, i) => a2.union(Set(Accept(i), SendBack(i))))
    end.union(per).union(edit).union(acc)
      .union(if (v.session < 1) Set(MoveHost) else Set())
  def allWhats: Set[What] =
    val perSlot = SLOTS.fold(Set(), (acc, i) => acc.union(Set(Reject(i), Accept(i), SendBack(i),
      Decide(i), SendTask(i), AssignDo(i), Review(i), Evaluate(i), Advance(i), WriteRule(i),
      RunTest(i), Ship(i), LoopReview(i), RecheckDone(i), RunRule(i))))
      .union(FIXIDS.filter(i => free(i)).fold(Set(), (acc, i) => acc.union(Set(Advance(i),
                 WriteRule(i), RunTest(i), Ship(i), LoopReview(i), Accept(i), SendBack(i)))))
    val perMaker = s.makers.keys().fold(Set(), (acc, m) =>
      acc.union(Set(Resume(m), ReadBrief(m), Report(m), Exit(m))))
    Set(EndProject, MoveHost, EditDirection, Reassign, TopDone).union(perSlot)
      .union(perMaker).union(PERSISTENT.map(p => Revive(p)))

  // ---- obligations and told (the told-once tier)
  def toldTo(ob: Ob): Set[int] = toldAny(s, ob).filter(k => hears(k))
  // The engine owes the next move for an actor that does not hear: its revive (the harness),
  // its prompt (read once the line is clear), or the report of its exit (the pump, attached
  // or about to attach; the hook inside the role for a maker; for the host, only with
  // hostWatched).
  // The pump can report the end of a pane only if it can see it: it is attached (or about
  // to attach) and, without listOnAttach, the pane did not end while it was away.
  def pumpSees(k: int): bool = (tm.pump or tm.pending)
    and (CFG.listOnAttach or not(procsOf(k).exists(p => pr(p).unseen and not(pr(p).up))))
  def engineOwes(k: int): bool =
    if (s.down.contains(k)) PERSISTENT.contains(k)
    // A process at its usage limit: the limit lifts (a fair step), then it goes on.
    else if (procsOf(k).exists(p => active(p) and pr(p).limited)) true
    // A typed prompt (promptArg off) is read once the line is ready.
    else if (procsOf(k).exists(p => pr(p).up and pr(p).starting))
      PANES.contains(k) and promptReady(tm, k)
    else if (k == HOST) CFG.hostWatched
    else if (k == ROLE or k == PIPE) pumpSees(k)
    else runs(ROLE) or pumpSees(ROLE)
  def waitsLegally(ob: Ob): bool =
    val t = toldAny(s, ob)
    t.size() == 1 and t.forall(k => k >= 0 and not(hears(k)) and engineOwes(k))
  // What an honest sender puts in an act built on view v: the item versions of v, and for a
  // recheck the items pending in v (the items it judged).
  def built(v: Store, b: Act): Act = { ...b, vers: v.ver, realVers: v.ver,
    items: match b.what { | RecheckDone(i) => tk(v, i).pend.filter(y => not(testRule(v, y)))
                          | _ => b.items } }
  def doable(k: int, x: What): bool =
    variants(built(s, mkAct(k, epOf(s, k), x, cur(s, x), vsum(s), false, false, true, -1)))
      .exists(a => accept(s, a) and honestContent(s, a))

  // ---- the commit of a step: every variable, and the derived ones
  action commitS(ns: Store, nn: Set[Act], np: int -> Proc, nt: Tmux, npg: Page, nf: int,
                 nm: bool, nsil: int -> int, nq: int -> int, ev: Event): bool = all {
    s' = ns, net' = nn, procs' = np, tm' = nt, page' = npg, faults' = nf, merged' = nm,
    silence' = nsil, quiet' = nq, lies' = lies, lastEvent' = ev, told' = toldOf(ns),
    obligations' = obligationsOf(ns),
  }
  // Every step but a poll or a tick leaves the wait markers as they are.
  action commit(ns: Store, nn: Set[Act], np: int -> Proc, nt: Tmux, npg: Page, nf: int,
                nm: bool, ev: Event): bool =
    commitS(ns, nn, np, nt, npg, nf, nm, silence, quiet, ev)
  // A step that prints in the actor's terminal (it acted or read).
  action commitP(k: int, ns: Store, nn: Set[Act], np: int -> Proc, nt: Tmux, npg: Page,
                 nf: int, nm: bool, ev: Event): bool =
    commitS(ns, nn, np, nt, npg, nf, nm, silence, printed(k), ev)
  def freshProc(k: int, ep: int, gen: int, v: Store): Proc =
    { actor: k, ep: ep, gen: gen, up: true, idle: false, starting: false, ctx: true,
      stale: false, view: v, todo: Set(), last: Set(), waiting: false, wakes: 0,
      limited: false, unseen: false }
  // The starting states (ENV.starts), so deep corners are reached without a long prefix.
  def doneAt(st: Store, i: int): Store = { ...st, tasks: st.tasks.set(i,
    { ...tk(st, i), st: Done, rid: 0, cause: NoCause, checked: st.ver }) }
  def raisedAt(st: Store, i: int, f: Fix): Store = { ...st,
    tasks: st.tasks.set(i, { ...tk(st, i), st: Raised, rid: 0 }), fixes: st.fixes.set(i, f) }
  def START_OF(n: int, sN: Store): Store =
    val d1 = doneAt(sN, 1)
    if (n == 1) { ...doneAt(d1, 0), top: { ...sN.top, done: true } }
    // A standards draft about to ship, on items already fixed once at standard level.
    else if (n == 2) { ...raisedAt(d1, 0, { ...CLOSED, stage: SDraft, entry: SStdAssess,
      level: Standard, kind: DDir, form: Mech, truth: true, step: 1 }),
      fixDepth: ITEMS.mapBy(x => if (x == IDir) -1 else 1) }
    else if (n == 3) raisedAt(d1, 0, { ...CLOSED, stage: SAtPerson, entry: SDirAssess,
      level: Direct, kind: DDir, items: Set(IDir), real: Set(IDir), step: 1 })
    else if (n == 4) { ...sN, ruleForm: Set(0, 1).mapBy(j => Mech) }
    else if (n == 5)
      val v5 = ZERO.set(IStd(0), 1)
      { ...d1, ver: v5, tasks: d1.tasks.set(0, { ...tk(d1, 0), st: Done, rid: 0, taken: true,
          cause: NoCause, checked: ZERO, pend: Set(IStd(0)), broken: false, rBad: true })
          .set(1, { ...tk(d1, 1), checked: v5 }) }
    else if (n == 6)
      val v1 = ZERO.set(IDir, 1)
      { ...d1, ver: v1, tasks: d1.tasks.set(0, { ...tk(d1, 0), st: Done, rid: 0,
          cause: NoCause, checked: ZERO, pend: Set(IDir), broken: true, rBad: true })
          .set(1, { ...tk(d1, 1), checked: v1 }) }
    else if (n == 7)
      val v7 = ZERO.set(IStd(0), 1)
      val r7 = raisedAt({ ...sN, ver: v7 }, 1, { ...CLOSED, stage: SAtPerson,
        entry: SDirAssess, level: Direct, kind: DDir, items: Set(IDir), real: Set(IDir),
        step: 1 })
      { ...r7, tasks: r7.tasks.set(0, { ...tk(r7, 0), st: Done, rid: 0, cause: NoCause,
          checked: ZERO, pend: Set(IStd(0)), broken: false }) }
    else if (n == 8)
      val r8 = raisedAt(sN, 0, { ...CLOSED, stage: SAtPerson, entry: SDirAssess,
        level: Direct, kind: DDir, items: Set(IDir), real: Set(IDir), step: 1 })
      raisedAt(r8, 1, { ...CLOSED, stage: SDraft, entry: SStdAssess, level: Standard,
        kind: DDir, form: Mech, truth: true, items: Set(IStd(0)), real: Set(IStd(0)),
        step: 1 })
    else if (n == 9)
      { ...sN, nextMaker: 4, ep: sN.ep.put(3, 0),
        makers: sN.makers.put(3, { slot: 0, ended: false, claim: true, brief: ZERO, revs: 1 }),
        tasks: sN.tasks.set(0, { ...tk(sN, 0), st: Working, tries: 1, maker: 3, rid: 1,
                                 rBad: false }) }
    else if (n == 12)
      val r12 = raisedAt(sN, 0, { ...CLOSED, stage: SDraft, entry: SPrinciple, level: Principle,
        kind: DDir, form: Ref, truth: true, refOk: true, fights: true,
        items: Set(IDir, IRule(0)), real: Set(IDir, IRule(0)), step: 1 })
      { ...r12, tasks: r12.tasks
          .set(0, { ...tk(r12, 0), floor: Principle })
          .set(1, { ...tk(r12, 1), st: Done, rid: 0, cause: NoCause, floor: Principle }) }
    else if (n == 11)
      val r11 = raisedAt(sN, 0, { ...CLOSED, stage: SAtPerson, entry: SDirAssess,
        level: Direct, kind: DDir, items: Set(IDir), real: Set(IDir), step: 1 })
      raisedAt(r11, 1, { ...CLOSED, stage: SDraft, entry: SStdAssess, level: Standard,
        kind: DDir, form: Ref, truth: true, refOk: true, fights: true,
        items: Set(IRule(1)), real: Set(IRule(1)), step: 1 })
    else if (n == 10)
      { ...sN, agentChanges: 2, changes: 2, tasks: sN.tasks
          .set(0, { ...freshTask(1, CauseAt(Standard)), st: Sent, floor: Standard,
                    sections: 1 })
          .set(1, { ...tk(sN, 1), st: Done, rid: 0, cause: NoCause, floor: Direct }) }
    else sN
  action init = {
    nondet c0 = envCauses.oneOf()
    nondet c1 = envCauses.oneOf()
    nondet n = ENV.starts.oneOf()
    val s0 = START_OF(n, initStore(Map(0 -> c0, 1 -> c1)))
    all {
      s' = s0, net' = Set(),
      procs' = Set(HOST, ROLE, PIPE).union(if (n == 9) Set(3) else Set())
        .mapBy(k => freshProc(k, 0, if (k == HOST or k >= 3) -1 else 0, s0)),
      tm' = initTmux(PANES), page' = { view: s0, oldBuild: false, acts: 0 }, faults' = 0,
      merged' = false, silence' = PERSISTENT.mapBy(k => 0), quiet' = PERSISTENT.mapBy(k => 0),
      lies' = 0,
      lastEvent' = Start, told' = toldOf(s0), obligations' = obligationsOf(s0),
    }
  }

  // ---- honest processes: read (the wait returns with ready work), then act on the view
  action procReads(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), not(pr(p).idle), not(pr(p).waiting), not(pr(p).limited),
    pr(p).todo == Set() or pr(p).stale, dos(s, pr(p).actor) != Set(),
    nondet mode = Set(Full).union(if (ENV.head) Set(Head) else Set())
      .union(if (ENV.head and faults < ENV.maxFaults) Set(Drop) else Set()).oneOf()
    val xs = dos(s, pr(p).actor)
    val todo = if (mode == Full) xs else if (mode == Head) headOf(xs) else Set()
    commitS(s, net, procs.setBy(p, q => { ...q, view: s, todo: todo, stale: false }), tm, page,
            faults + if (mode == Drop) 1 else 0, merged, polled(pr(p).actor),
            printed(pr(p).actor), Read((p, mode))),
  }
  // An honest process in its wait with nothing ready polls (its wait marker is fresh).
  action procPolls(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), not(pr(p).waiting), PERSISTENT.contains(pr(p).actor),
    not(pr(p).limited), dos(s, pr(p).actor) == Set(), silence.get(pr(p).actor) > 0,
    commitS(s, net, procs, tm, page, faults, merged, polled(pr(p).actor), quiet, Polled(p)),
  }
  // A working process prints in its terminal (it thinks, runs tools): a sign of life that is
  // not a wait poll.
  action procPrints(p: int): bool = all {
    active(p), not(pr(p).idle), not(pr(p).limited), PERSISTENT.contains(pr(p).actor),
    isByz(pr(p).actor) or pr(p).todo != Set() or pr(p).waiting, quiet.get(pr(p).actor) > 0,
    commitS(s, net, procs, tm, page, faults, merged, silence, printed(pr(p).actor), Printed(p)),
  }
  // A process hits the usage limit of its AI CLI: it shows the message and stops.
  action hitsLimit(p: int): bool = all {
    ENV.crash, faults < ENV.maxFaults, active(p), not(pr(p).limited),
    PERSISTENT.contains(pr(p).actor),
    commit(s, net, procs.setBy(p, z => { ...z, limited: true }), tm, page, faults + 1, merged,
           Limited(p)),
  }
  // Time passes: every persistent role's markers age (they stop at x, so time never ends).
  def aged(m: int -> int): int -> int =
    m.keys().mapBy(k => if (m.get(k) < CFG.silentSteps) m.get(k) + 1 else m.get(k))
  action tick: bool = all {
    PERSISTENT.exists(k => silence.get(k) < CFG.silentSteps or quiet.get(k) < CFG.silentSteps),
    // The timing assumption: a live terminal prints or renews its wait beat within x ticks.
    not(ENV.printsOften) or PERSISTENT.forall(k => live(k) implies
      (quiet.get(k) + 1 < CFG.silentSteps or silence.get(k) + 1 < CFG.silentSteps)),
    commitS(s, net, procs, tm, page, faults, merged, aged(silence), aged(quiet), Ticked),
  }
  action procActs(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), not(pr(p).idle), not(pr(p).waiting), not(pr(p).limited),
    sent(pr(p).actor) < ENV.maxNet,
    nondet x = pr(p).todo.oneOf()
    val q = pr(p)
    // A liar may send an act with any content (its own budget of lies; only the kinds named).
    val canLie = ENV.liars.contains(if (q.actor >= 3) 3 else q.actor) and lies < ENV.maxLies
      and (ENV.lieOn == Set() or ENV.lieOn.contains(KIND_OF(x)))
    nondet a = variants(built(q.view, mkAct(q.actor, q.ep, x, cur(q.view, x), vsum(q.view), false,
                                             false, q.ctx, p)))
      .filter(a => canLie or honestContent(q.view, a)).oneOf()
    val lie = not(honestContent(q.view, a))
    all {
      s' = s, net' = net.union(Set(a)),
      procs' = procs.setBy(p, z => { ...z, waiting: true, last: Set(a),
                                     todo: if (z.stale) z.todo else z.todo.exclude(Set(x)) }),
      tm' = tm, page' = page, faults' = faults, merged' = merged, silence' = silence,
      quiet' = printed(q.actor), lies' = lies + if (lie) 1 else 0, lastEvent' = Posted(a),
      told' = told, obligations' = obligations,
    }
  }
  // A process resumed with its old context sends its last act again (it never saw the answer).
  action procRepeats(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), pr(p).stale, not(pr(p).waiting), pr(p).last != Set(),
    not(pr(p).limited),
    sent(pr(p).actor) < ENV.maxNet,
    nondet a = pr(p).last.oneOf()
    commitP(pr(p).actor, s, net.union(Set(a)), procs.setBy(p, z => { ...z, waiting: true }), tm,
            page, faults, merged, Repeated(a)),
  }
  // ---- Byzantine processes: any act with their own token, any content and basis, any time
  action byzActs(p: int): bool = all {
    isByz(pr(p).actor), active(p), sent(pr(p).actor) < ENV.maxNet, not(pr(p).limited),
    // A step it is told (with any content and basis), any act of its own authority, or any
    // act at all (the token check refuses another's).
    val own = allWhats.filter(y => authority(mkAct(pr(p).actor, 0, y, 0, 0, false, true, true, p)))
    nondet pool = Set(dos(s, pr(p).actor), own, allWhats).filter(xs => xs != Set()).oneOf()
    nondet x = pool.oneOf()
    nondet seen = Set(cur(s, x) - 1, cur(s, x), cur(s, x) + 1).oneOf()
    nondet seenDir = Set(vsum(s) - 1, vsum(s)).oneOf()
    // It may claim any base for its content; the content is built on its own view.
    nondet vs = Set(s.ver, pr(p).view.ver).oneOf()
    nondet a = variants({ ...mkAct(pr(p).actor, pr(p).ep, x, seen, seenDir, false, true,
                                   pr(p).ctx, p), vers: vs, realVers: pr(p).view.ver }).oneOf()
    commit(s, net.union(Set(a)), procs, tm, page, faults, merged, Posted(a)),
  }
  // A process goes on after a stop at most twice (else random runs toggle forever).
  action byzStops(p: int): bool = all {
    isByz(pr(p).actor), active(p), not(pr(p).idle),
    commit(s, net, procs.setBy(p, z => { ...z, idle: true }), tm, page, faults, merged, Stopped(p)),
  }
  action byzWakes(p: int): bool = all {
    isByz(pr(p).actor), active(p), pr(p).idle, pr(p).wakes < 2,
    commitP(pr(p).actor, s, net, procs.setBy(p, z => { ...z, idle: false, wakes: z.wakes + 1 }),
            tm, page, faults, merged, Woke(p)),
  }

  // ---- the harness: the watcher revives (into a reachable server); the pump reports the
  // end of a pane it sees (the processes of the current server); the hook inside the role's
  // process reports a maker's end; the host's pane only with hostWatched.
  def harnessAct(x: What): Act = mkAct(HARNESS, 0, x, cur(s, x), vsum(s), false, false, true, -1)
  // The watcher revives into a reachable server; the harness runs a changed rule's test.
  action harnessRevives: bool = all {
    sent(HARNESS) < ENV.maxNet,
    nondet x = dos(s, HARNESS).oneOf()
    val ok = match x { | Revive(k) => k == HOST or reachable(tm) | _ => true }
    all { ok, not(net.exists(a => a.what == x)),
          commit(s, net.union(Set(harnessAct(x))), procs, tm, page, faults, merged,
                 Posted(harnessAct(x))) },
  }
  // The pump sees the end of a pane of the current server only if it was attached when the
  // pane ended, unless it lists the panes when it attaches (listOnAttach).
  def seenEnded(k: int): bool =
    procsOf(k).forall(p => pr(p).gen != tm.gen or not(pr(p).up)
                           or (CFG.idleSeen and pr(p).idle))
      and (CFG.listOnAttach or procsOf(k).forall(p => not(pr(p).unseen)))
  def exitDue(k: int): bool =
    not(s.down.contains(k)) and not(net.contains(harnessAct(Exit(k))))
      and (if (k == ROLE or k == PIPE) tm.pump and reachable(tm) and seenEnded(k)
           else if (k == HOST) CFG.hostWatched and not(runs(HOST))
           else isMaker(s, k) and not(mk(s, k).ended) and runs(ROLE)
                and procsOf(k).forall(p => not(pr(p).up)))
  action exitReported(k: int): bool = all {
    exitDue(k), sent(HARNESS) < ENV.maxNet,
    commit(s, net.union(Set(harnessAct(Exit(k)))), procs, tm, page, faults, merged,
           Posted(harnessAct(Exit(k)))),
  }

  // ---- the person through the page: an act the page shows, built on the page's view
  action personActs: bool = all {
    page.acts < ENV.maxPerson, sent(PERSON) < ENV.maxNet,
    nondet x = personWhats(page.view).oneOf()
    nondet f = BOOLS.oneOf()
    // An edit names what the person wrote (it changes the direction).
    nondet xs = ITEMSETS.filter(ys => ys.contains(IDir)).oneOf()
    // An accepted change may break tasks (the environment's truth).
    nondet h = HITS.oneOf()
    // flag3 (the environment's truth): the accepted direction change resolves a contradiction.
    nondet r = BOOLS.oneOf()
    val a = { ...mkAct(PERSON, 0, x, cur(page.view, x), vsum(page.view), page.oldBuild, false,
                       true, -1), flag: f, flag3: r, items: xs, hits: h, vers: page.view.ver,
              realVers: page.view.ver }
    commit(s, net.union(Set(a)), procs, tm, { ...page, acts: page.acts + 1 }, faults, merged,
           Posted(a)),
  }
  action pageRefreshes: bool = all {
    page.view != s,
    commit(s, net, procs, tm, { ...page, view: s }, faults, merged, PageRefreshed),
  }
  action pageDeploys: bool = all {
    ENV.page, not(page.oldBuild),
    commit(s, net, procs, tm, { ...page, oldBuild: true }, faults, merged, PageDeployed),
  }
  action pageReloads: bool = all {
    page.oldBuild,
    commit(s, net, procs, tm, { ...page, view: s, oldBuild: false }, faults, merged, PageReloaded),
  }

  // ---- the store appends an act in flight, or refuses it; the sender gets its answer.
  // A taken act starts processes: a new maker (inside the role's process), a resumed maker,
  // a revived role (its prompt typed into its pane), the host in its new session. A resume
  // or revive keeps the old context or not; with it, the process is stale.
  def answered(np: int -> Proc, a: Act): int -> Proc =
    if (np.keys().contains(a.pid)) np.setBy(a.pid, z => { ...z, waiting: false }) else np
  def resumed(k: int, ep: int, gen: int, ctx: bool, ns: Store): Proc =
    val old = latest(k)
    if (ctx and old != Set())
      val o = pr(old.fold(0, (acc, p) => p))
      { ...o, ep: ep, gen: gen, up: true, idle: false, starting: false, ctx: true,
        stale: true, waiting: false, limited: false, unseen: false }
    else { ...freshProc(k, ep, gen, ns), ctx: false }
  def procsAfter(a: Act, ns: Store, ctx: bool): int -> Proc =
    val np = answered(procs, a)
    val pid = np.keys().fold(0, (acc, p) => if (p >= acc) p + 1 else acc)
    match a.what {
      | AssignDo(_) => np.put(pid, { ...freshProc(s.nextMaker, 0, -1, ns), up: runs(ROLE) })
      | Resume(m) => np.put(pid, { ...resumed(m, epOf(ns, m), -1, ctx, ns), up: runs(ROLE) })
      | Revive(k) => np.put(pid, { ...resumed(k, epOf(ns, k), if (k == HOST) -1 else tm.gen,
                                              ctx, ns),
                                   up: k == HOST or reachable(tm),
                                   starting: not(CFG.promptArg) })
      | MoveHost => procsOf(HOST).fold(np, (acc, p) => acc.setBy(p, z => { ...z, up: false }))
          .put(pid, freshProc(HOST, epOf(ns, HOST), -1, ns))
      | Exit(k) => procsOf(k).fold(np, (acc, p) =>
          if (pr(p).idle) acc.setBy(p, z => { ...z, up: false, idle: false }) else acc)
      | _ => np
    }
  def tmAfter(a: Act): Tmux = match a.what {
    // With promptArg the prompt is an argument of the CLI: nothing is typed.
    | Revive(k) => if (CFG.promptArg) tm else queuePrompt(tm, k, false)
    | _ => tm
  }
  action storeTakes(k: int): bool = all {
    net.exists(a => a.who == k),
    nondet a = net.filter(a => a.who == k).oneOf()
    nondet ctx = BOOLS.oneOf()
    val ns = take(s, a)
    // A revived terminal prints as it starts.
    val k2 = match a.what { | Revive(j) => j | MoveHost => HOST | _ => -9 }
    all { accept(s, a),
          commitP(k2, ns, net.exclude(Set(a)), procsAfter(a, ns, ctx), tmAfter(a), page, faults,
                  merged, Taken(a)) },
  }
  action storeRefuses(k: int): bool = all {
    net.exists(a => a.who == k),
    nondet a = net.filter(a => a.who == k).oneOf()
    all { not(accept(s, a)),
          commit(s, net.exclude(Set(a)), answered(procs, a), tm, page, faults, merged,
                 Refused(a)) },
  }
  // The network delivers an act and keeps a copy that arrives again (a double send).
  action storeTakesKept: bool = all {
    ENV.dups, faults < ENV.maxFaults, net != Set(),
    nondet a = net.oneOf()
    nondet ctx = BOOLS.oneOf()
    val ns = take(s, a)
    val k2 = match a.what { | Revive(j) => j | MoveHost => HOST | _ => -9 }
    all { accept(s, a),
          commitP(k2, ns, net, procsAfter(a, ns, ctx), tmAfter(a), page, faults + 1, merged,
                  TakenKept(a)) },
  }

  // ---- processes die and come back by themselves. The role's death is its makers' death.
  def killed(p: int): int -> Proc =
    val np = procs.setBy(p, z => { ...z, up: false, idle: false, unseen: not(tm.pump) })
    if (pr(p).actor != ROLE) np
    else np.keys().fold(np, (acc, q) => if (pr(q).actor >= 3) acc.setBy(q, z => { ...z, up: false })
                                         else acc)
  action crashes(p: int): bool = all {
    ENV.crash, faults < ENV.maxFaults, pr(p).up,
    commit(s, net, killed(p), tm, page, faults + 1, merged, Crashed(p)),
  }
  // A process comes back by itself (tmux resurrect, a resumed session), its old token
  // and epoch; with or without its old context.
  action selfResumes(p: int): bool = all {
    ENV.crash, faults < ENV.maxFaults, not(pr(p).up),
    pr(p).actor < 3 or runs(ROLE),
    nondet ctx = BOOLS.oneOf()
    commitP(pr(p).actor, s, net,
            procs.setBy(p, z => if (ctx) { ...z, up: true, stale: true, waiting: false }
                                else { ...freshProc(z.actor, z.ep, z.gen, s), ctx: false }),
            tm, page, faults + 1, merged, SelfResumed(p)),
  }

  // ---- tmux
  def agentsSide(p: int): bool = pr(p).actor != HOST
  action serverKilled: bool = all {
    ENV.tmuxFaults, faults < ENV.maxFaults, reachable(tm),
    commit(s, net, procs.keys().fold(procs, (acc, p) =>
             if (agentsSide(p)) acc.setBy(p, z => { ...z, up: false, unseen: true }) else acc),
           kill(tm), page, faults + 1, merged, ServerKilled),
  }
  // A reboot of the machine: the agents' server and the person's tmux (the host's pane)
  // end at once.
  action machineReboots: bool = all {
    ENV.tmuxFaults, faults < ENV.maxFaults, reachable(tm),
    commit(s, net, procs.keys().fold(procs, (acc, p) =>
             acc.setBy(p, z => { ...z, up: false, unseen: true })),
           kill(tm), page, faults + 1, merged, Rebooted),
  }
  action socketLost: bool = all {
    ENV.tmuxFaults, faults < ENV.maxFaults, reachable(tm),
    commit(s, net, procs, loseSocket(tm), page, faults + 1, merged, SocketLost),
  }
  action serverRecreated: bool = all {
    not(reachable(tm)),
    commit(s, net, procs, recreate(tm), page, faults, merged, ServerRecreated),
  }
  action pumpStolen: bool = all {
    ENV.tmuxFaults, faults < ENV.maxFaults, tm.pump,
    commit(s, net, procs, stealPump(tm, CFG.pumpReattach), page, faults + 1, merged, PumpStolen),
  }
  action pageServerRestarts: bool = all {
    ENV.tmuxFaults, faults < ENV.maxFaults, tm.pump,
    commit(s, net, procs, closePump(tm), page, faults + 1, merged, PageServerRestarted),
  }
  action pumpAttaches: bool = all {
    tm.pending, reachable(tm),
    commit(s, net, procs, attachPump(tm), page, faults, merged, PumpAttached),
  }
  action personTypes(k: int): bool = all {
    ENV.tmuxFaults, page.acts < ENV.maxPerson, tm.input.get(k) == Empty,
    commit(s, net, procs, typeInto(tm, k), { ...page, acts: page.acts + 1 }, faults, merged,
           Typed(k)),
  }
  action personClears(k: int): bool = all {
    tm.input.get(k) == Typing or tm.input.get(k) == Pending,
    commit(s, net, procs, clearLine(tm, k), page, faults, merged, Cleared(k)),
  }
  // The new process reads its prompt. A merged prompt is misread: no context, history flag.
  action promptRead(k: int): bool = all {
    promptReady(tm, k),
    procsOf(k).exists(p => pr(p).up and pr(p).starting),
    val g = tm.input.get(k) == Garbled
    commitP(k, s, net, procsOf(k).fold(procs, (acc, p) =>
             if (pr(p).up and pr(p).starting)
               acc.setBy(p, z => { ...z, starting: false, ctx: z.ctx and not(g),
                                   stale: z.stale and not(g) })
             else acc),
           consume(tm, k), page, faults, merged or g, PromptRead((k, g))),
  }

  // The usage limit lifts (it resets after its window): fair.
  action limitLifts(p: int): bool = all {
    pr(p).up, pr(p).limited,
    commitP(pr(p).actor, s, net, procs.setBy(p, z => { ...z, limited: false }), tm, page,
            faults, merged, LimitLifted(p)),
  }
  action procStep(p: int): bool = any {
    procReads(p), procActs(p), procRepeats(p), byzActs(p), byzStops(p), byzWakes(p),
    crashes(p), selfResumes(p), procPrints(p), hitsLimit(p), limitLifts(p),
  }
  // A Byzantine process also gets its own branch, so its acts are not rare in random runs.
  action byzStep: bool = {
    nondet p = procs.keys().filter(q => isByz(pr(q).actor) and active(q)).oneOf()
    byzActs(p)
  }
  // For TLC: every counter stops at its cap (the run is past the bound there).
  def capped(st: Store): bool =
    st.nextMaker <= CFG.maxMakers + 2 and procs.keys().size() <= ENV.maxProcs
      and vsum(st) <= ENV.maxVer and st.card <= ENV.maxVer
      and FIXIDS.forall(i => fx(st, i).step <= ENV.maxStep)
      and SLOTS.forall(i => tk(st, i).rid <= ENV.maxStep and tk(st, i).gen <= ENV.maxStep)
      and st.session <= 2
      and st.ep.keys().forall(k => st.ep.get(k) <= ENV.maxStep)
      and st.makers.keys().forall(m => mk(st, m).revs <= ENV.maxStep)
  // At a cap (ENV.bounded) every action is off, the fair ones too: the run stops there and
  // NotAtCap reports it (a cap is a bound of the model, never a success).
  val inCaps: bool = not(ENV.bounded) or capped(s)
  val NotAtCap: bool = inCaps
  action step = all { inCaps, any {
    nondet p = procs.keys().oneOf() procStep(p),
    byzStep, tick,
    nondet p = procs.keys().oneOf() procPolls(p),
    harnessRevives,
    nondet k = PERSISTENT.union(s.makers.keys()).oneOf() exitReported(k),
    personActs, pageRefreshes, pageDeploys, pageReloads,
    nondet k = Set(PERSON, HARNESS).union(PERSISTENT).union(s.makers.keys()).oneOf()
      any { storeTakes(k), storeRefuses(k) },
    storeTakesKept,
    serverKilled, machineReboots, socketLost, serverRecreated, pumpStolen, pageServerRestarts,
    pumpAttaches,
    nondet k = PANES.oneOf() any { personTypes(k), personClears(k), promptRead(k) },
  } }

  // ==== Tier 1: safety under Byzantine agents and faults. Each is an impossible state;
  // the history flags (Store.g) are run one by one (spec.sh), so one cannot hide another.
  // Store-shape sanity: these follow from the store's state machine; a violation is a bug
  // of the model.
  val DoneIsClosed: bool = SLOTS.forall(i => tk(s, i).st == Done implies
    (fx(s, i).stage == SClosed and liveMaker(s, i) < 0))
  val OneMakerPerTask: bool = SLOTS.forall(i =>
    s.makers.keys().filter(m => mk(s, m).slot == i and not(mk(s, m).ended)).size() <= 1)
  val RaiseHasOwner: bool =
    SLOTS.forall(i => (tk(s, i).st == Raised) iff (fx(s, i).stage != SClosed))
  val Sane: bool = DoneIsClosed and OneMakerPerTask and RaiseHasOwner
  // A claim is held only by a live maker the store has not seen end (a protocol property:
  // without endedCheck an ended maker's late read takes a claim).
  val NoClaimByEnded: bool = not(s.g.claimByEnded) and s.makers.keys().forall(m =>
    mk(s, m).claim implies (not(mk(s, m).ended) and not(s.down.contains(m))))
  // The protocol's impossible states.
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
  val NoBadReference: bool = not(s.g.badRef)
  val NoDeepChangeWithoutPerson: bool = not(s.g.deepNoPerson)
  val NoRoleChangeMisjudged: bool = not(s.g.roleMisjudged)
  val NoPassOfBrokenResult: bool = not(s.g.passBroken)
  val NoPassOfBadResult: bool = not(s.g.passDefect)
  val NoShallowEvaluation: bool = not(s.g.shallowEval)
  val NoStalePipelineAct: bool = not(s.g.staleFix)
  val NoSplitBrain: bool = not(s.g.oldEpoch)
  val RevisionHasContext: bool = not(s.g.noContext)
  val NoUnrevisedResubmit: bool = not(s.g.unchangedResubmit)
  // DESIGN.md 9: the project never ends with a task done under an old version of an item
  // that applies to it; a change never misses a task its content touches.
  // A done task with nothing pending to recheck is current (every item that applies to it
  // at the version it was checked under).
  val DoneIsCurrent: bool = SLOTS.forall(i => (tk(s, i).st == Done and tk(s, i).pend == Set())
    implies oldFor(s, i) == Set())
  // The project never ends with a done task whose work a change broke (the recheck caught
  // it). The truth of "broke" is the environment's (Act.hits).
  val NoDoneBrokenAtEnd: bool = not(s.g.endBroken)
  val NoUnrecheckedScope: bool = not(s.g.unrechecked)
  val NoMergedInput: bool = not(merged)
  // DESIGN.md 10.1: no accept takes effect on an escalation that did not wait for the person
  // at its append; the person's edit takes no change in effect the person did not write and
  // did not accept.
  val NoAcceptNotWaiting: bool = not(s.g.acceptNotWaiting)
  val NoUnacceptedEditChange: bool = not(s.g.unacceptedChange)
  // The live faults of 2026-11-16 20:35 (fde5e40, e4e49ff): an open run's top task, when it
  // has an open host assignment, has it bound to the run's current session.
  val HostBoundToRunSession: bool = s.top.ended or s.top.hostSession == s.session
  // DESIGN.md 11: a recheck judges what a change broke, not the defect the person took.
  val NoTakenUndone: bool = not(s.g.takenUndone)
  // The person's edit never takes effect without an item the person wrote.
  val NoWrittenDropped: bool = not(s.g.wroteDropped)

  // ==== The dashboard (DESIGN.md 10): cards derived by the page from its copy of the store,
  // the wait markers and tmux. A page can only render a copy: the four "matches" properties
  // below compare that copy with the store and break while the page is stale (a finding: it
  // shows the staleness window; every act from the page is still checked by the store).
  // A terminal card's status (Nanda, DESIGN.md 10: Inactive is the terminal's status, not the
  // role's). Inactive: tmux disconnected, or the usage-limit message, or for x ticks neither
  // a wait poll nor any output. Working: the role has a step of its own (with
  // reviewSubagents a review is a subagent's: the role waits). Waiting: else.
  type CardSt = CardWorking | CardWaiting | CardInactive
  def cardView: Store = page.view
  def tmuxGone(k: int): bool = k != HOST and not(reachable(tm))
  // The card shows the actor's current terminal: its latest process.
  def limitShown(k: int): bool = latest(k).exists(p => pr(p).up and pr(p).limited)
  // The CLI's own hook: it stopped at its prompt (idleSeen).
  def stopShown(k: int): bool = CFG.idleSeen and latest(k).exists(p => pr(p).up and pr(p).idle)
  def inactiveSignal(k: int): bool =
    limitShown(k) or stopShown(k)
      or (silence.get(k) >= CFG.silentSteps and quiet.get(k) >= CFG.silentSteps)
  def ownWork(v: Store, k: int): Set[What] = dos(v, k).filter(x =>
    not(CFG.reviewSubagents and match x { | Review(_) => true | _ => false }))
  def card(k: int): CardSt =
    if (tmuxGone(k) or inactiveSignal(k)) CardInactive
    else if (ownWork(cardView, k) != Set()) CardWorking
    else CardWaiting
  // An ASSUMPTION, not a check (it restates tick's guard under printsOften): a live terminal
  // (it works, or waits in `work wait`) prints or renews its beat within 1 minute, so it
  // never shows Inactive. What the 1-minute rule cannot see: a busy CLI that redraws but is
  // stuck, and a hung tool call that prints nothing (it shows Inactive only after 1 minute).
  def live(k: int): bool = latest(k).exists(p => active(p) and not(pr(p).idle)
    and not(pr(p).limited))
  val LiveNotInactive: bool = cards.forall(k =>
    (live(k) and not(tmuxGone(k))) implies card(k) != CardInactive)
  // Terminal cards: the host and each persistent role. The pipeline role's work is the TASK
  // PIPELINE row of escalation cards.
  def cards: Set[int] = Set(HOST, ROLE)
  // An escalation card: queued (waits for the pipeline role), in the pipeline (its stages and
  // review loop), or waiting for the person's review; none once accepted or closed.
  type EscSt = EscNone | EscQueued | EscInPipeline | EscWaitReview
  def escOf(v: Store, i: int): EscSt =
    val st = fx(v, i).stage
    if (st == SEval) EscQueued
    else if (pipeStage(st)) EscInPipeline
    else if (st == SAtPerson)
      EscWaitReview
    else EscNone
  def openTask(st: TS): bool = st == Unsent or st == Sent or st == Working or st == InReview
  // The queue: tasks shown as queued (no maker yet) or working.
  def queue: Set[int] = SLOTS.filter(i => not(cardView.top.ended) and openTask(tk(cardView, i).st))
  // A card never shows Working while the role only waits.
  val DashNoFalseWorking: bool =
    cards.forall(k => card(k) == CardWorking implies ownWork(s, k) != Set())
  // The queue shows only queued and working tasks.
  val DashQueueActive: bool = queue.forall(i => openTask(tk(s, i).st))
  // An escalation card has the pipeline's state of that escalation.
  val DashEscalationMatches: bool = FIXIDS.forall(i => escOf(cardView, i) == escOf(s, i))
  // The task pipeline row (it lists every escalation) is shown exactly when an escalation
  // waits for the person. A stale page may show it after the person's wait ended, or hide it
  // while one waits.
  def rowShown(v: Store): bool = FIXIDS.exists(i => escOf(v, i) == EscWaitReview)
  val DashRowMatches: bool = rowShown(cardView) == rowShown(s)

  // ==== Tier 2: told once. The person is told through the page: every step the page's view
  // owes the person, the page offers.
  val PageOffersPersonObs: bool = obligationsOf(page.view).filter(ob => isPersonOb(ob))
    .forall(ob => personWhats(page.view).exists(x => discharges(ob, PERSON, x)))
  val EveryObligationToldOnce: bool =
    obligationsOf(s).forall(ob => waitsLegally(ob) or toldTo(ob).size() == 1)
  val ToldIsAllowed: bool =
    actorsOf(s).filter(k => k >= 0).forall(k => dos(s, k).forall(x => doable(k, x)))
  val SomethingOwed: bool = s.top.ended or obligationsOf(s) != Set()
  val Told: bool = EveryObligationToldOnce and ToldIsAllowed and SomethingOwed

  // ==== Convergence: the run stays inside the model's bounds (changes, makers). A
  // violation means the run went on past them: a finding, never a success.
  // Converges: agent changes stay within the bound the config gives (changeBound). The real
  // DESIGN.md 13 violation is NoRefixAtSameLevel: an item (or a split part) fixed again at
  // the same or a lower level than its last fix.
  val Converges: bool = not(pastBound(s))
  val NoRefixAtSameLevel: bool = not(s.g.refix)
  // DESIGN.md 13.2: a draft raised to direction or principle reaches the person.
  val NoEscalationWithoutPerson: bool = not(s.g.escalatedNoPerson)
  // DESIGN.md 13: past the top rung (a task at principle) the person is the end: every
  // further change of the task goes through the person.
  val NoAgentChangeAtTop: bool = not(s.g.topNoPerson)


  // ==== Tier 3: progress. Fair: each honest actor's process does what it is told; the
  // store answers each sender; the pump, the hooks and the watcher report and revive; a
  // closed pump attaches again; a typed prompt is read. Byzantine agents, the person and
  // the page are not fair. Final is never "past the bound".
  // Per process (a stale process of an actor cannot stand in for the live one).
  action procFair(p: int): bool = all { inCaps, procs.keys().contains(p),
    any { procReads(p), procActs(p) } }
  action liftFair(p: int): bool = all { inCaps, procs.keys().contains(p), limitLifts(p) }
  action deliverFrom(k: int): bool = all { inCaps, any { storeTakes(k), storeRefuses(k) } }
  action promptStep: bool = all { inCaps, nondet k = PANES.oneOf() promptRead(k) }
  action exitStep: bool = all { inCaps,
    nondet k = PERSISTENT.union(s.makers.keys()).oneOf() exitReported(k) }
  action pageFair: bool = all { inCaps, pageRefreshes }
  action revivesFair: bool = all { inCaps, harnessRevives }
  action recreatedFair: bool = all { inCaps, serverRecreated }
  action attachFair: bool = all { inCaps, pumpAttaches }
  val vars = (s, net, procs, tm, page, faults, merged, silence, quiet, lies, lastEvent, told,
              obligations)
  temporal Fairness = all {
    weakFair(procFair(0), vars), weakFair(procFair(1), vars), weakFair(procFair(2), vars),
    weakFair(procFair(3), vars), weakFair(procFair(4), vars), weakFair(procFair(5), vars),
    weakFair(procFair(6), vars), weakFair(procFair(7), vars), weakFair(procFair(8), vars),
    weakFair(procFair(9), vars), weakFair(procFair(10), vars), weakFair(procFair(11), vars),
    weakFair(liftFair(0), vars), weakFair(liftFair(1), vars), weakFair(liftFair(2), vars),
    weakFair(liftFair(3), vars), weakFair(liftFair(4), vars), weakFair(liftFair(5), vars),
    weakFair(liftFair(6), vars), weakFair(liftFair(7), vars), weakFair(liftFair(8), vars),
    weakFair(liftFair(9), vars), weakFair(liftFair(10), vars), weakFair(liftFair(11), vars),
    weakFair(pageFair, vars),
    weakFair(deliverFrom(-2), vars), weakFair(deliverFrom(-1), vars),
    weakFair(deliverFrom(0), vars), weakFair(deliverFrom(1), vars),
    weakFair(deliverFrom(2), vars), weakFair(deliverFrom(3), vars),
    weakFair(deliverFrom(4), vars), weakFair(deliverFrom(5), vars),
    weakFair(deliverFrom(6), vars), weakFair(deliverFrom(7), vars),
    weakFair(deliverFrom(8), vars),
    weakFair(revivesFair, vars), weakFair(exitStep, vars), weakFair(recreatedFair, vars),
    weakFair(attachFair, vars), weakFair(promptStep, vars),
  }
  // A run stopped at a cap is not judged here; NotAtCap reports it.
  temporal Progress = always(eventually(finalOf(s) or not(inCaps)))
  // For TLC: agent changes stop in the end (no endless loop of fixes).
  val agentChangeNow: bool = match lastEvent {
    | Taken(a) => match a.what { | Ship(_) => true | Evaluate(_) => true
                                 | _ => false }
    | _ => false }
  temporal AgentChangesStop = eventually(always(not(agentChangeNow)))
  temporal FairProgress = Fairness implies Progress

  // ==== Witnesses: each should be reached in > 0 runs (quint run --witnesses).
  def taken(p: What => bool): bool = match lastEvent {
    | Taken(a) => p(a.what) | TakenKept(a) => p(a.what) | _ => false
  }
  def isEv(p: Event => bool): bool = p(lastEvent)
  val wSendTask = taken(x => match x { | SendTask(_) => true | _ => false })
  val wAssignDo = taken(x => match x { | AssignDo(_) => true | _ => false })
  val wReadBrief = taken(x => match x { | ReadBrief(_) => true | _ => false })
  val wReport = taken(x => match x { | Report(_) => true | _ => false })
  val wReviewPass = taken(x => match x { | Review(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).st == Done)
  val wRevision = taken(x => match x { | Review(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).st == Working)
  val wSecondRevision = s.makers.keys().exists(m => mk(s, m).revs >= 2)
  val wRaise = taken(x => match x { | Review(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).st == Raised)
  val wReject = taken(x => match x { | Reject(_) => true | _ => false })
  val wEvaluate = taken(x => match x { | Evaluate(_) => true | _ => false })
  val wSplit = taken(x => match x { | Evaluate(_) => true | _ => false })
    and SLOTS.exists(i => tk(s, i).gen > 0 and tk(s, i).st == Sent)
  val wTopDone = taken(x => x == TopDone)
  val wEndProject = taken(x => x == EndProject)
  val wMoveHost = taken(x => x == MoveHost)
  val wAdvance = taken(x => match x { | Advance(_) => true | _ => false })
  val wWriteRule = taken(x => match x { | WriteRule(_) => true | _ => false })
  val wRunTest = taken(x => match x { | RunTest(_) => true | _ => false })
  val wTestRewrite = taken(x => match x { | WriteRule(i) => fx(s, i).ruleTries > 0
                                          | _ => false })
  val wShipStandard = taken(x => match x { | Ship(_) => true | _ => false }) and vsum(s) > 0
  val wLoopReview = taken(x => match x { | LoopReview(_) => true | _ => false })
  val wAccept = taken(x => match x { | Accept(_) => true | _ => false })
  val wSendBack = taken(x => match x { | SendBack(_) => true | _ => false })
  val wCardChange = s.card > 0
  val wReassign = taken(x => x == Reassign)
  val wReassignEndsWorking = s.g.reassignEnded
  val wDecide = taken(x => match x { | Decide(_) => true | _ => false })
  val wFloorRaised = ITEMS.exists(x => s.fixDepth.get(x) >= 2)
  val wFightShipped = s.g.fightShipped
  val wRaisedUp = s.g.raisedUp
  val wTaskFloor = SLOTS.exists(i => depth(tk(s, i).floor) >= 2)
  val wNearBound = s.agentChanges >= changeBound - 1
  val wTopChange = taken(x => match x {
    | Accept(i) => i < 2 and tk(s, i).floor == Principle | _ => false })
  val wDecideFought = taken(x => match x {
    | Decide(i) => tk(s, i).pend.contains(IRule(i)) | _ => false })
  val wEscalatedLoop = taken(x => match x {
    | Ship(i) => fx(s, i).stage == SLoop
        and (fx(s, i).entry == SDirAssess or fx(s, i).entry == SPrinciple) | _ => false })
  val wRoleDraft = FIXIDS.exists(i => fx(s, i).kind == DRole and fx(s, i).stage != SClosed)
  val wTakenRechecked = taken(x => match x { | RecheckDone(i) => tk(s, i).taken | _ => false })
  val wLimitLifted = isEv(e => match e { | LimitLifted(_) => true | _ => false })
  val wResume = taken(x => match x { | Resume(_) => true | _ => false })
  val wRevive = taken(x => match x { | Revive(_) => true | _ => false })
  val wExit = taken(x => match x { | Exit(_) => true | _ => false })
  val wDirChangeWhileReview = taken(x => match x { | Ship(_) => true | Accept(_) => true
                                                   | _ => false })
    and SLOTS.exists(i => tk(s, i).st == InReview and oldFor(s, i) != Set())
  val wPipeCrashMidStage = not(runs(PIPE)) and SLOTS.exists(i => pipeStage(fx(s, i).stage))
  val wRebase = s.g.rebaseFired
  val wRecheck = s.g.recheckFired
  val wRecheckDone = taken(x => match x { | RecheckDone(_) => true | _ => false })
  val wRunRule = taken(x => match x { | RunRule(_) => true | _ => false })
  val wStandardScope = s.ver.get(IStd(0)) > 0 or s.ver.get(IRule(1)) > 0
  val wSplitBrainTaken = taken(x => true) and match lastEvent {
    | Taken(a) => a.who >= 0 and a.ep < epOf(s, a.who) | _ => false }
  val wRefused = isEv(e => match e { | Refused(_) => true | _ => false })
  val wTakenKept = isEv(e => match e { | TakenKept(_) => true | _ => false })
  val wRepeat = isEv(e => match e { | Repeated(_) => true | _ => false })
  val wHeadRead = isEv(e => match e { | Read(r) => r._2 == Head | _ => false })
  val wDropRead = isEv(e => match e { | Read(r) => r._2 == Drop | _ => false })
  val wCrash = isEv(e => match e { | Crashed(_) => true | _ => false })
  val wSelfResume = isEv(e => match e { | SelfResumed(_) => true | _ => false })
  val wStop = isEv(e => match e { | Stopped(_) => true | _ => false })
  val wWake = isEv(e => match e { | Woke(_) => true | _ => false })
  val wServerKilled = isEv(e => e == ServerKilled)
  val wSocketLost = isEv(e => e == SocketLost)
  val wServerRecreated = isEv(e => e == ServerRecreated)
  val wPumpStolen = isEv(e => e == PumpStolen)
  val wPageServerRestart = isEv(e => e == PageServerRestarted)
  val wPumpAttached = isEv(e => e == PumpAttached)
  val wTyped = isEv(e => match e { | Typed(_) => true | _ => false })
  val wCleared = isEv(e => match e { | Cleared(_) => true | _ => false })
  val wPromptRead = isEv(e => match e { | PromptRead(_) => true | _ => false })
  val wHostSurvivesKill = tm.srv == SrvKilled and runs(HOST)
  val wPageRefresh = isEv(e => e == PageRefreshed)
  val wPageDeploy = isEv(e => e == PageDeployed)
  val wPageReload = isEv(e => e == PageReloaded)
  val wFinal = finalOf(s) and not(s.top.ended)
  val wCardWorking = cards.exists(k => card(k) == CardWorking)
  val wCardWaiting = cards.exists(k => card(k) == CardWaiting)
  val wCardInactive = cards.exists(k => card(k) == CardInactive)
  val wEscCard = FIXIDS.exists(i => escOf(cardView, i) != EscNone)
  val wRowShown = rowShown(cardView)
  val wEdit = taken(x => x == EditDirection)
  val wEditInEffect = taken(x => x == Ship(EDIT) or x == Accept(EDIT))
    and fx(s, EDIT).stage == SAccepted
  val wPolled = isEv(e => match e { | Polled(_) => true | _ => false })
  val wPrinted = isEv(e => match e { | Printed(_) => true | _ => false })
  val wLimited = isEv(e => match e { | Limited(_) => true | _ => false })
  val wRebooted = isEv(e => e == Rebooted)
  val wBroken = SLOTS.exists(i => tk(s, i).broken)
  val wDecideRecheck = taken(x => match x {
    | Decide(i) => tk(s, i).taken and tk(s, i).pend != Set() | _ => false })
    and SLOTS.exists(i => tk(s, i).st == Done and tk(s, i).pend != Set())
}

// ---- Configurations. DESIGN: DESIGN.md as written (with Nanda's rulings: refCheck,
// rebind, acceptCheck, decideRecheck, promptArg, C1 b, crossTest, raiseLevel, strictScope,
// no agent remake of the top); every other check off.
// FIXED: every proposed check on.
module cfgs {
  pure val DESIGN = { crossTest: true, raiseLevel: true, recheckBasis: false, slots: Set(0, 1), basis: false, build: false,
    rebase: false, harnessTest: false, classify: false, passTests: false, fullBrief: false,
    endedCheck: false, formCheck: false, refCheck: true, epochs: false, reviseCheck: false,
    rebind: true, pumpReattach: false, hostWatched: false, promptArg: true, idleSeen: false,
    silentSteps: 3, reviewSubagents: false, editBack: 1, acceptCheck: true,
    decideRecheck: true, briefCheck: false, strictScope: true, sections: 2, listOnAttach: false,
    ladderRoute: true, maxTries: 3, maxMakers: 6, maxLoops: 1, maxRuleTries: 2 }
  pure val FIXED = { ...DESIGN, basis: true, build: true, rebase: true,
    harnessTest: true, classify: true, passTests: true, recheckBasis: true,
    fullBrief: true, endedCheck: true, formCheck: true, epochs: true, reviseCheck: true,
    pumpReattach: true, hostWatched: true, idleSeen: true,
    briefCheck: true, listOnAttach: true }
  pure val HONEST = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: false,
    crash: true, tmuxFaults: true, page: true, head: true, reject: true, maxFaults: 3,
    maxNet: 3, maxPerson: 6, causes: 0.to(5), starts: Set(0), printsOften: true,
    liars: Set(), misjudge: false, dups: true, maxLies: 0, lieOn: Set(), bounded: false,
    maxProcs: 12, maxVer: 12, maxStep: 30 }
  pure val CALM = { ...HONEST, crash: false, tmuxFaults: false, page: false, head: false,
    reject: false, maxFaults: 0, maxPerson: 10, dups: false }
  // Every starting state (START_OF).
  pure val DEEP = 0.to(12)
  pure val ROLE_ID = 1
  pure val PIPE_ID = 2
  pure val RECHECK_KIND = 6
}
// The design, one Byzantine class at a time (the others honest), every fault.
module designHonest {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = HONEST).* from "./workenv"
}
module designMaker {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...HONEST, byzMaker: true }).* from "./workenv"
}
module designRole {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...HONEST, byzRole: true }).* from "./workenv"
}
module designPipe {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...HONEST, byzPipe: true }).* from "./workenv"
}
module designHost {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...HONEST, byzHost: true }).* from "./workenv"
}
// Every proposed check on, one Byzantine class at a time, from every starting state.
module fixedHonest {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...HONEST, starts: DEEP }).* from "./workenv"
}
module fixedMaker {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...HONEST, byzMaker: true, starts: DEEP })
    .* from "./workenv"
}
module fixedRole {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...CALM, byzRole: true, starts: DEEP }).* from "./workenv"
}
module fixedPipe {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...CALM, byzPipe: true, starts: DEEP }).* from "./workenv"
}
module fixedHost {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...HONEST, byzHost: true, starts: DEEP })
    .* from "./workenv"
}
module fixedCalm {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...CALM, starts: DEEP }).* from "./workenv"
}
// R1: the recheck judged on an old view (recheckBasis off; every other check on).
module noRecheckBasis {
  import cfgs.*
  import workenv(CFG = { ...FIXED, recheckBasis: false }, ENV = { ...CALM, starts: Set(7) })
    .* from "./workenv"
}
// For TLC: one task, a calm run, every counter capped. maxStep 24: three raises of the task
// (7 fix steps each) fit, so the ladder's rungs and a contradiction are inside the caps.
// Check NotAtCap with them: a run that reaches a cap is reported, not excused.
module tlcCalm {
  import cfgs.*
  import workenv(CFG = { ...FIXED, slots: Set(0) },
    ENV = { ...CALM, bounded: true, maxPerson: 2, maxProcs: 14, maxVer: 12, maxStep: 40 })
    .* from "./workenv"
}
// For TLC with crashes (R4: a usage limit, a crash and a resume).
module tlcCrash {
  import cfgs.*
  import workenv(CFG = { ...FIXED, slots: Set(0) },
    ENV = { ...CALM, crash: true, maxFaults: 2, bounded: true, maxPerson: 2, maxProcs: 12,
            maxVer: 12, maxStep: 40 }).* from "./workenv"
}
// Convergence (DESIGN.md 13). The pipeline role may misjudge the level; rules may
// contradict. NoRefixAtSameLevel (a guard of raiseLevel) and Converges (the bound derived
// from the config) hold in convFixed; each mutant turns one rule off.
module convFixed {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...CALM, causes: Set(0, 1, 5), misjudge: true,
    starts: DEEP }).* from "./workenv"
}
module convNoCross {
  import cfgs.*
  import workenv(CFG = { ...FIXED, crossTest: false },
    ENV = { ...CALM, causes: Set(5), maxPerson: 40 })
    .* from "./workenv"
}
module convNoRaise {
  import cfgs.*
  import workenv(CFG = { ...FIXED, raiseLevel: false },
    ENV = { ...CALM, causes: Set(4, 5), misjudge: true }).* from "./workenv"
}
module convNeither {
  import cfgs.*
  import workenv(CFG = { ...FIXED, crossTest: false, raiseLevel: false },
    ENV = { ...CALM, causes: Set(5), maxPerson: 0 }).* from "./workenv"
}
// Strict scope off and raiseLevel off: nothing ends splits (with either on, they end).
module convNoSplitLimits {
  import cfgs.*
  import workenv(CFG = { ...FIXED, strictScope: false, raiseLevel: false },
    ENV = { ...CALM, causes: Set(1) }).* from "./workenv"
}
module convNoScope {
  import cfgs.*
  import workenv(CFG = { ...FIXED, strictScope: false },
    ENV = { ...CALM, causes: Set(1) }).* from "./workenv"
}
// The live fault before e4e49ff (run continue left the host's assignment on the old session).
module beforeMove {
  import cfgs.*
  import workenv(CFG = { ...FIXED, rebind: false }, ENV = CALM).* from "./workenv"
}
// R5-3: the store routes by content only; a lying pipeline role ships a raised draft as a
// standards change.
module noLadderRoute {
  import cfgs.*
  import workenv(CFG = { ...FIXED, ladderRoute: false }, ENV = { ...CALM, liars: Set(PIPE_ID),
    maxLies: 2, lieOn: Set(4), causes: Set(5), starts: Set(2, 12) }).* from "./workenv"
}
// One check off on the fixed ones.
module noDecideRecheck {
  import cfgs.*
  import workenv(CFG = { ...FIXED, decideRecheck: false },
    ENV = { ...CALM, starts: Set(8, 11) }).* from "./workenv"
}
module noListOnAttach {
  import cfgs.*
  import workenv(CFG = { ...FIXED, listOnAttach: false },
    ENV = { ...HONEST, maxFaults: 4 }).* from "./workenv"
}
// Mutants: the design as written, a calm run, one fault class or one liar each.
// mutBuild: the basis check on, the build check off: an act from an old build names no
// basis, so it skips the basis check.
module mutBuild {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, basis: true }, ENV = { ...CALM, page: true, reject: true })
    .* from "./workenv"
}
module mutPage {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, page: true, reject: true, starts: Set(0, 3) })
    .* from "./workenv"
}
module mutDup {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, dups: true, maxFaults: 8 }).* from "./workenv"
}
module mutCrash {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, crash: true, maxFaults: 3, causes: Set(5),
    starts: Set(0, 9) })
    .* from "./workenv"
}
module mutCrashHi {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, maxTries: 5 },
    ENV = { ...CALM, crash: true, maxFaults: 8, causes: Set(5) }).* from "./workenv"
}
module editAlways {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, editBack: 0 }, ENV = CALM).* from "./workenv"
}
module editNever {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, editBack: 2 }, ENV = CALM).* from "./workenv"
}
module mutAccept {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, acceptCheck: false },
    ENV = { ...CALM, page: true, starts: Set(0, 3) }).* from "./workenv"
}
module mutRace {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, causes: Set(0, 5) }).* from "./workenv"
}
// The revive prompt typed into the input line (promptArg off): it can merge.
module mutTmux {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, promptArg: false },
    ENV = { ...CALM, tmuxFaults: true, maxFaults: 3 }).* from "./workenv"
}
module mutMaker {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, byzMaker: true }).* from "./workenv"
}
// Honest except lies (their own budget; only the act kinds named).
module mutRole {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, liars: Set(ROLE_ID), maxLies: 1,
    starts: Set(0, 4) }).* from "./workenv"
}
module mutPipe {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, liars: Set(PIPE_ID), maxLies: 2,
    starts: Set(0, 2, 3) }).* from "./workenv"
}
module mutRecheck {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, liars: Set(PIPE_ID), maxLies: 1,
    lieOn: Set(RECHECK_KIND), starts: Set(5, 6) }).* from "./workenv"
}
module mutPipeByz {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, byzPipe: true, starts: Set(0, 2, 3) })
    .* from "./workenv"
}
module mutRefByz {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, refCheck: false },
    ENV = { ...CALM, byzPipe: true, starts: Set(0, 2) }).* from "./workenv"
}
// Witness coverage. Calm: no faults, few tries, so random runs go deep. Done: tasks reach
// done. Crash: crashes and rejects. Faults: every fault, the fixed checks (a typed prompt).
// Byz: a Byzantine maker (stops, wakes).
module witnessCalm {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, maxTries: 2, rebase: true }, ENV = { ...CALM, starts: DEEP })
    .* from "./workenv"
}
module witnessDone {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, rebase: true },
    ENV = { ...CALM, causes: Set(0, 5), starts: DEEP }).* from "./workenv"
}
module witnessCrash {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, maxTries: 2, rebase: true },
    ENV = { ...CALM, crash: true, reject: true, maxFaults: 3 }).* from "./workenv"
}
module witnessFaults {
  import cfgs.*
  import workenv(CFG = { ...FIXED, promptArg: false }, ENV = { ...HONEST, maxFaults: 4 })
    .* from "./workenv"
}
module witnessByz {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...HONEST, byzMaker: true, maxFaults: 4 })
    .* from "./workenv"
}
