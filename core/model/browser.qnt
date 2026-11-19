// The browser model: G4 of contract.qnt, the person's channel.
// "Every act the person owes is, in the end, shown on the person's page", despite websocket
// drops, page server crashes, a new build (the page server restarts on it, the open page is
// from the old build), and a background tab (no timer of its own: only pushes reach it).
// Small on purpose, for TLC with liveness. The protocol is abstracted to "the person owes
// these acts", set and cleared at any time; the agents' terminal states and the escalation's
// state are inputs the engine gives the page, also set and cleared at any time
// (over-approximations). Fair: the engine parts only (server restarts, page reconnects or
// reloads, server pushes); never the person. The store's refusal of a stale page's accept is
// store.qnt's.
// Safety after a refresh: the dashboard drawn from the page's copy is the store's dashboard
// (no Working while the role only waits; Inactive only from the engine's signal; the
// pipeline row shown exactly when an escalation waits for the person).
module browser {
  import contract.* from "./contract"

  // reconnect: the page reconnects its websocket after a drop.
  // reloadOnBuild: a page of an old build reloads when the server has a new one.
  // push: the server pushes each change to a connected page (off: only a refresh shows it).
  // poll: the page server rereads the store now and then (off: only its watch, which can
  // be lost, and its start read the store).
  const FEATURES: { reconnect: bool, reloadOnBuild: bool, push: bool, poll: bool }

  // One owed act: every act is handled the same way (two acts multiplied the states).
  pure val OWED_ACTS = Set(0)

  type Escalation = NoEscalation | WaitReview

  // What the store and the engine say: the acts the person owes; whether the role has a
  // step of its own; the engine's inactive signal for its terminal; the escalation's state.
  type StoreView = {
    owed: Set[int], roleHasOwnStep: bool, inactiveSignal: bool, escalation: Escalation
  }

  type ServerState = ServerUp | Restarting

  // pageCopy: the page's copy. connected: its websocket is connected. synced: the copy is
  // the store's since the last change. serverCopy: the page server's copy of the store.
  // watchWorks: the server's watch of the store works.
  // adversaryDone: false: failures may still happen; true: they stopped.
  type BrowserState = {
    storeNow: StoreView, serverCopy: StoreView, watchWorks: bool, server: ServerState,
    serverBuild: int, connected: bool, pageBuild: int, pageCopy: StoreView, synced: bool,
    adversaryDone: bool
  }
  var browserState: BrowserState

  pure val EMPTY_VIEW: StoreView =
    { owed: Set(), roleHasOwnStep: false, inactiveSignal: false, escalation: NoEscalation }

