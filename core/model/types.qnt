// The words of the model: the actors, the acts, and the records the store keeps.
// No logic here (protocol.qnt has it). Read this file first; README.md has the glossary.
module types {
  // ---- options: each check of the protocol, on or off (a mutant turns one off)
  type Options = {
    crossTest: bool,     // a new rule's test command also runs on the other rules' examples
    raiseLevel: bool,    // a task or an item fixed again goes one level up the ladder
    recheckBasis: bool,  // a recheck names the items and versions it judged; refused if moved
    slots: Set[int],     // the tasks of the top
    basis: bool,         // an act names its basis (revision, versions); an old one is refused
    build: bool,         // an act from an old build of the page is refused
    rebase: bool,        // a change in effect sends the other open drafts back to be redone
    harnessTest: bool,   // the harness, not the pipeline role, runs a test command
    classify: bool,      // the store, not the pipeline role, says what a draft really changes
    passTests: bool,     // a pass is refused while a test-command rule catches the result
    fullBrief: bool,     // a revision carries every earlier point (no context needed)
    endedCheck: bool,    // an act of a maker that is not the task's live maker is refused
    formCheck: bool,     // a rule with neither evidence form is refused
    refCheck: bool,      // the harness verifies a reference
    epochs: bool,        // a revive or resume makes a new epoch; old epochs are refused
    reviseCheck: bool,   // a draft the person sent back reaches the person only revised
    rebind: bool,        // run continue moves the open host assignment to the new session
    pumpReattach: bool,  // tmux: the pump attaches again after another client's attach -d
    hostWatched: bool,   // tmux: the exit of the host's pane is reported
    promptArg: bool,     // a revive passes its prompt as an argument, never typed
    idleSeen: bool,      // the CLI's "stopped at its prompt" hook: an exit, and Inactive
    silentSteps: int,    // dashboard: the ticks for one minute
    reviewSubagents: bool,  // dashboard: a role reviews itself when false
    editBack: int,       // after the person's direction edit goes down: 0 the person sees it
                         // always; 1 only when items the person did not write changed; 2 never
    acceptCheck: bool,   // an accept of an escalation not waiting for the person is refused
    decideRecheck: bool, // a task the person takes as it is is first rechecked
    briefCheck: bool,    // a report made under an old brief is refused
    strictScope: bool,   // a split part owns fewer sections: a one-section task is not split
    sections: int,       // the sections a task of the top owns
    listOnAttach: bool,  // tmux: the pump lists the panes when it attaches
    ladderRoute: bool,   // a draft entered at direction or principle goes to the loop and the
                         // person whatever its content names
    ruleLadder: bool,    // a rule failing its own examples again goes one level up
    loopLadder: bool,    // a draft the review loop sends back again goes one level up
    maxTries: int,
    makerAsks: bool,     // a mutant: a maker may ask its role to execute (a wait cycle)
  }

  // ---- actors
  // Makers get an id each, a fresh one per assignment (canon.qnt renames them by slot).
  // NewMaker and NoOne are placeholders, not actors: NewMaker stands for the maker the store
  // is about to make (the `to` of the role's Execute that makes one, before it has an id),
  // NoOne for "no maker held" (a task's maker field).
  type Actor = Human | Host | Role | Pipe | Harness | Maker(int) | NewMaker | NoOne
  pure def isMakerActor(actor: Actor): bool = match actor { | Maker(_) => true | _ => false }
  // The processes, which have an epoch (the person and the engine have none).
  pure def hasEpoch(actor: Actor): bool = match actor {
    | Host => true | Role => true | Pipe => true | Maker(_) => true | _ => false }
  pure val PERSISTENT = Set(Host, Role, Pipe)

