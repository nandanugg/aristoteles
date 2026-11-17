// The work model of plan/model/DESIGN.md (locked 2026-11-16): the store and the protocol.
// No variables: which acts the store takes (accept), what each does (effect), what each actor
// is told (dos), what is owed (obligationsOf). workenv.qnt puts the actors, tmux and the other
// parts of the environment around it. README.md: words, options, properties.
module work {
  // Options. The checks; README.md says
  // which DESIGN.md states and which are proposals. tmux options are read by workenv.qnt only.
  // C1 is settled (DESIGN.md 12): the host keeps hosting the remade top. D7 is settled
  // (DESIGN.md 13): no budgets; the loop ends by crossTest and raiseLevel (and strict scope).
  const OPT: {
    crossTest: bool,    // DESIGN.md 13.1: rule assessment runs a new rule's test command on
                        // the examples of the other rules; a contradicting rule does not ship
    raiseLevel: bool,   // DESIGN.md 13.2: a task or an item fixed again goes one level up
                        // (Task.floor; a draft changing an item already fixed at its level
                        // goes to direction assessment, direction to principle); a split
                        // part is not split again
    recheckBasis: bool, // a recheck names the items and versions it judged; the store
                        // refuses it if they moved
    slots: Set[int],    // the tasks of the top (a set, so a cut-down model can use one)
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
    rebind: bool,       // e4e49ff: run continue moves the open host assignment to the new session
    pumpReattach: bool, // tmux: the pump attaches again after another client's attach -d
    hostWatched: bool,  // tmux: the exit of the host's pane (the person's tmux) is reported
    promptArg: bool,    // a revive passes its prompt as an argument to the CLI (never typed
                        // into the input line); false only in a mutant
    idleSeen: bool,     // the CLI's own "stopped at its prompt" hook: an exit, and Inactive
    // The dashboard (DESIGN.md 10; read by workenv.qnt): silentSteps: the ticks for 1 minute;
    // reviewSubagents: Nanda's reading is false (a role reviews itself).
    silentSteps: int, reviewSubagents: bool,
    // DESIGN.md 10.1 (open): after the pipeline role carries the person's direction edit down,
    // does it come back to the person? 0 always; 1 only when the pipeline changed items the
    // person did not write; 2 never.
    editBack: int,
    // DESIGN.md 10.1: the store refuses an accept (or a send-back) of an escalation that does
    // not wait for the person at the append (the page offers it only when its view says so).
    acceptCheck: bool,
    // DESIGN.md 11 (in the design; off only in a mutant): a task the person takes as it is
    // is first rechecked against the changes that landed since its result was checked.
    decideRecheck: bool,
    // Review round 3 (each Nanda decides; the finding stays in README.md):
    briefCheck: bool,        // the store refuses a report made under an old brief
    strictScope: bool,       // a split part owns a strict subset of its parent's sections:
                             // a one-section task cannot be split again (the person decides)
    sections: int,           // the sections a task of the top owns
    listOnAttach: bool,      // tmux: the pump lists the panes when it attaches (else it sees
                             // only the ends that happen while it is attached)
    ladderRoute: bool,       // DESIGN.md 13.2: a draft entered at direction or principle (a
                             // raise up the ladder, a contradiction) goes to the review loop
                             // and the person whatever its content names
    maxTries: int, maxMakers: int, maxLoops: int,
    maxRuleTries: int,
  }

  // ---- actors. Makers get ids from 3 up, one per assignment (a fresh one per task).
  pure val PERSON = -1
  pure val HARNESS = -2  // the engine: the pump and hooks (exits), the watcher (revives)
  pure val HOST = 0
  pure val ROLE = 1      // the persistent role (its card): assigns, reviews, raises
  pure val PIPE = 2      // the pipeline role: evaluations, the direction pipeline, review loops
  pure val PERSISTENT = Set(HOST, ROLE, PIPE)
  // The tasks of the top, sent by the host to the role (OPT.slots: 0, 1).
  pure val SLOTS = OPT.slots
  // The person's direction edit enters the pipeline as its own entry (DESIGN.md 10.1); it has
  // a Fix but no task. FIXIDS: the tasks' raises and the edit.
  pure val EDIT = 2
  // A draft that waits for the person when the top is remade moves to 3 + its task (DESIGN.md
  // 12: the remake keeps it). Fixes from EDIT up have no task ("free" fixes).
  pure val FIXIDS = Set(EDIT).union(SLOTS)
  pure def free(i: int): bool = i >= EDIT

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
  // The item sets a draft may change: a standards draft one standard or rule, or a standard
  // with its rule; a direction draft the direction, alone or with either pair (symmetric).
  pure val ITEMSETS = Set(Set(IStd(0)), Set(IStd(1)), Set(IRule(0)), Set(IRule(1)),
    Set(IStd(0), IRule(0)), Set(IStd(1), IRule(1)), Set(IDir), Set(IDir, IStd(0), IRule(0)),
    Set(IDir, IStd(1), IRule(1)))
  type TS = Unsent | Sent | Working | InReview | Raised | Done
  type Verdict = Pass | Fail | RaiseTries | RaiseNoRule | RaiseMisses
  type Level = Split | Fit | Principle | Direct | Standard
  // The real cause of a task's trouble (hidden from the store and the agents' choices).
  type Cause = NoCause | CauseAt(Level)
  type Stage = SEval | SPrinciple | SDirAssess | SStdAssess | SRuleAssess | STest | SDraft
             | SLoop | SAtPerson | SAccepted | SClosed
  type Form = NoForm | Mech | Ref | Both
  type DKind = DDir | DRole
  type What =
    | EndProject | MoveHost | EditDirection | Reject(int) | Accept(int) | SendBack(int)
    | Decide(int)                                                              // person
    | SendTask(int) | Reassign | TopDone                                       // host
    | AssignDo(int) | Review(int) | Resume(int)                                // role
    | ReadBrief(int) | Report(int)                                             // maker
    | Evaluate(int) | Advance(int) | WriteRule(int) | RunTest(int) | Ship(int)
    | LoopReview(int) | RecheckDone(int)                                      // pipeline
    | Revive(int) | Exit(int) | RunRule(int)                                   // harness
  // An act as it reaches the store.
  // who, ep: the token and its epoch (a sender has only its own). seen, seenDir: the revision
  // of the target and the versions (their sum) of the sender's view. items: the items a draft
  // names as changed; real (ghost): the items its content really changes. old: from an old page build
  // (it names no basis). v, level, flag, flag2, form: content (see README.md, "Act
  // content"). Ghost fields, never read by accept: cause (the truth chosen by the environment),
  // byz (a Byzantine sender), ctx (the sender had its context), pid (its process).
  // vers: the item versions the sender says its content is built on (a draft's base);
  // realVers (ghost): the versions it really is built on.
  type Act = { who: int, ep: int, what: What, seen: int, seenDir: int, old: bool, v: Verdict,
               level: Level, flag: bool, flag2: bool, form: Form, cause: Cause,
               flag3: bool,
               items: Set[Item], real: Set[Item], hits: Set[int], vers: Item -> int,
               realVers: Item -> int, byz: bool, ctx: bool, pid: int }

