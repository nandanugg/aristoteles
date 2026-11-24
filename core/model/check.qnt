// The composed checking model: G2.
// "From every state someone is told the next step; told steps done lead every run to its
// end." Small on purpose, for TLC with liveness.
// The protocol is protocol.qnt's, imported, not restated: the store's check (accept), the
// effects (take), the told steps (toldSteps), the obligations, Final. This file adds what an
// honest agent puts in an act (honestOf) and the actors around it:
// - each agent takes a step it is told, with honest content (a bounded number of mistakes:
//   the pipeline role may evaluate shallower than the real cause); the act takes effect in
//   one step (no network, no stale views: those couplings are store.qnt's and browser.qnt's);
// - the environment's truths: a maker's slip, a test command's real behaviour, whether a
//   new rule contradicts the other rule (fights), what a change breaks (breaksTasks), the real
//   cause of a split part;
// - the person: accepts, sends back, rejects, takes as is, ends; at most maxPersonActs, and
//   never assumed to act (a run that waits only on the person is Final);
// - the engine's exits, the questions between actors, the rogue maker.
// Abstracted away: tmux, terminals, processes, crashes, the network, the page, time, the
// person's direction edit (EditDirection) and run continue (MoveHost).
// The properties are properties.qnt's, the limits and instances configs.qnt's, the state
// reduction canon.qnt's.
// The assumptions are the contract's (contract.qnt), each proven by its own model:
// - G1, for each actor: an agent told a step takes it in the end (G1 then A: "hears" is
//   the step itself). terminals.qnt proves G1; A is assumed. Assumed below.
// - G3: an act takes effect only if it is fresh (store.qnt proves it). It is what lets this
//   model apply each act atomically to the current state: every step below takes an act
//   only if G3 holds of it (a guard that is true of every act built here).
// - G4: what the person owes is, in the end, shown on the person's page (browser.qnt
//   proves it). It is what makes Final's "waits only on the person" an end and not a
//   stall: the person is shown the wait. This model has no page: it relies on G4 there.
module check {
  import contract.* from "./contract"
  // The limits of a run.
  // causesTask0: the real causes task 0 may start with, and a split part may get.
  // causesTask1: the real causes task 1 may start with.
  // maxPersonActs: the person's acts (-1: no count).
  // maxMistakes: the pipeline role's shallow evaluations.
  // makerMaySlip: a maker may slip (a bad result with no cause).
  // ruleForms: the forms the pipeline role may write for a rule.
  // testsMayFail: a test command may fail its own examples (then the rule is written again;
  //   past maxRuleTries only as a reference).
  // personMayReject: the person may reject a result.
  // maxExits: the process ends. personSendBackBound: the person sends a draft back at most
  //   sendBacksPerDraft times (and send-backs are not counted in maxPersonActs).
  // maxAsks: the questions asked by an any-to-any step. rogueMaker: an unbounded asker.
  const LIMITS: { causesTask0: Set[Cause], causesTask1: Set[Cause], maxPersonActs: int,
                  maxMistakes: int, makerMaySlip: bool, ruleForms: Set[Form],
                  testsMayFail: bool, personMayReject: bool, maxExits: int,
                  personSendBackBound: bool, sendBacksPerDraft: int, maxAsks: int,
                  rogueMaker: bool }
  import types.* from "./types"
  // OPTIONS, the protocol's options, is this model's constant too.
  import protocol.* from "./protocol"
  // The properties and instances reach the protocol through this module: one instance.
  export protocol.*
  import canon.* from "./canon"

  def reduced(store: Store): Store = canon(store, CLOSED, NOGHOST, changeBound)

  var store: Store
  var personActs: int       // the person's acts so far
  var mistakes: int         // the pipeline role's mistakes so far
  var agentChangeFlag: bool // flips at each agent change (AgentChangesStop)
  var exits: int            // the exits so far (LIMITS.maxExits)
  var asksMade: int         // the questions asked so far (LIMITS.maxAsks)