  // ---- the work: tasks, fixes, items
  // An item is a direction, a standard or a rule, each with its own version.
  type Item = ItemDirection | ItemStandard(int) | ItemRule(int)
  pure val ITEMS = Set(ItemDirection, ItemStandard(0), ItemStandard(1), ItemRule(0), ItemRule(1))
  // A standard applies to the tasks inside its `where`, a rule to the tasks it names.
  pure def applies(record: Item, slot: int): bool = match record {
    | ItemDirection => true
    | ItemStandard(number) => number == 1 or slot == 0  // standard 0: task 0; 1: both tasks
    | ItemRule(number) => slot == number                // rule 0: task 0; rule 1: task 1
  }
  pure def isRule(record: Item): bool = match record { | ItemRule(_) => true | _ => false }
  pure def ruleNumber(record: Item): int = match record { | ItemRule(number) => number | _ => -1 }
  // The item sets a draft may change: a standard draft one standard or rule, or a standard
  // with its rule; a direction draft the direction, alone or with either pair.
  pure val ITEMSETS = Set(
    Set(ItemStandard(0)), Set(ItemStandard(1)), Set(ItemRule(0)), Set(ItemRule(1)),
    Set(ItemStandard(0), ItemRule(0)), Set(ItemStandard(1), ItemRule(1)),
    Set(ItemDirection), Set(ItemDirection, ItemStandard(0), ItemRule(0)),
    Set(ItemDirection, ItemStandard(1), ItemRule(1)))

  // The person's direction edit enters the pipeline as a fix with no task: fix id EDIT.
  // The tasks' fixes are named by their slot.
  pure val EDIT = 2
  pure def free(fixId: int): bool = fixId >= EDIT
  pure val NONE = -1   // no slot, no fix, no revision

  type TaskState = Unsent | Sent | Working | InReview | Raised | Done
  type Verdict = Pass | Fail | RaiseTries | RaiseNoRule | RaiseMisses
  // The ladder: a split, a role's own fit (off the ladder), principle, direction, standard.
  type Level = Split | Fit | Principle | Direct | Standard
  // The real cause of a task's trouble: hidden from the store and the agents' choices.
  type Cause = NoCause | CauseAt(Level)
  // Where a fix is: the pipeline role evaluates the raise, assesses it down the ladder
  // (principle, direction, standard, rule), tests the rule, drafts, and the review loop goes
  // over it; then it is at the person, accepted (the host reassigns) or closed.
  type Stage = Evaluating | AtPrinciple | AtDirection | AtStandard | AtRule | Testing | Drafting
             | InLoop | AtPerson | Accepted | Closed
  // How a rule is verified: a test command, a reference, both.
  type Form = NoForm | Mech | Ref | Both
  // A fix changes items (DirectionDraft: direction, standards, rules) or the role's own card.
  type FixKind = DirectionDraft | RoleDraft
  // The person's reply to a draft: accept it, send it back, take the task's result as it
  // is, or send the raise back to evaluation.
  type Reply = AcceptIt | SendItBack | TakeAsIs | EvaluateAgain

  // ---- ask: the one act between actors
  // Question: any to any. Execute: host -> role (the task), role -> maker (make it), role or
  // person -> pipeline role (a raise). Check: maker -> role (the result to check). Decide:
  // pipeline role -> person (the draft). about: the slot or fix it is for (NONE: a question).
  type AskKind = Question | Execute | Check | Decide
  type Ask = { kind: AskKind, from: Actor, to: Actor, about: int }

  // ---- acts: the envelope, and one body per act with only its own fields
  // What the evaluation found: a split (the real cause of the new part), a change of the
  // role's own card, or a fix at a level of the ladder (built on `base`, really on `trueBase`).
  type Finding =
    | Splits({ cause: Cause })
    | FitsRole({ label: bool, only: bool })
    | FixAt({ level: Level, base: Item -> int, trueBase: Item -> int })

  // The content of each act that carries more than an ask or an id.
  type Edit = { items: Set[Item], base: Item -> int, trueBase: Item -> int }
  type Result = { ask: Ask, slipped: bool }
  type Judgement = { ask: Ask, verdict: Verdict }
  type Decision = { ask: Ask, reply: Reply, resolvesFight: bool, breaksTasks: Set[int] }
  type Evaluation = { fix: int, finding: Finding }
  type RuleDraft = { fix: int, form: Form, testOk: bool, refOk: bool, fights: bool }
  type TestRun = { fix: int, passed: bool, contradicts: bool }
  type Shipment = { fix: int, items: Set[Item], real: Set[Item], breaksTasks: Set[int] }
  type Loop = { fix: int, toPerson: bool }
  type Recheck = { task: int, holds: bool, items: Set[Item], base: Item -> int }