  action init = all {
    browserState' = {
      storeNow: EMPTY_VIEW, serverCopy: EMPTY_VIEW, watchWorks: true, server: ServerUp,
      serverBuild: 0, connected: true, pageBuild: 0, pageCopy: EMPTY_VIEW, synced: true,
      adversaryDone: false
    },
  }

  // The dashboard the page draws from a copy.
  type Card = Working | Waiting | Inactive
  pure def cardOf(view: StoreView): Card =
    if (view.inactiveSignal) Inactive else if (view.roleHasOwnStep) Working else Waiting
  pure def rowShown(view: StoreView): bool = view.escalation == WaitReview

  // The adversary: the protocol and the engine's inputs change at any time.
  action storeChanges = {
    nondet owed = OWED_ACTS.powerset().oneOf()
    nondet roleHasOwnStep = Set(true, false).oneOf()
    nondet inactiveSignal = Set(true, false).oneOf()
    nondet escalation = Set(NoEscalation, WaitReview).oneOf()
    val changed = {
      owed: owed, roleHasOwnStep: roleHasOwnStep, inactiveSignal: inactiveSignal,
      escalation: escalation
    }
    all {
      changed != browserState.storeNow,
      browserState' = { ...browserState, storeNow: changed, synced: false },
    }
  }

  // Faults: any number, until the adversary is done (one weakly fair step); not fair.
  // At most one new build (serverBuild 0 to 1).
  action fault(afterFault: BrowserState): bool =
    all { not(browserState.adversaryDone), browserState' = afterFault }
  action adversaryStops = all {
    not(browserState.adversaryDone),
    browserState' = { ...browserState, adversaryDone: true },
  }
  action websocketDrops = all {
    browserState.connected, fault({ ...browserState, connected: false })
  }
  action serverCrashes = fault({ ...browserState, server: Restarting, connected: false })
  // The page server's watch of the store is lost (it misses changes from now on).
  action watchLost = all {
    browserState.watchWorks, fault({ ...browserState, watchWorks: false })
  }
  // A new build: the page server restarts on it; the open page is of the old build.
  action newBuild = all {
    browserState.serverBuild < 1,
    fault({ ...browserState, serverBuild: browserState.serverBuild + 1, server: Restarting,
            connected: false }),
  }

  // The person (not fair): a refresh of the page.
  action personRefreshes = all {
    browserState.server == ServerUp,
    browserState' = { ...browserState, pageBuild: browserState.serverBuild,
                      pageCopy: browserState.serverCopy, connected: true,
                      synced: browserState.serverCopy == browserState.storeNow },
  }

  // The engine (fair). The page server starts: it reads the store and watches it again.
  action serverRestarts = all {
    browserState.server == Restarting,
    browserState' = { ...browserState, server: ServerUp, serverCopy: browserState.storeNow,
                      watchWorks: true },
  }
  // The page server reads a change of the store: through its watch, or by a poll.
  action serverReads = all {
    browserState.server == ServerUp, browserState.serverCopy != browserState.storeNow,
    browserState.watchWorks or FEATURES.poll,
    browserState' = { ...browserState, serverCopy: browserState.storeNow },
  }
  // The page reconnects (the server sends the whole state on connect); a page of an old
  // build is refused by the new server and reloads (reloadOnBuild).
  action pageReconnects = all {
    not(browserState.connected), browserState.server == ServerUp,
    val synced = browserState.serverCopy == browserState.storeNow
    if (browserState.pageBuild == browserState.serverBuild)
      all {
        FEATURES.reconnect,
        browserState' = { ...browserState, connected: true, pageCopy: browserState.serverCopy,
                          synced: synced },
      }
    else
      all {
        FEATURES.reloadOnBuild,
        browserState' = { ...browserState, connected: true, pageBuild: browserState.serverBuild,
                          pageCopy: browserState.serverCopy, synced: synced },
      },
  }
  action serverPushes = all {
    FEATURES.push, browserState.connected, browserState.server == ServerUp,
    browserState.pageBuild == browserState.serverBuild,
    browserState.pageCopy != browserState.serverCopy,
    browserState' = { ...browserState, pageCopy: browserState.serverCopy,
                      synced: browserState.serverCopy == browserState.storeNow },
  }

  action step = any {
    storeChanges, adversaryStops, websocketDrops, watchLost, serverReads, serverCrashes,
    newBuild, personRefreshes, serverRestarts, pageReconnects, serverPushes,
  }

  temporal Fairness = all {
    weakFair(serverRestarts, browserState), weakFair(pageReconnects, browserState),
    weakFair(serverPushes, browserState), weakFair(adversaryStops, browserState),
    weakFair(serverReads, browserState),
  }

  // G4 for each act the person may owe: it ends up shown on the page.
  temporal G4All = Fairness implies
    G4(browserState.storeNow.owed.contains(0), browserState.pageCopy.owed.contains(0))

  // After a refresh, the page's card is not Working unless the role has a step of its own.
  val NoFalseWorking: bool =
    browserState.synced implies
      (cardOf(browserState.pageCopy) == Working implies browserState.storeNow.roleHasOwnStep)
  // After a refresh, the page shows Inactive only on the engine's signal.
  val InactiveFromEngine: bool =
    browserState.synced implies
      (cardOf(browserState.pageCopy) == Inactive implies browserState.storeNow.inactiveSignal)
  // After a refresh, the pipeline row is shown exactly when an escalation waits.
  val RowMatches: bool =
    browserState.synced implies
      (rowShown(browserState.pageCopy) iff browserState.storeNow.escalation == WaitReview)
  // After a refresh, the escalation card shows the store's escalation status.
  val EscalationMatches: bool =
    browserState.synced implies
      browserState.pageCopy.escalation == browserState.storeNow.escalation
  // After a refresh, the page shows exactly the acts the person owes.
  val OwedShown: bool =
    browserState.synced implies browserState.pageCopy.owed == browserState.storeNow.owed
  // All of the above: the page draws the store's dashboard.
  val DashAfterRefresh: bool =
    NoFalseWorking and InactiveFromEngine and RowMatches and EscalationMatches and OwedShown
}

module browserCfgs {
  pure val FIXED_FEATURES = { reconnect: true, reloadOnBuild: true, push: true, poll: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and the mutants where
// G4 must FAIL.
module browserFixed {
  import browserCfgs.*
  import browser(FEATURES = FIXED_FEATURES).* from "./browser"
}
module browserNoReconnect {
  import browserCfgs.*
  import browser(FEATURES = { ...FIXED_FEATURES, reconnect: false }).* from "./browser"
}
module browserNoReload {
  import browserCfgs.*
  import browser(FEATURES = { ...FIXED_FEATURES, reloadOnBuild: false }).* from "./browser"
}
module browserNoPush {
  import browserCfgs.*
  import browser(FEATURES = { ...FIXED_FEATURES, push: false }).* from "./browser"
}
module browserNoPoll {
  import browserCfgs.*
  import browser(FEATURES = { ...FIXED_FEATURES, poll: false }).* from "./browser"
}