  // rBad: the latest result is wrong (a slip of the maker or the task's real cause).
  // checked: the item versions the result was made or last checked under. pend: items of a
  // done task still to recheck. sections: the sections of the top it owns (strictScope).
  // floor (DESIGN.md 13.2, per task): the lowest level its next evaluation may take. Split
  // at first; Standard for a split part (it is not split again); one level above the level
  // of the last change of its own raise (a task raised again after its standard change goes
  // to direction, after its direction change to principle).
  // broken (ghost): a change that landed broke this task's work (the environment's truth;
  // only a result made again under the new versions clears it).
  // taken: the person took the result as it is (its defect is accepted; DESIGN.md 11).
  type Task = { gen: int, st: TS, tries: int, maker: int, rid: int, checked: Item -> int,
                pend: Set[Item], rBad: bool, broken: bool, taken: bool, cause: Cause,
                sections: int, floor: Level }
  // brief: the item versions of the brief it read (its snapshot `under`).
  type Maker = { slot: int, ended: bool, claim: bool, brief: Item -> int, revs: int }
  // A raise and what follows it. truth: the test command behaves on its examples. refOk: the
  // reference exists. roleOnly:
  // the role draft changes only the card (content); roleLabel: the pipeline's answer.
  // trueBase (ghost): the item versions the draft's content really is built on. fights
  // (ghost, the environment's truth): the rule it writes contradicts the other rule of the
  // direction (its test breaks that rule's "follows" example).
  // items, real: the items the draft names, and those its content changes. base: the item
  // versions it was built on.
  type Fix = { stage: Stage, entry: Stage, level: Level, kind: DKind, form: Form, truth: bool,
               refOk: bool, ruleTries: int, items: Set[Item], real: Set[Item],
               roleOnly: bool, roleLabel: bool, base: Item -> int, cardBase: int, rev: int,
               sentBack: Set[int], needRevise: bool, loops: int, step: int, wrote: Set[Item],
               trueBase: Item -> int, fights: bool, contradicted: bool }
  // The host holds the top for the whole project (DESIGN.md 12). hostSession: the session its
  // assignment is bound to. done: the host returned the top (all done). step: basis of host acts.
  type Top = { hostSession: int, done: bool, ended: bool }
  // Impossible states the store let in (each must stay false), and markers for witnesses.
  type Ghost = {
    endedActed: bool, otherResult: bool, otherVersion: bool, staleReport: bool,
    unseenReject: bool, unseenAccept: bool, rejectedInEffect: bool, lostUpdate: bool,
    failedTest: bool, noForm: bool, badRef: bool, deepNoPerson: bool, roleMisjudged: bool,
    passBroken: bool, passDefect: bool, shallowEval: bool, staleFix: bool, oldEpoch: bool,
    noContext: bool, unchangedResubmit: bool, takenUndone: bool, wroteDropped: bool,
    unrechecked: bool, unacceptedChange: bool, acceptNotWaiting: bool, claimByEnded: bool,
    endBroken: bool, refix: bool, fightShipped: bool, raisedUp: bool, escalatedNoPerson: bool,
    topNoPerson: bool,
    rebaseFired: bool, recheckFired: bool, reassignEnded: bool,
  }
  type Store = {
    top: Top, session: int, tasks: int -> Task, makers: int -> Maker, fixes: int -> Fix,
    // fixDepth: per item, the depth of the level of its last fix from a task's raise (-1:
    // none; 1 standard, 2 direction, 3 principle). DESIGN.md 13.2 reads it.
    ver: Item -> int, ruleForm: int -> Form, card: int, changes: int, agentChanges: int,
    fixDepth: Item -> int,
    down: Set[int], ep: int -> int, nextMaker: int, g: Ghost,
  }

