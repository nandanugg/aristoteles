// The environment around the store of work.qnt (plan/model/DESIGN.md sections 7 and 8).
// Its own machines: the network of acts (a message soup), the processes (agents, honest or
// Byzantine, each with its own view), tmux (tmux.qnt), the web page, the person.
// README.md has the words, the options, the properties with their tiers, and the limits.
module workenv {
  const CFG: {
    c1Keep: bool, d7: int, basis: bool, build: bool, rebase: bool, harnessTest: bool, classify: bool, passTests: bool, fullBrief: bool,
    endedCheck: bool, formCheck: bool, refCheck: bool, epochs: bool, reviseCheck: bool,
    bindOpenOnly: bool, rebind: bool, pumpReattach: bool, hostWatched: bool,
    waitEmptyInput: bool, idleSeen: bool,
    dashLive: bool, dashInactiveFromView: bool, silentSteps: int, reviewSubagents: bool,
    editBack: int, acceptCheck: bool,
    maxTries: int, maxMakers: int, maxChanges: int, budget: int, maxPts: int, maxLoops: int,
    maxRuleTries: int, maxRemakes: int,
  }
  // byz*: that agent class is Byzantine (else honest). crash: processes die and resume.
  // tmuxFaults: server kill, lost socket, pump detached or closed, the person typing.
  // page: old builds. head: honest agents read only the first line of their wait.
  // reject: the person rejects results. causes: the real causes a new task may have
  // (0 none, 1 split, 2 fit, 3 principle, 4 direct, 5 standard; CAUSE_OF).
  // maxFaults: environment faults; maxNet: acts in flight; maxPerson: the person's acts.
  const ENV: {
    byzMaker: bool, byzRole: bool, byzPipe: bool, byzHost: bool, crash: bool,
    tmuxFaults: bool, page: bool, head: bool, reject: bool, maxFaults: int, maxNet: int,
    maxPerson: int, causes: Set[int], maxTicks: int,
  }
  import work(OPT = CFG).* from "./work"
  import tmux.* from "./tmux"

  // A process of an actor. ep: its token's epoch. gen: the agents' server it started in
  // (-1: the person's tmux, or inside the role's process). starting: its prompt is not yet
  // read. ctx: it has the context of its work. stale: it was resumed with that context and
  // may act on its old view and repeat its last act until it reads again. view, todo: the
  // store and the steps as of its last read. last: its last act. waiting: for the answer.
  type Proc = { actor: int, ep: int, gen: int, up: bool, idle: bool, starting: bool,
                ctx: bool, stale: bool, view: Store, todo: Set[What], last: Set[Act],
                waiting: bool, wakes: int }
  type ReadMode = Full | Head | Drop
  type Page = { view: Store, oldBuild: bool, acts: int }
  type Event =
    | Start | Posted(Act) | Repeated(Act) | Taken(Act) | TakenKept(Act) | Refused(Act)
    | Read((int, ReadMode)) | Crashed(int) | SelfResumed(int) | Stopped(int) | Woke(int)
    | ServerKilled | SocketLost | ServerRecreated | PumpStolen | PageServerRestarted
    | PumpAttached | Typed(int) | Cleared(int) | PromptRead((int, bool))
    | PageRefreshed | PageDeployed | PageReloaded | Polled(int) | Ticked

  var s: Store
  var net: Set[Act]            // acts sent and not yet appended or refused (unordered)
  var procs: int -> Proc       // every process ever started, by process id
  var tm: Tmux
  var page: Page
  var faults: int
  var merged: bool             // history: a prompt merged with the person's typing was read
  // Wait markers: per persistent role, the ticks since its process last polled its wait.
  var silence: int -> int
  var ticks: int               // ticks so far (bounded: ENV.maxTicks)
  var lastEvent: Event
  // For model-based testing: each actor's Do steps, and what is owed, in every state.
  var told: int -> Set[What]
  var obligations: Set[Ob]

  pure val VERDICTS = Set(Pass, Fail, RaiseTries, RaiseNoRule, RaiseMisses)
  pure val LEVELS = Set(Split, Fit, Principle, Direct, Standard)
  pure def CAUSE_OF(n: int): Cause =
    if (n == 1) CauseAt(Split) else if (n == 2) CauseAt(Fit) else if (n == 3) CauseAt(Principle)
    else if (n == 4) CauseAt(Direct) else if (n == 5) CauseAt(Standard) else NoCause
  def envCauses: Set[Cause] = ENV.causes.map(n => CAUSE_OF(n))
  pure val FORMS = Set(NoForm, Mech, Ref, Both)
  pure val BOOLS = Set(true, false)
  pure val PANES = PERSISTENT   // a pane per persistent role; makers live in the role's
  pure val MAKER_IDS = 3.to(8)

