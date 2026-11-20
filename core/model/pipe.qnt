// The live terminal model (the person's page): tmux (the pane) -> the pump (the page
// server's control client that pipes the pane) -> the websocket -> the terminal drawn in
// the browser, and the keystrokes back: browser -> websocket -> page server -> pump -> tmux.
// Small on purpose, for TLC with liveness: no time, no protocol, only the screen and the
// keystrokes. The adversary may do any failure, in any order, until one weakly fair step ends
// it (adversaryDone, as terminals.qnt and browser.qnt); that step also brings tmux back up.
// The engine's parts recover, fairly. The person only types (not fair).
// The screen is a version counter; it changes a bounded number of times (MAX_SCREEN), so
// the claim is about the last screen.
// The browser retains its outbox across a server restart and automatic build reload.
// The server keeps a durable prefix of dispatched ids for this browser and target.
// A crash between committing the mark and writing may lose that key. A replay of a
// marked key is retired once its write is no longer in flight.
// Claims: the final screen is drawn; every key is delivered unless a failure interrupted
// its marked write; no key is applied twice.
// Outside the model: tab close or crash, power loss, screen contents, time, and
// interactions between independent browser/target streams.
module pipe {
  // reattach: the pump attaches again after a crash or another client's attach -d.
  // reconnect: the page opens its websocket again after a drop.
  // redraw: after a (re)connect or a reattach, or when the view went stale, the pump sends
  // tmux's whole screen. dedup: the server forwards an id once, by its marks.
  // markBefore: mark the id sent, then write (off: write, then mark).
  // buffer: the page keeps a keystroke typed while its socket is closed.
  // durable: the mark survives the page server restarting.
  // restore: an automatic reload adopts the persisted browser outbox.
  // witnesses: record diagnostic history used only by the simulator.
  const P: { restore: bool, witnesses: bool, durable: bool, reattach: bool,
             reconnect: bool, redraw: bool, dedup: bool,
             markBefore: bool, buffer: bool }

  pure val MAX_SCREEN = 2            // the screen versions 0 .. MAX_SCREEN
  pure val KEYS = Set(0, 1)          // the keystroke ids the person may type
  pure val MAX_COPIES = 2            // copies of one id on the wire, held, or delivered

  type Tmux = TmuxUp | TmuxDown
  type Pump = Attached | Detached | Crashed
  type Socket = Open | Closed
  type View = ViewCurrent | ViewStale | ViewClosed

  // screen: tmux's version; pumpCopy: the pump's; drawn: the page's.
  // typed: ids the person typed; interrupted: keys caught between mark and write;
  // unacked: the persistent browser outbox, adopted by a replacement page on reload.
  // receipts: replies on the current socket, lost when it closes.
  // onWire: copies of an id on the websocket; held: in the server's queue; sent: the
  // server's marks; writing: ids between its two forwarding steps; delivered: applied by tmux.
  // Witness history: bufferedAtRestart tracks unsent keys, restored tracks their adoption,
  // awaitingReplay tracks applied keys without a receipt at restart, and replayReceipts
  // tracks receipt generation on replay. sawGap tracks out-of-order arrival.
  // restarted enables the automatic build reload and is not witness history.
  type Live = { tmux: Tmux, pump: Pump, socket: Socket, view: View,
                screen: int, pumpCopy: int, drawn: int,
                typed: Set[int], interrupted: Set[int], unacked: Set[int],
                bufferedAtRestart: Set[int], restored: Set[int], awaitingReplay: Set[int],
                restarted: bool, sawGap: bool, replayReceipts: Set[int], receipts: Set[int],
                onWire: int -> int, held: int -> int, sent: Set[int], writing: Set[int],
                delivered: int -> int, adversaryDone: bool }
  var live: Live

