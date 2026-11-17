// The terminals model (plan/model/DESIGN.md 8 and 14): G1 of contract.qnt.
// "An agent that owes work is, in the end, alive and hears its step", under process ends,
// tmux faults, reboots, usage limits, stops at the prompt and crashes of the engine. Small
// on purpose, for TLC with liveness: no time, no page, no store but the records the engine
// reads. Aristoteles is an ARBITRARY ADVERSARY here: each agent's `owes` bit may be set or
// cleared at any time, and it may ask for a send at any time. The model assumes nothing
// about the protocol.
// What it has:
// - the host's pane, in the person's own tmux. The engine never revives it: its end is
//   recorded (hostWatched) and the person is shown it; the person starts it again;
// - the role's and the pipeline role's panes, in the agents' tmux server; the role's maker,
//   a subagent inside the role's process (it ends with it);
// - the agents' server: killed (its panes end), its socket lost (the panes run on, no client
//   reaches them), recreated by the watcher; a reboot also ends the host's pane and the
//   engine;
// - the pump (a control client owned by the page server): attached, about to attach again,
//   or off (detached by another client's attach -d, without pumpReattach); it hears a pane
//   end only while attached; with listOnAttach it lists the panes when it attaches;
// - a CLI that stops at its prompt (it ended its turn without going back to its wait, or
//   the person interrupted it): with idleSeen the CLI's own hook records an exit;
// - the store's records the engine reads: `down` (an exit was recorded) and the outbox;
// - the outbox: the watcher records a revive (or a send) in the store, then acts, then
//   marks it done; it can crash between any two of these. A revive's act leaves a mark in
//   the world (a pane of that revive in the current server): with `evidence` the watcher
//   looks for it before acting again. A send (typed text) leaves no mark to read: a send is
//   at least once (the agents hear their steps through the store; a send is a nudge);
// - the usage limit: a limited process hears nothing; the limit lifts (fair);
// - each agents' pane's input line: the person may type into it (promptArg off: a typed
//   prompt merges with it).
// Left out: process ids and epochs (one process per agent; a revived process replaces the
// old one, whose acts the store refuses: work.qnt), the context of a resumed process (it
// does not change whether it hears: the prompt tells it to wait), time.
module terminals {
  import contract.* from "./contract"
  // listOnAttach, pumpReattach, promptArg, hostWatched, idleSeen: as in work.qnt. outbox:
  // the watcher's record in the store is acted on again after its crash (off: it acts from
  // memory after the record). evidence: before acting again on a revive, the watcher looks
  // for the pane of that revive. maxFaults: the faults of a run (process ends, stops at the
  // prompt, tmux faults, usage limits, engine crashes).
  const T: { listOnAttach: bool, pumpReattach: bool, promptArg: bool, outbox: bool,
             evidence: bool, hostWatched: bool, idleSeen: bool, maxFaults: int }

  pure val HOST = 0
  pure val ROLE = 1
  pure val PIPE = 2
  pure val MAKER = 3
  pure val AGENTS = Set(HOST, ROLE, PIPE, MAKER)
  pure val PANES = Set(ROLE, PIPE)       // panes in the agents' server
  pure val SEND = 9                      // the outbox op of the send (revives: ROLE, PIPE)
  pure val OPS = Set(ROLE, PIPE, SEND)
  // A process: none; started with its prompt typed and not yet read (promptArg off); its
  // prompt merged with the person's typing (it never learns to wait); running its wait;
  // stopped by the usage limit; stopped at its prompt.
  type PS = Down | Starting | Confused | Hears | Limited | Idle
  type Pump = Attached | Again | Off
  type Line = Empty | Typing
  type Box = NoBox | Recorded
  // owes: the adversary's bits. old: panes of an agents' server whose socket was lost.
  // noticed: ends the engine heard and has not yet recorded (in its memory). down: the
  // store's exit records. box: the outbox records (ROLE, PIPE: revives; SEND). acting: ops
  // the watcher acted on and has not yet marked (its memory). tag: revives whose pane is in
  // the current server (the evidence). sendTo: the send's target (-1: none). mem: outbox
  // off, ops to act on from memory. sent, dupAct: ghosts (the send was acted; a revive was
  // acted while the pane of its first act still ran).
  type W = { owes: Set[int], ps: int -> PS, old: Set[int], srvUp: bool, pump: Pump,
             noticed: Set[int], down: Set[int], box: int -> Box, acting: Set[int],
             tag: Set[int], sendTo: int, mem: Set[int], line: int -> Line, faults: int,
             sent: bool, dupAct: bool }
  var w: W