  // ---- reads
  def isByz(k: int): bool =
    if (k == HOST) ENV.byzHost else if (k == ROLE) ENV.byzRole
    else if (k == PIPE) ENV.byzPipe else k >= 3 and ENV.byzMaker
  def pr(p: int): Proc = procs.get(p)
  def procsOf(k: int): Set[int] = procs.keys().filter(p => pr(p).actor == k)
  def active(p: int): bool = pr(p).up and not(pr(p).starting)
  def runs(k: int): bool = procsOf(k).exists(p => active(p))
  // An actor hears its Do steps: the person (the page), the harness, an agent with a running
  // process past its prompt (a property of the model, not something an agent reads).
  def hears(k: int): bool = k < 0 or runs(k)
  // Acts of sender k in flight (each sender has at most ENV.maxNet).
  def sent(k: int): int = net.filter(a => a.who == k).size()
  def polled(k: int): int -> int = if (silence.keys().contains(k)) silence.set(k, 0) else silence
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
    { who: k, ep: ep, what: x, seen: seen, seenDir: seenDir, old: old, v: Pass, pts: 1,
      level: Standard, flag: true, flag2: true, form: Ref, cause: NoCause, items: Set(),
      real: Set(), byz: byz, ctx: ctx, pid: pid }
  // Every content an act x may carry (only the fields x uses vary).
  def variants(b: Act): Set[Act] = whatVariants(b, b.what)
  def whatVariants(b: Act, x: What): Set[Act] = match x {
    | Review(_) => VERDICTS.fold(Set(), (acc, v) =>
        acc.union(1.to(CFG.maxPts).map(p => { ...b, v: v, pts: p })))
    | Evaluate(_) => LEVELS.fold(Set(), (acc, l) => acc.union(BOOLS.fold(Set(), (a2, f) =>
        a2.union(BOOLS.fold(Set(), (a3, f2) => a3.union(envCauses.map(c =>
          { ...b, level: l, flag: f, flag2: f2, cause: c })))))))
    | WriteRule(_) => FORMS.fold(Set(), (acc, fm) => acc.union(BOOLS.fold(Set(), (a2, f) =>
        a2.union(BOOLS.map(f2 => { ...b, form: fm, flag: f, flag2: f2 })))))
    | RemakeTop => envCauses.map(c => { ...b, cause: c })
    | Ship(_) => ITEMSETS.fold(Set(), (acc, xs) => acc.union(ITEMSETS.map(ys =>
        { ...b, items: xs, real: ys })))
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
    | Evaluate(i) => (match tk(v, i).cause { | NoCause => true | CauseAt(c) => a.level == c })
        and (a.level != Fit or a.flag == a.flag2)
    | WriteRule(_) => a.form != NoForm and a.flag2
    | RunTest(i) => a.flag == fx(v, i).truth
    | Ship(i) => a.real.contains(IDir) == (fx(v, i).entry != SStdAssess) and a.items == a.real
        and fx(v, i).wrote.forall(x => a.real.contains(x))
    | RecheckDone(i) => a.flag == not(tk(v, i).rBad)
    | LoopReview(i) => not(a.flag and fx(v, i).needRevise)
    | _ => true
  }
  // What the page lets the person do, on the page's view (a reject only of a result shown).
  def personWhats(v: Store): Set[What] =
    val top = if (not(v.top.hosted) and not(v.top.done)) Set(OpenTop) else Set()
    val end = if (v.top.done) Set(EndProject) else Set()
    val per = SLOTS.fold(Set(), (acc, i) => acc
      .union(if (ENV.reject and tk(v, i).rid >= 0
                 and (tk(v, i).st == InReview or tk(v, i).st == Done))
               Set(Reject(i)) else Set())
      .union(if (fx(v, i).stage == SAtPerson) Set(Accept(i), SendBack(i)) else Set())
      .union(if (fx(v, i).stage == SPerson) Set(Decide(i)) else Set()))
    // Run continue: once per model run (a bound of the model).
    val edit = if (fx(v, EDIT).stage == SClosed) Set(EditDirection) else Set()
    val acc = if (fx(v, EDIT).stage == SAtPerson) Set(Accept(EDIT), SendBack(EDIT)) else Set()
    top.union(end).union(per).union(edit).union(acc)
      .union(if (v.session < 1) Set(MoveHost) else Set())
  def allWhats: Set[What] =
    val perSlot = SLOTS.fold(Set(), (acc, i) => acc.union(Set(Reject(i), Accept(i), SendBack(i),
      Decide(i), SendTask(i), AssignDo(i), Review(i), Evaluate(i), Advance(i), WriteRule(i),
      RunTest(i), Ship(i), LoopReview(i), RecheckDone(i), RunRule(i))))
      .union(Set(Advance(EDIT), WriteRule(EDIT), RunTest(EDIT), Ship(EDIT), LoopReview(EDIT),
                 Accept(EDIT), SendBack(EDIT)))
    val perMaker = s.makers.keys().fold(Set(), (acc, m) =>
      acc.union(Set(Resume(m), ReadBrief(m), Report(m), Exit(m))))
    Set(OpenTop, EndProject, MoveHost, EditDirection, Reassign, RemakeTop, TopDone).union(perSlot)
      .union(perMaker).union(PERSISTENT.map(p => Revive(p)))