  action init = all {
    live' = { tmux: TmuxUp, pump: Attached, socket: Open, view: ViewCurrent,
              screen: 0, pumpCopy: 0, drawn: 0,
              typed: Set(), interrupted: Set(), unacked: Set(),
              bufferedAtRestart: Set(), restored: Set(), awaitingReplay: Set(), restarted: false,
              sawGap: false, replayReceipts: Set(), receipts: Set(),
              onWire: KEYS.mapBy(id => 0), held: KEYS.mapBy(id => 0),
              sent: Set(), writing: Set(), delivered: KEYS.mapBy(id => 0),
              adversaryDone: false },
  }

  def bump(counts: int -> int, id: int, by: int): int -> int =
    counts.set(id, counts.get(id) + by)
  def noCopies: int -> int = KEYS.mapBy(id => 0)
  def pumpReaches: bool = live.pump == Attached and live.tmux == TmuxUp
  def nextScreen: int = if (live.screen < MAX_SCREEN) live.screen + 1 else live.screen
  // After a reattach with the socket open the page needs a full redraw.
  def viewAfterReattach: View = if (live.socket == Open) ViewStale else live.view

  // ---- the adversary: any failure, any number, any order, until adversaryDone
  action failure(after: Live): bool = all { not(live.adversaryDone), live' = after }
  // The failures stop, and tmux is up (with a new screen if it was down).
  action adversaryStops = all {
    not(live.adversaryDone),
    live' = { ...live, adversaryDone: true, tmux: TmuxUp,
              screen: if (live.tmux == TmuxDown) nextScreen else live.screen },
  }
  // Only a mark committed before an interrupted write permits loss.
  def interrupt(after: Live): Live = {
    ...after, writing: Set(),
    receipts: if (after.socket == Open)
              after.receipts.union(live.writing.intersect(live.sent).intersect(live.unacked))
              else after.receipts,
    interrupted: live.interrupted.union(live.writing.intersect(live.sent)),
  }

  // tmux goes down: the control client ends with it; a write in progress is lost.
  action tmuxGoesDown = all {
    live.tmux == TmuxUp,
    failure(interrupt({ ...live, tmux: TmuxDown,
              pump: if (live.pump == Attached) Detached else live.pump })),
  }
  action tmuxComesUp = all {
    live.tmux == TmuxDown,
    failure({ ...live, tmux: TmuxUp, screen: nextScreen }),
  }
  // The screen changes on its own.
  action screenChanges = all {
    live.tmux == TmuxUp, live.screen < MAX_SCREEN,
    failure({ ...live, screen: live.screen + 1 }),
  }
  // The pump crashes (its copy of the screen is gone) ...
  action pumpCrashes = all {
    live.pump == Attached,
    failure(interrupt({ ...live, pump: Crashed, pumpCopy: 0 })),
  }
  // ... or another client's attach -d detaches it (its copy stays).
  action pumpDetached = all {
    live.pump == Attached,
    failure(interrupt({ ...live, pump: Detached })),
  }
  // The websocket drops: what was on it is lost; the page shows it closed.
  action socketDrops = all {
    live.socket == Open,
    failure({ ...live, socket: Closed, view: ViewClosed, onWire: noCopies, receipts: Set() }),
  }
  // Restart drops the socket and volatile queue; the browser still has every unretired key.
  action serverRestarts = {
    val buffered = live.unacked.filter(id => live.delivered.get(id) == 0)
                              .exclude(live.sent)
    failure(interrupt({ ...live, socket: Closed, view: ViewClosed,
              onWire: noCopies, receipts: Set(), pump: Crashed, pumpCopy: 0, held: noCopies,
              sent: if (P.durable) live.sent else Set(),
              restarted: true,
              bufferedAtRestart: if (P.witnesses) live.bufferedAtRestart.union(buffered)
                                 else Set(),
              awaitingReplay: if (P.witnesses) live.awaitingReplay.union(
                live.unacked.filter(id => live.delivered.get(id) == 1)) else Set() }))
  }
  // An automatic build reload opens a new socket using the same browser stream and outbox.
  action pageReloads = all {
    live.restarted, live.socket == Open,
    {
      val adopted = if (P.restore) live.unacked else Set()
      failure({ ...live, socket: Closed, view: ViewClosed, onWire: noCopies, receipts: Set(),
                unacked: adopted, restored: live.restored.union(
                  adopted.intersect(live.bufferedAtRestart)
                    .filter(id => live.delivered.get(id) == 0)) })
    },
  }
  // The page's view goes stale (its drawn screen can no longer be trusted).
  action viewGoesStale = all {
    live.socket == Open, live.view == ViewCurrent,
    failure({ ...live, view: ViewStale }),
  }
  // The browser sends a keystroke again (the same id twice), e.g. its ack was lost.
  action browserResends = {
    nondet id = live.typed.filter(k => live.socket == Open
                                       and live.onWire.get(k) < MAX_COPIES).oneOf()
    failure({ ...live, onWire: bump(live.onWire, id, 1) })
  }

  // ---- the person (not fair): types a keystroke id once
  action personTypes = {
    nondet id = KEYS.exclude(live.typed)
      .filter(k => KEYS.filter(earlier => earlier < k).subseteq(live.typed)).oneOf()
    val kept = live.socket == Open or P.buffer
    live' = { ...live, typed: live.typed.union(Set(id)),
              unacked: if (kept) live.unacked.union(Set(id)) else live.unacked,
              onWire: if (live.socket == Open) bump(live.onWire, id, 1) else live.onWire }
  }

  // ---- the engine's recoveries (fair)
  action pumpReattaches = all {
    P.reattach, live.pump != Attached, live.tmux == TmuxUp,
    live' = { ...live, pump: Attached, view: viewAfterReattach },
  }
  action socketReconnects = all {
    P.reconnect, live.socket == Closed,
    live' = { ...live, socket: Open, view: ViewStale,
              onWire: KEYS.mapBy(id => if (live.unacked.contains(id)) 1 else 0) },
  }
  // The pump pipes the pane's output: its copy follows tmux's, and a page whose view is
  // current draws it at once.
  action pumpPipes = all {
    pumpReaches, live.pumpCopy != live.screen,
    live' = { ...live, pumpCopy: live.screen,
              drawn: if (live.socket == Open and live.view == ViewCurrent) live.screen
                     else live.drawn },
  }
  // The redraw: the pump sends tmux's current screen; the page draws it whole.
  action pageRedraws = all {
    P.redraw, pumpReaches, live.socket == Open, live.view == ViewStale,
    live' = { ...live, pumpCopy: live.screen, drawn: live.screen, view: ViewCurrent },
  }
  // A keystroke reaches the page server's queue (it needs the websocket, not the pump); with
  // dedup an id it holds, is writing, or marked sent is dropped.
  pure def earlierIds(id: int): Set[int] = KEYS.filter(earlier => earlier < id)
  action serverReceives = {
    nondet id = KEYS.filter(k => live.socket == Open and live.onWire.get(k) > 0
                                 and live.held.get(k) < MAX_COPIES).oneOf()
    val seen = live.held.get(id) > 0 or live.writing.contains(id) or live.sent.contains(id)
    val reply = live.sent.contains(id) and not(live.writing.contains(id))
      and live.unacked.contains(id)
    val gap = not(earlierIds(id).subseteq(live.sent))
      and earlierIds(id).exists(k => live.held.get(k) == 0 and not(live.writing.contains(k)))
    live' = { ...live, onWire: bump(live.onWire, id, -1),
              held: if (P.dedup and seen) live.held else bump(live.held, id, 1),
              receipts: if (reply) live.receipts.union(Set(id)) else live.receipts,
              replayReceipts: if (reply and live.awaitingReplay.contains(id))
                              live.replayReceipts.union(Set(id)) else live.replayReceipts,
              sawGap: live.sawGap or (P.witnesses and live.restarted and gap) }
  }
  // Forwarding, step 1. Mark before: take it from the queue, mark it sent. Mark after: write
  // it to tmux (it stays queued, unmarked).
  action forwardBegins = all {
    pumpReaches, live.writing == Set(),
    {
      nondet id = KEYS.filter(k => live.held.get(k) > 0
        and earlierIds(k).subseteq(live.sent)
        and (not(P.dedup) or not(live.sent.contains(k)))
        and live.delivered.get(k) < MAX_COPIES).oneOf()
      live' = if (P.markBefore)
                { ...live, held: bump(live.held, id, -1), sent: live.sent.union(Set(id)),
                  writing: Set(id) }
              else
                { ...live, delivered: bump(live.delivered, id, 1), writing: Set(id) }
    }
  }
  // Forwarding, step 2. Mark before: the write to tmux. Mark after: the mark and the drop
  // from the queue. A failure between the steps clears `writing`.
  action forwardEnds = {
    nondet id = live.writing.filter(k => not(P.markBefore) or (pumpReaches
                                         and live.delivered.get(k) < MAX_COPIES)).oneOf()
    val receipts = if (live.socket == Open and live.unacked.contains(id))
                   live.receipts.union(Set(id)) else live.receipts
    live' = if (P.markBefore)
              { ...live, receipts: receipts, delivered: bump(live.delivered, id, 1),
                writing: live.writing.exclude(Set(id)) }
            else
              { ...live, receipts: receipts, held: bump(live.held, id, -1),
                sent: live.sent.union(Set(id)), writing: live.writing.exclude(Set(id)) }
  }
  // The browser retires a committed id once its attempt has finished or been interrupted.
  // A receipt for an interrupted write does not assert that tmux applied the key.
  action browserAcks = {
    nondet id = live.receipts.intersect(live.unacked).oneOf()
    live' = { ...live, receipts: live.receipts.exclude(Set(id)),
              unacked: live.unacked.exclude(Set(id)) }
  }

  action step = any {
    adversaryStops, tmuxGoesDown, tmuxComesUp, screenChanges, pumpCrashes, pumpDetached,
    serverRestarts, pageReloads,
    socketDrops, viewGoesStale, browserResends,
    personTypes,
    pumpReattaches, socketReconnects, pumpPipes, pageRedraws, serverReceives,
    forwardBegins, forwardEnds, browserAcks,
  }

  // ---- properties
  // Fairness of the engine's parts only, and of the end of the failures; never the person.
  temporal Fairness = all {
    weakFair(adversaryStops, live), weakFair(pumpReattaches, live),
    weakFair(socketReconnects, live), weakFair(pumpPipes, live),
    weakFair(pageRedraws, live), weakFair(serverReceives, live),
    weakFair(forwardBegins, live), weakFair(forwardEnds, live), weakFair(browserAcks, live),
  }
  val shows: bool = live.tmux == TmuxUp and live.view == ViewCurrent
                    and live.drawn == live.screen
  // Once the failures stop the screen is fixed: in the end tmux is up and the page's terminal
  // is open, current, draws tmux's last screen, and stays so.
  temporal ShowsCurrentScreen = Fairness implies eventually(always(shows))
  // Every typed key reaches tmux unless a failure interrupted its marked attempt.
  temporal keystrokeReaches(id: int): bool =
    always(live.typed.contains(id) implies
      eventually(live.delivered.get(id) > 0 or live.interrupted.contains(id)))
  temporal NoKeystrokeLost = Fairness implies all { keystrokeReaches(0), keystrokeReaches(1) }
  val ReplayedAfterRestart: bool = live.awaitingReplay.exists(id =>
    live.onWire.get(id) > 0 and live.unacked.contains(id))
  val ReplayRetired: bool = live.replayReceipts.exists(id => not(live.unacked.contains(id)))
  val GapDrained: bool = live.sawGap and KEYS.forall(id => live.delivered.get(id) == 1)
  val Prefix: bool = live.sent.forall(id => earlierIds(id).subseteq(live.sent))
  val AtMostOneWriting: bool = live.writing.size() <= 1
  val WritingIsMarked: bool = live.writing.subseteq(live.sent)
  val InterruptedWrite: bool = live.interrupted.exists(id => live.delivered.get(id) == 0)
  val BufferedKeySurvivesReload: bool = live.restored.exists(id => live.delivered.get(id) == 1)
  // Safety: no keystroke id reaches tmux more than once.
  val NoKeystrokeTwice: bool = KEYS.forall(id => live.delivered.get(id) <= 1)

  // Witness for the simulator (it cannot check liveness): the failures stopped, the page does
  // not show tmux's screen, and no recovery step is enabled. Reachable exactly in the
  // liveness mutants.
  val recoveryEnabled: bool =
    (P.reattach and live.pump != Attached)
    or (P.reconnect and live.socket == Closed)
    or (P.redraw and live.view == ViewStale)
    or (pumpReaches and live.pumpCopy != live.screen)
  val NotStuck: bool = not(live.adversaryDone and not(shows) and not(recoveryEnabled))
}

module pipeCfgs {
  pure val FIXED_P = { restore: true, witnesses: false, durable: true, reattach: true,
                       reconnect: true, redraw: true, dedup: true,
                       markBefore: true, buffer: true }
}
// ---- instances (tlc.sh keeps only the one it checks). The design, and the mutants where
// one property must FAIL.
module pipeFixed {
  import pipeCfgs.*
  import pipe(P = FIXED_P).* from "./pipe"
}
module pipeNoReattach {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, reattach: false }).* from "./pipe"
}
module pipeNoReconnect {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, reconnect: false }).* from "./pipe"
}
module pipeNoRedraw {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, redraw: false }).* from "./pipe"
}
module pipeNoDedup {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, dedup: false }).* from "./pipe"
}
module pipeMarkAfter {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, markBefore: false }).* from "./pipe"
}
module pipeNoBuffer {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, buffer: false }).* from "./pipe"
}
module pipeVolatileMarks {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, durable: false }).* from "./pipe"
}
module pipeNoOutbox {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, restore: false }).* from "./pipe"
}
module pipeWitnesses {
  import pipeCfgs.*
  import pipe(P = { ...FIXED_P, witnesses: true }).* from "./pipe"
}
