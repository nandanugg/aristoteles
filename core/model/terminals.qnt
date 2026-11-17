// The terminals model (plan/model/DESIGN.md 8 and 14): G1 of contract.qnt.
// "An agent that owes work is, in the end, alive and hears its step", under process ends,
// tmux faults, reboots, usage limits and crashes of the engine. Small on purpose, for TLC
// with liveness: no time, no page, no store but the records the engine reads.
// Aristoteles is an ARBITRARY ADVERSARY here: each agent's `owes` bit may be set or cleared
// at any time. The model assumes nothing about the protocol.
// What it has:
// - the host's pane, in the person's own tmux (never revived by the engine: the person
//   revives it; with hostWatched the engine sees its end and the person is shown it);
// - the role's and the pipeline role's panes, in the agents' tmux server; the role's maker,
//   a subagent inside the role's process (it ends with it);
// - the agents' server: killed (its panes end), its socket lost (the panes run on, no client
//   reaches them), recreated by the watcher; a reboot also ends the host's pane;
// - the pump (a control client owned by the page server): attached, about to attach again,
//   or off (detached by another client's attach -d, without pumpReattach); it hears a pane
//   end only while attached; with listOnAttach it lists the panes when it attaches;
// - the store's records the engine reads: `down` (an exit was recorded) and the outbox;
// - the outbox: the watcher records a revive (or a send) in the store, then acts, then
//   marks it done; the watcher can crash between any two of these;
// - the usage limit: a limited process hears nothing; the limit lifts (fair);
// - each agents' pane's input line: the person may type into it (promptArg off: a typed
//   prompt merges with it).
// Left out: process ids and epochs (one process per agent; a revived process replaces the
// old one, whose acts the store refuses: core.qnt and work.qnt), the context of a resumed
// process (it does not change whether it hears: the prompt tells it to wait), time.
module terminals {
  import contract.* from "./contract"
  // listOnAttach, pumpReattach, promptArg: as in work.qnt. outbox: the watcher's record in
  // the store is replayed after its crash (off: it acts from memory after the record).
  // evidence: the act leaves a mark the watcher checks before acting again (off: after its
  // crash it acts again). hostWatched: the host's end is seen and shown to the person.
  // maxFaults: the faults of a run (process ends, tmux faults, limits, engine crashes).
  const T: { listOnAttach: bool, pumpReattach: bool, promptArg: bool, outbox: bool,
             evidence: bool, hostWatched: bool, maxFaults: int }

  pure val HOST = 0
  pure val ROLE = 1
  pure val PIPE = 2
  pure val MAKER = 3
  pure val AGENTS = Set(HOST, ROLE, PIPE, MAKER)
  pure val PANES = Set(ROLE, PIPE)       // panes in the agents' server
  pure val SEND = 9                      // the outbox op of the one send (revives: ROLE, PIPE)
  // A process: none; started with its prompt typed and not yet read (promptArg off); its
  // prompt merged with the person's typing (it never learns to wait); running its wait;
  // stopped by the usage limit.
  type PS = Down | Starting | Confused | Hears | Limited
  type Pump = Attached | Again | Off
  type Line = Empty | Typing
  // An outbox entry: none; recorded in the store; acted (the mark the watcher checks).
  type Box = NoBox | Recorded | Acted

  var owes: Set[int]        // the adversary: the agents that owe work now
  var ps: int -> PS
  var old: Set[int]         // panes of an agents' server whose socket was lost
  var srvUp: bool           // the agents' server is reachable
  var pump: Pump
  var noticed: Set[int]     // ends the engine heard and has not yet recorded (in memory)
  var down: Set[int]        // the store: an exit was recorded
  var box: int -> Box       // the outbox: ROLE, PIPE (revives) and SEND
  var sendTo: int           // the send's target (-1: none)
  var mem: Set[int]         // outbox off: ops recorded, to act from memory
  var line: int -> Line
  var faults: int
  var acted: Set[int]       // ghost: ops acted since their record
  var dupAct: bool           // ghost: an op acted dupAct for one record

  val vars = (owes, ps, old, srvUp, pump, noticed, down, box, sendTo, mem, line, faults, acted,
              dupAct)

