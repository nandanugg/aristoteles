// The live terminal model (the person's page): tmux (the pane) -> the pump (the page
// server's control client that pipes the pane) -> the websocket -> the terminal drawn in
// the browser, and the keystrokes back: browser -> websocket -> page server -> pump -> tmux.
// Small on purpose, for TLC with liveness: no time, no protocol, only the screen and the
// keystrokes. The adversary may do any failure, in any order, until one weakly fair step ends
// it (adversaryDone, as terminals.qnt and browser.qnt); that step also brings tmux back up.
// The engine's parts recover, fairly. The person only types (not fair).
// The screen is a version counter; it changes a bounded number of times (MAX_SCREEN), so
// the claim is about the last screen.
// Requirements this model states: the page BUFFERS a keystroke typed while its socket is
// closed (pipeNoBuffer drops it); the browser keeps a keystroke until tmux applied it and
// sends it again after a reconnect (a lost ack is a browserResends step).
// The page server holds the keystroke queue and its marks (`sent`); the pump is only the
// transport to tmux. Forwarding is two steps with a crash between them; the server marks the
// id as sent BEFORE it writes (a crash between loses that keystroke, never repeats it).
// Claims: nothing applied twice, ever; a keystroke typed after the failures stopped (late)
// is applied. A keystroke caught mid-write by a failure may be lost.
// Outside the claim: the page server's own restart (it loses its queue and marks: the
// keystrokes in it are lost, and a re-sent one can then be applied again); not modelled.
// Not modelled: what is on the screen (only its version), time, several panes or pages.
module pipe {
  // reattach: the pump attaches again after a crash or another client's attach -d.
  // reconnect: the page opens its websocket again after a drop.
  // redraw: after a (re)connect or a reattach, or when the view went stale, the pump sends
  // tmux's whole screen. dedup: the server forwards an id once, by its marks.
  // markBefore: mark the id sent, then write (off: write, then mark).
  // buffer: the page keeps a keystroke typed while its socket is closed.
  const P: { reattach: bool, reconnect: bool, redraw: bool, dedup: bool,
             markBefore: bool, buffer: bool }

  pure val MAX_SCREEN = 2            // the screen versions 0 .. MAX_SCREEN
  pure val KEYS = Set(0, 1)          // the keystroke ids the person may type
  pure val MAX_COPIES = 2            // copies of one id on the wire, held, or delivered

  type Tmux = TmuxUp | TmuxDown
  type Pump = Attached | Detached | Crashed
  type Socket = Open | Closed
  type View = ViewCurrent | ViewStale | ViewClosed

  // screen: tmux's version; pumpCopy: the pump's; drawn: the page's.
  // typed: ids the person typed; late: those typed after the failures stopped;
  // unacked: ids the browser keeps until tmux applied them.
  // onWire: copies of an id on the websocket; held: in the server's queue; sent: the
  // server's marks; writing: ids between its two forwarding steps; delivered: applied by tmux.
  type Live = { tmux: Tmux, pump: Pump, socket: Socket, view: View,
                screen: int, pumpCopy: int, drawn: int,
                typed: Set[int], late: Set[int], unacked: Set[int],
                onWire: int -> int, held: int -> int, sent: Set[int], writing: Set[int],
                delivered: int -> int, adversaryDone: bool }
  var live: Live

  action init = all {
    live' = { tmux: TmuxUp, pump: Attached, socket: Open, view: ViewCurrent,
              screen: 0, pumpCopy: 0, drawn: 0,
              typed: Set(), late: Set(), unacked: Set(),
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
  // tmux goes down: the control client ends with it; a write in progress is lost.
  action tmuxGoesDown = all {
    live.tmux == TmuxUp,
    failure({ ...live, tmux: TmuxDown, writing: Set(),
              pump: if (live.pump == Attached) Detached else live.pump }),
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
    failure({ ...live, pump: Crashed, pumpCopy: 0, writing: Set() }),
  }
  // ... or another client's attach -d detaches it (its copy stays).
  action pumpDetached = all {
    live.pump == Attached,
    failure({ ...live, pump: Detached, writing: Set() }),
  }
  // The websocket drops: what was on it is lost; the page shows it closed.
  action socketDrops = all {
    live.socket == Open,
    failure({ ...live, socket: Closed, view: ViewClosed, onWire: noCopies }),
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
    nondet id = KEYS.exclude(live.typed).oneOf()
    val kept = live.socket == Open or P.buffer
    live' = { ...live, typed: live.typed.union(Set(id)),
              late: if (live.adversaryDone) live.late.union(Set(id)) else live.late,
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
  action serverReceives = {
    nondet id = KEYS.filter(k => live.socket == Open and live.onWire.get(k) > 0
                                 and live.held.get(k) < MAX_COPIES).oneOf()
    val seen = live.held.get(id) > 0 or live.writing.contains(id) or live.sent.contains(id)
    live' = { ...live, onWire: bump(live.onWire, id, -1),
              held: if (P.dedup and seen) live.held else bump(live.held, id, 1) }
  }
  // Forwarding, step 1. Mark before: take it from the queue, mark it sent. Mark after: write
  // it to tmux (it stays queued, unmarked).
  action forwardBegins = {
    nondet id = KEYS.filter(k => live.held.get(k) > 0 and not(live.writing.contains(k))
                                 and (not(P.dedup) or not(live.sent.contains(k)))
                                 and (P.markBefore or (pumpReaches
                                                       and live.delivered.get(k) < MAX_COPIES))
                           ).oneOf()
    live' = if (P.markBefore)
              { ...live, held: bump(live.held, id, -1), sent: live.sent.union(Set(id)),
                writing: live.writing.union(Set(id)) }
            else
              { ...live, delivered: bump(live.delivered, id, 1),
                writing: live.writing.union(Set(id)) }
  }
  // Forwarding, step 2. Mark before: the write to tmux. Mark after: the mark and the drop
  // from the queue. A failure between the steps clears `writing`.
  action forwardEnds = {
    nondet id = live.writing.filter(k => not(P.markBefore) or (pumpReaches
                                         and live.delivered.get(k) < MAX_COPIES)).oneOf()
    live' = if (P.markBefore)
              { ...live, delivered: bump(live.delivered, id, 1),
                writing: live.writing.exclude(Set(id)) }
            else
              { ...live, held: bump(live.held, id, -1), sent: live.sent.union(Set(id)),
                writing: live.writing.exclude(Set(id)) }
  }
  // The browser learns tmux applied the keystroke and stops keeping it.
  action browserAcks = {
    nondet id = live.unacked.filter(k => live.socket == Open
                                         and live.delivered.get(k) > 0).oneOf()
    live' = { ...live, unacked: live.unacked.exclude(Set(id)) }
  }

  action step = any {
    adversaryStops, tmuxGoesDown, tmuxComesUp, screenChanges, pumpCrashes, pumpDetached,
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
  // A keystroke typed after the failures stopped is in the end applied by tmux.
  temporal keystrokeReaches(id: int): bool =
    always(live.late.contains(id) implies eventually(live.delivered.get(id) > 0))
  temporal NoKeystrokeLost = Fairness implies all { keystrokeReaches(0), keystrokeReaches(1) }
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
  pure val FIXED_P = { reattach: true, reconnect: true, redraw: true, dedup: true,
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
