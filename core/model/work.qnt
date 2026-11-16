// The work model of plan/model/DESIGN.md (locked 2026-11-16): the store and the protocol.
// No variables: which acts the store takes (accept), what each does (effect), what each actor
// is told (dos), what is owed (obligationsOf). workenv.qnt puts the actors, tmux and the other
// parts of the environment around it. README.md: words, options, properties.
module work {
  // Options. c1Keep, d7: Nanda's open choices. The others are checks; README.md says
  // which DESIGN.md states and which are proposals. tmux options are read by workenv.qnt only.
  const OPT: {
    c1Keep: bool,       // C1 b: the host keeps hosting after it remakes the top (false: a, warn)
    d7: int,            // D7: 0 none, 1 a budget of agent changes, 2 a recheck only shrinks points
    basis: bool,        // an act names its basis (revision, direction); the store refuses an old one
    build: bool,        // the store refuses an act from an old build of the page
    rebase: bool,       // a change in effect sends the other open drafts back to be redone
    harnessTest: bool,  // the harness, not the pipeline role, runs a test command on the examples
    classify: bool,     // the store, not the pipeline role, answers the two "only ...?" questions
    passTests: bool,    // the store refuses a pass while a test-command rule catches the result
    fullBrief: bool,    // a revision carries every earlier point (no context needed)
    endedCheck: bool,   // the store refuses an act of a maker that is not the task's live maker
    formCheck: bool,    // the store refuses a rule with neither evidence form
    refCheck: bool,     // the harness verifies a reference (DESIGN.md 4 states it)
    epochs: bool,       // a revive or resume makes a new token epoch; the store refuses old ones
    reviseCheck: bool,  // a draft the person sent back reaches the person only revised
    bindOpenOnly: bool, // fde5e40: a new host assignment binds the session unless an OPEN one holds it
    rebind: bool,       // e4e49ff: run continue moves the open host assignment to the new session
    pumpReattach: bool, // tmux: the pump attaches again after another client's attach -d
    hostWatched: bool,  // tmux: the exit of the host's pane (the person's tmux) is reported
    waitEmptyInput: bool, // tmux: the engine types a prompt only into an empty input line
    idleSeen: bool,     // tmux: a process that stops at its prompt counts as an exit
    // The dashboard (DESIGN.md 10; read by workenv.qnt): dashLive: cards are derived from the
    // live store, not the page's copy; dashInactiveFromView: a mutant that also shows Inactive
    // from the page's copy of the store; silentSteps: the ticks without a wait poll before a
    // role is Inactive (1 minute); reviewSubagents: Nanda's reading is false (a role reviews
    // itself).
    dashLive: bool, dashInactiveFromView: bool, silentSteps: int, reviewSubagents: bool,
    // DESIGN.md 10.1 (open): after the pipeline role carries the person's direction edit down,
    // does it come back to the person? 0 always; 1 only when the pipeline changed items the
    // person did not write; 2 never.
    editBack: int,
    // DESIGN.md 10.1: the store refuses an accept (or a send-back) of an escalation that does
    // not wait for the person at the append (the page offers it only when its view says so).
    acceptCheck: bool,
    maxTries: int, maxMakers: int, maxChanges: int, budget: int, maxPts: int, maxLoops: int,
    maxRuleTries: int, maxRemakes: int,
  }

  // ---- actors. Makers get ids from 3 up, one per assignment (a fresh one per task).
  pure val PERSON = -1
  pure val HARNESS = -2  // the engine: the pump and hooks (exits), the watcher (revives)
  pure val HOST = 0
  pure val ROLE = 1      // the persistent role (its card): assigns, reviews, raises
  pure val PIPE = 2      // the pipeline role: evaluations, the direction pipeline, review loops
  pure val PERSISTENT = Set(HOST, ROLE, PIPE)
  pure val SLOTS = Set(0, 1)  // two tasks of the top, sent by the host to the role
  // The person's direction edit enters the pipeline as its own entry (DESIGN.md 10.1); it has
  // a Fix but no task. FIXIDS: the tasks' raises and the edit.
  pure val EDIT = 2
  pure val FIXIDS = Set(0, 1, EDIT)

  // DESIGN.md 9: a direction, each standard and each rule are separate records, each with its
  // own version. The model has one direction, two standards, two rules. A standard applies to
  // the tasks inside its `where`; a rule to the tasks it names (WHERE below).
  type Item = IDir | IStd(int) | IRule(int)
  pure val ITEMS = Set(IDir, IStd(0), IStd(1), IRule(0), IRule(1))
  pure def applies(x: Item, i: int): bool = match x {
    | IDir => true
    | IStd(j) => j == 1 or i == 0     // standard 0: task 0; standard 1: both tasks
    | IRule(j) => i == j              // rule 0: task 0; rule 1: task 1
  }
  pure def isRule(x: Item): bool = match x { | IRule(_) => true | _ => false }
  pure def ruleNo(x: Item): int = match x { | IRule(j) => j | _ => -1 }
  // The item sets a draft may change (a direction draft changes the direction and some
  // items below it; a standards draft only standards and rules).
  pure val ITEMSETS = Set(Set(IDir, IStd(1), IRule(0)), Set(IDir), Set(IStd(0)), Set(IStd(1)),
    Set(IRule(0)), Set(IRule(1)), Set(IStd(0), IRule(0)))
  type TS = Unsent | Sent | Working | InReview | Raised | Done
  type Verdict = Pass | Fail | RaiseTries | RaiseNoRule | RaiseMisses
  type Level = Split | Fit | Principle | Direct | Standard
  // The real cause of a task's trouble (hidden from the store and the agents' choices).
  type Cause = NoCause | CauseAt(Level)
  // SHostRemake: the evaluation split the top; the host must remake it.
  // SPerson: past the D7 bound the person decides.
  type Stage = SEval | SPrinciple | SDirAssess | SStdAssess | SRuleAssess | STest | SDraft
             | SLoop | SAtPerson | SAccepted | SHostRemake | SPerson | SClosed
  type Form = NoForm | Mech | Ref | Both
  type DKind = DDir | DRole
  type What =
    | OpenTop | EndProject | MoveHost | EditDirection | Reject(int) | Accept(int) | SendBack(int)
    | Decide(int)                                                              // person
    | SendTask(int) | Reassign | RemakeTop | TopDone                           // host
    | AssignDo(int) | Review(int) | Resume(int)                                // role
    | ReadBrief(int) | Report(int)                                             // maker
    | Evaluate(int) | Advance(int) | WriteRule(int) | RunTest(int) | Ship(int)
    | LoopReview(int) | RecheckDone(int)                                      // pipeline
    | Revive(int) | Exit(int) | RunRule(int)                                   // harness
  // An act as it reaches the store.
  // who, ep: the token and its epoch (a sender has only its own). seen, seenDir: the revision
  // of the target and the versions (their sum) of the sender's view. items: the items a draft
  // names as changed; real (ghost): the items its content really changes. old: from an old page build
  // (it names no basis). v, pts, level, flag, flag2, form: content (see README.md, "Act
  // content"). Ghost fields, never read by accept: cause (the truth chosen by the environment),
  // byz (a Byzantine sender), ctx (the sender had its context), pid (its process).
  type Act = { who: int, ep: int, what: What, seen: int, seenDir: int, old: bool, v: Verdict,
               pts: int, level: Level, flag: bool, flag2: bool, form: Form, cause: Cause,
               items: Set[Item], real: Set[Item], byz: bool, ctx: bool, pid: int }