  val vars = (store, personActs, mistakes, agentChangeFlag, exits, asksMade)
  pure val VERDICTS = Set(Pass, Fail, RaiseTries, RaiseNoRule, RaiseMisses)
  pure val LEVELS = Set(Split, Fit, Principle, Direct, Standard)
  pure val BOOLS = Set(true, false)
  // A maker of task n has the id n: one live maker per task; before each act the next
  // maker's id is set to its task's (withNextMakerId), and canon drops the ended makers.
  def makerForSlot(slot: int): Actor = Maker(slot)
  def slotMakers: Set[Actor] = SLOTS.map(slot => makerForSlot(slot))

  action commitExits(updated: Store, newPersonActs: int, newMistakes: int, newExits: int): bool =
    all {
      store' = reduced(updated), personActs' = newPersonActs, mistakes' = newMistakes,
      exits' = newExits, asksMade' = asksMade,
      agentChangeFlag' = if (updated.agentChanges > store.agentChanges) not(agentChangeFlag)
                         else agentChangeFlag,
    }
  action commit(updated: Store, newPersonActs: int, newMistakes: int): bool =
    commitExits(updated, newPersonActs, newMistakes, exits)

  action init = {
    nondet cause0 = LIMITS.causesTask0.oneOf()
    nondet cause1 = LIMITS.causesTask1.oneOf()
    all { store' = initStore(Map(0 -> cause0, 1 -> cause1)), personActs' = 0, mistakes' = 0,
          agentChangeFlag' = false, exits' = 0, asksMade' = 0 }
  }

  // ---- acts. An act as its sender builds it on the current store (its basis is current).
  def actNow(sender: Actor, body: Body): Act = actAs(store, sender, body)
  // The tasks a change of task `slot` may break (the environment's truth): none or the other.
  def others(slot: int): Set[Set[int]] =
    Set(Set()).union(SLOTS.filter(other => other != slot).map(other => Set(other)))
  def withBody(act: Act, body: Body): Act = { ...act, body: body }
  // The contents an honest agent may choose, and the environment's truths, per act. Only
  // the fields the act uses vary (honestOf then filters).
  def choices(draft: Act): Set[Act] = match draft.body {
    // A maker's result to its Execute (it may slip); the role's verdict on a check.
    | Report(result) => (if (LIMITS.makerMaySlip) BOOLS else Set(false)).map(slipped =>
        withBody(draft, Report({ ...result, slipped: slipped })))
    | Review(judgement) => VERDICTS.map(verdict =>
        withBody(draft, Review({ ...judgement, verdict: verdict })))
    | Evaluate(evaluation) => LEVELS.fold(Set(), (acts, level) => acts.union(
        if (level == Fit) BOOLS.map(flag => withBody(draft, Evaluate({ ...evaluation,
          finding: FitsRole({ label: flag, only: flag }) })))
        else if (level == Split) LIMITS.causesTask0.fold(Set(), (splits, cause) => splits.union(
          (if (OPTIONS.scopeOutput) BOOLS else Set(false)).map(addsOutput =>
            withBody(draft, Evaluate({ ...evaluation, finding: Splits({ cause: cause, addsOutput: addsOutput }) })))))
        else Set(withBody(draft, Evaluate({ ...evaluation, finding:
          FixAt({ level: level, base: store.versions, trueBase: store.versions }) })))))
    | WriteRule(rule) => LIMITS.ruleForms.fold(Set(), (acts, form) => acts.union(
        (if (LIMITS.testsMayFail) BOOLS else Set(true)).fold(Set(), (more, testOk) =>
          more.union(BOOLS.map(fights => withBody(draft, WriteRule({ ...rule, form: form,
            testOk: testOk, refOk: true, fights: fights })))))))
    // The draft of task n's raise changes items that apply to task n.
    | Ship(shipment) =>
        ITEMSETS.filter(items => items.forall(record => itemApplies(store, record, shipment.fix)))
          .fold(Set(), (acts, items) => acts.union(others(shipment.fix).map(breaksTasks =>
            withBody(draft, Ship({ ...shipment, items: items, real: items,
                                  breaksTasks: breaksTasks })))))
    | RunTest(testRun) => BOOLS.fold(Set(), (acts, passed) => acts.union(BOOLS.map(contradicts =>
        withBody(draft, RunTest({ ...testRun, passed: passed, contradicts: contradicts })))))
    | RecheckDone(recheck) => BOOLS.map(holds =>
        withBody(draft, RecheckDone({ ...recheck, holds: holds })))
    | LoopReview(loop) => BOOLS.map(toPerson =>
        withBody(draft, LoopReview({ ...loop, toPerson: toPerson })))
    // every other act has no content to choose
    | _ => Set(draft)
  }
  // A new maker gets its task's id: the next id is set to the slot of the Execute.
  def withNextMakerId(act: Act): Store = match act.body {
    | Open(ask) => if (ask.kind == Execute and ask.from == Role) { ...store, nextMaker: ask.about }
                   else store
    | _ => store   // no other act makes a maker
  }
  def honestNow(act: Act): bool = honestOf(store, act, mistakes < LIMITS.maxMistakes)
  // An honest agent's content, on its own view (misjudge: the pipeline role may evaluate
  // shallower than the real cause, a mistake): it reviews correctly (it runs the test
  // commands; on a rule with both forms it judges the candidates), evaluates at the real
  // cause, reports its test runs as they printed, labels a draft by its content, revises a
  // draft the person sent back, writes real references. Its maker's slips, the test
  // command's real behaviour and the real causes of new tasks are the environment's choice.
  def honestOf(view: Store, act: Act, misjudge: bool): bool = match act.body {
    | Review(judgement) =>
        val task = taskOf(view, judgement.ask.about)
        val triesLeft = task.tries + 1 < OPTIONS.maxTries
        val verdict = judgement.verdict
        if (not(task.badResult)) verdict == Pass
        else if (task.cause == NoCause) verdict == (if (triesLeft) Fail else RaiseTries)
        else verdict != Pass and (verdict != Fail or triesLeft)
             and (verdict != RaiseTries or not(triesLeft))
    // At the real cause (with misjudge: possibly shallower), and one level up after a fix
    // (raiseLevel): the floor wins when it is deeper.
    | Evaluate(evaluation) =>
        val task = taskOf(view, evaluation.fix)
        val level = levelOf(evaluation.finding)
        val atCause = match task.cause {
          | NoCause => true
          | CauseAt(real) => level == real
              or (misjudge and depth(level) < depth(real) and level != Fit) }
        // With raiseLevel the task's floor wins: a level below it is refused, and the floor
        // itself is taken when the cause is below it.
        val floored = OPTIONS.raiseLevel and level != Fit
        val atFloor = floored and level == task.floor and match task.cause {
          | CauseAt(real) => real != Fit and depth(real) < depth(task.floor) | NoCause => true }
        val fitHonest = match evaluation.finding {
          | FitsRole(fit) => fit.label == fit.only
          | Splits(_) => true
          | FixAt(_) => true }
        or { atCause, atFloor }
          and not(floored and depth(level) < depth(task.floor)) and fitHonest
    | WriteRule(rule) => rule.form != NoForm and rule.refOk
    | RunTest(testRun) =>
        testRun.passed == fixOf(view, testRun.fix).testOk
          and testRun.contradicts == (OPTIONS.crossTest and fixOf(view, testRun.fix).fights)
    | Ship(shipment) =>
        shipment.real.contains(ItemDirection) == (fixOf(view, shipment.fix).entry != AtStandard)
          and shipment.items == shipment.real
          and fixOf(view, shipment.fix).wrote.forall(record => shipment.real.contains(record))
    | RecheckDone(recheck) => recheck.holds == not(taskOf(view, recheck.task).broken)
    | LoopReview(loop) => not(loop.toPerson and fixOf(view, loop.fix).needRevise)
    // the default is the rule: every other act has no content an agent can get wrong
    | _ => true
  }
  // G3's facts of an act at its append, read from protocol.qnt's checks. Every act here is
  // sent once (firstTime).
  def fresh(act: Act): Fresh = {
    basisCurrent: basisCurrent(store, act),
    // only a recheck names judged versions; every other act has none to go stale
    judgedCurrent: match act.body { | RecheckDone(recheck) => recheckCurrent(store, recheck)
                                    | _ => true },
    firstTime: true, currentEpoch: epochOk(store, act), currentBuild: not(act.old),
    waitsIfAccept: match act.body {
      | Respond(decision) => decision.reply != AcceptIt
          or fixOf(store, decision.ask.about).stage == AtPerson
      | _ => true },   // only an accept can name a draft that does not wait
  }

  // ---- the actors
  // An agent (or the harness) takes a step it is told, with honest content; not while its
  // exit is recorded (it is revived or resumed first).
  action agentStep(actor: Actor): bool = all {
    not(store.down.contains(actor)),
    nondet step = toldSteps(store, actor).oneOf()
    nondet act = choices(actNow(actor, step))
      .filter(candidate => accept(store, candidate) and G3(fresh(candidate))
                           and honestNow(candidate))
      .oneOf()
    commit(take(withNextMakerId(act), act), personActs,
           mistakes + if (honestOf(store, act, false)) 0 else 1),
  }
  // A process ends: the engine records its exit (protocol.qnt Exit, the harness's act), at
  // most maxExits times; not fair. Then the harness revives a role, the role resumes its
  // maker, the person starts the host again (protocol.qnt Revive, Resume, ReviveOb).
  action exitHappens = all {
    exits < LIMITS.maxExits,
    nondet actor = Set(Host, Role, Pipe).union(store.makers.keys())
      .filter(process => not(store.down.contains(process))).oneOf()
    val act = actNow(Harness, Exit({ actor: actor }))
    all { accept(store, act), commitExits(take(store, act), personActs, mistakes, exits + 1) },
  }
  // A question between actors, at most maxAsks in a run; not fair: any agent
  // asks any actor, in both directions, the person a target too (questions cross). Answers and
  // hears are the answerer's and the asker's told steps (agentStep), the person's answer a
  // person act; a question blocks nobody.
  action putAsk(act: Act, newAsksMade: int): bool = all {
    accept(store, act), G3(fresh(act)),
    store' = reduced(take(store, act)), personActs' = personActs,
    mistakes' = mistakes, exits' = exits, agentChangeFlag' = agentChangeFlag,
    asksMade' = newAsksMade,
  }
  action askStep = all {
    asksMade < LIMITS.maxAsks,
    nondet asker = Set(Host, Role, Pipe).union(store.makers.keys()).oneOf()
    nondet answerer = Set(Human, Host, Role, Pipe).union(store.makers.keys()).oneOf()
    putAsk(actNow(asker, Open(question(asker, answerer))), asksMade + 1),
  }
  // The rogue maker (LIMITS.rogueMaker): it asks its role again and again, whenever the store
  // takes it (not fair, not counted by maxAsks: the cap, ASK_CAP, bounds it), and past the cap
  // it raises its task (AskRaise). Unbounded: the ladder and the person must bound the raises.
  action rogueStep = all {
    LIMITS.rogueMaker,
    nondet maker = store.makers.keys().oneOf()
    any {
      putAsk(actNow(maker, Open(question(maker, Role))), asksMade),
      putAsk(actNow(maker, AskRaise(question(maker, Role))), asksMade),
    },
  }
  // The mutant of the wait order (OPTIONS.makerAsks): a maker asks its role to execute, the
  // reverse of the role's own Execute to it. The store takes it only in the mutant.
  action reverseStep = all {
    OPTIONS.makerAsks,
    nondet maker = store.makers.keys()
      .filter(candidate => not(makerOf(store, candidate).ended)).oneOf()
    putAsk(actNow(maker, Open(executeAsk(maker, Role, makerOf(store, maker).slot))), asksMade),
  }
  // The person: what the person is told (accept, send back, take as is, end, start the
  // host), and a reject of a result. Not fair; at most maxPersonActs. With
  // personSendBackBound (an assumption about the person, contract.qnt
  // PERSON_SEND_BACKS) the person sends one draft back at most that many times, and send-backs
  // are not counted in maxPersonActs.
  def personMoves: Set[Body] = toldSteps(store, Human).union(
    if (not(LIMITS.personMayReject)) Set() else
    SLOTS.filter(slot => taskOf(store, slot).resultId >= 0
                         and (taskOf(store, slot).state == InReview
                              or taskOf(store, slot).state == Done))
      .map(slot => Open(executeAsk(Human, Pipe, slot))))
  // The reply to a decide: accept, send back, and for a slot's raise take as is or again.
  def replies(step: Body): Set[Reply] = match step {
    | Respond(decision) => if (free(decision.ask.about)) Set(AcceptIt, SendItBack)
                           else Set(AcceptIt, SendItBack, TakeAsIs, EvaluateAgain)
    | _ => Set(AcceptIt)   // only a decide has a choice of replies
  }
  action personStep = all {
    nondet step = personMoves.oneOf()
    nondet reply = replies(step).oneOf()
    val counted = reply != SendItBack or not(LIMITS.personSendBackBound)
    // sendBacksPerDraft: the send-backs a run of this instance explores per draft (at most
    // PERSON_SEND_BACKS).
    val cap = if (LIMITS.sendBacksPerDraft < PERSON_SEND_BACKS) LIMITS.sendBacksPerDraft
              else PERSON_SEND_BACKS
    val bounded = match step {
      | Respond(decision) => reply != SendItBack or not(LIMITS.personSendBackBound)
          or fixOf(store, decision.ask.about).sendBacks < cap
      | _ => true }   // only a decide is a send-back
    // resolvesFight: the accepted direction change resolves a contradiction; breaksTasks: the
    // tasks the accepted change breaks.
    val resolveChoices = if (reply == AcceptIt) BOOLS else Set(false)
    val hitSets = match step { | Respond(decision) => if (reply == AcceptIt)
                                                         others(decision.ask.about)
                                                       else Set(Set())
                               | _ => Set(Set()) }   // only an accepted decide
    nondet resolvesFight = resolveChoices.oneOf()
    nondet breaksTasks = hitSets.oneOf()
    val act = withBody(actNow(Human, step), match step {
      | Respond(decision) => Respond({ ...decision, reply: reply, resolvesFight: resolvesFight,
                                       breaksTasks: breaksTasks })
      | _ => step })   // any other act is the told step as it is
    val countsAct = counted and LIMITS.maxPersonActs >= 0
    all { not(counted) or LIMITS.maxPersonActs < 0 or personActs < LIMITS.maxPersonActs,
          bounded, accept(store, act), G3(fresh(act)),
          commit(take(store, act), personActs + if (countsAct) 1 else 0, mistakes) },
  }
  action step = any {
    agentStep(Host), agentStep(Role), agentStep(Pipe), agentStep(Harness),
    nondet maker = slotMakers.oneOf() agentStep(maker),
    personStep, exitHappens, askStep, rogueStep, reverseStep,
  }

  // ---- fairness
  def owes(actor: Actor): bool = toldSteps(store, actor) != Set()
  // The assumption, with the same arguments terminals.qnt proves: G1 then A, for each agent:
  // an agent told a step takes one in the end, or it is no longer told one; the host may
  // instead wait for the person to start it again (its exit is recorded: a person obligation,
  // protocol.qnt ReviveOb). A maker whose exit is recorded is told nothing (its resume is the
  // role's step): terminals' "the role hears the resume".
  temporal AgentsG1 = all {
    G1(owes(Host), mustChange(agentStep(Host), vars), store.down.contains(Host)),
    G1(owes(Role), mustChange(agentStep(Role), vars), false),
    G1(owes(Pipe), mustChange(agentStep(Pipe), vars), false),
    G1(owes(Maker(0)), mustChange(agentStep(Maker(0)), vars), false),
    G1(owes(Maker(1)), mustChange(agentStep(Maker(1)), vars), false),
  }
  // Engine fairness, not the contract: the harness runs a rule's test command it is due to
  // run (RunRule) and revives a role whose exit is recorded (terminals.qnt's watcher).
  temporal EngineFair = G1(owes(Harness), mustChange(agentStep(Harness), vars), false)
  temporal Assumed = AgentsG1 and EngineFair
}
