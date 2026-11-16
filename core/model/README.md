# core/model: the protocol as Quint specs

These files describe how the aristoteles protocol *should* behave, in Quint, and check it.
They are test-only. No code imports them. The plan behind them is plan/research/quint/PLAN.md.

The goal (Nanda, 2026-11-16): the system is **stall-free by design**. Every run ends, or it
waits only on the person, and the person is told what to do. No supervisor that restarts idle
agents, no reminder, is the fix.

## Words

- **Spec** (specification): the system written as *state* (variables) plus *actions* (the ways
  the state may change). Quint is the language; it is a typed syntax over TLA+.
- **Actor**: anyone who acts: the person, the host, the watcher (the engine part that revives
  a persistent agent), and each assignment (a lead, a maker, a checker).
- **Obligation**: a thing that must happen next for the run to go on, read from the state alone.
  Example: "the checker of result 3 must review it".
- **Told**: printed to an actor as a *Do* step by its wait. A *Wait* step tells nobody to act.
- **Hears**: the actor can read what it is told: the person (the page), the host, the watcher,
  and an assignment whose process runs.
- **Invariant**: a condition that must hold in every state the system can reach (safety).
- **Final**: the task is done, or everything owed is owed by the person.
- **Progress**: from every state, the run reaches Final in the end (liveness).
- **Fairness**: an act that stays possible is taken in the end. Here it means: an honest agent
  does what it is told. The person is not assumed fair: a wait on the person is allowed.
- **Simulator** (`quint run`): random runs; it finds bugs fast and proves nothing.
- **TLC**: a model checker; it visits every reachable state of a small model and checks
  progress under fairness. It runs on Java.
- **Counterexample**: a run, step by step, that breaks a property.
- **"before" module**: the spec with one design rule off (the code before a fix). It must break
  its invariant; that proves the invariant can see the bug.

## How to run

- `bun run spec`: typechecks every `.qnt` file, then simulates the design modules (`after`,
  `oneStep`): no violation expected. About 30 s.
