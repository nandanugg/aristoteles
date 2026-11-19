// The terminals model: G1 of contract.qnt.
// "An agent that owes work is, in the end, alive and hears its step", under process ends,
// tmux faults, reboots, usage limits, stops at the prompt and crashes of the engine. Small
// on purpose, for TLC with liveness: no time, no page, no store but the records the engine
// reads. Aristoteles is an ARBITRARY ADVERSARY here: whatever an agent owes, at any time,
// and it may ask for a send at any time. The model assumes nothing about the protocol.
// No action reads what an agent owes, so G1 is checked with `owes` always true: "always
// eventually the agent hears (or the person owes its revival)". That implies G1 for every
// way the adversary may set and clear owes (the owes bits are not state).
// Faults: at most maxFaults in a run, in any order (TLC measured: with any number of faults
// until a fair step ends them, the state space passed 2.3 million states and kept growing).
// What it has:
// - the host's pane, in the person's own tmux. The engine never revives it: its end is
//   recorded (hostWatched) and the person is shown it; the person starts it again;
// - the role's and the pipeline role's panes, in the agents' tmux server; the role's maker,
//   a subagent inside the role's process (it ends with it);
// - the agents' server: killed (its panes end), its socket lost (the panes run on, no client
//   reaches them), recreated by the watcher; a reboot also ends the host's pane and the
//   engine;
// - the pump (a control client owned by the page server): attached, about to attach again,
//   or detached for good (by another client's attach -d, without pumpReattach); it hears a
//   pane end only while attached; with listOnAttach it lists the panes when it attaches;
// - a CLI that stops at its prompt (it ended its turn without going back to its wait, or
//   the person interrupted it): with idleSeen the CLI's own hook records an exit;
// - the store's records the engine reads: the exits and the outbox;
// - the outbox: the watcher records a revive (or a send) in the store, then acts, then
//   marks it done; it can crash between any two of these. A revive's act leaves a mark in
//   the world (a pane of that revive in the current server): with `evidence` the watcher
//   looks for it before acting again. A send (typed text) leaves no mark to read: a send is
//   at least once (the agents hear their steps through the store; a send is a nudge);
// - the usage limit: a limited process hears nothing; the limit lifts (fair);
// - each agents' pane's input line: the person may type into it (promptArg off: a typed
//   prompt merges with it).
// Left out: process ids and epochs (one process per agent; a revived process replaces the
// old one, whose acts the store refuses), the context of a resumed process (it does not
// change whether it hears: the prompt tells it to wait), time.
module terminals {
  import contract.* from "./contract"

  // listOnAttach: the pump lists the panes when it attaches.
  // pumpReattach: the pump attaches again after another client's attach -d.
  // promptArg: a new process gets its prompt as an argument (off: typed, may be merged).
  // outbox: the watcher's record in the store is acted on again after its crash (off: it
  //   acts from memory after the record).
  // evidence: before acting again on a revive, the watcher looks for the pane of that revive.
  // hostWatched: the host's end is recorded.
  // idleSeen: the CLI's hook records a stop at the prompt as an exit.
  // maxFaults: the faults of a run (process ends, stops at the prompt, tmux faults, usage
  //   limits, engine crashes).
  const Design: { listOnAttach: bool, pumpReattach: bool, promptArg: bool, outbox: bool,
                  evidence: bool, hostWatched: bool, idleSeen: bool, maxFaults: int }

  type Agent = Host | Role | Pipe | Maker
  pure val AGENTS = Set(Host, Role, Pipe, Maker)
  pure val PANES = Set(Role, Pipe)       // panes in the agents' server
  // An outbox op: a revive of a pane, or a send.
  type Op = Revive(Agent) | SendText
  pure val OPS = Set(Revive(Role), Revive(Pipe), SendText)

