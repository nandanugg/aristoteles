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

# The new work design: work.qnt and workenv.qnt

The source is plan/model/DESIGN.md (locked 2026-11-16). It replaces the flow of today's code,
so these two files do not extend protocol.qnt or tasks.qnt; they start again. Status: built,
typechecked, smoke-run only (a few hundred random runs). A review of the model comes before
any stress run (TLC, Apalache, long simulations).

## Words (new here)

- **Store**: the one truth. An ordered, append-only log; the model keeps its fold (`Store`).
- **Act**: a request to the store (`Act`): who sends it (its **token**), what it asks, and its
  content. The store takes it (it is appended) or refuses it.
- **Token**: the sender's identity. A sender can use only its own; the store's `authority`
  check stands for "cannot forge another actor's token".
- **Basis**: the revision of its target an act was built on (`seen`), e.g. the result id a
  review read, or the draft step the page showed.
- **Network**: the acts sent and not yet answered, as an unordered set (`net`, a "message
  soup"). Any act in it can arrive next; so acts arrive late and out of order.
- **Honest agent**: does only what it is told, on the current view, with honest content.
- **Byzantine agent**: may send any act with its own token, any content, built on any view,
  at any time; may stop at its prompt. It cannot forge another token.
- **Ghost**: a history flag in the store (`Ghost`): it records that an impossible state was let
  in. Each must stay false.
- **Witness**: a state that should be reachable; `quint run --witnesses` counts the random runs
  that reach it. Zero means a dead action.

## Files and modules

- `work.qnt`, module `work`: the protocol and the store, pure (no variables). Types, the
  store's check `accept` (= `authority` + `legal` + `basisOk` + build check), `effect`, the told
  steps `dos`, the obligations `obligationsOf`, `finalOf`.
- `workenv.qnt`, module `workenv`: the environment and the properties. Variables: `s` (store),
  `net` (acts in flight), `term` (a terminal per persistent role and per maker), `page`,
  `faults`, `noContext`, `lastEvent`, `told`, `obligations`.
- Instances (in workenv.qnt): `design` (DESIGN.md as written: every unstated check off, all
  agents Byzantine, all faults), `designHonest` (same, honest agents), `fixed` (every proposed
  check on, D7 budget, all Byzantine), `fixedHonest`, `c1b`, `d7shrink`, `d7none`, and the
  witness modules `witness` (honest role, pipeline and maker; Byzantine host; faults) and
  `witnessCalm` (no terminal faults, so random runs go deep).

Sizes: two tasks of the top (`SLOTS`), one persistent role, one pipeline role, one host, at
most 6 makers, 2 tries, 2 points, 4 changes (budget 3), 1 review-loop revision, 1 rule
rewrite, 1 top remake, 3 faults, 3 acts in flight, 4 person acts (40 in the witness modules).

## Options (`CFG`)

| Field | Meaning | In `design` |
|---|---|---|
| c1Keep | C1: false = (a) the host's first remake of the top is a warning; true = (b) the host keeps hosting | false |
| d7 | D7: 0 none, 1 a budget of changes (past it a raise is the person's), 2 each recheck only shrinks the points | 0 |
| basis | an act names its basis; the store refuses an old one | off |
| build | the store refuses an act from an old page build | off |
| staleRedo | a brief or result under an older direction is made again | off |
| rebase | a change in effect sends the other open drafts back to be redone | off |
| harnessTest | the harness, not the pipeline role, runs a test command on the examples | off |
| classify | the store, not the pipeline role, answers "only a standard change?" | off |
| passTests | the store refuses a pass while a test command prints lines on the result | off |
| fullBrief | a revision carries every earlier point | off |
| idleSeen | a process that stops at its prompt counts as an exit | off |

The checks marked "off" are not in DESIGN.md. Each is a proposal; the stress test will say
which impossible state each one removes.

## DESIGN.md to Quint

| DESIGN.md | Quint (work.qnt unless named) |
|---|---|
| 1 Person | `PERSON`; acts `OpenTop`, `Reject`, `Accept`, `SendBack`, `Decide`, `EndProject`; workenv `personSends`, `personClicks` |
| 1 Host | `HOST`; `SendTask`, `Reassign`, `RemakeTop` |
| 1 Persistent role (card) | `ROLE`; `AssignDo`, `Review` (its verdict is the decision), `Resume`; `card` version |
| 1 Maker subagent | `Maker` record, ids from 3, fresh per `AssignDo`; `ReadBrief`, `Report`; ended by `Pass` or a raise |
| 1 Pipeline role | `PIPE`; `Evaluate`, `Advance`, `WriteRule`, `RunTest`, `Ship`, `LoopReview` |
| 2.1-2.3 send, assign, report, review | `SendTask`, `AssignDo`, `Report`, `Review` |
| 2.4 pass: done, back to the parent | `Review` with `Pass`: task `Done`, maker ended; all done: the person's `EndOb` |
| 2.5 revision to the same maker | `Review` with `Fail` (while `tries + 1 < maxTries`): `revs + 1`, same maker keeps its claim |
| 2.6 raise | `RaiseTries` (tries used up), `Reject` (person), `RaiseNoRule`, `RaiseMisses`; `raise` |
| 3 evaluation, five levels | `Evaluate` with `Level`: `Split` (new task generation, back to the role), `Fit` (role draft), `Principle`, `Direct`, `Standard` (enter the pipeline at their stage) |
| 4 pipeline stages | `Stage`: `SPrinciple` -> `SDirAssess` -> `SStdAssess` -> `SRuleAssess` -> `STest` -> `SDraft`; `nextStage` |
| 4 rule forms, test on examples | `Form` (`Mech`, `Ref`, `Both`; `NoForm` refused); `truth`; `RunTest` |
| 5 only a standard change? | `Ship`: yes: `dirInEffect` and `backToRole`; no: `SLoop` |
| 5 review loop, change by human | `LoopReview` (`SLoop` -> `SAtPerson`), `Accept`, `SendBack` |
| 5 role draft | `Evaluate` with `Fit`: `kind: DRole`, straight to `SLoop` |
| 5 only a role change? | `Accept`: role draft with `roleOnly`: `cardInEffect` and `backToRole`; else `SAccepted`, then the host's `Reassign` |
| 6 C1, D7 | `CFG.c1Keep` (`RemakeTop`), `CFG.d7` (`overBudget`, `SPerson`, `Decide`; `ptsBound`) |
| 7 Store | `accept`, `effect`; workenv `storeTakes`, `storeRefuses` |

## The environment to Quint (workenv.qnt)

| Fault (DESIGN.md 7 and the task) | Quint |
|---|---|
| Store refuses an act | `storeRefuses` |
| Act arrives late, out of order | `net` is a set; `storeTakes` picks any |
| Act sent twice (page or agent) | `storeTakesKept` (taken, a copy stays in flight) |
| Page shows an old state | `page.view` (a copy of the store), `pageRefreshes` |
| Page from an old build | `pageDeploys`, `pageReloads`; `Act.old` (the act names no basis) |
| Terminal dies; process ends at any step | `crashes`; the pump reports it later, `pumpSendsExit` |
| Terminal detached | `detaches`, `reattaches` (no exit is reported while detached) |
| Restarted / resumed, with or without context | `Resume` and `Revive` taken (`termAfter`), `selfResumes`; `Term.ctx`, `Term.stale` |
| Agent: old token, old brief, repeat, out of order, misread | `byzSends` (any act, any basis), `staleSends` (an honest process resumed on an old view acts once) |
| Agent: stops without waiting | `byzStops`, `byzWakes`; with `idleSeen` the pump reports it |
| Agent: skips its step | Byzantine agents are not fair |
| Honest agent | `honestSends`: a told step, current basis, honest content, one act in flight |
| Person: any act at any time, or never | `personSends` (any person act), `personClicks` (what the page shows); not fair; `ENV.person` |

## Properties

Tier 1, safety under Byzantine agents and faults (`Safe`): `DoneIsClosed`,
`OneMakerPerTask`, `MakerOnlyWhileWorking`, `NoOrphanMaker`, `ClaimOnlyLive`,
`RaiseHasOwner`, `TopHasOwner`, `NoActByEnded`, `NoReviewOfOtherResult`,
`NoPassUnderOtherVersion`, `NoStaleReport`, `NoUnseenReject`, `NoUnseenAccept`,
`NoRejectedDraftInEffect`, `NoLostUpdate`, `NoFailedTestInEffect`, `EveryRuleHasForm`,
`NoDeepChangeWithoutPerson`, `NoPassOfBrokenResult`, `NoStalePipelineAct`,
`RevisionHasContext`, `ChangesWithinBudget`.

Tier 2, told once (`Told`): `EveryObligationToldOnce` (a legal wait: the one actor told is down
and the pump or the harness owes the next move), `ToldIsAllowed` (some content of each told
step is taken), `SomethingOwed`, `Recorded`.

Tier 3, progress: `FairProgress` = fairness of honest agents, the store's answers, the pump,
reattach and the harness implies `always(eventually(FinalOrBound))`. Byzantine agents and the
person are not fair.

## Simplified or left out on purpose

- One persistent role for both tasks; "reassign roles" ends the role's open work and sends it
  again (no second role card).
- A split remakes the task as one finer task in the same slot (a new generation), not several.
- Rule rewrites past `maxRuleTries` must take the reference form (DESIGN.md has no bound).
- Claims end with every exit (rule D6 of the earlier specs; DESIGN.md does not speak of claims).
- The person ends the project only when every task is done.
- A stale honest process acts once, with a basis one step old (not a full old copy of the store).
- Fairness of makers and of the network is fairness of "some maker", "some delivery".
- No text, no timing, no store or page as code.