- `bun run spec:check`: the same, and each "before" module must break its invariant (the script
  turns quint's failure into a pass). About a minute.
- Neither is part of `bun test`.
- TLC, by hand, one run at a time, with a heap limit and a timeout:

  ```sh
  cd core/model
  _JAVA_OPTIONS=-Xmx2g timeout 1800 ../../node_modules/.bin/quint verify protocol.qnt \
    --main=afterTlcA --backend=tlc --temporal=FairProgress --invariant=Safe
  ```

  Then `afterTlcB`, and `tasks.qnt` with `--main=after --invariant=RunSafe`. Each takes 1.5 GB
  or less and under 5 minutes. All new features in one model did not finish in 30 minutes, so
  `afterTlcA` (subagent exits, the person's grants) and `afterTlcB` (a death of the persistent
  agent, a question) split them.

- One counterexample, as JSON (ITF: the Informal Trace Format):
  `quint run tasks.qnt --main=needDirection --invariant=EveryObligationToldOnce --mbt --seed=7
  --out-itf=/tmp/t.itf.json`.

## The files

- `protocol.qnt`: one task. The host assigns a lead; the lead assigns a maker and a checker
  (subagents); results, reviews, points, escalations, questions, the person's evaluation,
  claims, a subagent that stops, a persistent agent that dies and is revived.
- `wait.qnt`: what `work wait` tells one persistent agent that holds several assignments, and
  which lines it reads.
- `tasks.qnt`: the run. A top task with two regions; region 1 needs region 0 (it runs after it).
  Direction changes, rechecks, remakes, a remake of the top.

Each spec writes `told` (each actor's Do steps) and `obligations` as state variables, so a
trace carries them for model-based testing later (P3).

## The invariants

| Name | In plain words |
|---|---|
| I1 EveryObligationToldOnce | Each obligation is told to exactly one actor that hears it. Zero is a stall; two is churn or a race. Allowed exceptions: the work waits on a task it needs, or on the revive of its one owner. |
| I2 ToldIsAllowed | An actor is told only acts the engine allows. |
| I3 NoOrphan | A working subagent has a working parent. |
| I4 NoFalseGone | The host is taken for gone only after it was silent: no wait return and no act. |
| I5 NoStaleReview | A review is made with a brief of the current directions. |
| I6 ClaimEndsWithExit | A claim is held only by a subagent whose process runs. Every exit ends it. |
| I7 SomethingOwed | An open task always owes something. |
| W1 ReturnTells | A wait return with ready work tells one of them in the lines the agent reads. |
| W2 NoHiddenReady | A wait never blocks while its agent has a ready step. |
| W3 ReturnTellsOne | A return tells exactly one step. |
| ChangesWithinBudget | Agents change directions or remake at most MAX_CHANGES times. |
| FairProgress | If agents do what they are told, the run reaches Final. |

`Safe` (protocol) and `RunSafe` (tasks) are all of their invariants together.

## The modules

`after` in each file is the design. The others switch one rule off.

| File | Module | Rule off | Breaks | The live case |
|---|---|---|---|---|
| protocol | after, afterTlcA, afterTlcB | none | nothing (simulator; TLC on A and B) | |
| protocol | before | all | Safe | the code before 2026-11-15 evening |
| protocol | today | D2, D6 | I1 | the code at db66a7e |
| protocol | orphan | D4 parent end | I3, I1 | 713b8a0: checkers outlived their lead |
| protocol | startWait | D4 start is a Do | I1 | 8462e5d: "start your subagent" was a Wait |
| protocol | churn | escalate once | I2 | 4bbf1da: an escalation offered again |
| protocol | goneRace | D5 | I4 | 40ba4ac: a host that acted taken for gone |
| protocol | stale | D4 brief version | I5 | 0a8a447: a review on an old brief |
| protocol | noOwner | D2 | I1 | 01:03 t25: a point told to five; v219.1 |
| protocol | claimHeld | D6 | I6, I1 | 00:40: a judge stopped with its claim open |
| wait | oneStep | none (D1) | nothing | |
| wait | live | ready first, D1 | W1 | 00:21: a103 printed below line 6 |
| wait | readyFirst | D1 | W2 | 00:32: `seen` hid ready work 60 s |
| wait | tokenWait | agent wait | W2 | 00:52: p1 waited on a119's token; a123 told to nobody |
| tasks | after | none | nothing (simulator; TLC) | |
| tasks | today | D2, D7 | I1 | the code at db66a7e |
| tasks | needDirection | D2 | I1 | v219.1 (00:26), v271.3 (00:57) |
| tasks | diverge | D7 | ChangesWithinBudget; TLC FairProgress | 01:41: the Proposed Solution remade five times |
| tasks | topRemake | person told | I1 | C1: t37 waits for the person's assign |

## The design rules the specs check

- **D1** A wait return tells exactly one step: the next one to do. There is no `seen` filter;
  a step stays told until it is done or gone. A persistent agent waits as the agent, on all
  its assignments (b2fecec), never on one assignment's token.
- **D2** Every point has one owner from its creation. A Fix point: its maker (redo, or
  escalate). A Direction point: the director, told at once, also while the task waits on a
  task it needs. Only the owner is told to escalate. When the task has no director now (it was
  accepted with the point open, then opened again), the point waits on the director's
  assignment, which the host is told to make (TLC found this case; the simulator did not).
- **D4** A subagent ends with its parent (713b8a0). "Start your subagent" is a Do of the parent
  (8462e5d). A stale brief is read again before a review (0a8a447).
- **D5** Any sign of life counts: an act or a wait return (40ba4ac). The supervisor only
  detects a crash; it never moves work.
- **D6** Every exit of a subagent ends its claim: a counted act, a stop with no act, a crash.
  Its parent is told "start it again" at once, not after the claim's 10-minute timer.
- **D7** (proposed; Nanda decides) A budget of direction changes and remakes. Past the budget,
  a Direction point is the person's to decide (an evaluation), so the run cannot loop forever.

## Convergence (the live case of 01:41)

A Direction point is no fault of the maker: it uses no try. A direction change makes every
older result "not under the current directions", so every try count starts again, and every
accepted region is checked again. A remake makes a new task with no tries. So nothing in the
protocol of 2026-11-16 bounds the loop "review rejects with a Direction point, the director
changes the direction, the rechecks reject again". TLC finds this loop under fair agents
(`diverge`). Progress holds only under an assumption: agents make finitely many direction
changes and remakes. D7 turns this assumption into a rule. Another rule would also do: each
recheck may only shrink the set of open points.

## Ruling C1: a host remakes the top task

A remake of the run's top task by the host ends the host's assignment and the whole tree. The
run then waits until the person assigns the new top. The person is told (the idle top is on
the person's list), so this is a legal wait on the person, not a stall: I1 counts the person
as an actor that hears. `topRemake` shows that without the person's list it would be a stall.
Two options for Nanda: (a) warn the host before it remakes the top; (b) the host keeps its
assignment on the new top.

## Limits

- Fairness is an assumption: an agent that ends its turn without waiting breaks it. That is an
  agent fault, outside the protocol.
- Progress is checked inside the bounds: a run that used up MAX_IDS assignments leaves the
  model (`FinalOrBound`).
- The models are small (two regions, a few results, one question, one death). The simulator
  goes deeper; TLC is exact only within these bounds.
- Not modelled: text, the page and CLI as code, the store and fold, setup, real time.
