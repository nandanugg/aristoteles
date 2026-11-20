// The properties of the checked model (README.md "Properties"): each with its meaning. The
// invariants are checked by TLC (tlc.sh) and the simulator (spec.sh); the temporal ones by
// TLC. A witness is a property the model must break: it shows the case is reached.
module properties {
  import types.* from "./types"
  import contract.* from "./contract"
  import check.* from "./check"
  // An instance imports this module alone: the model it checks comes with the properties.
  export check.*

  // ---- safety: invariants of every reachable state
  // A done task is closed and holds no maker.
  val DoneIsClosed: bool = SLOTS.forall(slot => taskOf(store, slot).state == Done implies
    (fixOf(store, slot).stage == Closed and liveMaker(store, slot) == NoOne))
  // At most one live maker per task.
  val OneMakerPerTask: bool = SLOTS.forall(slot => store.makers.keys().filter(maker =>
    makerOf(store, maker).slot == slot and not(makerOf(store, maker).ended)).size() <= 1)
  // A task is raised exactly while its fix is open.
  val RaiseHasOwner: bool = SLOTS.forall(slot =>
    (taskOf(store, slot).state == Raised) iff (fixOf(store, slot).stage != Closed))
  // The open protocol asks are those the tasks and fixes imply.
  val AsksFollowState: bool = asksMatchState(store)
  val Sane: bool = DoneIsClosed and OneMakerPerTask and RaiseHasOwner and AsksFollowState

  // An answer deferred by alternation is told later: its answerer is told its own step now.
  def deferred(obligation: Obligation): bool = match obligation {
    | AskOb(ask) => ask.kind == Question and store.justAnswered.contains(ask.to)
        and ownToldSteps(store, ask.to) != Set()
    | _ => false   // the default is the rule: only a question can be deferred
  }
  // Every obligation is told to exactly one actor (everyone hears here: G1).
  val EveryObligationToldOnce: bool = obligationsOf(store).forall(obligation =>
    toldAny(store, obligation).size() == 1
      or (toldAny(store, obligation).size() == 0 and deferred(obligation)))
  // Every step told to an agent has an honest content the store takes.
  val ToldIsAllowed: bool = Set(Host, Role, Pipe, Harness).union(store.makers.keys())
    .forall(actor => toldSteps(store, actor).forall(step =>
      choices(actNow(actor, step)).exists(act =>
        accept(withNextMakerId(act), act) and honestOf(store, act, false))))
  // Someone is told something until the project ends.
  val SomethingOwed: bool = store.top.ended or obligationsOf(store) != Set()
  // A done task with nothing pending to recheck has no stale item.
  val DoneIsCurrent: bool = SLOTS.forall(slot => (taskOf(store, slot).state == Done
    and taskOf(store, slot).pending == Set()) implies staleItems(store, slot) == Set())
  // The ghost flags the store sets on an impossible state stay false.
  val NoDoneBrokenAtEnd: bool = not(store.ghost.endBroken)
  val NoLostUpdate: bool = not(store.ghost.lostUpdate)
  val NoTakenUndone: bool = not(store.ghost.takenUndone)
  val NoPassOfBadResult: bool = not(store.ghost.passDefect)
  val NoRefixAtSameLevel: bool = not(store.ghost.refix)
  val NoEscalationWithoutPerson: bool = not(store.ghost.escalatedNoPerson)
  val NoAgentChangeAtTop: bool = not(store.ghost.topNoPerson)
  // Agent changes stay within the bound the options give.
  val Converges: bool = not(pastBound(store))
  // No cycle of waits (protocol.qnt waitsFor).
  val NoWaitCycle: bool = not(waitClosure(store).exists(edge => edge._1 == edge._2))
  // An asker asks a pair at most ASK_CAP times.
  val AskCap: bool = store.askCount.keys().forall(pair => store.askCount.get(pair) <= ASK_CAP)

