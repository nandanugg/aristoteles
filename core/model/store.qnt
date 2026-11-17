// The store model (plan/model/DESIGN.md 7 and 14): G3 of contract.qnt. An act takes effect
// only if it is fresh, so every act that takes effect is applied once, atomically, to the
// state it was built on. Small on purpose, for TLC (safety only; every reachable state).
// The protocol is abstracted to items with versions: any act's effect is "write these
// items" (an over-approximation of every act kind). An ADVERSARY sends any act: built on any
// view (any versions, seen or not), with any token epoch up to the current one, any id (so
// twice, or a copy that arrives late), from an old page build, in any order. The page is
// one more stale viewer: the person's accept is built on the page's copy of the store.
// The store's checks (work.qnt accept): basis (the versions of what the act read are the
// current ones; for a draft this is the compare-and-set of rebase), recheckBasis (the
// versions a recheck judged did not move), dedup (an act id is taken once), epochs (a token
// of an older epoch is refused), build (an act of an old page build is refused),
// acceptCheck (an accept is taken only while the draft waits for the person).
// Left out: what an act means (core.qnt and work.qnt), liveness (the page's: browser.qnt).
module store {
  import contract.* from "./contract"
  const S: { basis: bool, recheckBasis: bool, dedup: bool, epochs: bool, build: bool,
             acceptCheck: bool }
  pure val ITEMS = Set(0, 1)     // item 1 holds the draft the person may accept
  pure val IDS = Set(0, 1, 2)
  pure val MAXV = 2
  pure val VIEWS: Set[int -> int] =
    tuples(0.to(MAXV), 0.to(MAXV)).map(p => Map(0 -> p._1, 1 -> p._2))
  type Kind = AgentAct | Recheck | PersonAccept
  // reads: the items the act was built on (a recheck: the items it judged); basis: their
  // versions as the sender saw them; writes: the items it changes.
  type Act = { kind: Kind, reads: Set[int], basis: int -> int, writes: Set[int], id: int,
               ep: int, oldBuild: bool }
  // ver, atPerson (the draft waits for the person), ep (the agent's current epoch), done
  // (the act ids taken), page (the person's copy and whether its build is old), bad (ghost:
  // an act that took effect broke G3).
  type St = { ver: int -> int, atPerson: bool, ep: int, done: Set[int],
              page: { ver: int -> int, atPerson: bool, old: bool }, bad: bool }
  var st: St

  action init = all {
    st' = { ver: Map(0 -> 0, 1 -> 0), atPerson: false, ep: 0, done: Set(),
            page: { ver: Map(0 -> 0, 1 -> 0), atPerson: false, old: false }, bad: false },
  }

  // What the store knows of an act at its append (contract.qnt Fresh).
  def facts(a: Act): Fresh = {
    basisCurrent: a.kind == Recheck or a.reads.forall(x => a.basis.get(x) == st.ver.get(x)),
    judgedCurrent: a.kind != Recheck or a.reads.forall(x => a.basis.get(x) == st.ver.get(x)),
    firstTime: not(st.done.contains(a.id)),
    currentEpoch: a.kind == PersonAccept or a.ep == st.ep,
    currentBuild: not(a.oldBuild),
    waitsIfAccept: a.kind != PersonAccept or st.atPerson,
  }
  // The store's check, each part behind its option.
  def accepts(a: Act): bool =
    val f = facts(a)
    (not(S.basis) or f.basisCurrent) and (not(S.recheckBasis) or f.judgedCurrent)
      and (not(S.dedup) or f.firstTime) and (not(S.epochs) or f.currentEpoch)
      and (not(S.build) or f.currentBuild) and (not(S.acceptCheck) or f.waitsIfAccept)
  // Versions stop at MAXV (a bound of the model: an act that would pass it is not sent).
  def inBound(a: Act): bool = a.writes.forall(x => st.ver.get(x) < MAXV)
  action arrives(a: Act): bool = all {
    inBound(a),
    if (accepts(a))
      st' = { ...st, ver: ITEMS.mapBy(x => st.ver.get(x) + if (a.writes.contains(x)) 1 else 0),
              done: st.done.union(Set(a.id)),
              atPerson: if (a.kind == PersonAccept) false else st.atPerson,
              bad: st.bad or not(G3(facts(a))) }
    else st' = st,
  }

  // ---- the adversary: any agent act or recheck, on any view, any id, any epoch
  action agentSends = {
    nondet k = Set(AgentAct, Recheck).oneOf()
    nondet reads = ITEMS.powerset().oneOf()
    nondet basis = VIEWS.oneOf()
    nondet writes = (if (k == Recheck) Set(Set()) else ITEMS.powerset().exclude(Set(Set())))
      .oneOf()
    nondet id = IDS.oneOf()
    nondet ep = 0.to(st.ep).oneOf()
    arrives({ kind: k, reads: reads, basis: basis, writes: writes, id: id, ep: ep,
             oldBuild: false })
  }
  // The person accepts what the page shows: built on the page's copy, from its build.
  action personAccepts = all {
    st.page.atPerson,
    nondet id = IDS.oneOf()
    arrives({ kind: PersonAccept, reads: Set(1), basis: st.page.ver, writes: Set(0), id: id,
             ep: 0, oldBuild: st.page.old }),
  }
  // ---- the rest of the protocol, abstracted: a draft goes to the person or back (its
  // content changes), the agent is revived (a new epoch).
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
  // G3: every act that took effect was fresh.
  val G3Holds: bool = not(st.bad)
}

module storeCfgs {
  pure val FIXED_S = { basis: true, recheckBasis: true, dedup: true, epochs: true, build: true,
                       acceptCheck: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and one check off each:
// G3Holds must break.
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
module storeNoDedup {
  import storeCfgs.*
  import store(S = { ...FIXED_S, dedup: false }).* from "./store"
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
