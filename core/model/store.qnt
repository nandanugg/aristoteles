// The store model: G3 of contract.qnt. An act takes effect
// only if it is fresh: every act that takes effect is applied to the state it was built on
// (no lost update, no second copy), by a token of the actor's current process, from the
// current page build. Small on purpose, for TLC (safety only; every reachable state).
// The protocol is abstracted to items with versions: any act's effect is "write these
// items" (an over-approximation of every act kind). Senders are honest but slow: an act is
// built on a VIEW of the store (any versions up to the current ones: every old view and
// more), names its basis from it (the versions of what it read), and the network may
// deliver it late, out of order, twice (a copy is the same act again, built on the same
// view). The page is one more stale viewer: the person's accept is built on the page's
// copy. A process whose actor was revived still runs and sends (its token has the old epoch).
// The property is semantic (ghosts the store never reads): an act that takes effect was
// built on a view equal to the store on every itemId it reads or writes; it was sent by
// the actor's current process; it came from the current page build; an accept is of a
// draft that waits for the person.
// The checks (protocol.qnt accept): basis (the versions an act read are the current ones: for a
// draft the compare-and-set of rebase), recheckBasis (the versions a recheck judged did not
// move), epochs, build, acceptCheck. G3 rests on one fact of the protocol, stated in the
// contract: every act reads what it writes (its basis or `legal` covers the items it
// changes). The model's acts keep it; the mutant storeBlind drops it and G3 breaks.
module store {
  import contract.* from "./contract"
  // Which checks the store makes; readsWrites is the protocol's fact (an act reads what it writes).
  const Checks: { basis: bool, recheckBasis: bool, epochs: bool, build: bool,
                  acceptCheck: bool, readsWrites: bool }
  pure val ITEMS = Set(0, 1)
  pure val TARGET_ITEM = 0       // what an accept changes
  pure val DRAFT_ITEM = 1        // holds the draft the person may accept
  pure val MAX_VERSION = 2       // a bound of the model
  type Versions = int -> int     // itemId -> version
  pure val VIEWS: Set[Versions] =
    tuples(0.to(MAX_VERSION), 0.to(MAX_VERSION)).map(pair => Map(0 -> pair._1, 1 -> pair._2))
  type ActKind = AgentAct | Recheck | PersonAccept
  // reads: what the act was built on (a recheck: what it judged); basis: their versions as
  // named in the act; writes: what it changes; epoch: its token's epoch; fromOldBuild: from an
  // old page build (it names no basis). Ghosts: seenStore, the versions the sender saw;
  // generation, the sender process's generation.
  type Act = { kind: ActKind, reads: Set[int], basis: Versions, writes: Set[int], epoch: int,
               fromOldBuild: bool, seenStore: Versions, generation: int }
  type Page = { versions: Versions, draftAtPerson: bool, oldBuild: bool }
  // epoch: the agent's current epoch (a revive raises it); page: the person's copy;
  // notFresh: ghost, an act that took effect was not fresh.
  type Store = { versions: Versions, draftAtPerson: bool, epoch: int, page: Page,
                 notFresh: bool }
  var store: Store