  // ---- obligations and told (the told-once tier)
  def toldTo(ob: Ob): Set[int] = toldAny(s, ob).filter(k => hears(k))
  // The engine owes the next move for an actor that does not hear: its revive (the harness),
  // its prompt (read once the line is clear), or the report of its exit (the pump, attached
  // or about to attach; the hook inside the role for a maker; for the host, only with
  // hostWatched).
  def engineOwes(k: int): bool =
    if (s.down.contains(k)) PERSISTENT.contains(k)
    // A prompt held by the person's typing (waitEmptyInput) is a wait on the person: the
    // page shows it. Without waitEmptyInput the prompt is typed at once (it may merge).
    else if (procsOf(k).exists(p => pr(p).up and pr(p).starting))
      PANES.contains(k) and (promptReady(tm, k) or tm.input.get(k) == Pending)
    else if (k == HOST) CFG.hostWatched
    else if (k == ROLE or k == PIPE) tm.pump or tm.pending
    else runs(ROLE) or tm.pump or tm.pending
  def waitsLegally(ob: Ob): bool =
    val t = toldAny(s, ob)
    t.size() == 1 and t.forall(k => k >= 0 and not(hears(k)) and engineOwes(k))
  def doable(k: int, x: What): bool =
    variants(mkAct(k, epOf(s, k), x, cur(s, x), vsum(s), false, false, true, -1))
      .exists(a => accept(s, a) and honestContent(s, a))

