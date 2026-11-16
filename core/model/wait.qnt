// What a persistent agent is TOLD by `work wait` (core/effects/wait.ts), and what it reads.
// Live, 2026-11-16 00:21-00:32: agent p1 held a7..a12 and a103; a103's Do steps printed last,
// below five blocks of waits; p1 read 6 lines and stopped waiting; a fresh wait hid the same
// steps for 60 s because their key was `seen`.
module wait {
  const FIX_READY_FIRST: bool   // the blocks of ready assignments print first (all of them)
  const FIX_ONE_STEP: bool      // proposed: a return prints exactly one step, the next one to do
  const FIX_NO_SEEN: bool       // proposed: a wait never hides a ready step (no `seen` filter)
  const FIX_AGENT_WAIT: bool    // b2fecec: a token wait of a persistent agent waits as the agent
  const N: int                  // assignments the agent holds (live: 7)
  const READ: int               // lines of a return the agent reads (live: 6)
  const READY_AGAIN: int        // ticks before seen ready work prints again (live: 60 s)
  const MAX_CLOCK: int

  var ready: int -> bool    // assignment i (0..N-1) has a Do step now
  var waiting: bool         // the agent is blocked in work wait
  var inTurn: bool          // the agent read a return and acts
  var heard: Set[int]       // the Do steps it read in the last return
  var seen: Set[int]        // the key of the last return: the ready steps it printed
  var since: int            // when the current wait started
  var tok: int              // the assignment whose token the agent passed to its wait
  var clock: int
  var blind: bool           // history: a return had ready work but told none in the read lines

  val readyNow: Set[int] = ready.keys().filter(i => ready.get(i))
  // Each assignment prints a block of 2 lines (its name, then its step). The line of i's step:
  // in assignment order today; after the ready blocks with FIX_READY_FIRST.
  def lineOf(i: int): int =
    val rank = if (FIX_READY_FIRST) readyNow.filter(j => j < i).size() else i
    2 * rank + 2
  def told: Set[int] =
    if (FIX_ONE_STEP) (if (readyNow == Set()) Set()
                       else readyNow.filter(i => readyNow.forall(j => i <= j)))
    else readyNow.filter(i => lineOf(i) <= READ)
  // What the wait watches: every assignment of the agent, or (before b2fecec) the one whose token
  // it passed (live 00:52: p1 blocked 540 s on a119's token; a123's ready step was told to nobody).
  val watched: Set[int] = if (FIX_AGENT_WAIT) readyNow else readyNow.filter(i => i == tok)
  val canReturn: bool = waiting and watched != Set() and
    (FIX_NO_SEEN or readyNow != seen or clock - since >= READY_AGAIN)

  action init = all {
    ready' = 0.to(N - 1).mapBy(i => false),
    waiting' = true, inTurn' = false, heard' = Set(), seen' = Set(), since' = 0, clock' = 0,
    blind' = false, tok' = 0,
  }
  action unchangedAgent = all {
    waiting' = waiting, inTurn' = inTurn, heard' = heard, seen' = seen, since' = since, tok' = tok,
  }
  // Other actors act: an assignment of the agent gets a Do step, or loses one.
  action others = all {
    nondet i = oneOf(0.to(N - 1))
    all { ready' = ready.set(i, not(ready.get(i))), unchangedAgent, clock' = clock, blind' = blind },
  }
  action waitReturns = all {
    canReturn,
    waiting' = false, inTurn' = true, heard' = told, seen' = readyNow,
    blind' = (blind or told == Set()),
    ready' = ready, since' = since, clock' = clock, tok' = tok,
  }
  // An honest agent does a step it read.
  action agentDoes = all {
    inTurn,
    nondet i = oneOf(heard)
    all { ready' = ready.set(i, false), heard' = heard.exclude(Set(i)),
          waiting' = waiting, inTurn' = inTurn, seen' = seen, since' = since, clock' = clock,
          blind' = blind, tok' = tok },
  }
  // It waits again when it has done what it read (the skill's rule), with the token of one of
  // its assignments (the one it last acted on).
  action agentWaits = all {
    inTurn, heard == Set(),
    nondet t = oneOf(0.to(N - 1))
    all {
      waiting' = true, inTurn' = false, since' = clock, tok' = t,
      ready' = ready, heard' = heard, seen' = seen, clock' = clock, blind' = blind,
    },
  }
  action tick = all { clock < MAX_CLOCK, clock' = clock + 1, ready' = ready, unchangedAgent,
                      blind' = blind }
  action step = any { others, waitReturns, agentDoes, agentWaits, tick }

  // Every return that has ready work tells at least one step in the lines the agent reads.
  val ReturnTells: bool = not(blind)
  // A wait never blocks while its agent has a ready step.
  val NoHiddenReady: bool = (waiting and readyNow != Set()) implies canReturn
  // D1: a return tells exactly one step.
  val ReturnTellsOne: bool = inTurn implies heard.size() <= 1
  val Told: bool = ReturnTells and NoHiddenReady
}

module live {
  import wait(FIX_READY_FIRST = false, FIX_ONE_STEP = false, FIX_NO_SEEN = false,
    FIX_AGENT_WAIT = true, N = 7,
    READ = 6, READY_AGAIN = 2, MAX_CLOCK = 4).*
}
module readyFirst {
  import wait(FIX_READY_FIRST = true, FIX_ONE_STEP = false, FIX_NO_SEEN = false,
    FIX_AGENT_WAIT = true, N = 7,
    READ = 6, READY_AGAIN = 2, MAX_CLOCK = 4).*
}
module oneStep {
  import wait(FIX_READY_FIRST = true, FIX_ONE_STEP = true, FIX_NO_SEEN = true,
    FIX_AGENT_WAIT = true, N = 7,
    READ = 6, READY_AGAIN = 2, MAX_CLOCK = 4).*
}
// Live 00:52 (b2fecec): p1 holds a119 and a123 and waits on a119's token only. D1 otherwise.
module tokenWait {
  import wait(FIX_READY_FIRST = true, FIX_ONE_STEP = true, FIX_NO_SEEN = true,
    FIX_AGENT_WAIT = false, N = 2, READ = 6, READY_AGAIN = 2, MAX_CLOCK = 4).*
}