  // rBad: the latest result is wrong (a slip of the maker or the task's real cause).
  // checked: the item versions the result was made or last checked under. pend: items of a
  // done task still to recheck. bound: D7 shrink, the points the next failing review may have.
  type Task = { gen: int, st: TS, tries: int, maker: int, rid: int, checked: Item -> int,
                pend: Set[Item], rBad: bool, cause: Cause, lastPts: int, bound: int }
  // brief: the item versions of the brief it read (its snapshot `under`).
  type Maker = { slot: int, ended: bool, claim: bool, brief: Item -> int, revs: int }
  // A raise and what follows it. truth: the test command behaves on its examples. refOk: the
  // reference exists. roleOnly:
  // the role draft changes only the card (content); roleLabel: the pipeline's answer.
  // items, real: the items the draft names, and those its content changes. base: the item
  // versions it was built on.
  type Fix = { stage: Stage, entry: Stage, level: Level, kind: DKind, form: Form, truth: bool,
               refOk: bool, ruleTries: int, items: Set[Item], real: Set[Item],
               roleOnly: bool, roleLabel: bool, base: Item -> int, cardBase: int, rev: int,
               sentBack: Set[int], needRevise: bool, loops: int, step: int, wrote: Set[Item] }
  // hosted: an open host assignment. hostSession: its session (-1: none). everBound: some
  // assignment of this top task, open or finished, held a session. step: basis of host acts.
  type Top = { hosted: bool, hostSession: int, everBound: bool, done: bool, ended: bool,
               remakes: int, warned: bool, warnStep: int, step: int }
  // Impossible states the store let in (each must stay false), and markers for witnesses.
  type Ghost = {
    endedActed: bool, otherResult: bool, otherVersion: bool, staleReport: bool,
    unseenReject: bool, unseenAccept: bool, rejectedInEffect: bool, lostUpdate: bool,
    failedTest: bool, noForm: bool, badRef: bool, deepNoPerson: bool, roleMisjudged: bool,
    passBroken: bool, passDefect: bool, shallowEval: bool, staleFix: bool, oldEpoch: bool,
    noContext: bool, unchangedResubmit: bool, endOld: bool, remakeUnconfirmed: bool,
    unrechecked: bool, unacceptedChange: bool, acceptNotWaiting: bool, rebaseFired: bool, recheckFired: bool, reassignEnded: bool,
  }
  type Store = {
    top: Top, session: int, tasks: int -> Task, makers: int -> Maker, fixes: int -> Fix,
    ver: Item -> int, ruleForm: int -> Form, card: int, changes: int, agentChanges: int,
    down: Set[int], ep: int -> int, nextMaker: int, g: Ghost,
  }

  pure val ZERO: Item -> int = ITEMS.mapBy(x => 0)
  pure val CLOSED: Fix = { stage: SClosed, entry: SClosed, level: Standard, kind: DDir,
    form: NoForm, truth: true, refOk: true, ruleTries: 0, items: Set(), real: Set(),
    roleOnly: false, roleLabel: false, base: ZERO, cardBase: 0, rev: 0, sentBack: Set(),
    needRevise: false, loops: 0, step: 0, wrote: Set() }
  pure val NOGHOST: Ghost = { endedActed: false, otherResult: false, otherVersion: false,
    staleReport: false, unseenReject: false, unseenAccept: false, rejectedInEffect: false,
    lostUpdate: false, failedTest: false, noForm: false, badRef: false, deepNoPerson: false,
    roleMisjudged: false, passBroken: false, passDefect: false, shallowEval: false,
    staleFix: false, oldEpoch: false, noContext: false, unchangedResubmit: false,
    endOld: false, remakeUnconfirmed: false, unrechecked: false, unacceptedChange: false, acceptNotWaiting: false,
    rebaseFired: false,
    recheckFired: false, reassignEnded: false }
  def freshTask(gen: int, c: Cause): Task = { gen: gen, st: Unsent, tries: 0, maker: -1,
    rid: -1, checked: ZERO, pend: Set(), rBad: false, cause: c, lastPts: OPT.maxPts, bound: OPT.maxPts }
  // The person opened the top task before the model starts; the host holds it in session 0.
  def initStore(causes: int -> Cause): Store = {
    top: { hosted: true, hostSession: 0, everBound: true, done: false, ended: false,
           remakes: 0, warned: false, warnStep: -1, step: 0 },
    session: 0, tasks: SLOTS.mapBy(i => freshTask(0, causes.get(i))), makers: Map(),
    fixes: FIXIDS.mapBy(i => CLOSED), ver: ZERO, ruleForm: Set(0, 1).mapBy(j => Ref), card: 0,
    changes: 0, agentChanges: 0, down: Set(), ep: PERSISTENT.mapBy(k => 0), nextMaker: 3,
    g: NOGHOST,
  }

