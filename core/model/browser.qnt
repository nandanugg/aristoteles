// The browser model (plan/model/DESIGN.md 10 and 14): G4 of contract.qnt, the person's
// channel. "Every act the person owes is, in the end, shown on the person's page", despite
// websocket drops, page server crashes, a new build (the page server restarts itself on it,
// and the open page is from the old build), a background tab (it has no timer of its own
// that refreshes: only what the engine pushes reaches it). Small on purpose, for TLC with
// liveness. The protocol is abstracted to "the person owes these acts", set and cleared at
// any time; the agents' terminal states and the escalation's state are inputs the engine
// gives the page, also set and cleared at any time (over-approximations). Fair: the engine
// parts only (the server restarts, the page reconnects or reloads, the server pushes);
// never the person. The page's safety at the store (an accept from a stale page is refused)
// is store.qnt's.
// Safety after a refresh: the dashboard the page draws from its copy is the dashboard of the
// store (no Working while the role only waits; Inactive only from the engine's signal: tmux,
// the usage-limit message, 1 minute of silence; the pipeline row shown exactly when an
// escalation waits for the person; the escalation card's status).
module browser {
  import contract.* from "./contract"
  // reconnect: the page reconnects its websocket after a drop. reloadOnBuild: a page of an
  // old build reloads itself when the server has a new one. push: the server pushes each
  // change to a connected page (off: only the person's refresh brings it).
  // poll: the page server reads the store again now and then (off: it hears changes only
  // through its watch, which can be lost, and reads the store only when it starts).
  const B: { reconnect: bool, reloadOnBuild: bool, push: bool, poll: bool }
  // One owed act: every act the person may owe is handled the same way (the check holds for
  // each act alone; two acts multiplied the states).
  pure val OWED = Set(0)
  type Esc = NoEsc | WaitReview     // in the pipeline or queued: as NoEsc for the row
  // What the store and the engine say: the person's owed acts; the role has a step of its
  // own; the engine's inactive signal for its terminal; the escalation's state.
  type Now = { owed: Set[int], own: bool, sig: bool, esc: Esc }
  type Srv = SrvUp | Restarting
  // page: the page's copy; ws: its websocket is connected; synced: the copy is the store's
  // since the last change (set by a refresh, a push, a reconnect, a reload).
  // srvNow: the page server's copy of the store; watch: its watch of the store works.
  type Bw = { now: Now, srvNow: Now, watch: bool, srv: Srv, srvBuild: int, ws: bool,
              pageBuild: int, page: Now, synced: bool, calm: bool }
  var b: Bw