  // A process: none; started with its prompt typed and not yet read (promptArg off); its
  // prompt merged with the person's typing (it never learns to wait); running its wait;
  // stopped by the usage limit; stopped at its prompt.
  type Process = Down | Starting | Confused | Hears | Limited | Idle
  type Pump = Attached | Reattaching | Detached
  type InputLine = Empty | Typing
  type OutboxState = NotRecorded | Recorded
  type SendTarget = NoTarget | SendTo(Agent)

  // lostSocket: panes of an agents' server whose socket was lost.
  // heardEnds: ends the engine heard and has not yet recorded (in its memory).
  // exitRecorded: the store's exit records.
  // outbox: the outbox records (a revive per pane; the send).
  // acting: ops the watcher acted on and has not yet marked (its memory).
  // reviveMark: revives whose pane is in the current server (the evidence).
  // sendTo: the send's target. fromMemory: outbox off, ops to act on from memory.
  // sendActed, reviveDoubled: ghosts (the send was acted; a revive was acted while the pane
  // of its first act still ran).
  type World = { process: Agent -> Process, lostSocket: Set[Agent], serverUp: bool,
                 pump: Pump, heardEnds: Set[Agent], exitRecorded: Set[Agent],
                 outbox: Op -> OutboxState, acting: Set[Op], reviveMark: Set[Op],
                 sendTo: SendTarget, fromMemory: Set[Op], inputLine: Agent -> InputLine,
                 faults: int, sendActed: bool, reviveDoubled: bool }
  var world: World