  // ---- liveness (G2)
  // Every run reaches Final (the project ended, or it waits only on the person) again and
  // again; with exits, the host whose exit is recorded waits for the person (finalOf).
  temporal Progress = always(eventually(finalOf(store)))
  // Agent changes stop.
  temporal AgentChangesStop = eventually(always(agentChangeFlag))
                              or eventually(always(not(agentChangeFlag)))
  // The run settles: in the end it is Final for good (ended, or waiting only on a person who
  // has no acts left). It holds with the person's acts bounded (maxPersonActs, P); without P
  // the person can keep a draft going round for ever: corePersonUnbounded breaks it (expected:
  // the run then depends on the person, not on the system).
  temporal Settles = eventually(always(finalOf(store)))
  temporal CoreProgress = Assumed implies Progress
  temporal CoreChangesStop = Assumed implies AgentChangesStop
  temporal CoreSettles = Assumed implies Settles
  // The answerer's own work is not starved (an answer alternates with a step of its own): the
  // role is, again and again, owed no step of its own (assign, review, resume, hear), or the
  // run is Final.
  temporal AnswererFinishes =
    Assumed implies always(eventually(ownToldSteps(store, Role) == Set() or finalOf(store)))

  // ---- the assumption cut (TLC must break these: the assumption is not vacuous)
  // Without the pipeline role's part of the assumption a run can stop short of Final.
  temporal AssumedNoPipe = all {
    G1(owes(Host), mustChange(agentStep(Host), vars), store.down.contains(Host)),
    G1(owes(Role), mustChange(agentStep(Role), vars), false),
    G1(owes(Maker(0)), mustChange(agentStep(Maker(0)), vars), false),
    G1(owes(Maker(1)), mustChange(agentStep(Maker(1)), vars), false),
    EngineFair,
  }
  temporal CoreProgressNoPipe = AssumedNoPipe implies Progress
  // Without engine fairness (the watcher's revive) a role's exit can stall the run: TLC must
  // break this on coreTwoExit.
  temporal CoreProgressNoEngine = AgentsG1 implies Progress

  // ---- witnesses (the simulator or TLC must break them: the case is reached)
  // A run is Final with a question still open.
  val NoFinalWithAsk: bool = not(store.asks.exists(ask => ask.kind == Question)
                                 and finalOf(store) and not(store.top.ended))
  // Questions cross: an ask each way at once.
  val NoCrossing: bool = not(store.asks.exists(ask => ask.kind == Question and
    store.asks.exists(back => back.kind == Question and back.from == ask.to
                              and back.to == ask.from)))
  // A wait chain of length 2 or more (host -> role -> maker).
  val NoWaitChain: bool = not(waitClosure(store).exists(edge =>
    edge._1 == Host and isMakerActor(edge._2)))
  // The full chain host -> role -> pipeline role -> person.
  val NoLongWaitChain: bool = not(waitClosure(store).exists(edge =>
    edge._1 == Host and edge._2 == Human))
  // An asker reaches the cap.
  val NoCapReached: bool = store.askCount.keys().forall(pair =>
    store.askCount.get(pair) < ASK_CAP)
  // A role revived while its task was working: the task went back to Sent and got a fresh maker.
  val NoRestartAssigned: bool = not(store.ghost.restartedAssigned)
  // A role revived while its task was in review: its Check survived and was judged.
  val NoKeptCheckJudged: bool = not(store.ghost.keptCheckJudged)
  // A kept Check was failed (the task went to Sent: the old maker is gone) and a fresh maker took
  // the task.
  val NoKeptFailAssigned: bool = not(store.ghost.keptFailAssigned)
  // After that, an open Execute never names an ended maker (the Resume is told and allowed only
  // for a live maker: resumeAllowed, resumeTold).
  val NoExecuteToEndedMaker: bool = store.asks.forall(ask =>
    not(ask.kind == Execute and isMakerActor(ask.to)) or isLive(store, ask.to))
  // A repeat past the cap raised its task.
  val NoAskRaise: bool = not(store.ghost.askRaised)
}