  action init = all {
    owes' = Set(), ps' = AGENTS.mapBy(k => Hears), old' = Set(), srvUp' = true,
    pump' = Attached, noticed' = Set(), down' = Set(),
    box' = Set(ROLE, PIPE, SEND).mapBy(k => NoBox), sendTo' = -1, mem' = Set(),
    line' = PANES.mapBy(k => Empty), faults' = 0, acted' = Set(), dupAct' = false,
  }

  def up(k: int): bool = ps.get(k) != Down
  // The role's maker lives inside the role's process and its usage limit.
  def hears(k: int): bool =
    if (k == MAKER) ps.get(MAKER) == Hears and ps.get(ROLE) == Hears
    else ps.get(k) == Hears
  // The maker's step after its end: the role is told to resume it (work.qnt ResumeOb).
  def heardBy(k: int): bool =
    hears(k) or (k == MAKER and down.contains(MAKER) and hears(ROLE))
  // The person owes the host's revival: its end is recorded, so the person is shown it.
  def personOwes(k: int): bool = k == HOST and ps.get(HOST) == Down and down.contains(HOST)
  // The pump hears a pane end while attached to the server that has the pane.
  def heard(k: int): bool = PANES.contains(k) and pump == Attached and not(old.contains(k))

  action keep(np: int -> PS, nf: int): bool = all {
    ps' = np, faults' = nf, owes' = owes, old' = old, srvUp' = srvUp, pump' = pump,
    noticed' = noticed, down' = down, box' = box, sendTo' = sendTo, mem' = mem, line' = line,
    acted' = acted, dupAct' = dupAct,
  }