  action init = all {
    world' = { process: AGENTS.mapBy(agent => Hears), lostSocket: Set(), serverUp: true,
               pump: Attached, heardEnds: Set(), exitRecorded: Set(),
               outbox: OPS.mapBy(op => NotRecorded), acting: Set(), reviveMark: Set(),
               sendTo: NoTarget, fromMemory: Set(), inputLine: PANES.mapBy(pane => Empty),
               faults: 0, sendActed: false, reviveDoubled: false },
  }

  def isUp(agent: Agent): bool = world.process.get(agent) != Down
  // The role's maker lives inside the role's process and its usage limit.
  def hears(agent: Agent): bool =
    if (agent == Maker) world.process.get(Maker) == Hears and world.process.get(Role) == Hears
    else world.process.get(agent) == Hears
  // The maker's step after its end: the role is told to resume it.
  def heardBy(agent: Agent): bool =
    hears(agent) or (agent == Maker and world.exitRecorded.contains(Maker) and hears(Role))
  // The person owes the host's revival: its end (or its stop at the prompt) is recorded,
  // so the person is shown it.
  def personOwes(agent: Agent): bool =
    agent == Host and not(hears(Host)) and world.exitRecorded.contains(Host)
  // The pump hears a pane end while attached to the server that has the pane.
  def pumpHears(agent: Agent): bool =
    PANES.contains(agent) and world.pump == Attached and not(world.lostSocket.contains(agent))
  action fault(after: World): bool =
    all { world.faults < Design.maxFaults, world' = { ...after, faults: world.faults + 1 } }
  def ended(process: Agent -> Process, agent: Agent): Agent -> Process =
    if (agent == Role) process.set(Role, Down).set(Maker, Down) else process.set(agent, Down)
  // The exits a recorded end of an agent implies: the role's exit is its maker's too.
  def exitsOf(agent: Agent): Set[Agent] = if (agent == Role) Set(Role, Maker) else Set(agent)

  // ---- the adversary (aristoteles) asks for a send (a text for an agent's terminal),
  // recorded in the store first.
  action sendRecorded = all {
    world.sendTo == NoTarget, world.outbox.get(SendText) == NotRecorded,
    not(world.fromMemory.contains(SendText)),
    nondet target = Set(Host, Role, Pipe).oneOf()
    world' = { ...world, sendTo: SendTo(target), sendActed: false,
               outbox: if (Design.outbox) world.outbox.set(SendText, Recorded)
                       else world.outbox,
               fromMemory: if (Design.outbox) world.fromMemory
                           else world.fromMemory.union(Set(SendText)) },
  }

  // ---- faults (at most maxFaults; not fair)
  // A process ends. The pump hears a pane's end while attached; the hook inside the role
  // records its maker's end; the host's end is seen with hostWatched. The role's end is
  // its maker's end.
  action crash = {
    nondet agent = AGENTS.filter(other => isUp(other)).oneOf()
    fault({ ...world, process: ended(world.process, agent),
            lostSocket: world.lostSocket.exclude(Set(agent)),
            reviveMark: world.reviveMark.exclude(Set(Revive(agent))),
            heardEnds: if (pumpHears(agent) or (agent == Host and Design.hostWatched))
                         world.heardEnds.union(Set(agent))
                       else world.heardEnds,
            exitRecorded: if (agent == Maker) world.exitRecorded.union(Set(Maker))
                          else world.exitRecorded })
  }
  // A CLI stops at its prompt: its turn ended without its wait, or the person interrupted it.
  action stopsAtPrompt = {
    nondet agent = AGENTS.filter(other => world.process.get(other) == Hears).oneOf()
    fault({ ...world, process: world.process.set(agent, Idle) })
  }
  // The agents' server is killed: its panes end, the pump's client with it (no end heard).
  action serverKilled = all {
    world.serverUp,
    val kept = world.lostSocket.union(Set(Host))
                    .union(if (world.lostSocket.contains(Role)) Set(Maker) else Set())
    fault({ ...world,
            process: AGENTS.mapBy(agent => if (kept.contains(agent)) world.process.get(agent)
                                           else Down),
            serverUp: false, pump: if (world.pump == Detached) Detached else Reattaching,
            reviveMark: Set() }),
  }
  // A reboot: the agents' server, the person's tmux (the host's pane) and the engine end.
  // The engine starts again: its memory is gone; it looks at the host's pane.
  action reboot =
    fault({ ...world, process: AGENTS.mapBy(agent => Down), lostSocket: Set(),
            serverUp: false, pump: Reattaching,
            heardEnds: hostAtStart(AGENTS.mapBy(agent => Down)), fromMemory: Set(),
            acting: Set(), reviveMark: Set() })
  // The socket of the agents' server is lost: its panes run on (they still hear: the
  // store is not tmux), but no client reaches them; the pump's client ends.
  action socketLost = all {
    world.serverUp,
    fault({ ...world, lostSocket: world.lostSocket.union(PANES.filter(pane => isUp(pane))),
            serverUp: false,
            pump: if (world.pump == Detached) Detached else Reattaching, reviveMark: Set() }),
  }
  // Another client's attach -d detaches the pump; its owner attaches again (pumpReattach).
  action pumpStolen = all {
    world.pump == Attached,
    fault({ ...world, pump: if (Design.pumpReattach) Reattaching else Detached }),
  }
  // The page server restarts: its pump closes and the new one attaches; the ends it had
  // heard and not yet recorded are gone. At its start it looks at the host's pane (in the
  // person's tmux; with hostWatched): the pump's listing does not cover it (TLC found the
  // host's end lost by a restart between the end and its record).
  def hostAtStart(process: Agent -> Process): Set[Agent] =
    if (Design.hostWatched and process.get(Host) == Down
        and not(world.exitRecorded.contains(Host))) Set(Host)
    else Set()
  action pageServerRestarts =
    fault({ ...world, pump: Reattaching, heardEnds: hostAtStart(world.process) })
  // The watcher crashes and starts again: what it held in memory is gone (with the outbox,
  // its records are in the store).
  action watcherCrashes = fault({ ...world, fromMemory: Set(), acting: Set() })
  // An agent's AI CLI hits its usage limit: it shows the message and stops.
  action hitsLimit = {
    nondet agent = Set(Host, Role, Pipe).filter(other => world.process.get(other) == Hears)
                                        .oneOf()
    fault({ ...world, process: world.process.set(agent, Limited) })
  }

  // ---- the person (not fair)
  // Only with promptArg off: else nothing the engine does reads the line.
  action personTypes = all {
    not(Design.promptArg),
    nondet pane = PANES.oneOf()
    world' = { ...world,
               inputLine: world.inputLine.set(pane, if (world.inputLine.get(pane) == Empty)
                                                      Typing
                                                    else Empty) },
  }
  // The person starts the host again in its own tmux, or talks to it after its stop (the
  // engine does not revive it).
  action personRevivesHost = all {
    not(hears(Host)), world.process.get(Host) != Limited,
    world' = { ...world, process: world.process.set(Host, Hears),
               exitRecorded: world.exitRecorded.exclude(Set(Host)),
               heardEnds: world.heardEnds.exclude(Set(Host)) },
  }
  // The role resumes its maker (an agent's act: not fair here; G1 counts the role hearing
  // the resume as the maker's step heard). Only the role's current process: one whose
  // revive is recorded is old (the store refuses its acts).
  action roleResumesMaker = all {
    not(isUp(Maker)), world.exitRecorded.contains(Maker), hears(Role),
    world.outbox.get(Revive(Role)) != Recorded, not(world.fromMemory.contains(Revive(Role))),
    world' = { ...world, process: world.process.set(Maker, Hears),
               exitRecorded: world.exitRecorded.exclude(Set(Maker)) },
  }

  // ---- the engine (fair)
  // The pump (or the host's watcher) records an end it heard: an exit in the store. The
  // role's exit is its maker's exit too.
  action report = {
    nondet agent = world.heardEnds.oneOf()
    world' = { ...world, heardEnds: world.heardEnds.exclude(Set(agent)),
               exitRecorded: if (world.exitRecorded.contains(agent)) world.exitRecorded
                             else world.exitRecorded.union(exitsOf(agent)) }
  }
  // With idleSeen the CLI's hook records the stop at the prompt as an exit, and the engine
  // ends that CLI; the host's CLI is the person's: its stop is recorded and shown to the
  // person, and the CLI is left as it is.
  action idleHook = all {
    Design.idleSeen,
    nondet agent = AGENTS.filter(other => world.process.get(other) == Idle
                                          and not(other == Host
                                                  and world.exitRecorded.contains(Host)))
                         .oneOf()
    world' = { ...world,
               process: if (agent == Host) world.process
                        else ended(world.process, agent),
               reviveMark: world.reviveMark.exclude(Set(Revive(agent))),
               lostSocket: world.lostSocket.exclude(Set(agent)),
               exitRecorded: world.exitRecorded.union(exitsOf(agent)) },
  }
  action engineReports = any { report, idleHook }
  // The watcher revives a role whose exit is recorded: it records the revive in the store
  // (the store holds the role as alive again, and the role's makers as ended: TLC found a
  // maker resumed by the old role, on a lost socket, between the role's exit and its
  // revive, that died unseen), then acts. Outbox off: it acts from memory.
  action recordRevive = {
    nondet pane = PANES.filter(other => world.exitRecorded.contains(other)
                                        and world.outbox.get(Revive(other)) == NotRecorded
                                        and not(world.fromMemory.contains(Revive(other))))
                       .oneOf()
    world' = { ...world,
               exitRecorded: world.exitRecorded.exclude(Set(pane))
                                  .union(if (pane == Role) Set(Maker) else Set()),
               outbox: if (Design.outbox) world.outbox.set(Revive(pane), Recorded)
                       else world.outbox,
               fromMemory: if (Design.outbox) world.fromMemory
                           else world.fromMemory.union(Set(Revive(pane))) }
  }
  // The revive's act: a new process in the current server, its prompt an argument of the
  // CLI (promptArg) or typed into its input line (merged if the person is typing). A new
  // role process has no maker (the old one is held as ended).
  def spawned(agent: Agent): Process =
    if (Design.promptArg) Hears
    else if (world.inputLine.get(agent) == Typing) Confused
    else Starting
  // A send reaches its target: the target's CLI waits for input in a pane a client reaches.
  def canAct(op: Op): bool = match op {
    | SendText => match world.sendTo {
        | SendTo(target) => hears(target)
                            and (target == Host
                                 or (world.serverUp and not(world.lostSocket.contains(target))))
        | NoTarget => false
      }
    | Revive(_) => world.serverUp
  }
  def acted(op: Op): World = match op {
    | SendText => { ...world, sendActed: true }
    | Revive(pane) =>
        { ...world,
          process: if (pane == Role) world.process.set(Role, spawned(Role)).set(Maker, Down)
                   else world.process.set(pane, spawned(pane)),
          lostSocket: world.lostSocket.exclude(Set(pane)),
          reviveMark: world.reviveMark.union(Set(op)),
          reviveDoubled: world.reviveDoubled or world.reviveMark.contains(op) }
  }
  def targetCleared(op: Op): SendTarget = if (op == SendText) NoTarget else world.sendTo
  // Per op: act on a record (with evidence, only if the pane of an earlier act of it is
  // not there), mark it done after its own act, or on finding that pane after a crash.
  // Outbox off: act on an op held in memory. Fair per op: the adversary's sends must not
  // starve a revive.
  action outboxOp(op: Op): bool = any {
    all { world.outbox.get(op) == Recorded, not(world.acting.contains(op)),
          not(Design.evidence and world.reviveMark.contains(op)), canAct(op),
          world' = { ...acted(op), acting: world.acting.union(Set(op)) } },
    all { world.acting.contains(op),
          world' = { ...world, outbox: world.outbox.set(op, NotRecorded),
                     acting: world.acting.exclude(Set(op)),
                     reviveMark: world.reviveMark.exclude(Set(op)),
                     sendTo: targetCleared(op) } },
    all { Design.evidence, world.outbox.get(op) == Recorded, not(world.acting.contains(op)),
          world.reviveMark.contains(op),
          world' = { ...world, outbox: world.outbox.set(op, NotRecorded),
                     reviveMark: world.reviveMark.exclude(Set(op)) } },
    all { world.fromMemory.contains(op), canAct(op),
          world' = { ...acted(op), fromMemory: world.fromMemory.exclude(Set(op)),
                     sendTo: targetCleared(op) } },
  }
  // A typed prompt (promptArg off) is read: the process waits for its steps.
  action promptRead = {
    nondet pane = PANES.filter(other => world.process.get(other) == Starting).oneOf()
    world' = { ...world, process: world.process.set(pane, Hears) }
  }
  action limitLifts = {
    nondet agent = AGENTS.filter(other => world.process.get(other) == Limited).oneOf()
    world' = { ...world, process: world.process.set(agent, Hears) }
  }
  action serverRecreated = all { not(world.serverUp), world' = { ...world, serverUp: true } }
  // The pump attaches again. With listOnAttach it lists the panes: a role with no pane in
  // this server (it ended unheard, or it runs on a lost server), with no exit recorded and
  // no revive about to act, is an end heard now.
  action pumpAttaches = all {
    world.pump == Reattaching, world.serverUp,
    val pending = PANES.filter(pane => world.outbox.get(Revive(pane)) == Recorded
                                       and not(world.acting.contains(Revive(pane)))
                                       and not(world.reviveMark.contains(Revive(pane))))
                       .map(pane => Revive(pane)).union(world.fromMemory)
    val missing = PANES.filter(pane => (not(isUp(pane)) or world.lostSocket.contains(pane))
                                       and not(world.exitRecorded.contains(pane))
                                       and not(pending.contains(Revive(pane))))
    world' = { ...world, pump: Attached,
               heardEnds: if (Design.listOnAttach) world.heardEnds.union(missing)
                          else world.heardEnds },
  }

  action step = any {
    sendRecorded,
    crash, stopsAtPrompt, serverKilled, reboot, socketLost, pumpStolen, pageServerRestarts,
    watcherCrashes, hitsLimit,
    personTypes, personRevivesHost, roleResumesMaker,
    engineReports, recordRevive, outboxOp(Revive(Role)), outboxOp(Revive(Pipe)),
    outboxOp(SendText), promptRead, limitLifts, serverRecreated, pumpAttaches,
  }

  // ---- properties
  // Fairness of the engine parts only: the pump and the hooks record what they heard, the
  // pump attaches again, the watcher records, acts and marks, and recreates the server; a
  // typed prompt is read; the usage limit lifts. Agents, the person, the adversary and
  // faults are not fair.
  temporal Fairness = all {
    weakFair(engineReports, world), weakFair(recordRevive, world),
    weakFair(outboxOp(Revive(Role)), world), weakFair(outboxOp(Revive(Pipe)), world),
    weakFair(outboxOp(SendText), world), weakFair(promptRead, world),
    weakFair(limitLifts, world), weakFair(serverRecreated, world),
    weakFair(pumpAttaches, world),
  }
  // G1 for each agent (contract.qnt). The host: or the person owes its revival.
  temporal G1Host = G1(true, heardBy(Host), personOwes(Host))
  temporal G1Role = G1(true, heardBy(Role), false)
  temporal G1Pipe = G1(true, heardBy(Pipe), false)
  temporal G1Maker = G1(true, heardBy(Maker), false)
  // Every agent, in the end, hears its step (or the person owes the host's revival).
  temporal G1All = Fairness implies all { G1Host, G1Role, G1Pipe, G1Maker }
  // A recorded send is acted on in the end (or its target is the host and the person owes
  // its revival): the same form as G1.
  temporal SendActed =
    G1(world.sendTo != NoTarget and not(world.sendActed), false,
       world.sendTo == SendTo(Host) and personOwes(Host))
  // The send is done in the end.
  temporal SendDone = Fairness implies SendActed
  // Safety: a revive is acted on once per record while the pane of its act runs (with a
  // kill or a reboot between, acting again is right: that pane is gone).
  val ExactlyOnce: bool = not(world.reviveDoubled)
  // Sanity of the model: a pane in a lost server is up; a maker runs only in a running role.
  val Sane: bool =
    world.lostSocket.forall(agent => isUp(agent)) and (isUp(Maker) implies isUp(Role))
}

// The design: every check on.
module termCfgs {
  pure val FIXED_DESIGN = { listOnAttach: true, pumpReattach: true, promptArg: true,
                            outbox: true, evidence: true, hostWatched: true,
                            idleSeen: true, maxFaults: 2 }
}
// ---- instances (tlc.sh keeps only the one it checks: quint's TLA+ export of a file with
// many instances overflows). The design, and the sanity mutants where G1 must FAIL.
module termFixed {
  import termCfgs.*
  import terminals(Design = FIXED_DESIGN).* from "./terminals"
}
module termFixed3 {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, maxFaults: 3 }).* from "./terminals"
}
module termNoList {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, listOnAttach: false }).* from "./terminals"
}
module termNoReattach {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, pumpReattach: false }).* from "./terminals"
}
module termNoPromptArg {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, promptArg: false }).* from "./terminals"
}
module termNoOutbox {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, outbox: false }).* from "./terminals"
}
module termNoEvidence {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, evidence: false }).* from "./terminals"
}
module termNoHostWatch {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, hostWatched: false }).* from "./terminals"
}
module termNoIdleSeen {
  import termCfgs.*
  import terminals(Design = { ...FIXED_DESIGN, idleSeen: false }).* from "./terminals"
}