  // ---- the commit of a step: every variable, and the derived ones
  action commitS(ns: Store, nn: Set[Act], np: int -> Proc, nt: Tmux, npg: Page, nf: int,
                 nm: bool, nsil: int -> int, ntk: int, ev: Event): bool = all {
    s' = ns, net' = nn, procs' = np, tm' = nt, page' = npg, faults' = nf, merged' = nm,
    silence' = nsil, ticks' = ntk, lastEvent' = ev, told' = toldOf(ns), obligations' = obligationsOf(ns),
  }
  // Every step but a poll or a tick leaves the wait markers as they are.
  action commit(ns: Store, nn: Set[Act], np: int -> Proc, nt: Tmux, npg: Page, nf: int,
                nm: bool, ev: Event): bool =
    commitS(ns, nn, np, nt, npg, nf, nm, silence, ticks, ev)
  def freshProc(k: int, ep: int, gen: int, v: Store): Proc =
    { actor: k, ep: ep, gen: gen, up: true, idle: false, starting: false, ctx: true,
      stale: false, view: v, todo: Set(), last: Set(), waiting: false, wakes: 0 }
  action init = {
    nondet c0 = envCauses.oneOf()
    nondet c1 = envCauses.oneOf()
    val s0 = initStore(Map(0 -> c0, 1 -> c1))
    all {
      s' = s0, net' = Set(),
      procs' = Map(HOST -> freshProc(HOST, 0, -1, s0), ROLE -> freshProc(ROLE, 0, 0, s0),
                   PIPE -> freshProc(PIPE, 0, 0, s0)),
      tm' = initTmux(PANES), page' = { view: s0, oldBuild: false, acts: 0 }, faults' = 0,
      merged' = false, silence' = PERSISTENT.mapBy(k => 0), ticks' = 0, lastEvent' = Start, told' = toldOf(s0), obligations' = obligationsOf(s0),
    }
  }

  // ---- honest processes: read (the wait returns with ready work), then act on the view
  action procReads(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), not(pr(p).idle), not(pr(p).waiting),
    pr(p).todo == Set() or pr(p).stale, dos(s, pr(p).actor) != Set(),
    nondet mode = Set(Full).union(if (ENV.head) Set(Head) else Set())
      .union(if (ENV.head and faults < ENV.maxFaults) Set(Drop) else Set()).oneOf()
    val xs = dos(s, pr(p).actor)
    val todo = if (mode == Full) xs else if (mode == Head) headOf(xs) else Set()
    commitS(s, net, procs.setBy(p, q => { ...q, view: s, todo: todo, stale: false }), tm, page,
            faults + if (mode == Drop) 1 else 0, merged, polled(pr(p).actor), ticks,
            Read((p, mode))),
  }
  // An honest process in its wait with nothing ready polls (its wait marker is fresh).
  action procPolls(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), not(pr(p).waiting), PERSISTENT.contains(pr(p).actor),
    dos(s, pr(p).actor) == Set(), silence.get(pr(p).actor) > 0,
    commitS(s, net, procs, tm, page, faults, merged, polled(pr(p).actor), ticks, Polled(p)),
  }
  // Time passes: every persistent role's marker ages (up to x).
  action tick: bool = all {
    ticks < ENV.maxTicks, PERSISTENT.exists(k => silence.get(k) < CFG.silentSteps),
    commitS(s, net, procs, tm, page, faults, merged,
            silence.keys().mapBy(k => if (silence.get(k) < CFG.silentSteps) silence.get(k) + 1
                                      else silence.get(k)), ticks + 1, Ticked),
  }
  action procActs(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), not(pr(p).idle), not(pr(p).waiting),
    sent(pr(p).actor) < ENV.maxNet,
    nondet x = pr(p).todo.oneOf()
    val q = pr(p)
    nondet a = variants(mkAct(q.actor, q.ep, x, cur(q.view, x), vsum(q.view), false, false,
                              q.ctx, p)).filter(a => honestContent(q.view, a)).oneOf()
    commit(s, net.union(Set(a)),
           procs.setBy(p, z => { ...z, waiting: true, last: Set(a),
                                 todo: if (z.stale) z.todo else z.todo.exclude(Set(x)) }),
           tm, page, faults, merged, Posted(a)),
  }
  // A process resumed with its old context sends its last act again (it never saw the answer).
  action procRepeats(p: int): bool = all {
    not(isByz(pr(p).actor)), active(p), pr(p).stale, not(pr(p).waiting), pr(p).last != Set(),
    sent(pr(p).actor) < ENV.maxNet,
    nondet a = pr(p).last.oneOf()
    commit(s, net.union(Set(a)), procs.setBy(p, z => { ...z, waiting: true }), tm, page,
           faults, merged, Repeated(a)),
  }
  // ---- Byzantine processes: any act with their own token, any content and basis, any time
  action byzActs(p: int): bool = all {
    isByz(pr(p).actor), active(p), sent(pr(p).actor) < ENV.maxNet,
    // A step it is told (with any content and basis), any act of its own authority, or any
    // act at all (the token check refuses another's).
    val own = allWhats.filter(y => authority(mkAct(pr(p).actor, 0, y, 0, 0, false, true, true, p)))
    nondet pool = Set(dos(s, pr(p).actor), own, allWhats).filter(xs => xs != Set()).oneOf()
    nondet x = pool.oneOf()
    nondet seen = Set(cur(s, x) - 1, cur(s, x), cur(s, x) + 1).oneOf()
    nondet seenDir = Set(vsum(s) - 1, vsum(s)).oneOf()
    nondet a = variants(mkAct(pr(p).actor, pr(p).ep, x, seen, seenDir, false, true,
                              pr(p).ctx, p)).oneOf()
    commit(s, net.union(Set(a)), procs, tm, page, faults, merged, Posted(a)),
  }
  // A process goes on after a stop at most twice (else random runs toggle forever).
  action byzStops(p: int): bool = all {
    isByz(pr(p).actor), active(p), not(pr(p).idle),
    commit(s, net, procs.setBy(p, z => { ...z, idle: true }), tm, page, faults, merged, Stopped(p)),
  }
  action byzWakes(p: int): bool = all {
    isByz(pr(p).actor), active(p), pr(p).idle, pr(p).wakes < 2,
    commit(s, net, procs.setBy(p, z => { ...z, idle: false, wakes: z.wakes + 1 }), tm, page,
           faults, merged, Woke(p)),
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
  def seenEnded(k: int): bool =
    procsOf(k).forall(p => pr(p).gen != tm.gen or not(pr(p).up)
                           or (CFG.idleSeen and pr(p).idle))
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
    val a = { ...mkAct(PERSON, 0, x, cur(page.view, x), vsum(page.view), page.oldBuild, false,
                       true, -1), flag: f, items: xs }
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
        stale: true, waiting: false }
    else { ...freshProc(k, ep, gen, ns), ctx: false }
  def procsAfter(a: Act, ns: Store, ctx: bool): int -> Proc =
    val np = answered(procs, a)
    val pid = np.keys().fold(0, (acc, p) => if (p >= acc) p + 1 else acc)
    match a.what {
      | AssignDo(_) => np.put(pid, { ...freshProc(s.nextMaker, 0, -1, ns), up: runs(ROLE) })
      | Resume(m) => np.put(pid, { ...resumed(m, epOf(ns, m), -1, ctx, ns), up: runs(ROLE) })
      | Revive(k) => np.put(pid, { ...resumed(k, epOf(ns, k), if (k == HOST) -1 else tm.gen,
                                              ctx, ns),
                                   up: k == HOST or reachable(tm), starting: true })
      | MoveHost => procsOf(HOST).fold(np, (acc, p) => acc.setBy(p, z => { ...z, up: false }))
          .put(pid, freshProc(HOST, epOf(ns, HOST), -1, ns))
      | Exit(k) => procsOf(k).fold(np, (acc, p) =>
          if (pr(p).idle) acc.setBy(p, z => { ...z, up: false, idle: false }) else acc)
      | _ => np
    }
  def tmAfter(a: Act): Tmux = match a.what {
    | Revive(k) => queuePrompt(tm, k, CFG.waitEmptyInput)
    | _ => tm
  }
  action storeTakes(k: int): bool = all {
    net.exists(a => a.who == k),
    nondet a = net.filter(a => a.who == k).oneOf()
    nondet ctx = BOOLS.oneOf()
    val ns = take(s, a)
    all { accept(s, a),
          commit(ns, net.exclude(Set(a)), procsAfter(a, ns, ctx), tmAfter(a), page, faults,
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
    faults < ENV.maxFaults, net != Set(),
    nondet a = net.oneOf()
    nondet ctx = BOOLS.oneOf()
    val ns = take(s, a)
    all { accept(s, a),
          commit(ns, net, procsAfter(a, ns, ctx), tmAfter(a), page, faults + 1, merged,
                 TakenKept(a)) },
  }

  // ---- processes die and come back by themselves. The role's death is its makers' death.
  def killed(p: int): int -> Proc =
    val np = procs.setBy(p, z => { ...z, up: false, idle: false })
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
    commit(s, net, procs.setBy(p, z => if (ctx) { ...z, up: true, stale: true, waiting: false }
                                       else { ...freshProc(z.actor, z.ep, z.gen, s), ctx: false }),
           tm, page, faults + 1, merged, SelfResumed(p)),
  }

  // ---- tmux
  def agentsSide(p: int): bool = pr(p).actor != HOST
  action serverKilled: bool = all {
    ENV.tmuxFaults, faults < ENV.maxFaults, reachable(tm),
    commit(s, net, procs.keys().fold(procs, (acc, p) =>
             if (agentsSide(p)) acc.setBy(p, z => { ...z, up: false }) else acc),
           kill(tm), page, faults + 1, merged, ServerKilled),
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
    commit(s, net, procsOf(k).fold(procs, (acc, p) =>
             if (pr(p).up and pr(p).starting)
               acc.setBy(p, z => { ...z, starting: false, ctx: z.ctx and not(g),
                                   stale: z.stale and not(g) })
             else acc),
           consume(tm, k), page, faults, merged or g, PromptRead((k, g))),
  }

  action procStep(p: int): bool = any {
    procReads(p), procActs(p), procRepeats(p), byzActs(p), byzStops(p), byzWakes(p),
    crashes(p), selfResumes(p),
  }
  // A Byzantine process also gets its own branch, so its acts are not rare in random runs.
  action byzStep: bool = {
    nondet p = procs.keys().filter(q => isByz(pr(q).actor) and active(q)).oneOf()
    byzActs(p)
  }
  action step = any {
    nondet p = procs.keys().oneOf() procStep(p),
    byzStep, tick,
    nondet p = procs.keys().oneOf() procPolls(p),
    harnessRevives,
    nondet k = PERSISTENT.union(s.makers.keys()).oneOf() exitReported(k),
    personActs, pageRefreshes, pageDeploys, pageReloads,
    nondet k = Set(PERSON, HARNESS).union(PERSISTENT).union(s.makers.keys()).oneOf()
      any { storeTakes(k), storeRefuses(k) },
    storeTakesKept,
    serverKilled, socketLost, serverRecreated, pumpStolen, pageServerRestarts, pumpAttaches,
    nondet k = PANES.oneOf() any { personTypes(k), personClears(k), promptRead(k) },
  }

  // ==== Tier 1: safety under Byzantine agents and faults. Each is an impossible state;
  // the history flags (Store.g) are run one by one (spec.sh), so one cannot hide another.
  // Store-shape sanity: these follow from the store's state machine; a violation is a bug
  // of the model.
  val DoneIsClosed: bool = SLOTS.forall(i => tk(s, i).st == Done implies
    (fx(s, i).stage == SClosed and liveMaker(s, i) < 0))
  val OneMakerPerTask: bool = SLOTS.forall(i =>
    s.makers.keys().filter(m => mk(s, m).slot == i and not(mk(s, m).ended)).size() <= 1)
  val ClaimOnlyLive: bool = s.makers.keys().forall(m => mk(s, m).claim implies
    (not(mk(s, m).ended) and not(s.down.contains(m))))
  val RaiseHasOwner: bool =
    SLOTS.forall(i => (tk(s, i).st == Raised) iff (fx(s, i).stage != SClosed))
  val Sane: bool = DoneIsClosed and OneMakerPerTask and ClaimOnlyLive and RaiseHasOwner
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
  val NoDoneUnderOldVersion: bool = not(s.g.endOld)
  val NoUnrecheckedScope: bool = not(s.g.unrechecked)
  val NoMergedInput: bool = not(merged)
  // DESIGN.md 10.1: no accept takes effect on an escalation that did not wait for the person
  // at its append; the person's edit takes no change in effect the person did not write and
  // did not accept.
  val NoAcceptNotWaiting: bool = not(s.g.acceptNotWaiting)
  val NoUnacceptedEditChange: bool = not(s.g.unacceptedChange)
  // The live faults of 2026-11-16 20:35 (fde5e40, e4e49ff): an open run's top task, when it
  // has an open host assignment, has it bound to the run's current session.
  val HostBoundToRunSession: bool = s.top.ended or not(s.top.hosted)
    or s.top.hostSession == s.session
  // C1 a: every remake follows a warning the host confirmed on that warning.
  val C1aConfirmed: bool = not(s.g.remakeUnconfirmed)
  // C1 b: the host keeps the top (it is hosted unless done or ended). Fails under a.
  val C1bHosted: bool = s.top.ended or s.top.done or s.top.hosted
  // D7 budget: agent changes stop at the budget.
  val ChangesWithinBudget: bool = CFG.d7 != 1 or s.agentChanges <= CFG.budget

  // ==== The dashboard (DESIGN.md 10): cards derived by the page from its copy of the store
  // (or the live store, dashLive), the wait markers and tmux.
  // A card's status. Inactive: tmux disconnected (the agents' server unreachable; the host's
  // pane lives in the person's tmux) or x polls missed. Working: the role has a step of its
  // own (with reviewSubagents a review is a subagent's: the role waits). Waiting: else.
  type CardSt = CardWorking | CardWaiting | CardInactive
  def cardView: Store = if (CFG.dashLive) s else page.view
  def tmuxGone(k: int): bool = k != HOST and not(reachable(tm))
  def ownWork(v: Store, k: int): Set[What] = dos(v, k).filter(x =>
    not(CFG.reviewSubagents and match x { | Review(_) => true | _ => false }))
  def card(k: int): CardSt =
    if (tmuxGone(k) or silence.get(k) >= CFG.silentSteps
        or (CFG.dashInactiveFromView and page.view.down.contains(k))) CardInactive
    else if (ownWork(cardView, k) != Set()) CardWorking
    else CardWaiting
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
    else if (st == SAtPerson or st == SPerson) EscWaitReview
    else EscNone
  def openTask(st: TS): bool = st == Unsent or st == Sent or st == Working or st == InReview
  // The queue: tasks shown as queued (no maker yet) or working.
  def queue: Set[int] = SLOTS.filter(i => not(cardView.top.ended) and openTask(tk(cardView, i).st))
  // A card never shows Working while the role only waits.
  val DashNoFalseWorking: bool =
    cards.forall(k => card(k) == CardWorking implies ownWork(s, k) != Set())
  // Inactive only from tmux or missed polls, never from the page's copy of the store.
  val DashInactiveReal: bool = cards.forall(k => card(k) == CardInactive implies
    (tmuxGone(k) or silence.get(k) >= CFG.silentSteps))
  // The queue shows only queued and working tasks.
  val DashQueueActive: bool = queue.forall(i => openTask(tk(s, i).st))
  // An escalation card has the pipeline's state of that escalation.
  val DashEscalationMatches: bool = FIXIDS.forall(i => escOf(cardView, i) == escOf(s, i))
  // The task pipeline row (it lists every escalation) is shown exactly when an escalation
  // waits for the person. A stale page may show it after the person's wait ended, or hide it
  // while one waits.
  def rowShown(v: Store): bool = FIXIDS.exists(i => escOf(v, i) == EscWaitReview)
  val DashRowMatches: bool = rowShown(cardView) == rowShown(s)

  // ==== Tier 2: told once.
  val EveryObligationToldOnce: bool =
    obligationsOf(s).forall(ob => waitsLegally(ob) or toldTo(ob).size() == 1)
  val ToldIsAllowed: bool =
    actorsOf(s).filter(k => k >= 0).forall(k => dos(s, k).forall(x => doable(k, x)))
  val SomethingOwed: bool = s.top.ended or obligationsOf(s) != Set()
  val Told: bool = EveryObligationToldOnce and ToldIsAllowed and SomethingOwed

  // ==== Convergence: the run stays inside the model's bounds (changes, makers). A
  // violation means the run went on past them: a finding, never a success.
  val Converges: bool = not(pastBound(s))

  // ==== Tier 3: progress. Fair: each honest actor's process does what it is told; the
  // store answers each sender; the pump, the hooks and the watcher report and revive; a
  // closed pump attaches again; a typed prompt is read. Byzantine agents, the person and
  // the page are not fair. Final is never "past the bound".
  action actorStep(k: int): bool = {
    nondet p = procsOf(k).oneOf()
    any { procReads(p), procActs(p) }
  }
  action deliverFrom(k: int): bool = any { storeTakes(k), storeRefuses(k) }
  action promptStep: bool = { nondet k = PANES.oneOf() promptRead(k) }
  action exitStep: bool = { nondet k = PERSISTENT.union(s.makers.keys()).oneOf() exitReported(k) }
  val vars = (s, net, procs, tm, page, faults, merged, silence, ticks, lastEvent, told,
              obligations)
  temporal Fairness = all {
    weakFair(actorStep(0), vars), weakFair(actorStep(1), vars), weakFair(actorStep(2), vars),
    weakFair(actorStep(3), vars), weakFair(actorStep(4), vars), weakFair(actorStep(5), vars),
    weakFair(actorStep(6), vars), weakFair(actorStep(7), vars), weakFair(actorStep(8), vars),
    weakFair(deliverFrom(-2), vars), weakFair(deliverFrom(-1), vars),
    weakFair(deliverFrom(0), vars), weakFair(deliverFrom(1), vars),
    weakFair(deliverFrom(2), vars), weakFair(deliverFrom(3), vars),
    weakFair(deliverFrom(4), vars), weakFair(deliverFrom(5), vars),
    weakFair(deliverFrom(6), vars), weakFair(deliverFrom(7), vars),
    weakFair(deliverFrom(8), vars),
    weakFair(harnessRevives, vars), weakFair(exitStep, vars), weakFair(serverRecreated, vars),
    weakFair(pumpAttaches, vars), weakFair(promptStep, vars),
  }
  temporal Progress = always(eventually(finalOf(s)))
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
  val wTopSplit = SLOTS.exists(i => fx(s, i).stage == SHostRemake)
  val wRemakeWarned = s.top.warned
  val wRemakeTop = s.top.remakes > 0
  val wOpenTop = taken(x => x == OpenTop)
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
  val wPastBudget = SLOTS.exists(i => fx(s, i).stage == SPerson)
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
  val wPromptPending = PANES.exists(k => tm.input.get(k) == Pending)
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
  val wEditInEffect = taken(x => x == Ship(EDIT)) and fx(s, EDIT).stage == SClosed
  val wPolled = isEv(e => match e { | Polled(_) => true | _ => false })
}

