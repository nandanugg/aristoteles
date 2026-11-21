// One canonical store per state (the method's "bound unbounded things"), apart from the
// design: a reduction of the state space that changes no property. In the checked models no
// act is in flight and no view is old, so the counters that only tell an old act from a
// current one (a fix's basisStep and revision, a result's id, a maker's revisions, the epochs,
// the maker ids, a task's generation) carry nothing: they are set to one value.
// Item versions and the card are compared only with each other: each is shifted so that its
// smallest copy is 0. Ended makers are dropped (nothing reads them again). The history flags
// the model does not check are cleared. agentChanges stops at changeBound + 1 (Converges
// reads it).
// The rule: canon may reset a field only when no reachable step reads it again. A task's checked
// versions are kept while it has a result (a raise from Working, then a take as is, reads them).
module canon {
  import types.* from "./types"
  import contract.* from "./contract"
  // Pure on the store's words: it takes from the protocol (check.qnt passes them) the closed
  // fix, the empty ghost record and the bound of agent changes.

  def shifted(versions: Item -> int, lowest: Item -> int): Item -> int =
    ITEMS.mapBy(record => versions.get(record) - lowest.get(record))

  // The brief a maker keeps matters only while it is claimed.
  def canonMakers(store: Store, live: Set[Actor]): Actor -> MakerState =
    live.mapBy(maker => { ...store.makers.get(maker), revisions: 0,
                          brief: if (store.makers.get(maker).claimed) store.makers.get(maker).brief
                                 else store.versions })

  def canonTasks(store: Store): int -> Task =
    store.tasks.keys().mapBy(slot =>
      val task = store.tasks.get(slot)
      { ...task, generation: 0, resultId: if (task.resultId >= 0) 0 else -1,
        // a result's checked versions are read again (a take as is rechecks what moved since)
        checked: if (task.resultId >= 0) task.checked else store.versions })

  def canonFixes(store: Store, closed: Fix): int -> Fix =
    store.fixes.keys().mapBy(fixId =>
      val fix = store.fixes.get(fixId)
      val keepBase = fix.stage != Evaluating and fix.kind == DirectionDraft
      if (fix.stage == Closed) closed
      else { ...fix, basisStep: 0, revision: 0, sentBack: Set(),
             sendBacks: if (fix.sendBacks > PERSON_SEND_BACKS) PERSON_SEND_BACKS else fix.sendBacks,
             base: if (keepBase) fix.base else store.versions,
             trueBase: if (keepBase) fix.trueBase else store.versions,
             cardBase: if (fix.kind == RoleDraft) fix.cardBase else store.card })

  def canon(store: Store, closed: Fix, noGhost: Ghost, changeBound: int): Store =
    val live = store.makers.keys().filter(maker => not(store.makers.get(maker).ended))
    val makers = canonMakers(store, live)
    val tasks = canonTasks(store)
    val fixes = canonFixes(store, closed)
    val open = fixes.keys().filter(fixId => fixes.get(fixId).stage != Closed)
    val copies = Set(store.versions).union(tasks.keys().map(slot => tasks.get(slot).checked))
      .union(makers.keys().map(maker => makers.get(maker).brief))
      .union(open.map(fixId => fixes.get(fixId).base))
      .union(open.map(fixId => fixes.get(fixId).trueBase))
    val lowest = ITEMS.mapBy(record => copies.fold(store.versions.get(record), (low, copy) =>
      if (copy.get(record) < low) copy.get(record) else low))
    val cardLowest = open.fold(store.card, (low, fixId) =>
      if (fixes.get(fixId).cardBase < low) fixes.get(fixId).cardBase else low)
    val ghost = store.ghost
    { ...store,
      versions: shifted(store.versions, lowest), card: store.card - cardLowest,
      tasks: tasks.keys().mapBy(slot =>
        { ...tasks.get(slot), checked: shifted(tasks.get(slot).checked, lowest) }),
      makers: makers.keys().mapBy(maker =>
        { ...makers.get(maker), brief: shifted(makers.get(maker).brief, lowest) }),
      fixes: fixes.keys().mapBy(fixId =>
        if (fixes.get(fixId).stage == Closed) fixes.get(fixId)
        else { ...fixes.get(fixId), base: shifted(fixes.get(fixId).base, lowest),
               trueBase: shifted(fixes.get(fixId).trueBase, lowest),
               cardBase: fixes.get(fixId).cardBase - cardLowest }),
      epochs: PERSISTENT.mapBy(actor => 0), nextMaker: 0, changes: 0,
      agentChanges: if (store.agentChanges > changeBound) changeBound + 1
                    else store.agentChanges,
      down: store.down.filter(actor => not(isMakerActor(actor)) or live.contains(actor)),
      ghost: { ...noGhost, endBroken: ghost.endBroken, lostUpdate: ghost.lostUpdate,
               takenUndone: ghost.takenUndone, refix: ghost.refix,
               escalatedNoPerson: ghost.escalatedNoPerson, topNoPerson: ghost.topNoPerson,
               passDefect: ghost.passDefect, askRaised: ghost.askRaised,
               restartedSlots: ghost.restartedSlots, keptChecks: ghost.keptChecks,
               restartedAssigned: ghost.restartedAssigned,
               keptCheckJudged: ghost.keptCheckJudged,
               keptFailSlots: ghost.keptFailSlots,
               keptFailAssigned: ghost.keptFailAssigned } }
}