  action init = all {
    w' = { owes: Set(), ps: AGENTS.mapBy(k => Hears), old: Set(), srvUp: true,
           pump: Attached, noticed: Set(), down: Set(), box: OPS.mapBy(k => NoBox),
           acting: Set(), tag: Set(), sendTo: -1, mem: Set(), line: PANES.mapBy(k => Empty),
           faults: 0, sent: false, dupAct: false },
  }

  def up(k: int): bool = w.ps.get(k) != Down
  // The role's maker lives inside the role's process and its usage limit.
  def hears(k: int): bool =
    if (k == MAKER) w.ps.get(MAKER) == Hears and w.ps.get(ROLE) == Hears
    else w.ps.get(k) == Hears
  // The maker's step after its end: the role is told to resume it (work.qnt ResumeOb).
  def heardBy(k: int): bool =
    hears(k) or (k == MAKER and w.down.contains(MAKER) and hears(ROLE))
  // The person owes the host's revival: its end is recorded, so the person is shown it.
  def personOwes(k: int): bool = k == HOST and not(up(HOST)) and w.down.contains(HOST)
  // The pump hears a pane end while attached to the server that has the pane.
  def heard(k: int): bool = PANES.contains(k) and w.pump == Attached and not(w.old.contains(k))
  action fault(nw: W): bool = all { w.faults < T.maxFaults, w' = { ...nw, faults: w.faults + 1 } }
  def ended(ps: int -> PS, k: int): int -> PS =
    if (k == ROLE) ps.set(ROLE, Down).set(MAKER, Down) else ps.set(k, Down)

  // ---- the adversary (aristoteles): any agent owes work, or stops owing it, at any time;
  // it asks for a send (a text for an agent's terminal), recorded in the store first.
  action owesChanges = {
    nondet k = AGENTS.oneOf()
    w' = { ...w, owes: if (w.owes.contains(k)) w.owes.exclude(Set(k)) else w.owes.union(Set(k)) }
  }
  action sendRecorded = all {
    w.sendTo == -1, w.box.get(SEND) == NoBox, not(w.mem.contains(SEND)),
    nondet k = Set(HOST, ROLE, PIPE).oneOf()
    w' = { ...w, sendTo: k, sent: false,
           box: if (T.outbox) w.box.set(SEND, Recorded) else w.box,
           mem: if (T.outbox) w.mem else w.mem.union(Set(SEND)) },
  }

  // ---- faults (at most maxFaults in a run; not fair)
  // A process ends. The pump hears a pane's end while attached; the hook inside the role
  // records its maker's end; the host's end is seen with hostWatched. The role's end is
  // its maker's end.
  action crash = {
    nondet k = AGENTS.filter(j => up(j)).oneOf()
    fault({ ...w, ps: ended(w.ps, k), old: w.old.exclude(Set(k)), tag: w.tag.exclude(Set(k)),
            noticed: if (heard(k) or (k == HOST and T.hostWatched)) w.noticed.union(Set(k))
                     else w.noticed,
            down: if (k == MAKER) w.down.union(Set(MAKER)) else w.down })
  }
  // A CLI stops at its prompt: its turn ended without its wait, or the person interrupted it.
  action stopsAtPrompt = {
    nondet k = AGENTS.filter(j => w.ps.get(j) == Hears).oneOf()
    fault({ ...w, ps: w.ps.set(k, Idle) })
  }
  // The agents' server is killed: its panes end, the pump's client with it (no end heard).
  action serverKilled = all {
    w.srvUp,
    val kept = w.old.union(Set(HOST)).union(if (w.old.contains(ROLE)) Set(MAKER) else Set())
    fault({ ...w, ps: AGENTS.mapBy(k => if (kept.contains(k)) w.ps.get(k) else Down),
            srvUp: false, pump: if (w.pump == Off) Off else Again, tag: Set() }),
  }
  // A reboot: the agents' server, the person's tmux (the host's pane) and the engine end.
  // The engine starts again: its memory is gone; it looks at the host's pane.
  action reboot =
    fault({ ...w, ps: AGENTS.mapBy(k => Down), old: Set(), srvUp: false, pump: Again,
            noticed: hostAtStart(AGENTS.mapBy(k => Down)), mem: Set(), acting: Set(),
            tag: Set() })
  // The socket of the agents' server is lost: its panes run on (they still hear: the
  // store is not tmux), but no client reaches them; the pump's client ends.
  action socketLost = all {
    w.srvUp,
    fault({ ...w, old: w.old.union(PANES.filter(k => up(k))), srvUp: false,
            pump: if (w.pump == Off) Off else Again, tag: Set() }),
  }
  // Another client's attach -d detaches the pump; its owner attaches again (pumpReattach).
  action pumpStolen = all {
    w.pump == Attached,
    fault({ ...w, pump: if (T.pumpReattach) Again else Off }),
  }
  // The page server restarts: its pump closes and the new one attaches; the ends it had
  // heard and not yet recorded are gone. At its start it looks at the host's pane (in the
  // person's tmux; with hostWatched): the pump's listing does not cover it (TLC found the
  // host's end lost by a restart between the end and its record).
  def hostAtStart(ps: int -> PS): Set[int] =
    if (T.hostWatched and ps.get(HOST) == Down and not(w.down.contains(HOST))) Set(HOST)
    else Set()
  action pageServerRestarts = fault({ ...w, pump: Again, noticed: hostAtStart(w.ps) })
  // The watcher crashes and starts again: what it held in memory is gone (with the outbox,
  // its records are in the store).
  action watcherCrashes = fault({ ...w, mem: Set(), acting: Set() })
  // An agent's AI CLI hits its usage limit: it shows the message and stops.
  action hitsLimit = {
    nondet k = Set(HOST, ROLE, PIPE).filter(j => w.ps.get(j) == Hears).oneOf()
    fault({ ...w, ps: w.ps.set(k, Limited) })
  }

  // ---- the person (not fair)
  // Only with promptArg off: else nothing the engine does reads the line.
  action personTypes = all {
    not(T.promptArg),
    nondet k = PANES.oneOf()
    w' = { ...w, line: w.line.set(k, if (w.line.get(k) == Empty) Typing else Empty) },
  }
  // The person starts the host again in its own tmux (the engine does not revive it).
  action personRevivesHost = all {
    not(up(HOST)),
    w' = { ...w, ps: w.ps.set(HOST, Hears), down: w.down.exclude(Set(HOST)),
           noticed: w.noticed.exclude(Set(HOST)) },
  }
  // The role resumes its maker (an agent's act: not fair here; G1 counts the role hearing
  // the resume as the maker's step heard). Only the role's current process: one whose
  // revive is recorded is old (the store refuses its acts).
  action roleResumesMaker = all {
    not(up(MAKER)), w.down.contains(MAKER), hears(ROLE),
    w.box.get(ROLE) != Recorded, not(w.mem.contains(ROLE)),
    w' = { ...w, ps: w.ps.set(MAKER, Hears), down: w.down.exclude(Set(MAKER)) },
  }

  // ---- the engine (fair)
  // The pump (or the host's watcher) records an end it heard: an exit in the store. The
  // role's exit is its maker's exit too. With idleSeen the CLI's hook records the stop at
  // the prompt as an exit, and the engine ends that CLI.
  action report = {
    nondet k = w.noticed.oneOf()
    val gone = if (k == ROLE) Set(ROLE, MAKER) else Set(k)
    w' = { ...w, noticed: w.noticed.exclude(Set(k)),
           down: if (w.down.contains(k)) w.down else w.down.union(gone) }
  }
  action idleHook = all {
    T.idleSeen,
    nondet k = AGENTS.filter(j => w.ps.get(j) == Idle).oneOf()
    w' = { ...w, ps: ended(w.ps, k), tag: w.tag.exclude(Set(k)), old: w.old.exclude(Set(k)),
           down: w.down.union(if (k == ROLE) Set(ROLE, MAKER) else Set(k)) },
  }
  action engineReports = any { report, idleHook }
  // The watcher revives a role whose exit is recorded: it records the revive in the store
  // (the store holds the role as alive again, and the role's makers as ended: TLC found a
  // maker resumed by the old role, on a lost socket, between the role's exit and its
  // revive, that died unseen), then acts. Outbox off: it acts from memory.
  action recordRevive = {
    nondet k = PANES.filter(j => w.down.contains(j) and w.box.get(j) == NoBox
                                 and not(w.mem.contains(j))).oneOf()
    w' = { ...w, down: w.down.exclude(Set(k)).union(if (k == ROLE) Set(MAKER) else Set()),
           box: if (T.outbox) w.box.set(k, Recorded) else w.box,
           mem: if (T.outbox) w.mem else w.mem.union(Set(k)) }
  }
  // The revive's act: a new process in the current server, its prompt an argument of the
  // CLI (promptArg) or typed into its input line (merged if the person is typing). A new
  // role process has no maker (the old one is held as ended).
  def spawned(k: int): PS =
    if (T.promptArg) Hears else if (w.line.get(k) == Typing) Confused else Starting
  // A send reaches its target: the target's CLI waits for input in a pane a client reaches.
  def canAct(op: int): bool =
    if (op == SEND) w.sendTo >= 0 and hears(w.sendTo)
                    and (w.sendTo == HOST or (w.srvUp and not(w.old.contains(w.sendTo))))
    else w.srvUp
  def acted(op: int): W =
    if (op == SEND) { ...w, sent: true }
    else { ...w, ps: if (op == ROLE) w.ps.set(ROLE, spawned(ROLE)).set(MAKER, Down)
                     else w.ps.set(op, spawned(op)),
           old: w.old.exclude(Set(op)), tag: w.tag.union(Set(op)),
           dupAct: w.dupAct or w.tag.contains(op) }
  // Per op: act on a record (with evidence, only if the pane of an earlier act of it is
  // not there), mark it done after its own act, or on finding that pane after a crash.
  // Outbox off: act on an op held in memory. Fair per op: the adversary's sends must not
  // starve a revive.
  action outboxOp(op: int): bool = any {
    all { w.box.get(op) == Recorded, not(w.acting.contains(op)),
          not(T.evidence and w.tag.contains(op)), canAct(op),
          w' = { ...acted(op), acting: w.acting.union(Set(op)) } },
    all { w.acting.contains(op),
          w' = { ...w, box: w.box.set(op, NoBox), acting: w.acting.exclude(Set(op)),
                 tag: w.tag.exclude(Set(op)), sendTo: if (op == SEND) -1 else w.sendTo } },
    all { T.evidence, w.box.get(op) == Recorded, not(w.acting.contains(op)),
          w.tag.contains(op),
          w' = { ...w, box: w.box.set(op, NoBox), tag: w.tag.exclude(Set(op)) } },
    all { w.mem.contains(op), canAct(op),
          w' = { ...acted(op), mem: w.mem.exclude(Set(op)),
                 sendTo: if (op == SEND) -1 else w.sendTo } },
  }
  // A typed prompt (promptArg off) is read: the process waits for its steps.
  action promptRead = {
    nondet k = PANES.filter(j => w.ps.get(j) == Starting).oneOf()
    w' = { ...w, ps: w.ps.set(k, Hears) }
  }
  action limitLifts = {
    nondet k = AGENTS.filter(j => w.ps.get(j) == Limited).oneOf()
    w' = { ...w, ps: w.ps.set(k, Hears) }
  }
  action serverRecreated = all { not(w.srvUp), w' = { ...w, srvUp: true } }
  // The pump attaches again. With listOnAttach it lists the panes: a role with no pane in
  // this server (it ended unheard, or it runs on a lost server), with no exit recorded and
  // no revive about to act, is an end heard now.
  action pumpAttaches = all {
    w.pump == Again, w.srvUp,
    val pending = PANES.filter(k => w.box.get(k) == Recorded and not(w.acting.contains(k))
                                    and not(w.tag.contains(k))).union(w.mem)
    val missing = PANES.filter(k => (not(up(k)) or w.old.contains(k))
                                    and not(w.down.contains(k)) and not(pending.contains(k)))
    w' = { ...w, pump: Attached,
           noticed: if (T.listOnAttach) w.noticed.union(missing) else w.noticed },
  }

  action step = any {
    owesChanges, sendRecorded,
    crash, stopsAtPrompt, serverKilled, reboot, socketLost, pumpStolen, pageServerRestarts,
    watcherCrashes, hitsLimit,
    personTypes, personRevivesHost, roleResumesMaker,
    engineReports, recordRevive, outboxOp(ROLE), outboxOp(PIPE), outboxOp(SEND), promptRead,
    limitLifts, serverRecreated, pumpAttaches,
  }

  // ---- properties
  // Fairness of the engine parts only: the pump and the hooks record what they heard, the
  // pump attaches again, the watcher records, acts and marks, and recreates the server; a
  // typed prompt is read; the usage limit lifts. Agents, the person, the adversary and
  // faults are not fair.
  temporal Fairness = all {
    weakFair(engineReports, w), weakFair(recordRevive, w), weakFair(outboxOp(ROLE), w),
    weakFair(outboxOp(PIPE), w), weakFair(outboxOp(SEND), w), weakFair(promptRead, w),
    weakFair(limitLifts, w), weakFair(serverRecreated, w), weakFair(pumpAttaches, w),
  }
  // G1 for each agent (contract.qnt). The host: or the person owes its revival.
  temporal G1Host = G1(w.owes.contains(HOST), heardBy(HOST), personOwes(HOST))
  temporal G1Role = G1(w.owes.contains(ROLE), heardBy(ROLE), false)
  temporal G1Pipe = G1(w.owes.contains(PIPE), heardBy(PIPE), false)
  temporal G1Maker = G1(w.owes.contains(MAKER), heardBy(MAKER), false)
  temporal G1All = Fairness implies all { G1Host, G1Role, G1Pipe, G1Maker }
  // A recorded send is acted on in the end (or its target is the host and the person owes
  // its revival): the same form as G1.
  temporal SendActed = G1(w.sendTo >= 0 and not(w.sent), false,
                          w.sendTo == HOST and personOwes(HOST))
  temporal SendDone = Fairness implies SendActed
  // Safety: a revive is acted on once per record while the pane of its act runs (with a
  // kill or a reboot between, acting again is right: that pane is gone).
  val ExactlyOnce: bool = not(w.dupAct)
  // Sanity of the model: a pane in a lost server is up; a maker runs only in a running role.
  val Sane: bool = w.old.forall(k => up(k)) and (up(MAKER) implies up(ROLE))
}

// The design: every check on.
module termCfgs {
  pure val FIXED_T = { listOnAttach: true, pumpReattach: true, promptArg: true, outbox: true,
                       evidence: true, hostWatched: true, idleSeen: true, maxFaults: 2 }
}
// ---- instances (tlc.sh keeps only the one it checks: quint's TLA+ export of a file with
// many instances overflows). The design, and the sanity mutants where G1 must FAIL.
module termFixed {
  import termCfgs.*
  import terminals(T = FIXED_T).* from "./terminals"
}
module termFixed3 {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, maxFaults: 3 }).* from "./terminals"
}
module termNoList {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, listOnAttach: false }).* from "./terminals"
}
module termNoReattach {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, pumpReattach: false }).* from "./terminals"
}
module termNoPromptArg {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, promptArg: false }).* from "./terminals"
}
module termNoOutbox {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, outbox: false }).* from "./terminals"
}
module termNoEvidence {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, evidence: false }).* from "./terminals"
}
module termNoHostWatch {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, hostWatched: false }).* from "./terminals"
}
module termNoIdleSeen {
  import termCfgs.*
  import terminals(T = { ...FIXED_T, idleSeen: false }).* from "./terminals"
}