  pure val NOW0: Now = { owed: Set(), own: false, sig: false, esc: NoEsc }
  action init = all {
    b' = { now: NOW0, srvNow: NOW0, watch: true, srv: SrvUp, srvBuild: 0, ws: true, pageBuild: 0, page: NOW0,
           synced: true, calm: false },
  }

  // ---- the dashboard the page draws from a copy (DESIGN.md 10)
  type Card = Working | Waiting | Inactive
  pure def cardOf(v: Now): Card = if (v.sig) Inactive else if (v.own) Working else Waiting
  pure def rowShown(v: Now): bool = v.esc == WaitReview

  // ---- the adversary: the protocol and the engine's inputs change at any time
  action nowChanges = {
    nondet o = OWED.powerset().oneOf()
    nondet own = Set(true, false).oneOf()
    nondet sig = Set(true, false).oneOf()
    nondet e = Set(NoEsc, WaitReview).oneOf()
    val n = { owed: o, own: own, sig: sig, esc: e }
    all { n != b.now, b' = { ...b, now: n, synced: false } }
  }
  // ---- faults: any number, until the run is calm (one weakly fair step); not fair. One
  // new build (srvBuild 0 to 1).
  action fault(nb: Bw): bool = all { not(b.calm), b' = nb }
  action calms = all { not(b.calm), b' = { ...b, calm: true } }
  action wsDrops = all { b.ws, fault({ ...b, ws: false }) }
  action serverCrashes = fault({ ...b, srv: Restarting, ws: false })
  // The page server's watch of the store is lost (it misses changes from now on).
  action watchLost = all { b.watch, fault({ ...b, watch: false }) }
  // A new build: the page server restarts itself on it; the open page is of the old build.
  action newBuild = all { b.srvBuild < 1,
                          fault({ ...b, srvBuild: b.srvBuild + 1, srv: Restarting, ws: false }) }
  // ---- the person (not fair): a refresh of the page
  action personRefreshes = all {
    b.srv == SrvUp,
    b' = { ...b, pageBuild: b.srvBuild, page: b.srvNow, ws: true, synced: b.srvNow == b.now },
  }
  // ---- the engine (fair)
  // The page server starts: it reads the store and watches it again.
  action serverRestarts = all {
    b.srv == Restarting, b' = { ...b, srv: SrvUp, srvNow: b.now, watch: true },
  }
  // The page server reads a change of the store: through its watch, or by a poll.
  action serverReads = all {
    b.srv == SrvUp, b.srvNow != b.now, b.watch or B.poll, b' = { ...b, srvNow: b.now },
  }
  // The page reconnects (the server sends the whole state on connect); a page of an old
  // build is refused by the new server and reloads (reloadOnBuild).
  action pageReconnects = all {
    not(b.ws), b.srv == SrvUp,
    if (b.pageBuild == b.srvBuild)
      all { B.reconnect, b' = { ...b, ws: true, page: b.srvNow, synced: b.srvNow == b.now } }
    else all { B.reloadOnBuild,
               b' = { ...b, ws: true, pageBuild: b.srvBuild, page: b.srvNow,
                      synced: b.srvNow == b.now } },
  }
  action serverPushes = all {
    B.push, b.ws, b.srv == SrvUp, b.pageBuild == b.srvBuild, b.page != b.srvNow,
    b' = { ...b, page: b.srvNow, synced: b.srvNow == b.now },
  }

  action step = any {
    nowChanges, calms, wsDrops, watchLost, serverReads, serverCrashes, newBuild, personRefreshes, serverRestarts,
    pageReconnects, serverPushes,
  }

  temporal Fairness = all {
    weakFair(serverRestarts, b), weakFair(pageReconnects, b), weakFair(serverPushes, b),
    weakFair(calms, b), weakFair(serverReads, b),
  }
  // G4 for each act the person may owe.
  temporal G4All = Fairness implies G4(b.now.owed.contains(0), b.page.owed.contains(0))
  // Safety after a refresh: the page draws the store's dashboard.
  val NoFalseWorking: bool = b.synced implies (cardOf(b.page) == Working implies b.now.own)
  val InactiveFromEngine: bool = b.synced implies (cardOf(b.page) == Inactive implies b.now.sig)
  val RowMatches: bool = b.synced implies (rowShown(b.page) iff b.now.esc == WaitReview)
  val EscMatches: bool = b.synced implies b.page.esc == b.now.esc
  val OwedShown: bool = b.synced implies b.page.owed == b.now.owed
  val DashAfterRefresh: bool =
    NoFalseWorking and InactiveFromEngine and RowMatches and EscMatches and OwedShown
}

module browserCfgs {
  pure val FIXED_B = { reconnect: true, reloadOnBuild: true, push: true, poll: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and the mutants where
// G4 must FAIL.
module browserFixed {
  import browserCfgs.*
  import browser(B = FIXED_B).* from "./browser"
}
module browserNoReconnect {
  import browserCfgs.*
  import browser(B = { ...FIXED_B, reconnect: false }).* from "./browser"
}
module browserNoReload {
  import browserCfgs.*
  import browser(B = { ...FIXED_B, reloadOnBuild: false }).* from "./browser"
}
module browserNoPush {
  import browserCfgs.*
  import browser(B = { ...FIXED_B, push: false }).* from "./browser"
}
module browserNoPoll {
  import browserCfgs.*
  import browser(B = { ...FIXED_B, poll: false }).* from "./browser"
}