  // ---- reads
  def tk(s: Store, i: int): Task = s.tasks.get(i)
  def fx(s: Store, i: int): Fix = s.fixes.get(i)
  def isMaker(s: Store, m: int): bool = s.makers.keys().contains(m)
  def mk(s: Store, m: int): Maker = s.makers.get(m)
  def epOf(s: Store, k: int): int = if (s.ep.keys().contains(k)) s.ep.get(k) else 0
  // The sum of all versions: it grows with every change (an act's view of the versions).
  def vsum(s: Store): int = ITEMS.fold(0, (acc, x) => acc + s.ver.get(x))
  def appliesTo(i: int): Set[Item] = ITEMS.filter(x => applies(x, i))
  def testRule(s: Store, x: Item): bool = isRule(x) and hasMech(s.ruleForm.get(ruleNo(x)))
  // A rule with only a test command (no reader) applies to the task: its test catches a
  // bad result without a judge.
  def mechCatches(s: Store, i: int): bool =
    appliesTo(i).exists(x => isRule(x) and s.ruleForm.get(ruleNo(x)) == Mech)
  def oldFor(s: Store, i: int): Set[Item] =
    appliesTo(i).filter(x => tk(s, i).checked.get(x) < s.ver.get(x))
  def briefOld(s: Store, m: int): bool =
    appliesTo(mk(s, m).slot).exists(x => mk(s, m).brief.get(x) < s.ver.get(x))
  def allDone(s: Store): bool = SLOTS.forall(i => tk(s, i).st == Done and tk(s, i).pend == Set())
  def hasMech(f: Form): bool = f == Mech or f == Both
  def hasRef(f: Form): bool = f == Ref or f == Both
  def budgetLeft(s: Store): bool = OPT.d7 != 1 or s.agentChanges < OPT.budget
  // Without acceptCheck an accept is taken for any open escalation.
  def atPerson(s: Store, i: int): bool =
    if (OPT.acceptCheck) fx(s, i).stage == SAtPerson else fx(s, i).stage != SClosed
  // The host may remake the top now; otherwise a split of the top is the person's.
  def remakeable(s: Store): bool = s.top.remakes < OPT.maxRemakes and budgetLeft(s)
  def pipeStage(st: Stage): bool =
    Set(SEval, SPrinciple, SDirAssess, SStdAssess, SRuleAssess, STest, SDraft, SLoop)
      .contains(st)
  def nextStage(st: Stage): Stage =
    if (st == SPrinciple) SDirAssess else if (st == SDirAssess) SStdAssess else SRuleAssess
  def entryOf(l: Level): Stage =
    if (l == Principle) SPrinciple else if (l == Direct) SDirAssess else SStdAssess
  def depth(l: Level): int =
    if (l == Principle) 3 else if (l == Direct) 2 else if (l == Standard) 1 else 0
  // A change entered at level l removes the cause c (a direction change runs every stage
  // below its entry, so it removes a cause at its level or below).
  def resolves(l: Level, c: Cause): bool = match c {
    | NoCause => true
    | CauseAt(x) => if (x == Split or x == Fit) l == x else depth(l) >= depth(x)
  }
  def liveMaker(s: Store, i: int): int =
    val m = tk(s, i).maker
    if (m >= 0 and isMaker(s, m) and not(mk(s, m).ended)) m else -1
  // The host's wait finds the top only through an assignment bound to the run's session.
  def hostFinds(s: Store): bool = s.top.hosted and s.top.hostSession == s.session