// ---- Configurations. DESIGN: DESIGN.md as written and the code fixes of today (refCheck,
// bindOpenOnly, rebind); every other check off; C1 a; no D7. FIXED: every proposed check on,
// D7 budget.
module cfgs {
  pure val DESIGN = { c1Keep: false, d7: 0, basis: false, build: false, rebase: false, harnessTest: false, classify: false, passTests: false,
    fullBrief: false, endedCheck: false, formCheck: false, refCheck: true, epochs: false,
    reviseCheck: false, bindOpenOnly: true, rebind: true, pumpReattach: false,
    hostWatched: false, waitEmptyInput: false, idleSeen: false,
    dashLive: false, dashInactiveFromView: false, silentSteps: 3, reviewSubagents: false,
    editBack: 1, acceptCheck: true,
    maxTries: 3, maxMakers: 6, maxChanges: 4, budget: 3, maxPts: 2, maxLoops: 1,
    maxRuleTries: 2, maxRemakes: 1 }
  pure val FIXED = { ...DESIGN, d7: 1, basis: true, build: true, rebase: true, harnessTest: true, classify: true, passTests: true,
    fullBrief: true, endedCheck: true, formCheck: true, epochs: true, reviseCheck: true,
    pumpReattach: true, hostWatched: true, waitEmptyInput: true, idleSeen: true,
    dashLive: true }
  pure val HONEST = { byzMaker: false, byzRole: false, byzPipe: false, byzHost: false,
    crash: true, tmuxFaults: true, page: true, head: true, reject: true, maxFaults: 3,
    maxNet: 3, maxPerson: 6, causes: 0.to(5), maxTicks: 8 }
  pure val CALM = { ...HONEST, crash: false, tmuxFaults: false, page: false, head: false,
    reject: false, maxFaults: 0, maxPerson: 10, causes: 0.to(5) }
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
// Every proposed check on, one Byzantine class at a time.
module fixedHonest {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = HONEST).* from "./workenv"
}
module fixedMaker {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...HONEST, byzMaker: true }).* from "./workenv"
}
module fixedRole {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...CALM, byzRole: true }).* from "./workenv"
}
module fixedPipe {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...CALM, byzPipe: true }).* from "./workenv"
}
module fixedHost {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...HONEST, byzHost: true }).* from "./workenv"
}
// Nanda's options on the fixed checks.
module c1b {
  import cfgs.*
  import workenv(CFG = { ...FIXED, c1Keep: true }, ENV = CALM).* from "./workenv"
}
module d7none {
  import cfgs.*
  import workenv(CFG = { ...FIXED, d7: 0 }, ENV = { ...CALM, causes: Set(0) }).* from "./workenv"
}
module d7shrink {
  import cfgs.*
  import workenv(CFG = { ...FIXED, d7: 2 }, ENV = CALM).* from "./workenv"
}
// The live faults before fde5e40 (a finished assignment held the session) and e4e49ff
// (run continue left the open host assignment on the old session).
module beforeBind {
  import cfgs.*
  import workenv(CFG = { ...FIXED, bindOpenOnly: false },
    ENV = { ...CALM, reject: true, causes: Set(0, 5) })
    .* from "./workenv"
}
module beforeMove {
  import cfgs.*
  import workenv(CFG = { ...FIXED, rebind: false }, ENV = CALM).* from "./workenv"
}
// Mutants: the design as written, a calm run, one fault class each, so runs go deep.
module mutPage {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, page: true, reject: true }).* from "./workenv"
}
module mutDup {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, maxFaults: 3 }).* from "./workenv"
}
module mutCrash {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, crash: true, maxFaults: 3 }).* from "./workenv"
}
module mutDash {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, dashInactiveFromView: true }, ENV = { ...CALM, crash: true,
    maxFaults: 3 }).* from "./workenv"
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
  import workenv(CFG = { ...DESIGN, acceptCheck: false }, ENV = { ...CALM, page: true })
    .* from "./workenv"
}
module mutRace {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, causes: Set(3, 4, 5) }).* from "./workenv"
}
module mutTmux {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, tmuxFaults: true, maxFaults: 3 }).* from "./workenv"
}
module mutMaker {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, byzMaker: true }).* from "./workenv"
}
module mutRole {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, byzRole: true }).* from "./workenv"
}
module mutPipe {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...CALM, byzPipe: true }).* from "./workenv"
}
module mutRef {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, refCheck: false }, ENV = { ...CALM, byzPipe: true })
    .* from "./workenv"
}
// Witness coverage. Calm: no faults, a small budget and few tries, so random runs go deep.
// Crash: the same with crashes and rejects. Faults: every fault, honest agents, the fixed
// checks (a held prompt needs waitEmptyInput). Byz: a Byzantine maker (stops and wakes).
module witnessCalm {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, d7: 1, budget: 1, maxTries: 2, rebase: true }, ENV = CALM)
    .* from "./workenv"
}
module witnessDone {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, d7: 1, budget: 1, rebase: true },
    ENV = { ...CALM, causes: Set(0, 5) }).* from "./workenv"
}
module witnessCrash {
  import cfgs.*
  import workenv(CFG = { ...DESIGN, d7: 1, budget: 1, maxTries: 2, rebase: true },
    ENV = { ...CALM, crash: true, reject: true, maxFaults: 3 }).* from "./workenv"
}
module witnessFaults {
  import cfgs.*
  import workenv(CFG = FIXED, ENV = { ...HONEST, maxFaults: 4 }).* from "./workenv"
}
module witnessByz {
  import cfgs.*
  import workenv(CFG = DESIGN, ENV = { ...HONEST, byzMaker: true, maxFaults: 4 }).* from "./workenv"
}