  action init = all {
    store' = { versions: Map(0 -> 0, 1 -> 0), draftAtPerson: false, epoch: 0,
               page: { versions: Map(0 -> 0, 1 -> 0), draftAtPerson: false, oldBuild: false },
               notFresh: false },
  }

  // The facts the store can read of an act at its append (contract.qnt Fresh). No act
  // carries an id: a second copy is refused because what it read has moved.
  def namesCurrentVersions(act: Act): bool =
    act.reads.forall(itemId => act.basis.get(itemId) == store.versions.get(itemId))
  def facts(act: Act): Fresh = {
    basisCurrent: act.kind == Recheck or act.fromOldBuild or namesCurrentVersions(act),
    judgedCurrent: act.kind != Recheck or namesCurrentVersions(act),
    firstTime: true,
    currentEpoch: act.kind == PersonAccept or act.epoch == store.epoch,
    currentBuild: not(act.fromOldBuild),
    waitsIfAccept: act.kind != PersonAccept or store.draftAtPerson,
  }
  def accepts(act: Act): bool =
    val fact = facts(act)
    (not(Checks.basis) or fact.basisCurrent)
      and (not(Checks.recheckBasis) or fact.judgedCurrent)
      and (not(Checks.epochs) or fact.currentEpoch)
      and (not(Checks.build) or fact.currentBuild)
      and (not(Checks.acceptCheck) or fact.waitsIfAccept)
  // The truth (ghosts): built on the current store for all it touches, by the current
  // process, from the current build, and an accept is of the draft that waits.
  def freshTruth(act: Act): bool =
    act.reads.union(act.writes).forall(itemId =>
      act.seenStore.get(itemId) == store.versions.get(itemId))
      and (act.kind == PersonAccept or act.generation == store.epoch)
      and not(act.fromOldBuild)
      and (act.kind != PersonAccept or store.draftAtPerson)
  // An act that would pass MAX_VERSION is not sent.
  def inBound(act: Act): bool =
    act.writes.forall(itemId => store.versions.get(itemId) < MAX_VERSION)
  action arrives(act: Act): bool = all {
    inBound(act),
    if (accepts(act))
      store' = { ...store,
                 versions: ITEMS.mapBy(itemId => store.versions.get(itemId)
                                               + if (act.writes.contains(itemId)) 1 else 0),
                 draftAtPerson: if (act.kind == PersonAccept) false else store.draftAtPerson,
                 notFresh: store.notFresh or not(freshTruth(act)) }
    else store' = store,
  }

  // ---- senders
  def notNewer(seen: Versions): bool =
    ITEMS.forall(itemId => seen.get(itemId) <= store.versions.get(itemId))
  // An agent act or a recheck, built on any old view, by the current or an old process,
  // delivered at any time, any number of times. It reads what it writes (readsWrites; off:
  // a blind write is possible).
  action agentSends = {
    nondet kind = Set(AgentAct, Recheck).oneOf()
    nondet seenVersions = VIEWS.filter(candidate => notNewer(candidate)).oneOf()
    nondet writes = (if (kind == Recheck) Set(Set()) else ITEMS.powerset().exclude(Set(Set())))
      .oneOf()
    nondet extraReads = ITEMS.powerset().oneOf()
    val reads = if (Checks.readsWrites) writes.union(extraReads) else extraReads
    nondet generation = 0.to(store.epoch).oneOf()
    arrives({ kind: kind, reads: reads, basis: seenVersions, writes: writes, epoch: generation,
              fromOldBuild: false, seenStore: seenVersions, generation: generation })
  }
  // The person accepts what the page shows: built on the page's copy, from the page's build.
  action personAccepts = all {
    store.page.draftAtPerson,
    arrives({ kind: PersonAccept, reads: ITEMS, basis: store.page.versions,
              writes: Set(TARGET_ITEM), epoch: 0, fromOldBuild: store.page.oldBuild,
              seenStore: store.page.versions, generation: 0 }),
  }
  // ---- the rest of the protocol, abstracted
  // A draft goes to the person or back (its content changes).
  action draftMoves = all {
    store.versions.get(DRAFT_ITEM) < MAX_VERSION,
    store' = { ...store, draftAtPerson: not(store.draftAtPerson),
               versions: store.versions.set(DRAFT_ITEM, store.versions.get(DRAFT_ITEM) + 1) },
  }
  // The agent is revived: a new epoch; the old process may still send.
  action revived = all { store.epoch < 1, store' = { ...store, epoch: store.epoch + 1 } }
  // ---- the page
  action pageRefreshes = store' = { ...store, page: { ...store.page, versions: store.versions,
                                                      draftAtPerson: store.draftAtPerson } }
  action newBuild = all { not(store.page.oldBuild),
                          store' = { ...store, page: { ...store.page, oldBuild: true } } }
  action pageReloads = all {
    store.page.oldBuild,
    store' = { ...store, page: { versions: store.versions, draftAtPerson: store.draftAtPerson,
                                 oldBuild: false } },
  }

  action step = any {
    agentSends, personAccepts, draftMoves, revived, pageRefreshes, newBuild, pageReloads,
  }
  // G3: every act that took effect was fresh (the truth, not the store's check).
  val G3Holds: bool = not(store.notFresh)
}

module storeCfgs {
  pure val ALL_CHECKS = { basis: true, recheckBasis: true, epochs: true, build: true,
                       acceptCheck: true, readsWrites: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and one check off
// each: G3Holds must break, unless another check covers it (README).
module storeFixed {
  import storeCfgs.*
  import store(Checks = ALL_CHECKS).* from "./store"
}
module storeNoBasis {
  import storeCfgs.*
  import store(Checks = { ...ALL_CHECKS, basis: false }).* from "./store"
}
module storeNoRecheckBasis {
  import storeCfgs.*
  import store(Checks = { ...ALL_CHECKS, recheckBasis: false }).* from "./store"
}
module storeNoEpochs {
  import storeCfgs.*
  import store(Checks = { ...ALL_CHECKS, epochs: false }).* from "./store"
}
module storeNoBuild {
  import storeCfgs.*
  import store(Checks = { ...ALL_CHECKS, build: false }).* from "./store"
}
module storeNoAcceptCheck {
  import storeCfgs.*
  import store(Checks = { ...ALL_CHECKS, acceptCheck: false }).* from "./store"
}
module storeBlind {
  import storeCfgs.*
  import store(Checks = { ...ALL_CHECKS, readsWrites: false }).* from "./store"
}
