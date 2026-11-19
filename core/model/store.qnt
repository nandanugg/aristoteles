// The store model (plan/model/DESIGN.md 7 and 14): G3 of contract.qnt. An act takes effect
// only if it is fresh: every act that takes effect is applied to the state it was built on
// (no lost update, no second copy), by a token of the actor's current process, from the
// current page build. Small on purpose, for TLC (safety only; every reachable state).
// The protocol is abstracted to items with versions: any act's effect is "write these
// items" (an over-approximation of every act kind). Senders are honest but slow: an act is
// built on a SNAPSHOT of the store (any versions up to the current ones: every old view and
// more), names its basis from it (the versions of what it read), and the network may
// deliver it late, out of order, twice (a copy is the same act again, built on the same
// snapshot). The page is one more stale viewer: the person's accept is built on the page's
// copy. A process whose actor was revived still runs and sends (its token has the old epoch).
// The property is semantic (ghosts the store never reads): an act that takes effect was
// built on a snapshot equal to the store on every item it reads or writes; it was sent by
// the actor's current process; it came from the current page build; an accept is of a
// draft that waits for the person.
// The checks (protocol.qnt accept): basis (the versions an act read are the current ones: for a
// draft the compare-and-set of rebase), recheckBasis (the versions a recheck judged did not
// move), epochs, build, acceptCheck. G3 rests on one fact of the protocol, stated in the
// contract: every act reads what it writes (its basis or `legal` covers the items it
// changes; README "The small models" maps protocol.qnt's acts). The model's acts keep it; the
// mutant storeBlind drops it and G3 breaks.
module store {
  import contract.* from "./contract"
  const S: { basis: bool, recheckBasis: bool, epochs: bool, build: bool, acceptCheck: bool,
             readsWrites: bool }
  pure val ITEMS = Set(0, 1)     // item 1 holds the draft the person may accept
  pure val MAXV = 2
  pure val VIEWS: Set[int -> int] =
    tuples(0.to(MAXV), 0.to(MAXV)).map(p => Map(0 -> p._1, 1 -> p._2))
  type Kind = AgentAct | Recheck | PersonAccept
  // reads: what the act was built on (a recheck: what it judged); basis: their versions as
  // named in the act; writes: what it changes; ep: its token's epoch; oldBuild: from an old
  // page build (an old build names no basis: protocol.qnt basisCurrent). Ghosts: snap, the
  // store the sender saw; gen, the sender process's generation.
  type Act = { kind: Kind, reads: Set[int], basis: int -> int, writes: Set[int], ep: int,
               oldBuild: bool, snap: int -> int, gen: int }
  // ep: the agent's current epoch (a revive raises it); page: the person's copy and whether
  // its build is old; bad: ghost, an act that took effect was not fresh.
  type St = { ver: int -> int, atPerson: bool, ep: int,
              page: { ver: int -> int, atPerson: bool, old: bool }, bad: bool }
  var st: St