  // ---- the adversary (aristoteles): any agent owes work, or stops owing it, at any time
  action owesChanges = all {
    nondet k = AGENTS.oneOf()
    all { owes' = if (owes.contains(k)) owes.exclude(Set(k)) else owes.union(Set(k)),
          ps' = ps, old' = old, srvUp' = srvUp, pump' = pump, noticed' = noticed,
          down' = down, box' = box, sendTo' = sendTo, mem' = mem, line' = line,
          faults' = faults, acted' = acted, dupAct' = dupAct },
  }
  // It asks for a send (a text for an agent's terminal): recorded in the store first.
  action sendRecorded = all {
    sendTo == -1, box.get(SEND) == NoBox, not(mem.contains(SEND)),
    nondet k = Set(HOST, ROLE, PIPE).oneOf()
    all { sendTo' = k,
          box' = if (T.outbox) box.set(SEND, Recorded) else box,
          mem' = if (T.outbox) mem else mem.union(Set(SEND)),
          acted' = acted.exclude(Set(SEND)),
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, pump' = pump,
          noticed' = noticed, down' = down, line' = line, faults' = faults, dupAct' = dupAct },
  }

  // ---- faults (at most maxFaults in a run; not fair)
  // A process ends. The pump hears a pane's end while attached; the hook inside the role
  // records its maker's end; the host's end is seen with hostWatched. The role's end is
  // its maker's end.
  action crash = all {
    faults < T.maxFaults,
    nondet k = AGENTS.filter(j => up(j)).oneOf()
    val np = if (k == ROLE) ps.set(ROLE, Down).set(MAKER, Down) else ps.set(k, Down)
    val hook = k == MAKER
    all { ps' = np, faults' = faults + 1, old' = old.exclude(Set(k)),
          noticed' = if (heard(k) or (k == HOST and T.hostWatched)) noticed.union(Set(k))
                     else noticed,
          down' = if (hook) down.union(Set(MAKER)) else down,
          owes' = owes, srvUp' = srvUp, pump' = pump, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, acted' = acted, dupAct' = dupAct },
  }
  // The agents' server is killed: its panes end, the pump's client with it (no end heard).
  action serverKilled = all {
    faults < T.maxFaults, srvUp,
    val kept = old.union(Set(HOST)).union(if (old.contains(ROLE)) Set(MAKER) else Set())
    all { ps' = AGENTS.mapBy(k => if (kept.contains(k)) ps.get(k) else Down),
          srvUp' = false, pump' = if (pump == Off) Off else Again, faults' = faults + 1,
          owes' = owes, old' = old, noticed' = noticed, down' = down, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, acted' = acted, dupAct' = dupAct },
  }
  // A reboot: the agents' server, the person's tmux (the host's pane) and the engine end.
  // The engine starts again: its memory is gone; with hostWatched it sees the host's end.
  action reboot = all {
    faults < T.maxFaults,
    all { ps' = AGENTS.mapBy(k => Down), old' = Set(), srvUp' = false, pump' = Again,
          noticed' = hostAtStart(AGENTS.mapBy(k => Down)), mem' = Set(),
          box' = if (T.evidence) box else box.keys().mapBy(k =>
                   if (box.get(k) == Acted) Recorded else box.get(k)),
          faults' = faults + 1,
          owes' = owes, down' = down, sendTo' = sendTo, line' = line, acted' = acted,
          dupAct' = dupAct },
  }
  // The socket of the agents' server is lost: its panes run on (they still hear: the
  // store is not tmux), but no client reaches them; the pump's client ends.
  action socketLost = all {
    faults < T.maxFaults, srvUp,
    all { old' = old.union(PANES.filter(k => up(k))), srvUp' = false,
          pump' = if (pump == Off) Off else Again, faults' = faults + 1,
          owes' = owes, ps' = ps, noticed' = noticed, down' = down, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, acted' = acted, dupAct' = dupAct },
  }
  // Another client's attach -d detaches the pump; its owner attaches again (pumpReattach).
  action pumpStolen = all {
    faults < T.maxFaults, pump == Attached,
    all { pump' = if (T.pumpReattach) Again else Off, faults' = faults + 1,
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, noticed' = noticed,
          down' = down, box' = box, sendTo' = sendTo, mem' = mem, line' = line,
          acted' = acted, dupAct' = dupAct },
  }
  // The page server restarts: its pump closes and the new one attaches; the ends it had
  // heard and not yet recorded are gone. At its start it looks at the host's pane (in the
  // person's tmux; with hostWatched): the pump's listing does not cover it (TLC found the
  // host's end lost by a restart between the end and its record).
  def hostAtStart(np: int -> PS): Set[int] =
    if (T.hostWatched and np.get(HOST) == Down and not(down.contains(HOST))) Set(HOST)
    else Set()
  action pageServerRestarts = all {
    faults < T.maxFaults,
    all { pump' = Again, noticed' = hostAtStart(ps), faults' = faults + 1,
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, down' = down, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, acted' = acted, dupAct' = dupAct },
  }
  // The watcher crashes and starts again. With the outbox nothing is lost (the records are
  // in the store). Without it, what it was about to do is gone; without evidence it does
  // not know it already acted.
  action watcherCrashes = all {
    faults < T.maxFaults,
    all { mem' = Set(), faults' = faults + 1,
          box' = if (T.evidence) box else box.keys().mapBy(k =>
                   if (box.get(k) == Acted) Recorded else box.get(k)),
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, pump' = pump,
          noticed' = noticed, down' = down, sendTo' = sendTo, line' = line, acted' = acted,
          dupAct' = dupAct },
  }
  // An agent's AI CLI hits its usage limit: it shows the message and stops.
  action hitsLimit = all {
    faults < T.maxFaults,
    nondet k = Set(HOST, ROLE, PIPE).filter(j => ps.get(j) == Hears).oneOf()
    keep(ps.set(k, Limited), faults + 1),
  }

  // ---- the person (not fair)
  // Only with promptArg off: else nothing the engine does reads the line.
  action personTypes = all {
    not(T.promptArg),
    nondet k = PANES.oneOf()
    all { line' = line.set(k, if (line.get(k) == Empty) Typing else Empty),
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, pump' = pump,
          noticed' = noticed, down' = down, box' = box, sendTo' = sendTo, mem' = mem,
          faults' = faults, acted' = acted, dupAct' = dupAct },
  }
  // The person starts the host again in its own tmux (the host is not revived by the engine).
  action personRevivesHost = all {
    ps.get(HOST) == Down,
    all { ps' = ps.set(HOST, Hears), down' = down.exclude(Set(HOST)),
          noticed' = noticed.exclude(Set(HOST)),
          owes' = owes, old' = old, srvUp' = srvUp, pump' = pump, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, faults' = faults, acted' = acted,
          dupAct' = dupAct },
  }
  // The role resumes its maker (an agent's act: not fair here; G1 counts the role hearing
  // the resume as the maker's step heard).
  // Only the role's current process: one whose revive is recorded is old (the store
  // refuses its acts).
  action roleResumesMaker = all {
    ps.get(MAKER) == Down, down.contains(MAKER), hears(ROLE),
    box.get(ROLE) != Recorded, not(mem.contains(ROLE)),
    all { ps' = ps.set(MAKER, Hears), down' = down.exclude(Set(MAKER)),
          owes' = owes, old' = old, srvUp' = srvUp, pump' = pump, noticed' = noticed,
          box' = box, sendTo' = sendTo, mem' = mem, line' = line, faults' = faults,
          acted' = acted, dupAct' = dupAct },
  }

  // ---- the engine (fair)
  // The pump (or the host's watcher) records an end it heard: an exit in the store. The
  // role's exit is its maker's exit too.
  action report = all {
    noticed != Set(),
    nondet k = noticed.oneOf()
    val gone = if (k == ROLE) Set(ROLE, MAKER) else Set(k)
    all { noticed' = noticed.exclude(Set(k)),
          down' = if (down.contains(k)) down else down.union(gone),
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, pump' = pump, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, faults' = faults, acted' = acted,
          dupAct' = dupAct },
  }
  // The watcher revives a role whose exit is recorded: it records the revive in the store
  // (the store holds the role as alive again), then acts. Outbox off: it acts from memory.
  action recordRevive = all {
    nondet k = PANES.filter(j => down.contains(j) and box.get(j) == NoBox
                                 and not(mem.contains(j))).oneOf()
    // The role's revive holds its makers as ended too (TLC: else a maker resumed by the old
    // role, on a lost socket, between the role's exit and its revive, dies unseen).
    all { down' = down.exclude(Set(k)).union(if (k == ROLE) Set(MAKER) else Set()),
          box' = if (T.outbox) box.set(k, Recorded) else box,
          mem' = if (T.outbox) mem else mem.union(Set(k)),
          acted' = acted.exclude(Set(k)),
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, pump' = pump,
          noticed' = noticed, sendTo' = sendTo, line' = line, faults' = faults,
          dupAct' = dupAct },
  }
  // The revive's act: a new process in the current server, its prompt an argument of the
  // CLI (promptArg) or typed into its input line (merged if the person is typing).
  def spawned(k: int): PS =
    if (T.promptArg) Hears else if (line.get(k) == Typing) Confused else Starting
  // A send reaches its target's pane: the pane exists and a client reaches it.
  def reaches(k: int): bool =
    up(k) and (k == HOST or (srvUp and not(old.contains(k))))
  def canAct(op: int): bool =
    if (op == SEND) sendTo >= 0 and reaches(sendTo) else srvUp
  action doAct(op: int, nb: int -> Box, nm: Set[int]): bool = all {
    // A new role process has no maker: the old one is held as ended (the role's exit).
    ps' = if (op == SEND) ps else if (op == ROLE) ps.set(ROLE, spawned(ROLE)).set(MAKER, Down)
          else ps.set(op, spawned(op)),
    old' = if (op == SEND) old else old.exclude(Set(op)),
    acted' = acted.union(Set(op)), dupAct' = (dupAct or acted.contains(op)),
    box' = nb, mem' = nm,
    sendTo' = if (op == SEND and not(T.outbox)) -1 else sendTo,
    owes' = owes, srvUp' = srvUp, pump' = pump, noticed' = noticed, down' = down,
    line' = line, faults' = faults,
  }
  // The outbox, per op: act on a recorded op (once: Acted is the mark it checks), then mark
  // it done. Outbox off: act on an op held in memory. Fair per op: the adversary's sends
  // must not starve a revive.
  action outboxOp(op: int): bool = any {
    all { box.get(op) == Recorded, canAct(op), doAct(op, box.set(op, Acted), mem) },
    all { box.get(op) == Acted,
          box' = box.set(op, NoBox), sendTo' = if (op == SEND) -1 else sendTo,
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, pump' = pump,
          noticed' = noticed, down' = down, mem' = mem, line' = line, faults' = faults,
          acted' = acted, dupAct' = dupAct },
    all { mem.contains(op), canAct(op), doAct(op, box, mem.exclude(Set(op))) },
  }
  // A typed prompt (promptArg off) is read: the process waits for its steps.
  action promptRead = all {
    nondet k = PANES.filter(j => ps.get(j) == Starting).oneOf()
    keep(ps.set(k, Hears), faults),
  }
  action limitLifts = all {
    nondet k = AGENTS.filter(j => ps.get(j) == Limited).oneOf()
    keep(ps.set(k, Hears), faults),
  }
  action serverRecreated = all {
    not(srvUp),
    all { srvUp' = true, owes' = owes, ps' = ps, old' = old, pump' = pump,
          noticed' = noticed, down' = down, box' = box, sendTo' = sendTo, mem' = mem,
          line' = line, faults' = faults, acted' = acted, dupAct' = dupAct },
  }
  // The pump attaches again. With listOnAttach it lists the panes: a role with no pane in
  // this server (it ended unheard, or it runs on a lost server), no exit recorded and no
  // revive about to start, is an end heard now.
  action pumpAttaches = all {
    pump == Again, srvUp,
    val missing = PANES.filter(k => (not(up(k)) or old.contains(k)) and not(down.contains(k))
                                     and box.get(k) != Recorded and not(mem.contains(k)))
    all { pump' = Attached,
          noticed' = if (T.listOnAttach) noticed.union(missing) else noticed,
          owes' = owes, ps' = ps, old' = old, srvUp' = srvUp, down' = down, box' = box,
          sendTo' = sendTo, mem' = mem, line' = line, faults' = faults, acted' = acted,
          dupAct' = dupAct },
  }

  action step = any {
    owesChanges, sendRecorded,
    crash, serverKilled, reboot, socketLost, pumpStolen, pageServerRestarts, watcherCrashes,
    hitsLimit,
    personTypes, personRevivesHost, roleResumesMaker,
    report, recordRevive, outboxOp(ROLE), outboxOp(PIPE), outboxOp(SEND), promptRead, limitLifts, serverRecreated, pumpAttaches,
  }

  // ---- properties
  // Fairness of the engine parts only: the pump records what it heard and attaches again,
  // the watcher records, acts and marks, recreates the server; a typed prompt is read; the
  // usage limit lifts. Agents, the person, the adversary and faults are not fair.
  temporal Fairness = all {
    weakFair(report, vars), weakFair(recordRevive, vars), weakFair(outboxOp(ROLE), vars),
    weakFair(outboxOp(PIPE), vars), weakFair(outboxOp(SEND), vars),
    weakFair(promptRead, vars), weakFair(limitLifts, vars), weakFair(serverRecreated, vars),
    weakFair(pumpAttaches, vars),
  }
  // G1 for each agent (contract.qnt), and for the send: a recorded send is delivered in
  // the end (or its target is the host and the person owes its revival).
  temporal G1Host = G1(owes.contains(HOST), heardBy(HOST), personOwes(HOST))
  temporal G1Role = G1(owes.contains(ROLE), heardBy(ROLE), false)
  temporal G1Pipe = G1(owes.contains(PIPE), heardBy(PIPE), false)
  temporal G1Maker = G1(owes.contains(MAKER), heardBy(MAKER), false)
  val sendOpen: bool = sendTo >= 0 and not(acted.contains(SEND))
  temporal SendDelivered = G1(sendOpen, false, sendTo == HOST and personOwes(HOST))
  temporal G1All = Fairness implies all { G1Host, G1Role, G1Pipe, G1Maker }
  temporal SendDone = Fairness implies SendDelivered
  // Safety: an op of the outbox is acted at most once for one record.
  val ExactlyOnce: bool = not(dupAct)
  // Sanity of the model: a pane in a lost server is up; a maker runs only in a running role.
  val Sane: bool = old.forall(k => up(k)) and (up(MAKER) implies up(ROLE))
}

// ---- instances: the design (every check on), and the sanity mutants where G1 must FAIL.
module termCfgs {
  pure val FIXED_T = { listOnAttach: true, pumpReattach: true, promptArg: true, outbox: true,
                       evidence: true, hostWatched: true, maxFaults: 2 }
}
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