  pure val ZERO: Item -> int = ITEMS.mapBy(x => 0)
  pure val CLOSED: Fix = { stage: SClosed, entry: SClosed, level: Standard, kind: DDir,
    form: NoForm, truth: true, refOk: true, ruleTries: 0, items: Set(), real: Set(),
    roleOnly: false, roleLabel: false, base: ZERO, cardBase: 0, rev: 0, sentBack: Set(),
    needRevise: false, loops: 0, step: 0, wrote: Set(), trueBase: ZERO, fights: false,
    contradicted: false }
  pure val NOGHOST: Ghost = { endedActed: false, otherResult: false, otherVersion: false,
    staleReport: false, unseenReject: false, unseenAccept: false, rejectedInEffect: false,
    lostUpdate: false, failedTest: false, noForm: false, badRef: false, deepNoPerson: false,
    roleMisjudged: false, passBroken: false, passDefect: false, shallowEval: false,
    staleFix: false, oldEpoch: false, noContext: false, unchangedResubmit: false,
    takenUndone: false, wroteDropped: false, unrechecked: false, unacceptedChange: false, acceptNotWaiting: false, claimByEnded: false, endBroken: false,
    refix: false, fightShipped: false, raisedUp: false, escalatedNoPerson: false, topNoPerson: false,
    rebaseFired: false,
    recheckFired: false, reassignEnded: false }
  def freshTask(gen: int, c: Cause): Task = { gen: gen, st: Unsent, tries: 0, maker: -1,
    rid: -1, checked: ZERO, pend: Set(), rBad: false, broken: false, taken: false, cause: c,
    sections: OPT.sections, floor: Split }
  // The person opened the top task before the model starts; the host holds it in session 0.
  def initStore(causes: int -> Cause): Store = {
    top: { hostSession: 0, done: false, ended: false },
    session: 0, tasks: SLOTS.mapBy(i => freshTask(0, causes.get(i))), makers: Map(),
    fixes: FIXIDS.mapBy(i => CLOSED), ver: ZERO, ruleForm: Set(0, 1).mapBy(j => Ref), card: 0,
    changes: 0, agentChanges: 0,
    fixDepth: ITEMS.mapBy(x => -1), down: Set(), ep: PERSISTENT.mapBy(k => 0), nextMaker: 3,
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
  // A rule rechecked by the harness alone: a test command and no reader (Mech). A rule with
  // both forms needs the role's judgement: the pipeline role rechecks it.
  def testRule(s: Store, x: Item): bool = isRule(x) and s.ruleForm.get(ruleNo(x)) == Mech
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
  // Without acceptCheck an accept is taken for any open escalation.
  def atPerson(s: Store, i: int): bool =
    if (OPT.acceptCheck) fx(s, i).stage == SAtPerson else fx(s, i).stage != SClosed
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
    // The ladder split < standard < direction < principle: a fix at a level removes a cause
    // at that level or below; a role's fit is off the ladder.
    | CauseAt(x) => if (x == Fit or l == Fit) l == x else depth(l) >= depth(x)
  }
  def liveMaker(s: Store, i: int): int =
    val m = tk(s, i).maker
    if (m >= 0 and isMaker(s, m) and not(mk(s, m).ended)) m else -1
  // The host's wait finds the top only through an assignment bound to the run's session.
  def hostFinds(s: Store): bool = s.top.hostSession == s.session

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
    | RecheckDone(i) => tk(s, i).rid
    | _ => -1
  }
  // Acts whose judgement depends on the item versions (with basis, an older view is refused).
  def dirBased(x: What): bool = match x {
    | Review(_) => true | Report(_) => true | Evaluate(_) => true | _ => false }

  // ---- the store's check: the token (no forgery)
  def authority(a: Act): bool = match a.what {
    | EndProject => a.who == PERSON
    | MoveHost => a.who == PERSON
    | EditDirection => a.who == PERSON
    | Reject(_) => a.who == PERSON
    | Accept(_) => a.who == PERSON
    | SendBack(_) => a.who == PERSON
    | Decide(_) => a.who == PERSON
    | SendTask(_) => a.who == HOST
    | Reassign => a.who == HOST
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
    t.st == InReview and match a.v {
      | Pass => not(OPT.passTests and t.rBad and mechCatches(s, i))
      | Fail => t.tries + 1 < OPT.maxTries
      | RaiseTries => t.tries + 1 >= OPT.maxTries
      | RaiseNoRule => true
      | RaiseMisses => true
    }
  def legal(s: Store, a: Act): bool = match a.what {
    | EndProject => s.top.done and allDone(s)
    | MoveHost => true
    | EditDirection => fx(s, EDIT).stage == SClosed and a.items.contains(IDir)
    | Reject(i) => tk(s, i).rid >= 0 and (tk(s, i).st == InReview or tk(s, i).st == Done)
    | Accept(i) => atPerson(s, i)
    | SendBack(i) => atPerson(s, i)
    | Decide(i) => not(free(i)) and fx(s, i).stage == SAtPerson
    | SendTask(i) => tk(s, i).st == Unsent
    | Reassign => FIXIDS.exists(i => fx(s, i).stage == SAccepted)
    | TopDone => allDone(s) and not(s.top.done)
    | AssignDo(i) => tk(s, i).st == Sent
    | Review(i) => reviewOk(s, i, a)
    | Resume(m) => isMaker(s, m) and not(mk(s, m).ended) and s.down.contains(m)
    | ReadBrief(m) => makerAt(s, m)
    | Report(m) => makerAt(s, m) and (mk(s, m).claim or not(OPT.endedCheck))
        and not(OPT.briefCheck and briefOld(s, m))
    // Not below the task's floor (raiseLevel); a one-section task cannot be split. A role
    // draft (Fit) is off the ladder.
    | Evaluate(i) => fx(s, i).stage == SEval
        and not(OPT.raiseLevel and a.level != Fit and depth(a.level) < depth(tk(s, i).floor))
        and not(OPT.strictScope and a.level == Split and tk(s, i).sections <= 1)
    | Advance(i) => Set(SPrinciple, SDirAssess, SStdAssess).contains(fx(s, i).stage)
    // Past maxRuleTries a rule must take the reference form (a model bound; README.md).
    | WriteRule(i) => fx(s, i).stage == SRuleAssess
        and (not(OPT.formCheck) or a.form != NoForm)
        and (not(OPT.refCheck) or not(hasRef(a.form)) or a.flag2)
        // Past maxRuleTries: a reference rule (a model bound; README.md).
        and (fx(s, i).ruleTries < OPT.maxRuleTries or a.form == Ref)
    | RunTest(i) => fx(s, i).stage == STest
    | Ship(i) => fx(s, i).stage == SDraft
    | LoopReview(i) => fx(s, i).stage == SLoop
        and (a.flag or fx(s, i).loops < OPT.maxLoops)
        and not(OPT.reviseCheck and a.flag and fx(s, i).needRevise)
    | RecheckDone(i) => recheckDue(s, i) and not(OPT.recheckBasis and not(recheckCurrent(s, i, a)))
    | RunRule(i) => tk(s, i).st == Done and tk(s, i).pend.exists(x => testRule(s, x))
    | Revive(k) => PERSISTENT.contains(k) and s.down.contains(k)
    | Exit(k) => not(s.down.contains(k))
  }
  // The recheck names the items it judged (items) at the versions it saw (vers): they must
  // be what is pending now, at the current versions.
  def recheckDue(s: Store, i: int): bool =
    tk(s, i).st == Done and tk(s, i).pend.exists(x => not(testRule(s, x)))
  def recheckCurrent(s: Store, i: int, a: Act): bool =
    val xs = tk(s, i).pend.filter(x => not(testRule(s, x)))
    a.items == xs and xs.forall(x => a.vers.get(x) == s.ver.get(x))
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
  // A raise: the maker ends; the evaluation opens.
  def raise(s: Store, i: int, tries: int): Store =
    val s1 = setT(endMaker(s, tk(s, i).maker), i, t => { ...t, st: Raised, tries: tries,
                                                          maker: -1, pend: Set() })
    setF(s1, i, f => { ...CLOSED, stage: SEval,
                       step: f.step + 1, base: s.ver, cardBase: s.card })
  // The work goes back to the role as a task (a fresh maker, no tries used).
  def backToRole(s: Store, i: int): Store =
    if (free(i)) setF(s, i, f => { ...CLOSED, step: f.step + 1 }) else
    setF(setT(s, i, t => { ...t, st: Sent, tries: 0, maker: -1, pend: Set() }),
         i, f => { ...CLOSED, step: f.step + 1 })
  def counted(s: Store, agent: bool): Store =
    { ...s, changes: s.changes + 1, agentChanges: s.agentChanges + if (agent) 1 else 0 }
  def resolveCause(s: Store, i: int): Store =
    if (free(i)) s else
    val l = fx(s, i).level
    setT(s, i, t => { ...t, cause: if (resolves(l, t.cause)) NoCause else t.cause })
  // DESIGN.md 13.2, per item: a draft from a task's raise that changes an item already fixed
  // at its level or higher (the same standard or rule raised again) goes one level up:
  // standard -> direction assessment, direction -> principle. Principle reaches the person.
  def fixAt(f: Fix): int = if (f.entry == SStdAssess or f.entry == SRuleAssess) 1
    else if (f.entry == SDirAssess) 2 else 3
  def refixed(s: Store, i: int): bool =
    not(free(i)) and fx(s, i).kind == DDir and fixAt(fx(s, i)) < 3
      and changedBy(fx(s, i)).exists(x => s.fixDepth.get(x) >= fixAt(fx(s, i)))
  def raiseUp(s: Store, i: int): Store =
    val st = if (fixAt(fx(s, i)) == 1) SDirAssess else SPrinciple
    ghost(setF(s, i, z => { ...z, stage: st, entry: st,
                            level: if (st == SDirAssess) Direct else Principle, step: z.step + 1 }),
          g => { ...g, raisedUp: true })
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
  // Compare and set (with rebase): a draft whose changed items moved since its base is not
  // put in effect; it goes back to its entry to be redone on the new versions.
  def conflict(s: Store, i: int): bool =
    val f = fx(s, i)
    if (f.kind == DRole) f.cardBase < s.card
    else changedBy(f).exists(x => f.base.get(x) < s.ver.get(x))
  def redo(s: Store, i: int): Store =
    ghost(setF(s, i, y => { ...y, stage: y.entry, base: s.ver, trueBase: s.ver, cardBase: s.card,
                            rev: y.rev + 1, step: y.step + 1 }), g => { ...g, rebaseFired: true })
  def casBlocks(s: Store, i: int): bool = OPT.rebase and conflict(s, i)
  // hits (ghost, the environment's choice): the tasks whose work this change breaks; only a
  // task an item of the change applies to can be hit.
  def itemsInEffect(s: Store, i: int, agent: bool, hits: Set[int]): Store =
    val f = fx(s, i)
    val c = changedBy(f)
    val rules = c.filter(x => isRule(x))
    // Items the content changes but the store did not version: their tasks are not rechecked.
    val missed = f.real.exclude(c)
    // A fix again at the same or a lower level: of an item (refixed), or of the task (below
    // its floor).
    val again = refixed(s, i) or (not(free(i)) and fixAt(f) < depth(tk(s, i).floor))
    val s0 = ghost(s, g => { ...g, refix: g.refix or again,
      topNoPerson: g.topNoPerson or (agent and not(free(i)) and tk(s, i).floor == Principle),
      failedTest: g.failedTest or (rules != Set() and hasMech(f.form) and not(f.truth)),
      noForm: g.noForm or (rules != Set() and f.form == NoForm),
      badRef: g.badRef or (rules != Set() and hasRef(f.form) and not(f.refOk)),
      lostUpdate: g.lostUpdate or f.real.exists(x => f.trueBase.get(x) < s.ver.get(x)),
      unrechecked: g.unrechecked or SLOTS.exists(j => j != i and tk(s, j).st != Raised
        and tk(s, j).st != Unsent and missed.exists(x => applies(x, j))) })
    val s1 = resolveCause(counted({ ...s0,
      fixDepth: if (free(i)) s.fixDepth else
        s.fixDepth.keys().mapBy(x => if (c.contains(x)) fixAt(f) else s.fixDepth.get(x)),
      tasks: if (free(i)) s.tasks else s.tasks.setBy(i, z => { ...z,
        floor: if (fixAt(f) >= 2) Principle else if (z.floor == Principle) Principle else Direct }),
      ver: s.ver.keys().mapBy(x => s.ver.get(x) + if (c.contains(x)) 1 else 0),
      ruleForm: s.ruleForm.keys().mapBy(j =>
        if (rules.contains(IRule(j))) f.form else s.ruleForm.get(j)) }, agent), i)
    // A rule that contradicts the other rule of the direction breaks the tasks that rule
    // applies to: their trouble is that rule again (a standard cause).
    val fightsBack = f.fights and rules != Set()
    val s1a = if (not(fightsBack)) s1 else ghost(
      SLOTS.fold(s1, (acc, j) =>
        if (j != i and not(rules.contains(IRule(j)))
            and Set(Working, InReview, Done, Raised).contains(tk(acc, j).st))
          // A done task is rechecked against its own rule (the one the change contradicts).
          setT(acc, j, z => { ...z, broken: true, rBad: z.rBad or z.st != Working,
                              cause: CauseAt(Standard),
                              pend: if (z.st == Done or z.st == Raised) z.pend.union(Set(IRule(j)))
                                    else z.pend })
        else acc), g => { ...g, fightShipped: true })
    val s1b = SLOTS.fold(s1a, (acc, j) =>
      if (j != i and hits.contains(j) and f.real.exists(x => applies(x, j))
          and Set(Working, InReview, Done, Raised).contains(tk(acc, j).st))
        setT(acc, j, z => { ...z, broken: true,
                            rBad: z.rBad or z.st != Working })
      else acc)
    val s2 = SLOTS.fold(s1b, (acc, j) =>
      val hit = c.filter(x => applies(x, j))
      if (j != i and tk(acc, j).st == Done and hit != Set())
        ghost(setT(acc, j, t => { ...t, pend: t.pend.union(hit) }),
              g => { ...g, recheckFired: true })
      else acc)
    if (not(OPT.rebase)) s2 else
      FIXIDS.fold(s2, (acc, j) =>
        val z = fx(acc, j)
        val early = Set(SPrinciple, SDirAssess, SStdAssess, SRuleAssess, STest, SDraft)
          .contains(z.stage) and c.contains(IDir)
        val late = (z.stage == SLoop or z.stage == SAtPerson) and z.kind == DDir
          and changedBy(z).exists(x => c.contains(x))
        if (j != i and (early or late))
          ghost(setF(acc, j, y => { ...y, stage: y.entry, base: acc.ver, trueBase: acc.ver,
                                    rev: y.rev + 1, step: y.step + 1 }),
                g => { ...g, rebaseFired: true })
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
  // Ship's yes branch: a standard change, in effect at once.
  def shipStandard(s: Store, i: int, hits: Set[int]): Store =
    if (casBlocks(s, i)) redo(s, i)
    else if (OPT.raiseLevel and refixed(s, i)) raiseUp(s, i)
    else backToRole(itemsInEffect(s, i, true, hits), i)

  // The person's edit after the pipeline role carried it down. editBack 0: back to the
  // person always; 1: only when the change has items the person did not write (as the store
  // sees them: named, or with classify the content); 2: never. A change in effect with items
  // the person did not write and did not accept is the history flag unacceptedChange.
  def shipEdit(s: Store, a: Act): Store =
    val f = fx(s, EDIT)
    val seen = if (OPT.classify) a.real else a.items
    // A change that leaves out what the person wrote (as the store sees it) goes back to the
    // person too.
    val back = OPT.editBack == 0 or (OPT.editBack == 1 and seen.exclude(f.wrote) != Set())
      or not(f.wrote.forall(x => seen.contains(x))) or f.contradicted
    if (back) setF(s, EDIT, z => { ...z, stage: SLoop })
    else if (casBlocks(s, EDIT)) redo(s, EDIT)
    // In effect at once; then, as after the person's accept, the host reassigns roles.
    else setF(itemsInEffect(ghost(s, g => { ...g,
                              unacceptedChange: g.unacceptedChange
                                or a.real.exclude(f.wrote) != Set(),
                              wroteDropped: g.wroteDropped
                                or not(f.wrote.forall(x => a.real.contains(x))) }),
                            EDIT, false, a.hits), EDIT, z => { ...z, stage: SAccepted })
  def effect(s: Store, a: Act): Store = match a.what {
    | EndProject =>
        val broken = SLOTS.exists(i => tk(s, i).st == Done and tk(s, i).broken)
        ghost({ ...s, top: { ...s.top, ended: true } },
              g => { ...g, endBroken: g.endBroken or broken })
    // Run continue: the run's host moves to a new session (a new host process).
    | MoveHost =>
        val s1 = newEp({ ...s, session: s.session + 1 }, HOST)
        if (OPT.rebind) { ...s1, top: { ...s.top, hostSession: s.session + 1 } } else s1
    // The person's edit (items: what the person wrote) enters at direction assessment, built
    // on the item versions the page showed (vers; an old build names none: the store's).
    | EditDirection => setF(s, EDIT, f => { ...CLOSED, stage: SDirAssess, entry: SDirAssess,
        level: Direct, kind: DDir, base: if (a.old) s.ver else a.vers, trueBase: a.realVers,
        wrote: a.items, step: f.step + 1 })
    | Reject(i) =>
        val t = tk(s, i)
        val s1 = ghost(s, g => { ...g, unseenReject: g.unseenReject or a.seen != t.rid })
        val s2 = if (t.st == Done) { ...s1, top: { ...s1.top, done: false } } else s1
        raise(s2, i, t.tries)
    | Accept(i) =>
        val f = fx(s, i)
        val s1 = ghost(s, g => { ...g,
          acceptNotWaiting: g.acceptNotWaiting or f.stage != SAtPerson,
          unseenAccept: g.unseenAccept or a.seen != f.step,
          rejectedInEffect: g.rejectedInEffect or (f.sentBack.contains(f.rev) and a.seen < f.step) })
        // A contradicted draft: whether its direction change resolves the contradiction is
        // the environment's truth (flag3); if not, the rule still fights (DESIGN.md 13.1).
        val s1r = if (f.contradicted and a.flag3) setF(s1, i, z => { ...z, fights: false })
                  else s1
        val s2 = bump(if (f.kind == DDir) itemsInEffect(s1r, i, false, a.hits)
                      else cardInEffect(s1, i), i)
        // "only a role change?" yes: back to the card, the work goes on. no: host reassigns.
        val roleOnly = f.kind == DRole and (if (OPT.classify) f.roleOnly else f.roleLabel)
        val s3 = ghost(s2, g => { ...g, roleMisjudged: g.roleMisjudged
          or (roleOnly and not(f.roleOnly)) })
        if (casBlocks(s1, i)) redo(s1, i)
        else if (OPT.raiseLevel and refixed(s1, i)) raiseUp(s1, i)
        else if (roleOnly) backToRole(s3, i) else setF(s3, i, z => { ...z, stage: SAccepted })
    | SendBack(i) => setF(s, i, f => { ...f, stage: SLoop, sentBack: f.sentBack.union(Set(f.rev)),
                                       needRevise: true, loops: 0, step: f.step + 1 })
    // The person takes the result as it is (instead of the draft at the person), or sends the
    // raise back to evaluation.
    // With decideRecheck the result is first rechecked against the changes since it was
    // checked (they land on raised tasks without a recheck).
    | Decide(i) =>
        if (a.flag) setF(setT(s, i, t => { ...t, st: Done, taken: true,
                       pend: if (OPT.decideRecheck) oldFor(s, i).union(t.pend) else Set() }), i,
                     f => { ...CLOSED, step: f.step + 1 })
        else setF(s, i, f => { ...CLOSED, stage: SEval, step: f.step + 1 })
    | SendTask(i) => setT(s, i, t => { ...t, st: Sent })
    // The roles are reassigned: the accepted raises go back, the role's open work is sent
    // again to the new role (its makers end). Not a change of the items.
    | Reassign =>
        FIXIDS.fold(s, (acc, j) =>
          if (fx(acc, j).stage == SAccepted) backToRole(acc, j)
          else if (free(j)) acc
          else if (tk(acc, j).st == Working or tk(acc, j).st == InReview)
            ghost(setT(endMaker(acc, tk(acc, j).maker), j, t => { ...t, st: Sent, tries: 0, maker: -1 }),
                  g => { ...g, reassignEnded: true })
          else acc)
    // The host returns the done top to the person; it keeps hosting (DESIGN.md 12).
    | TopDone => { ...s, top: { ...s.top, done: true } }
    | AssignDo(i) =>
        val m = s.nextMaker
        val s1 = { ...s, nextMaker: m + 1, ep: s.ep.put(m, 0), makers: s.makers.put(m,
          { slot: i, ended: false, claim: false, brief: ZERO, revs: 0 }) }
        setT(s1, i, t => { ...t, st: Working, tries: 0, maker: m })
    | Review(i) =>
        val t = tk(s, i)
        val s1 = ghost(s, g => { ...g, otherResult: g.otherResult or (not(a.byz) and a.seen != t.rid) })
        match a.v {
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
                setT(s1, i, z => { ...z, st: Sent, tries: z.tries + 1 })
              else setM(setT(s1, i, z => { ...z, st: Working, tries: z.tries + 1 }),
                        t.maker, y => { ...y, revs: y.revs + 1 })
          | RaiseTries => raise(s1, i, t.tries + 1)
          | RaiseNoRule => raise(s1, i, t.tries)
          | RaiseMisses => raise(s1, i, t.tries)
        }
    | Resume(m) => newEp({ ...s, down: s.down.exclude(Set(m)) }, m)
    // A read by a maker the store ended (endedCheck off): a claim on an ended maker.
    | ReadBrief(m) => ghost(setM(s, m, y => { ...y, claim: true, brief: s.ver }),
                            g => { ...g, claimByEnded: g.claimByEnded or mk(s, m).ended })
    | Report(m) =>
        val y = mk(s, m)
        val t = tk(s, y.slot)
        val s1 = ghost(s, g => { ...g,
          staleReport: g.staleReport or (not(a.byz) and not(a.old) and a.seen != y.revs),
          endedActed: g.endedActed or y.ended or t.maker != m,
          noContext: g.noContext or (not(a.byz) and y.revs > 0 and not(a.ctx)
                                     and not(OPT.fullBrief)) })
        // A result made under an old brief keeps the work a change broke.
        val old = briefOld(s, m)
        setT(s1, y.slot, z => { ...z, st: InReview, rid: z.rid + 1, checked: y.brief,
                                broken: z.broken and old, taken: false,
                                rBad: a.flag or z.cause != NoCause or (z.broken and old) })
    | Evaluate(i) =>
        val t = tk(s, i)
        val s1 = ghost(bump(staleFixAct(s, i, a), i), g => { ...g,
          shallowEval: g.shallowEval or not(resolves(a.level, t.cause)) })
        val s2 = setF(s1, i, f => { ...f, level: a.level })
        match a.level {
          // With strictScope the part owns one section less (a one-section task cannot be
          // split: the store refuses it). Agents never remake the top (DESIGN.md 13.1): a too
          // big task, the top included, is split like this.
          | Split =>
                // A split of a split part (raiseLevel off) is the same fix again.
                val s3 = ghost(counted(s2, true), g => { ...g, refix: g.refix or t.floor == Standard })
                setF(setT(s3, i, z => { ...freshTask(z.gen + 1, a.cause), st: Sent,
                                        floor: Standard,
                                        sections: if (OPT.strictScope) z.sections - 1
                                                  else z.sections }), i,
                     f => { ...CLOSED, step: f.step })
          | Fit => setF(s2, i, f => { ...f, kind: DRole, stage: SLoop, entry: SLoop,
                                      roleLabel: a.flag, roleOnly: a.flag2, cardBase: s.card })
          | _ => setF(s2, i, f => { ...f, kind: DDir, stage: entryOf(a.level),
                                    entry: entryOf(a.level), base: a.vers, trueBase: a.realVers })
        }
    | Advance(i) => setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, stage: nextStage(f.stage) })
    // flag: the test command really behaves on the examples; flag2: the reference exists.
    | WriteRule(i) =>
        setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, form: a.form, truth: a.flag,
          refOk: a.flag2, fights: a.flag3, contradicted: f.contradicted and a.flag3,
          stage: if (hasMech(a.form)) STest else SDraft })
    // flag: the pipeline role's claim that the test passed; flag2: its claim that a test
    // failed on another rule's example (a contradiction). The test command runs on the rule's
    // own examples and (crossTest) on the other rules' examples; a reference-only rule has no
    // test command and cannot be cross-tested. A contradiction is a direction-level cause: the
    // draft goes at once to direction assessment (DESIGN.md 13.1; no count).
    | RunTest(i) =>
        val f = fx(s, i)
        // own: the rule passes its own examples; contra: it fails another rule's example.
        val contra = if (OPT.harnessTest) OPT.crossTest and f.fights else a.flag2
        val own = if (OPT.harnessTest) f.truth else a.flag
        val s1 = bump(staleFixAct(s, i, a), i)
        // A rule that fails its own examples is written again (DESIGN.md 4). A contradiction
        // goes to direction assessment; a draft already at direction goes on, marked, and
        // its Ship goes to the person (13.1).
        if (not(own)) setF(s1, i, z => { ...z, stage: SRuleAssess, ruleTries: z.ruleTries + 1 })
        else if (contra and f.entry != SDirAssess and f.entry != SPrinciple)
          setF(s1, i, z => { ...z, kind: DDir, level: Direct, stage: SDirAssess, entry: SDirAssess,
                             contradicted: true })
        else if (contra) setF(s1, i, z => { ...z, stage: SDraft, contradicted: true })
        else setF(s1, i, z => { ...z, stage: SDraft })
    // items: the items the draft names; real: those its content changes. "Only a standard
    // change?" is read from the named items (with classify: from the content).
    | Ship(i) =>
        val s1 = setF(bump(staleFixAct(s, i, a), i), i, f => { ...f, items: a.items, real: a.real })
        val f = fx(s, i)
        val escalated = f.entry == SDirAssess or f.entry == SPrinciple
        val isStd = not((if (OPT.classify) a.real else a.items).contains(IDir))
          and not(OPT.ladderRoute and escalated)
        if (i == EDIT) shipEdit(s1, a)
        else if (isStd)
          shipStandard(ghost(s1, g => { ...g,
            deepNoPerson: g.deepNoPerson or a.real.contains(IDir),
            escalatedNoPerson: g.escalatedNoPerson or escalated }), i, a.hits)
        // Raised up the ladder before the person sees it (R5-10), else to the loop.
        else if (OPT.raiseLevel and refixed(s1, i)) raiseUp(s1, i)
        else setF(s1, i, z => { ...z, stage: SLoop })
    // flag: the draft goes to the person; else the loop revises it.
    | LoopReview(i) =>
        val f = fx(s, i)
        val s1 = ghost(bump(staleFixAct(s, i, a), i), g => { ...g,
          unchangedResubmit: g.unchangedResubmit or (a.flag and f.needRevise) })
        setF(s1, i, z =>
          if (a.flag) { ...z, stage: SAtPerson }
          else { ...z, rev: z.rev + 1, loops: z.loops + 1, needRevise: false })
    // The pipeline role rechecks a done task against the changed items (flag: it still
    // holds). The recheck judges what the change broke (`broken`), not a defect the person
    // took as it is (DESIGN.md 11). A failed recheck sends the task back to the role and
    // reopens the top.
    | RecheckDone(i) =>
        val t = tk(s, i)
        val xs = if (OPT.recheckBasis) a.items else t.pend.filter(x => not(testRule(s, x)))
        val s1 = ghost(s, g => { ...g, passDefect: g.passDefect or (a.flag and t.broken),
          takenUndone: g.takenUndone or (not(a.flag) and t.taken and not(t.broken)) })
        if (a.flag) setT(s1, i, z => { ...z, pend: z.pend.exclude(xs),
          checked: z.checked.keys().mapBy(x =>
            if (xs.contains(x)) s.ver.get(x) else z.checked.get(x)) })
        else { ...setT(s1, i, z => { ...z, st: Sent, tries: 0, maker: -1, pend: Set() }),
               top: { ...s.top, done: false } }
    // The harness runs the test commands of the changed rules on the done result: they catch
    // what the change broke.
    | RunRule(i) =>
        val t = tk(s, i)
        val xs = t.pend.filter(x => testRule(s, x))
        if (not(t.broken)) setT(s, i, z => { ...z, pend: z.pend.exclude(xs),
          checked: z.checked.keys().mapBy(x =>
            if (xs.contains(x)) s.ver.get(x) else z.checked.get(x)) })
        else { ...setT(s, i, z => { ...z, st: Sent, tries: 0, maker: -1, pend: Set() }),
               top: { ...s.top, done: false } }
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

  // An honest agent's content, on its own view (workenv.qnt and core.qnt; misjudge: the
  // pipeline role may evaluate shallower than the real cause, a mistake): it reviews correctly (it runs the test
  // commands; on a rule with both forms it judges the candidates), evaluates at the real
  // cause, reports its test runs as they printed, labels a draft by its content, revises a
  // draft the person sent back, writes real references. Its maker's slips, the test
  // command's real behaviour and the real causes of new tasks are the environment's choice.
  def honestOf(v: Store, a: Act, misjudge: bool): bool = match a.what {
    | Review(i) =>
        val t = tk(v, i)
        val left = t.tries + 1 < OPT.maxTries
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
              or (misjudge and depth(a.level) < depth(c) and a.level != Fit) }
        // With raiseLevel the task's floor wins: a level below it is refused, and the floor
        // itself is taken when the cause is below it.
        val floored = OPT.raiseLevel and a.level != Fit
        val atFloor = floored and a.level == t.floor and match t.cause {
          | CauseAt(c) => c != Fit and depth(c) < depth(t.floor) | NoCause => true }
        or { atCause, atFloor }
          and not(floored and depth(a.level) < depth(t.floor))
          and (a.level != Fit or a.flag == a.flag2)
    | WriteRule(_) => a.form != NoForm and a.flag2
    | RunTest(i) => a.flag == fx(v, i).truth and a.flag2 == (OPT.crossTest and fx(v, i).fights)
    | Ship(i) => a.real.contains(IDir) == (fx(v, i).entry != SStdAssess) and a.items == a.real
        and fx(v, i).wrote.forall(x => a.real.contains(x))
    | RecheckDone(i) => a.flag == not(tk(v, i).broken)
    | LoopReview(i) => not(a.flag and fx(v, i).needRevise)
    | _ => true
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
    if (not(isMaker(s, m)) or mk(s, m).ended or s.down.contains(m)) Set()
    else if (tk(s, mk(s, m).slot).st != Working or tk(s, mk(s, m).slot).maker != m) Set()
    else if (not(mk(s, m).claim) or briefOld(s, m)) Set(ReadBrief(m))
    else Set(Report(m))
  def dos(s: Store, k: int): Set[What] =
    if (s.top.ended) Set()
    else if (k == PERSON)
      val end = if (s.top.done and allDone(s)) Set(EndProject) else Set()
      val drafts = FIXIDS.filter(i => fx(s, i).stage == SAtPerson)
      val decide = SLOTS.filter(i => legal(s, { ...NOACT, what: Decide(i) })).map(i => Decide(i))
      end.union(drafts.map(i => Accept(i))).union(drafts.map(i => SendBack(i)))
        .union(decide)
    else if (k == HOST)
      if (not(hostFinds(s))) Set() else
      val sends = SLOTS.filter(i => tk(s, i).st == Unsent).map(i => SendTask(i))
      val re = if (FIXIDS.exists(i => fx(s, i).stage == SAccepted)) Set(Reassign) else Set()
      val done = if (allDone(s) and not(s.top.done)) Set(TopDone) else Set()
      sends.union(re).union(done)
    else if (k == ROLE)
      val assigns = SLOTS.filter(i => tk(s, i).st == Sent).map(i => AssignDo(i))
      val reviews = SLOTS.filter(i => tk(s, i).st == InReview).map(i => Review(i))
      val resumes = SLOTS.map(i => liveMaker(s, i)).filter(m => m >= 0 and s.down.contains(m))
        .map(m => Resume(m))
      assigns.union(reviews).union(resumes)
    else if (k == PIPE) SLOTS.fold(FIXIDS.filter(i => free(i)).fold(Set(), (acc, i) =>
        acc.union(pipeDo(fx(s, i).stage, i))), (acc, i) =>
      acc.union(pipeDo(fx(s, i).stage, i))
        .union(if (recheckDue(s, i)) Set(RecheckDone(i)) else Set()))
    else if (k == HARNESS) PERSISTENT.filter(p => s.down.contains(p)).map(p => Revive(p))
      .union(SLOTS.filter(i => legal(s, { ...NOACT, what: RunRule(i) })).map(i => RunRule(i)))
    else makerDos(s, k)
  pure val NOACT: Act = { who: HARNESS, ep: 0, what: EndProject, seen: -1, seenDir: 0,
    old: false, v: Pass, level: Standard, flag: true, flag2: true, flag3: false, form: Ref,
    cause: NoCause, items: Set(), real: Set(), hits: Set(), vers: ZERO, realVers: ZERO,
    byz: false, ctx: true, pid: -1 }
  def actorsOf(s: Store): Set[int] =
    Set(PERSON, HARNESS).union(PERSISTENT).union(s.makers.keys())
  def toldOf(s: Store): int -> Set[What] = actorsOf(s).mapBy(k => dos(s, k))

  // ---- obligations: what must happen next, from the protocol's state alone
  type Ob = EndOb | TopDoneOb | SendOb(int) | AssignOb(int) | MakeOb(int)
          | ResumeOb(int) | ReviewOb(int) | PipeOb(int) | DraftOb(int) | DecideOb(int)
          | ReassignOb | ReviveOb(int) | RecheckOb(int) | RuleRunOb(int)
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
      else if (st == SAccepted) Set(ReassignOb)
      else Set()
    else if (t.st == Done)
      (if (t.pend.exists(x => not(testRule(s, x)))) Set(RecheckOb(i)) else Set())
        .union(if (t.pend.exists(x => testRule(s, x))) Set(RuleRunOb(i)) else Set())
    else Set()
  // A fix with no raised task (the person's edit, or a draft of a remade task) owes the
  // pipeline role, then the person, then the host.
  def freeFixObs(s: Store, i: int): Set[Ob] =
    val st = fx(s, i).stage
    if (pipeStage(st)) Set(PipeOb(i)) else if (st == SAtPerson) Set(DraftOb(i))
    else if (st == SAccepted) Set(ReassignOb) else Set()
  // Every branch owes rechecks, the pipeline and revives (the host and roles live as long as
  // the project).
  def obligationsOf(s: Store): Set[Ob] =
    if (s.top.ended) Set() else
    val revive = PERSISTENT.filter(p => s.down.contains(p)).map(p => ReviveOb(p))
    val frees = FIXIDS.filter(i => free(i))
      .fold(Set(), (acc, i) => acc.union(freeFixObs(s, i)))
    val top = if (allDone(s)) Set(if (s.top.done) EndOb else TopDoneOb) else Set()
    SLOTS.fold(revive.union(frees).union(top), (acc, i) => acc.union(slotObs(s, i)))
  def discharges(ob: Ob, k: int, x: What): bool = match ob {
    | EndOb => x == EndProject
    | TopDoneOb => x == TopDone
    | SendOb(i) => x == SendTask(i)
    | AssignOb(i) => x == AssignDo(i)
    | MakeOb(m) => k == m and (x == ReadBrief(m) or x == Report(m))
    | ResumeOb(m) => x == Resume(m)
    | ReviewOb(i) => x == Review(i)
    | PipeOb(i) => k == PIPE and Set(Evaluate(i), Advance(i), WriteRule(i), RunTest(i), Ship(i),
        LoopReview(i)).contains(x)
    | DraftOb(i) => x == Accept(i) or x == SendBack(i) or x == Decide(i)
    | DecideOb(i) => x == Decide(i)
    | ReassignOb => x == Reassign
    | ReviveOb(p) => x == Revive(p)
    | RecheckOb(i) => x == RecheckDone(i)
    | RuleRunOb(i) => x == RunRule(i)
  }
  def isPersonOb(ob: Ob): bool = match ob {
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
  // The model's bound on agent changes, from the config (README.md "Convergence"): per task,
  // sections - 1 splits (strict scope) and then one standard change (its floor goes to
  // direction, which reaches the person; a split is below it). Past it is not a success.
  def changeBound: int = SLOTS.size() * OPT.sections
  def pastBound(s: Store): bool = s.agentChanges > changeBound
}