  action init = all {
    st' = { ver: Map(0 -> 0, 1 -> 0), atPerson: false, ep: 0,
            page: { ver: Map(0 -> 0, 1 -> 0), atPerson: false, old: false }, bad: false },
  }

  // The facts the store can read of an act at its append (contract.qnt Fresh), read
  // through the act's own fields. No act carries an id: a second copy is refused because
  // what it read has moved (protocol.qnt has no act ids either).
  def named(a: Act): bool = a.reads.forall(x => a.basis.get(x) == st.ver.get(x))
  def facts(a: Act): Fresh = {
    basisCurrent: a.kind == Recheck or a.oldBuild or named(a),
    judgedCurrent: a.kind != Recheck or named(a),
    firstTime: true,
    currentEpoch: a.kind == PersonAccept or a.ep == st.ep,
    currentBuild: not(a.oldBuild),
    waitsIfAccept: a.kind != PersonAccept or st.atPerson,
  }
  def accepts(a: Act): bool =
    val f = facts(a)
    (not(S.basis) or f.basisCurrent) and (not(S.recheckBasis) or f.judgedCurrent)
      and (not(S.epochs) or f.currentEpoch) and (not(S.build) or f.currentBuild)
      and (not(S.acceptCheck) or f.waitsIfAccept)
  // The truth (ghosts): the act was built on the current store for all it touches, by the
  // current process, from the current build, and an accept is of the draft that waits.
  def freshTruth(a: Act): bool =
    a.reads.union(a.writes).forall(x => a.snap.get(x) == st.ver.get(x))
      and (a.kind == PersonAccept or a.gen == st.ep) and not(a.oldBuild)
      and (a.kind != PersonAccept or st.atPerson)
  // Versions stop at MAXV (a bound of the model: an act that would pass it is not sent).
  def inBound(a: Act): bool = a.writes.forall(x => st.ver.get(x) < MAXV)
  action arrives(a: Act): bool = all {
    inBound(a),
    if (accepts(a))
      st' = { ...st, ver: ITEMS.mapBy(x => st.ver.get(x) + if (a.writes.contains(x)) 1 else 0),
              atPerson: if (a.kind == PersonAccept) false else st.atPerson,
              bad: st.bad or not(freshTruth(a)) }
    else st' = st,
  }

  // ---- senders: an agent act or a recheck, built on any old view, by the current or an
  // old process (its token carries its own epoch), delivered at any time, any number of
  // times. It reads what it writes (readsWrites; off: a blind write is possible).
  def older(v: int -> int): bool = ITEMS.forall(x => v.get(x) <= st.ver.get(x))
  action agentSends = {
    nondet k = Set(AgentAct, Recheck).oneOf()
    nondet snap = VIEWS.filter(v => older(v)).oneOf()
    nondet writes = (if (k == Recheck) Set(Set()) else ITEMS.powerset().exclude(Set(Set())))
      .oneOf()
    nondet extra = ITEMS.powerset().oneOf()
    val reads = if (S.readsWrites) writes.union(extra) else extra
    nondet gen = 0.to(st.ep).oneOf()
    arrives({ kind: k, reads: reads, basis: snap, writes: writes, ep: gen, oldBuild: false,
              snap: snap, gen: gen })
  }
  // The person accepts what the page shows: built on the page's copy (the draft, item 1,
  // and what it changes, item 0), from the page's build; any number of times.
  action personAccepts = all {
    st.page.atPerson,
    arrives({ kind: PersonAccept, reads: ITEMS, basis: st.page.ver, writes: Set(0), ep: 0,
              oldBuild: st.page.old, snap: st.page.ver, gen: 0 }),
  }
  // ---- the rest of the protocol, abstracted: a draft goes to the person or back (its
  // content changes), the agent is revived (a new epoch; the old process may still send).
  action draftMoves = all {
    st.ver.get(1) < MAXV,
    st' = { ...st, atPerson: not(st.atPerson), ver: st.ver.set(1, st.ver.get(1) + 1) },
  }
  action revived = all { st.ep < 1, st' = { ...st, ep: st.ep + 1 } }
  // ---- the page: refresh (a copy of the store), a new build (the open page is old), reload
  action pageRefreshes = st' = { ...st, page: { ...st.page, ver: st.ver, atPerson: st.atPerson } }
  action newBuild = all { not(st.page.old), st' = { ...st, page: { ...st.page, old: true } } }
  action pageReloads = all {
    st.page.old, st' = { ...st, page: { ver: st.ver, atPerson: st.atPerson, old: false } },
  }

  action step = any {
    agentSends, personAccepts, draftMoves, revived, pageRefreshes, newBuild, pageReloads,
  }
  // G3: every act that took effect was fresh (the truth, not the store's check).
  val G3Holds: bool = not(st.bad)
}

module storeCfgs {
  pure val FIXED_S = { basis: true, recheckBasis: true, epochs: true, build: true,
                       acceptCheck: true, readsWrites: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and one check off
// each: G3Holds must break, unless another check covers it (README).
module storeFixed {
  import storeCfgs.*
  import store(S = FIXED_S).* from "./store"
}
module storeNoBasis {
  import storeCfgs.*
  import store(S = { ...FIXED_S, basis: false }).* from "./store"
}
module storeNoRecheckBasis {
  import storeCfgs.*
  import store(S = { ...FIXED_S, recheckBasis: false }).* from "./store"
}
module storeNoEpochs {
  import storeCfgs.*
  import store(S = { ...FIXED_S, epochs: false }).* from "./store"
}
module storeNoBuild {
  import storeCfgs.*
  import store(S = { ...FIXED_S, build: false }).* from "./store"
}
module storeNoAcceptCheck {
  import storeCfgs.*
  import store(S = { ...FIXED_S, acceptCheck: false }).* from "./store"
}
module storeBlind {
  import storeCfgs.*
  import store(S = { ...FIXED_S, readsWrites: false }).* from "./store"
}