  type Body =
    | EndProject                  // person
    | MoveHost                    // person: run continue
    | Open(Ask)                   // by its from: a question, SendTask, AssignDo, a reject
    | AskEdit(Edit)               // person: the direction edit
    | AskRaise(Ask)               // a maker past the cap of asks
    | Hear(Ask)                   // the asker hears an answer
    | AnswerQuestion(Ask)         // by its to
    | Report(Result)              // maker: its result
    | Review(Judgement)           // role: the verdict on a check
    | Respond(Decision)           // person: the reply to the draft
    | Reassign | TopDone          // host
    | Resume({ maker: Actor })    // role
    | ReadBrief({ maker: Actor }) // maker
    | Evaluate(Evaluation)        // pipeline role from here on
    | Advance({ fix: int })
    | WriteRule(RuleDraft)
    | RunTest(TestRun)
    | Ship(Shipment)
    | LoopReview(Loop)
    | RecheckDone(Recheck)
    | Revive({ actor: Actor }) | Exit({ actor: Actor }) | RunRule({ task: int })  // engine
  // An act as it reaches the store. who, epoch: the sender's token (a process has its own).
  // seen, seenVersions: the revision of the target and the sum of the item versions in the
  // sender's view (its basis). old: from an old page build, which names no basis. Ghosts, never
  // read by the store's check: byzantine (a Byzantine sender), hadContext (the sender had its
  // context).
  type Act = { who: Actor, epoch: int, seen: int, seenVersions: int, old: bool,
               byzantine: bool, hadContext: bool, body: Body }

  // ---- the store
  // A task of the top. badResult: the latest result is wrong. checked: the item versions it
  // was made or last checked under. pending: items of a done task still to recheck. sections:
  // the sections it owns. floor: the lowest level its next evaluation may take. broken (ghost
  // truth): a change that landed broke its work. taken: the person took the result as it is.
  type Task = { generation: int, state: TaskState, tries: int, maker: Actor, resultId: int,
                checked: Item -> int, pending: Set[Item], badResult: bool, broken: bool,
                taken: bool, cause: Cause, sections: int, floor: Level }
  // brief: the item versions of the brief it read. revisions: the revisions it was sent.
  type MakerState = { slot: int, ended: bool, claimed: bool, brief: Item -> int, revisions: int }
  // A raise and what follows it. testOk: the test command behaves on its examples. refOk: the
  // reference exists. items, real: the items the draft names, and those its content changes.
  // base: the versions it was built on (trueBase, ghost: really built on). fights (ghost truth):
  // its rule contradicts the other rule. roleOnly (truth), roleLabel (the pipeline's answer):
  // the role draft changes only the card. climbedTo: the stage it was last sent up to.
  // basisStep: counts the fix's steps (the basis an act of the pipeline role names).
  // revision: the draft's version; sentBack: the revisions the person sent back, sendBacks how
  // often. loopRounds: the review loop's rounds. needRevise: the person sent it back, so it
  // must be revised before it reaches the person again.
  type Fix = { stage: Stage, entry: Stage, level: Level, kind: FixKind, form: Form,
               testOk: bool, refOk: bool, ruleTries: int, items: Set[Item], real: Set[Item],
               roleOnly: bool, roleLabel: bool, base: Item -> int, cardBase: int,
               revision: int, sentBack: Set[int], needRevise: bool, loopRounds: int,
               basisStep: int, wrote: Set[Item], climbedTo: Stage, sendBacks: int,
               trueBase: Item -> int, fights: bool, contradicted: bool }
  // The host holds the top for the whole project. hostSession: the session its assignment is
  // bound to. done: the host returned the top (all done).
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
    topNoPerson: bool, askRaised: bool, rebaseFired: bool, recheckFired: bool,
    reassignEnded: bool,
  }
  // versions: per item. fixDepth: per item, the depth of the level of its last fix from a
  // task's raise (NONE: none; 1 standard, 2 direction, 3 principle). epochs: per process.
  // asks: the open asks, one per (kind, from, to, about). answered: a question's answer not
  // yet heard by its asker. askCount: the questions so far per pair. justAnswered: the
  // answerers whose last act answered a question (they alternate it with a step of their own).
  type Store = {
    top: Top, session: int, tasks: int -> Task, makers: Actor -> MakerState, fixes: int -> Fix,
    versions: Item -> int, ruleForm: int -> Form, card: int, changes: int, agentChanges: int,
    fixDepth: Item -> int, down: Set[Actor], epochs: Actor -> int, nextMaker: int, ghost: Ghost,
    asks: Set[Ask], answered: Set[Ask], justAnswered: Set[Actor],
    askCount: (Actor, Actor) -> int,
  }
}