  // The basis of an act, now. -1: the act names none.
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
    | RemakeTop => s.top.step
    | RecheckDone(i) => tk(s, i).rid
    | _ => -1
  }
  def dirBased(x: What): bool = match x { | Review(_) => true | Report(_) => true | _ => false }

  // ---- the store's check: the token (no forgery)
  def authority(a: Act): bool = match a.what {
    | OpenTop => a.who == PERSON
    | EndProject => a.who == PERSON
    | MoveHost => a.who == PERSON
    | EditDirection => a.who == PERSON
    | Reject(_) => a.who == PERSON
    | Accept(_) => a.who == PERSON
    | SendBack(_) => a.who == PERSON
    | Decide(_) => a.who == PERSON
    | SendTask(_) => a.who == HOST
    | Reassign => a.who == HOST
    | RemakeTop => a.who == HOST
    | TopDone => a.who == HOST
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
    | RecheckDone(_) => a.who == PIPE
    | RunRule(_) => a.who == HARNESS
    | Revive(_) => a.who == HARNESS
    | Exit(_) => a.who == HARNESS
  }
  def epochOk(s: Store, a: Act): bool = not(OPT.epochs) or a.who < 0 or a.ep >= epOf(s, a.who)
  // ---- the store's check: legal in the state at the append (the store's state machine)
  // A maker act: on a working task; with endedCheck, only by its live maker.
  def makerAt(s: Store, m: int): bool = isMaker(s, m) and not(s.down.contains(m))
    and tk(s, mk(s, m).slot).st == Working
    and (not(OPT.endedCheck) or (not(mk(s, m).ended) and tk(s, mk(s, m).slot).maker == m))
  def reviewOk(s: Store, i: int, a: Act): bool =
    val t = tk(s, i)
    val ptsOk = a.pts >= 1 and a.pts <= OPT.maxPts
    t.st == InReview and match a.v {
      | Pass => not(OPT.passTests and t.rBad and mechCatches(s, i))
      | Fail => t.tries + 1 < OPT.maxTries and ptsOk
      | RaiseTries => t.tries + 1 >= OPT.maxTries and ptsOk
      | RaiseNoRule => ptsOk
      | RaiseMisses => ptsOk
    }
  def legal(s: Store, a: Act): bool = match a.what {
    | OpenTop => not(s.top.hosted) and not(s.top.done)
    | EndProject => s.top.done
    | MoveHost => true
    | EditDirection => fx(s, EDIT).stage == SClosed and a.items.contains(IDir)
    | Reject(i) => tk(s, i).rid >= 0 and (tk(s, i).st == InReview or tk(s, i).st == Done)
    | Accept(i) => atPerson(s, i)
    | SendBack(i) => atPerson(s, i)
    | Decide(i) => fx(s, i).stage == SPerson
        or (fx(s, i).stage == SHostRemake and not(remakeable(s)))
    | SendTask(i) => s.top.hosted and tk(s, i).st == Unsent
    | Reassign => s.top.hosted and FIXIDS.exists(i => fx(s, i).stage == SAccepted)
    | RemakeTop => s.top.hosted and not(s.top.done) and s.top.remakes < OPT.maxRemakes
        and budgetLeft(s)
    | TopDone => s.top.hosted and allDone(s) and not(s.top.done)
    | AssignDo(i) => s.top.hosted and tk(s, i).st == Sent
    | Review(i) => reviewOk(s, i, a)
    | Resume(m) => isMaker(s, m) and not(mk(s, m).ended) and s.down.contains(m)
    | ReadBrief(m) => makerAt(s, m)
    | Report(m) => makerAt(s, m) and (mk(s, m).claim or not(OPT.endedCheck))
    | Evaluate(i) => fx(s, i).stage == SEval
    | Advance(i) => Set(SPrinciple, SDirAssess, SStdAssess).contains(fx(s, i).stage)
    // Past maxRuleTries a rule must take the reference form (a model bound; README.md).
    | WriteRule(i) => fx(s, i).stage == SRuleAssess
        and (not(OPT.formCheck) or a.form != NoForm)
        and (not(OPT.refCheck) or not(hasRef(a.form)) or a.flag2)
        and (fx(s, i).ruleTries < OPT.maxRuleTries or a.form == Ref)
    | RunTest(i) => fx(s, i).stage == STest
    | Ship(i) => fx(s, i).stage == SDraft
    | LoopReview(i) => fx(s, i).stage == SLoop
        and (a.flag or fx(s, i).loops < OPT.maxLoops)
        and not(OPT.reviseCheck and a.flag and fx(s, i).needRevise)
    | RecheckDone(i) => tk(s, i).st == Done and tk(s, i).pend.exists(x => not(testRule(s, x)))
    | RunRule(i) => tk(s, i).st == Done and tk(s, i).pend.exists(x => testRule(s, x))
    | Revive(k) => PERSISTENT.contains(k) and s.down.contains(k)
    | Exit(k) => not(s.down.contains(k))
  }
  def basisOk(s: Store, a: Act): bool =
    not(OPT.basis) or a.old
      or ((cur(s, a.what) < 0 or a.seen == cur(s, a.what))
          and (not(dirBased(a.what)) or a.seenDir == vsum(s)))
  def accept(s: Store, a: Act): bool =
    (not(s.top.ended) or a.who == HARNESS) and authority(a) and epochOk(s, a) and legal(s, a)
      and basisOk(s, a) and not(OPT.build and a.old)

  // ---- effects
  def setT(s: Store, i: int, f: Task => Task): Store = { ...s, tasks: s.tasks.setBy(i, f) }
  def setF(s: Store, i: int, f: Fix => Fix): Store = { ...s, fixes: s.fixes.setBy(i, f) }
  def setM(s: Store, m: int, f: Maker => Maker): Store =
    if (isMaker(s, m)) { ...s, makers: s.makers.setBy(m, f) } else s
  def endMaker(s: Store, m: int): Store = setM(s, m, y => { ...y, ended: true, claim: false })
  def ghost(s: Store, f: Ghost => Ghost): Store = { ...s, g: f(s.g) }
  def bump(s: Store, i: int): Store = setF(s, i, f => { ...f, step: f.step + 1 })
  def newEp(s: Store, k: int): Store = { ...s, ep: s.ep.put(k, epOf(s, k) + 1) }
  // A raise: the maker ends; the evaluation opens (past the D7 budget: the person decides).
  def raise(s: Store, i: int, tries: int, pts: int): Store =
    val s1 = setT(endMaker(s, tk(s, i).maker), i, t => { ...t, st: Raised, tries: tries,
                                                          maker: -1, lastPts: pts, pend: Set() })
    setF(s1, i, f => { ...CLOSED, stage: if (budgetLeft(s)) SEval else SPerson,
                       step: f.step + 1, base: s.ver, cardBase: s.card })
  // The work goes back to the role as a task (a fresh maker, no tries used). D7 shrink: the
  // next failing review of this task must have fewer points than the one before the change.
  def backToRole(s: Store, i: int): Store =
    if (i == EDIT) setF(s, i, f => { ...CLOSED, step: f.step + 1 }) else
    setF(setT(s, i, t => { ...t, st: Sent, tries: 0, maker: -1, pend: Set(),
                           bound: if (OPT.d7 == 2) t.lastPts - 1 else t.bound }),
         i, f => { ...CLOSED, step: f.step + 1 })
  def toPerson(s: Store, i: int): Store = setF(s, i, f => { ...f, stage: SPerson })
  def counted(s: Store, agent: bool): Store =
    { ...s, changes: s.changes + 1, agentChanges: s.agentChanges + if (agent) 1 else 0 }
  def resolveCause(s: Store, i: int): Store =
    if (i == EDIT) s else if (resolves(fx(s, i).level, tk(s, i).cause)) setT(s, i, t => { ...t, cause: NoCause })
    else s
  // The items a change of task i's raise puts in effect: those the draft names, or with
  // classify those its content changes (the store diffs the records).
  def changedBy(f: Fix): Set[Item] = if (OPT.classify) f.real else f.items
  // A change of task i's raise takes effect (DESIGN.md 9). Each changed item gets a new
  // version. Recheck, by what changed: a direction change every active and done task; a
  // standard change the tasks in its `where`; a rule change the tasks it applies to, that
  // rule only. Never a raised (rejected) task. Active tasks are rechecked by their running
  // role (the maker reads its brief again; the role reviews under the new versions); done
  // tasks wait for the pipeline role (RecheckDone) or, for a rule with a test command, the
  // harness (RunRule).
  def itemsInEffect(s: Store, i: int, agent: bool): Store =
    val f = fx(s, i)
    val c = changedBy(f)
    val rules = c.filter(x => isRule(x))
    // Items the content changes but the store did not version: their tasks are not rechecked.
    val missed = f.real.exclude(c)
    val s0 = ghost(s, g => { ...g,
      failedTest: g.failedTest or (rules != Set() and hasMech(f.form) and not(f.truth)),
      noForm: g.noForm or (rules != Set() and f.form == NoForm),
      badRef: g.badRef or (rules != Set() and hasRef(f.form) and not(f.refOk)),
      lostUpdate: g.lostUpdate or c.exists(x => f.base.get(x) < s.ver.get(x)),
      unrechecked: g.unrechecked or SLOTS.exists(j => j != i and tk(s, j).st != Raised
        and tk(s, j).st != Unsent and missed.exists(x => applies(x, j))) })
    val s1 = resolveCause(counted({ ...s0,
      ver: s.ver.keys().mapBy(x => s.ver.get(x) + if (c.contains(x)) 1 else 0),
      ruleForm: s.ruleForm.keys().mapBy(j =>
        if (rules.contains(IRule(j))) f.form else s.ruleForm.get(j)) }, agent), i)
    val s2 = SLOTS.fold(s1, (acc, j) =>
      val hit = c.filter(x => applies(x, j))
      if (j != i and tk(acc, j).st == Done and hit != Set())
        ghost({ ...setT(acc, j, t => { ...t, pend: t.pend.union(hit) }),
                top: { ...acc.top, done: false } }, g => { ...g, recheckFired: true })
      else acc)
    if (not(OPT.rebase)) s2 else
      FIXIDS.fold(s2, (acc, j) =>
        val z = fx(acc, j)
        val early = Set(SPrinciple, SDirAssess, SStdAssess, SRuleAssess, STest, SDraft)
          .contains(z.stage) and c.contains(IDir)
        val late = (z.stage == SLoop or z.stage == SAtPerson) and z.kind == DDir
          and changedBy(z).exists(x => c.contains(x))
        if (j != i and (early or late))
          ghost(setF(acc, j, y => { ...y, stage: y.entry, base: acc.ver, rev: y.rev + 1,
                                    step: y.step + 1 }), g => { ...g, rebaseFired: true })
        else acc)
  def cardInEffect(s: Store, i: int): Store =
    val f = fx(s, i)
    val s0 = ghost(s, g => { ...g, lostUpdate: g.lostUpdate or f.cardBase < s.card })
    val s1 = resolveCause(counted({ ...s0, card: s.card + 1 }, false), i)
    if (not(OPT.rebase)) s1 else
      FIXIDS.fold(s1, (acc, j) =>
        if (j != i and fx(acc, j).kind == DRole
            and (fx(acc, j).stage == SLoop or fx(acc, j).stage == SAtPerson))
          ghost(setF(acc, j, z => { ...z, stage: SLoop, cardBase: acc.card, rev: z.rev + 1,
                                    step: z.step + 1 }), g => { ...g, rebaseFired: true })
        else acc)
  // A history flag from the sender's own basis counts only for a sender that is not
  // Byzantine (a Byzantine sender can write any basis; README.md, "Limits").
  def staleFixAct(s: Store, i: int, a: Act): Store =
    ghost(s, g => { ...g, staleFix: g.staleFix or (not(a.byz) and a.seen != fx(s, i).step) })
  // Ship's yes branch: a standard change, in effect at once (past the budget: the person).
  def shipStandard(s: Store, i: int): Store =
    if (budgetLeft(s)) backToRole(itemsInEffect(s, i, true), i) else toPerson(s, i)

  // The person's edit after the pipeline role carried it down. editBack 0: back to the
  // person always; 1: only when the change has items the person did not write (as the store
  // sees them: named, or with classify the content); 2: never. A change in effect with items
  // the person did not write and did not accept is the history flag unacceptedChange.
  def shipEdit(s: Store, a: Act): Store =
    val f = fx(s, EDIT)
    val seen = if (OPT.classify) a.real else a.items
    val back = OPT.editBack == 0 or (OPT.editBack == 1 and seen.exclude(f.wrote) != Set())
    if (back) setF(s, EDIT, z => { ...z, stage: SLoop })
    else backToRole(itemsInEffect(ghost(s, g => { ...g, unacceptedChange: g.unacceptedChange
                                           or a.real.exclude(f.wrote) != Set() }),
                                  EDIT, false), EDIT)
  def effect(s: Store, a: Act): Store = match a.what {
    // A new host assignment. Before fde5e40 it bound the session only if no assignment of
    // this top task, finished or open, ever held one.
    | OpenTop =>
        val bind = OPT.bindOpenOnly or not(s.top.everBound)
        { ...s, top: { ...s.top, hosted: true, hostSession: if (bind) s.session else -1,
                       everBound: s.top.everBound or bind, warned: false, step: s.top.step + 1 } }
    | EndProject =>
        // A task done under an old version of an item that applies to it.
        val old = SLOTS.exists(i => tk(s, i).st == Done and oldFor(s, i) != Set())
        ghost({ ...s, top: { ...s.top, ended: true } }, g => { ...g, endOld: g.endOld or old })
    // Run continue: the run's host moves to a new session (a new host process).
    | MoveHost =>
        val s1 = newEp({ ...s, session: s.session + 1 }, HOST)
        if (OPT.rebind and s.top.hosted) { ...s1, top: { ...s.top, hostSession: s.session + 1 } }
        else s1
    // The person's edit (items: what the person wrote) enters at direction assessment.
    | EditDirection => setF(s, EDIT, f => { ...CLOSED, stage: SDirAssess, entry: SDirAssess,
        level: Direct, kind: DDir, base: s.ver, wrote: a.items, step: f.step + 1 })
    | Reject(i) =>
        val t = tk(s, i)
        val s1 = ghost(s, g => { ...g, unseenReject: g.unseenReject or a.seen != t.rid })
        val s2 = if (t.st == Done) { ...s1, top: { ...s1.top, done: false } } else s1
        raise(s2, i, t.tries, t.lastPts)
    | Accept(i) =>
        val f = fx(s, i)
        val s1 = ghost(s, g => { ...g,
          acceptNotWaiting: g.acceptNotWaiting or f.stage != SAtPerson,
          unseenAccept: g.unseenAccept or a.seen != f.step,
          rejectedInEffect: g.rejectedInEffect or (f.sentBack.contains(f.rev) and a.seen < f.step) })
        val s2 = bump(if (f.kind == DDir) itemsInEffect(s1, i, false) else cardInEffect(s1, i), i)
        // "only a role change?" yes: back to the card, the work goes on. no: host reassigns.
        val roleOnly = f.kind == DRole and (if (OPT.classify) f.roleOnly else f.roleLabel)
        val s3 = ghost(s2, g => { ...g, roleMisjudged: g.roleMisjudged
          or (roleOnly and not(f.roleOnly)) })
        if (roleOnly) backToRole(s3, i) else setF(s3, i, z => { ...z, stage: SAccepted })
    | SendBack(i) => setF(s, i, f => { ...f, stage: SLoop, sentBack: f.sentBack.union(Set(f.rev)),
                                       needRevise: true, loops: 0, step: f.step + 1 })
    // The person decides past the D7 bound: take the result as it is, or evaluate again.
    | Decide(i) =>
        if (a.flag) setF(setT(s, i, t => { ...t, st: Done }), i, f => { ...CLOSED, step: f.step + 1 })
        else setF(s, i, f => { ...f, stage: SEval, step: f.step + 1 })
    | SendTask(i) => setT(s, i, t => { ...t, st: Sent })
    // The roles are reassigned: the accepted raises go back, the role's open work is sent
    // again to the new role (its makers end). Not a change of directions (D7 does not count it).
    | Reassign =>
        FIXIDS.fold(s, (acc, j) =>
          if (fx(acc, j).stage == SAccepted) backToRole(acc, j)
          else if (j == EDIT) acc
          else if (tk(acc, j).st == Working or tk(acc, j).st == InReview)
            ghost(setT(endMaker(acc, tk(acc, j).maker), j, t => { ...t, st: Sent, tries: 0, maker: -1 }),
                  g => { ...g, reassignEnded: true })
          else acc)
    // C1 a: the first remake is a warning; the next one, built on the warning, remakes.
    | RemakeTop =>
        if (not(OPT.c1Keep) and not(s.top.warned))
          { ...s, top: { ...s.top, warned: true, warnStep: s.top.step + 1, step: s.top.step + 1 } }
        else
          val unconfirmed = not(OPT.c1Keep) and not(a.byz) and a.seen != s.top.warnStep
          val s1 = counted(s.makers.keys().fold(s, (acc, m) => endMaker(acc, m)), true)
          ghost({ ...s1,
            top: { ...s.top, hosted: OPT.c1Keep, hostSession: if (OPT.c1Keep) s.top.hostSession else -1,
                   everBound: OPT.c1Keep, done: false, warned: false, remakes: s.top.remakes + 1,
                   step: s.top.step + 1 },
            tasks: SLOTS.mapBy(i => freshTask(tk(s, i).gen + 1, a.cause)),
            fixes: FIXIDS.mapBy(i => { ...CLOSED, step: fx(s, i).step + 1 }) },
            g => { ...g, remakeUnconfirmed: g.remakeUnconfirmed or unconfirmed })
    // The host returns the done top to the person; its assignment finishes.
    | TopDone => { ...s, top: { ...s.top, done: true, hosted: false, hostSession: -1 } }
    | AssignDo(i) =>
        val m = s.nextMaker
        val s1 = { ...s, nextMaker: m + 1, ep: s.ep.put(m, 0), makers: s.makers.put(m,
          { slot: i, ended: false, claim: false, brief: ZERO, revs: 0 }) }
        setT(s1, i, t => { ...t, st: Working, tries: 0, maker: m })
    | Review(i) =>
        val t = tk(s, i)
        val s1 = ghost(s, g => { ...g, otherResult: g.otherResult or (not(a.byz) and a.seen != t.rid) })
        // D7 shrink: more points than the bound sends the task to the person.
        val over = OPT.d7 == 2 and a.v != Pass and a.pts > t.bound
        if (over) toPerson(setT(endMaker(s1, t.maker), i, z => { ...z, st: Raised, maker: -1 }), i)
        else match a.v {
          | Pass =>
              val s2 = ghost(s1, g => { ...g,
                otherVersion: g.otherVersion or (not(a.byz) and a.seenDir != vsum(s)),
                passBroken: g.passBroken or (t.rBad and mechCatches(s, i)),
                passDefect: g.passDefect or t.rBad })
              setT(endMaker(s2, t.maker), i, z => { ...z, st: Done, maker: -1, checked: s.ver,
                                                     pend: Set() })
          // The revision goes to the same maker. A rechecked task has none: a fresh one.
          | Fail =>
              if (liveMaker(s, i) < 0)
                setT(s1, i, z => { ...z, st: Sent, tries: z.tries + 1, lastPts: a.pts })
              else setM(setT(s1, i, z => { ...z, st: Working, tries: z.tries + 1, lastPts: a.pts }),
                        t.maker, y => { ...y, revs: y.revs + 1 })
          | RaiseTries => raise(s1, i, t.tries + 1, a.pts)
          | RaiseNoRule => raise(s1, i, t.tries, a.pts)
          | RaiseMisses => raise(s1, i, t.tries, a.pts)
        }
    | Resume(m) => newEp({ ...s, down: s.down.exclude(Set(m)) }, m)
    | ReadBrief(m) => setM(s, m, y => { ...y, claim: true, brief: s.ver })
    | Report(m) =>
        val y = mk(s, m)
        val t = tk(s, y.slot)
        val s1 = ghost(s, g => { ...g,
          staleReport: g.staleReport or (not(a.byz) and not(a.old) and a.seen != y.revs),
          endedActed: g.endedActed or y.ended or t.maker != m,
          noContext: g.noContext or (not(a.byz) and y.revs > 0 and not(a.ctx)
                                     and not(OPT.fullBrief)) })
        setT(s1, y.slot, z => { ...z, st: InReview, rid: z.rid + 1, checked: y.brief,
                                rBad: a.flag or z.cause != NoCause })
    | Evaluate(i) =>
        val t = tk(s, i)
        val s1 = ghost(bump(staleFixAct(s, i, a), i), g => { ...g,
          shallowEval: g.shallowEval or not(resolves(a.level, t.cause)) })
        val s2 = setF(s1, i, f => { ...f, level: a.level })
        match a.level {
          // flag: the split is of the top (the host must remake it).
          | Split =>
              if (a.flag) setF(s2, i, f => { ...f, stage: SHostRemake })
              else if (not(budgetLeft(s))) toPerson(s2, i)
              else
                val s3 = counted(s2, true)
                setF(setT(s3, i, z => { ...freshTask(z.gen + 1, a.cause), st: Sent }), i,
                     f => { ...CLOSED, step: f.step })
          | Fit => setF(s2, i, f => { ...f, kind: DRole, stage: SLoop, entry: SLoop,
                                      roleLabel: a.flag, roleOnly: a.flag2, cardBase: s.card })
          | _ => setF(s2, i, f => { ...f, kind: DDir, stage: entryOf(a.level),
                                    entry: entryOf(a.level), base: s.ver })
        }
    | Advance(i) => setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, stage: nextStage(f.stage) })
    // flag: the test command really behaves on the examples; flag2: the reference exists.
    | WriteRule(i) =>
        setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, form: a.form, truth: a.flag,
          refOk: a.flag2, stage: if (hasMech(a.form)) STest else SDraft })
    // flag: the pipeline role's claim of the test's outcome.
    | RunTest(i) =>
        val ok = if (OPT.harnessTest) fx(s, i).truth else a.flag
        setF(bump(staleFixAct(s, i, a), i), i, z => { ...z,
          stage: if (ok) SDraft else SRuleAssess, ruleTries: z.ruleTries + if (ok) 0 else 1 })
    // items: the items the draft names; real: those its content changes. "Only a standard
    // change?" is read from the named items (with classify: from the content).
    | Ship(i) =>
        val s1 = setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, items: a.items, real: a.real })
        val isStd = not((if (OPT.classify) a.real else a.items).contains(IDir))
        if (i == EDIT) shipEdit(s1, a)
        else if (isStd)
          shipStandard(ghost(s1, g => { ...g,
            deepNoPerson: g.deepNoPerson or a.real.contains(IDir) }), i)
        else setF(s1, i, z => { ...z, stage: SLoop })
    // flag: the draft goes to the person; else the loop revises it.
    | LoopReview(i) =>
        val f = fx(s, i)
        val s1 = ghost(bump(staleFixAct(s, i, a), i), g => { ...g,
          unchangedResubmit: g.unchangedResubmit or (a.flag and f.needRevise) })
        setF(s1, i, z =>
          if (a.flag) { ...z, stage: SAtPerson }
          else { ...z, rev: z.rev + 1, loops: z.loops + 1, needRevise: false })
    // The pipeline role rechecks a done task under the changed items (flag: it still holds).
    // A failed recheck sends the task back to the role.
    | RecheckDone(i) =>
        val t = tk(s, i)
        val xs = t.pend.filter(x => not(testRule(s, x)))
        val s1 = ghost(s, g => { ...g, passDefect: g.passDefect or (a.flag and t.rBad) })
        if (a.flag) setT(s1, i, z => { ...z, pend: z.pend.exclude(xs),
          checked: z.checked.keys().mapBy(x =>
            if (xs.contains(x)) s.ver.get(x) else z.checked.get(x)) })
        else setT(s1, i, z => { ...z, st: Sent, tries: 0, maker: -1, pend: Set() })
    // The harness runs the test commands of the changed rules on the done result.
    | RunRule(i) =>
        val t = tk(s, i)
        val xs = t.pend.filter(x => testRule(s, x))
        if (not(t.rBad)) setT(s, i, z => { ...z, pend: z.pend.exclude(xs),
          checked: z.checked.keys().mapBy(x =>
            if (xs.contains(x)) s.ver.get(x) else z.checked.get(x)) })
        else setT(s, i, z => { ...z, st: Sent, tries: 0, maker: -1, pend: Set() })
    | Revive(k) => newEp({ ...s, down: s.down.exclude(Set(k)) }, k)
    // An exit, appended by the pump or a hook. A maker is a subagent inside the role's
    // process: the role's exit is the exit of its makers too. Every exit ends a claim.
    | Exit(k) =>
        val gone = if (k == ROLE) Set(k).union(SLOTS.map(i => liveMaker(s, i)).filter(m => m >= 0))
                   else Set(k)
        gone.fold({ ...s, down: s.down.union(gone) }, (acc, m) =>
          setM(acc, m, y => { ...y, claim: false }))
  }
  // Every taken act: an act of an older epoch of its actor is a split brain.
  def take(s: Store, a: Act): Store =
    effect(ghost(s, g => { ...g, oldEpoch: g.oldEpoch or (a.who >= 0 and a.ep < epOf(s, a.who)) }), a)

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
    if (not(isMaker(s, m)) or mk(s, m).ended or s.down.contains(m)) Set()
    else if (tk(s, mk(s, m).slot).st != Working or tk(s, mk(s, m).slot).maker != m) Set()
    else if (not(mk(s, m).claim) or briefOld(s, m)) Set(ReadBrief(m))
    else Set(Report(m))
  def dos(s: Store, k: int): Set[What] =
    if (s.top.ended) Set()
    else if (k == PERSON)
      val top = if (not(s.top.hosted) and not(s.top.done)) Set(OpenTop) else Set()
      val end = if (s.top.done) Set(EndProject) else Set()
      val drafts = FIXIDS.filter(i => fx(s, i).stage == SAtPerson)
      val decide = SLOTS.filter(i => legal(s, { ...NOACT, what: Decide(i) })).map(i => Decide(i))
      top.union(end).union(drafts.map(i => Accept(i))).union(drafts.map(i => SendBack(i)))
        .union(decide)
    else if (k == HOST)
      if (not(hostFinds(s))) Set() else
      val sends = SLOTS.filter(i => tk(s, i).st == Unsent).map(i => SendTask(i))
      val re = if (FIXIDS.exists(i => fx(s, i).stage == SAccepted)) Set(Reassign) else Set()
      val remake = if (SLOTS.exists(i => fx(s, i).stage == SHostRemake) and remakeable(s))
                     Set(RemakeTop) else Set()
      val done = if (allDone(s) and not(s.top.done)) Set(TopDone) else Set()
      sends.union(re).union(remake).union(done)
    else if (k == ROLE)
      if (not(s.top.hosted)) Set() else
      val assigns = SLOTS.filter(i => tk(s, i).st == Sent).map(i => AssignDo(i))
      val reviews = SLOTS.filter(i => tk(s, i).st == InReview).map(i => Review(i))
      val resumes = SLOTS.map(i => liveMaker(s, i)).filter(m => m >= 0 and s.down.contains(m))
        .map(m => Resume(m))
      assigns.union(reviews).union(resumes)
    else if (k == PIPE) SLOTS.fold(pipeDo(fx(s, EDIT).stage, EDIT), (acc, i) =>
      acc.union(pipeDo(fx(s, i).stage, i))
        .union(if (legal(s, { ...NOACT, what: RecheckDone(i) })) Set(RecheckDone(i)) else Set()))
    else if (k == HARNESS) PERSISTENT.filter(p => s.down.contains(p)).map(p => Revive(p))
      .union(SLOTS.filter(i => legal(s, { ...NOACT, what: RunRule(i) })).map(i => RunRule(i)))
    else makerDos(s, k)
  pure val NOACT: Act = { who: HARNESS, ep: 0, what: OpenTop, seen: -1, seenDir: 0, old: false,
    v: Pass, pts: 1, level: Standard, flag: true, flag2: true, form: Ref, cause: NoCause,
    items: Set(), real: Set(), byz: false, ctx: true, pid: -1 }
  def actorsOf(s: Store): Set[int] =
    Set(PERSON, HARNESS).union(PERSISTENT).union(s.makers.keys())
  def toldOf(s: Store): int -> Set[What] = actorsOf(s).mapBy(k => dos(s, k))

  // ---- obligations: what must happen next, from the protocol's state alone
  type Ob = OpenTopOb | EndOb | TopDoneOb | SendOb(int) | AssignOb(int) | MakeOb(int)
          | ResumeOb(int) | ReviewOb(int) | PipeOb(int) | DraftOb(int) | DecideOb(int)
          | ReassignOb | RemakeOb | ReviveOb(int) | RecheckOb(int) | RuleRunOb(int)
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
      else if (st == SHostRemake) (if (remakeable(s)) Set(RemakeOb) else Set(DecideOb(i)))
      else Set()
    else if (t.st == Done)
      (if (t.pend.exists(x => not(testRule(s, x)))) Set(RecheckOb(i)) else Set())
        .union(if (t.pend.exists(x => testRule(s, x))) Set(RuleRunOb(i)) else Set())
    else Set()
  // The person's edit in the pipeline owes the pipeline role, then the person, then the host.
  def editObs(s: Store): Set[Ob] =
    val st = fx(s, EDIT).stage
    if (pipeStage(st)) Set(PipeOb(EDIT)) else if (st == SAtPerson) Set(DraftOb(EDIT))
    else if (st == SAccepted) Set(ReassignOb) else Set()
  def obligationsOf(s: Store): Set[Ob] =
    if (s.top.ended) Set()
    else if (s.top.done) Set(EndOb).union(editObs(s))
    else if (not(s.top.hosted)) Set(OpenTopOb).union(editObs(s))
    else if (allDone(s)) Set(TopDoneOb).union(editObs(s))
    else
      val revive = PERSISTENT.filter(p => s.down.contains(p)).map(p => ReviveOb(p))
      SLOTS.fold(revive.union(editObs(s)), (acc, i) => acc.union(slotObs(s, i)))
  def discharges(ob: Ob, k: int, x: What): bool = match ob {
    | OpenTopOb => x == OpenTop
    | EndOb => x == EndProject
    | TopDoneOb => x == TopDone
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
    | RemakeOb => x == RemakeTop
    | ReviveOb(p) => x == Revive(p)
    | RecheckOb(i) => x == RecheckDone(i)
    | RuleRunOb(i) => x == RunRule(i)
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
  // Final: the project ended, or what is owed is owed by the person only.
  def finalOf(s: Store): bool =
    s.top.ended or (obligationsOf(s) != Set() and obligationsOf(s).forall(ob => isPersonOb(ob)))
  // Past the model's bounds (not a success: README.md, "Convergence").
  def pastBound(s: Store): bool =
    s.nextMaker > OPT.maxMakers + 2 or s.changes > OPT.maxChanges
}
