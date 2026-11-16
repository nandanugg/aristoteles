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


# The new work design: work.qnt, tmux.qnt, workenv.qnt

The source is plan/model/DESIGN.md (locked 2026-11-16, with sections 8 and 9 added the same
evening). It replaces the flow of today's code, so these files start again; they do not extend
protocol.qnt or tasks.qnt. Status: built, typechecked, smoke-run (a few hundred random runs per
property). A review of the model comes before any stress run (TLC, Apalache, long runs).

## Words (new here)

- **Store**: the one truth. An ordered, append-only log; the model keeps its fold (`Store`).
- **Act**: a request to the store (`Act`): its sender's token, what it asks, its content. The
  store takes it (it is appended) or refuses it.
- **Token**: the sender's identity and its **epoch** (`ep`), a counter the store raises when it
  revives or resumes that actor. A sender has only its own token.
- **Basis**: what an act was built on: the revision of its target it saw (`seen`) and the item
  versions of its view (`seenDir`, their sum).
- **Item**: a direction, a standard or a rule (DESIGN.md 9). Each has its own version. The
  model has one direction, two standards and two rules (`ITEMS`; `applies` says which task each
  one reaches: its `where`).
- **View**: the store as a process or the page last read it. Acts are built on a view.
- **Network**: acts sent and not yet answered, an unordered set (`net`): any of them can arrive
  next, so acts arrive late and out of order.
- **Process**: one running copy of an actor (`Proc`). An actor may have several over time, and
  two at once (a split brain).
- **Honest agent**: reads its wait, then does a step it read, on its view, with honest content.
- **Byzantine agent**: sends any act with its own token, any content, built on any view, at any
  time; may stop at its prompt. It cannot forge another token.
- **Real cause**: the truth of what is wrong with a task (`Cause`), chosen by the environment and
  hidden from the store. It lets the model see an evaluation at the wrong level.
- **History flag**: a field of `Store.g` that records an impossible state the store let in.
- **Witness**: a state that should be reachable; `quint run --witnesses` counts the runs that
  reach it. Zero means a dead action.
- **Mutant**: a configuration where a property must break; it proves the property can see the
  fault.

## Files and modules

- `work.qnt`, module `work`: the store and the protocol, pure (no variables). The store's check
  `accept` (= `authority` + `epochOk` + `legal` + `basisOk` + the build check), `effect` (and
  `take`), the told steps `dos`, the obligations `obligationsOf`, `finalOf`, `pastBound`.
- `tmux.qnt`, module `tmux`: tmux as its own machine, pure: the agents' server, the pump, each
  pane's input line.
- `workenv.qnt`, module `workenv`: the environment and all properties. Variables: `s` (store),
  `net`, `procs` (every process), `tm` (tmux), `page`, `faults`, `merged`, `lastEvent`, `told`,
  `obligations`. Module `cfgs`: the configurations `DESIGN`, `FIXED`, `HONEST`, `CALM`.
- Instances: `designHonest`, `designMaker`, `designRole`, `designPipe`, `designHost` (the design
  as written, one Byzantine class at a time, every fault); the same five as `fixed*` (every
  proposed check on; `fixedRole` and `fixedPipe` on a calm run); `c1b`, `d7none`, `d7shrink`
  (Nanda's options); `editAlways`, `editNever` (editBack 0 and 2); `beforeBind`, `beforeMove` (the live faults before fde5e40 and e4e49ff);
  the mutants `mutPage`, `mutDup`, `mutCrash`, `mutTmux`, `mutMaker`, `mutRole`, `mutPipe`,
  `mutRef`, `mutRace`, `mutDash`, `mutAccept` (the design as written on a calm run, one fault class each, so random
  runs go deep); the witness modules `witnessCalm`, `witnessDone`, `witnessCrash`,
  `witnessFaults`, `witnessByz`.
- Environments (`cfgs`): `HONEST` (every fault, honest agents, every real cause); `CALM` (no
  fault, no reject, 10 person acts). `ENV.causes` limits the real causes a task may get, so a
  calm run reaches done tasks.

Sizes: two tasks (`SLOTS`); one host, one persistent role, one pipeline role; at most 6 makers;
3 tries; 2 points; 4 changes (D7 budget 3); 1 review-loop revision; 2 rule rewrites; 1 top
remake; 1 run continue; 3 environment faults; 3 acts in flight; 6 person acts.

## Options (`CFG`; README of `cfgs` in workenv.qnt)

| Field | Meaning | `DESIGN` | `FIXED` |
|---|---|---|---|
| c1Keep | C1: false = (a) the host's first remake of the top is a warning, the next one (built on it) remakes; true = (b) the host keeps hosting | a | a |
| d7 | D7: 0 none; 1 a budget of agent changes (checked when a change takes effect; past it the person decides); 2 a recheck only shrinks points (per task; more points go to the person) | 0 | 1 |
| basis | an act names its basis; the store refuses an old one | off | on |
| build | the store refuses an act from an old page build | off | on |
| rebase | a change in effect sends the other open drafts it touches back to be redone | off | on |
| harnessTest | the harness, not the pipeline role, runs a test command on the examples | off | on |
| classify | the store answers "only a standard change?" and "only a role change?" from the content, not the pipeline role's answer; it versions the items the content changes, not the items the draft names | off | on |
| passTests | the store refuses a pass while a rule with only a test command catches the result | off | on |
| fullBrief | a revision carries every earlier point | off | on |
| endedCheck | the store refuses an act of a maker that is not the task's live maker | off | on |
| formCheck | the store refuses a rule with neither evidence form | off | on |
| refCheck | the harness verifies a reference (DESIGN.md 4 states it) | on | on |
| epochs | the store refuses an act of an older epoch | off | on |
| reviseCheck | a draft the person sent back reaches the person again only revised | off | on |
| bindOpenOnly | fde5e40: a new host assignment binds the run's session unless an open one holds it | on | on |
| rebind | e4e49ff: run continue moves the open host assignment to the new session | on | on |
| pumpReattach | the pump attaches again after another client's attach -d | off | on |
| hostWatched | the end of the host's pane (in the person's tmux) is reported | off | on |
| waitEmptyInput | the engine types a prompt only into an empty input line; the page shows a prompt held by the person's typing | off | on |
| idleSeen | a process that stops at its prompt counts as an exit | off | on |
| dashLive | the dashboard's cards come from the live store, not the page's copy | off | on |
| dashInactiveFromView | a mutant: a card is also Inactive when the page's copy says the role is down | off | off |
| silentSteps | the ticks without a wait poll before a card shows Inactive (DESIGN.md: 1 minute) | 3 | 3 |
| reviewSubagents | a role gives its review to a subagent (then the role waits); Nanda's reading: no | off | off |
| editBack | DESIGN.md 10.1, open: after the pipeline role carries the person's direction edit down, back to the person: 0 always, 1 only when the change has items the person did not write (the proposal), 2 never | 1 | 1 |
| acceptCheck | the store refuses an accept or send-back of an escalation not waiting for the person at the append | on | on |

## DESIGN.md to Quint

| DESIGN.md | Quint (work.qnt unless named) |
|---|---|
| 1 Person | `PERSON`: `OpenTop`, `Reject`, `Accept`, `SendBack`, `Decide`, `EndProject`, `MoveHost` (run continue); workenv `personActs` |
| 1 Host | `HOST`: `SendTask`, `Reassign`, `RemakeTop`, `TopDone`; its wait finds the top only through `hostFinds` |
| 1 Persistent role | `ROLE`: `AssignDo`, `Review` (its verdict is the decision), `Resume`; `card` |
| 1 Maker subagent | `Maker`, a fresh id per `AssignDo`; `ReadBrief`, `Report`; it lives inside the role's process (workenv `killed`, `Exit` of the role) |
| 1 Pipeline role | `PIPE`: `Evaluate`, `Advance`, `WriteRule`, `RunTest`, `Ship`, `LoopReview`, `RecheckDone` |
| 2 the loop | `SendTask` -> `AssignDo` -> `ReadBrief` -> `Report` -> `Review`: `Pass` (done), `Fail` (revision to the same maker, `revs + 1`), raise |
| 2.6 raise | `RaiseTries` (only when tries are used up), `RaiseNoRule`, `RaiseMisses`, the person's `Reject`; `raise` |
| 3 the five levels | `Evaluate` with `Level`; `Split` (a new task generation, or with `flag` the top: `SHostRemake`), `Fit` (role draft), `Principle`, `Direct`, `Standard` (`entryOf`); the real cause: `Task.cause`, `resolves` |
| 4 stages | `SPrinciple` -> `SDirAssess` -> `SStdAssess` -> `SRuleAssess` -> `STest` -> `SDraft`; `nextStage` |
| 4 rule forms | `Form`: `Mech` (test command), `Ref` (reference), `Both`; `WriteRule` (`flag`: the test's real behaviour, `flag2`: the reference exists); `RunTest` |
| 5 only a standard change? | `Ship`: the draft names `items` (content: `real`); no direction among them: `shipStandard` (in effect at once, back to the role); else `SLoop` |
| 5 review loop, change by human | `LoopReview`, `Accept`, `SendBack` |
| 5 role draft, only a role change? | `Evaluate` `Fit` -> `SLoop`; `Accept`: role-only -> `cardInEffect`, `backToRole`; else `SAccepted` -> `Reassign` |
| 6 C1, D7 | `c1Keep` in `RemakeTop`; `d7`: `budgetLeft`, `SPerson`, `Decide`; `Task.bound` |
| 7 Store | `accept`, `take`; workenv `storeTakes`, `storeRefuses` |
| 8 tmux | tmux.qnt; workenv `serverKilled`, `socketLost`, `serverRecreated`, `pumpStolen`, `pageServerRestarts`, `pumpAttaches`, `personTypes`, `personClears`, `promptRead`, `procReads` (output) |
| 10.1 the person's edit, the pipeline row | `EditDirection` (a pipeline entry `EDIT` at direction assessment; `wrote`), `shipEdit` (editBack), `atPerson` (acceptCheck); workenv `rowShown`, `DashRowMatches` |
| 10 dashboard | workenv `card`, `cards`, `queue`, `silence` (wait markers), `tick`, `procPolls`; `DashNoFalseWorking`, `DashInactiveReal`, `DashQueueActive`, `escOf`, `DashEscalationMatches` |
| 9 per-item versions, scoped recheck | `Item`, `ITEMS`, `applies`, `Store.ver`, `Fix.items`/`real`, `itemsInEffect` (scope), `Task.pend`, `RecheckDone` (pipeline role), `RunRule` (harness), `Maker.brief` and `Task.checked` (snapshots `{item: version}`) |

## The environment to Quint (workenv.qnt)

| Fault | Quint |
|---|---|
| store refuses an act | `storeRefuses` |
| act late, out of order | `net` is a set; `storeTakes(k)` picks any act of sender k |
| act sent twice | `storeTakesKept` (taken; a copy stays in flight); `procRepeats` (a resumed process sends its last act again) |
| page shows an old state | `page.view`, `pageRefreshes`; the person acts on what the view shows (`personWhats`) |
| page from an old build | `pageDeploys`, `pageReloads`; `Act.old` (names no basis) |
| process ends at any step | `crashes`; the role's end is its makers' end (`killed`) |
| process comes back by itself | `selfResumes` (its old epoch; with or without context) |
| restart or resume, with or without context | `procsAfter` on `Resume`, `Revive`, `MoveHost`; `Proc.ctx`, `Proc.stale` |
| agent acts on an old view or old brief | honest: `procReads` then `procActs` (the view can age between); stale: `Proc.stale` |
| agent reads only the first lines, or drops the output | `procReads` with `Head` (`headOf`, `rank`) or `Drop` |
| agent: any act at any time, misreads, skips, repeats | `byzActs` (own token, any content and basis): a step it is told, any act of its own authority, or any act at all; `byzStep` gives it its own branch |
| agent stops without waiting | `byzStops`, `byzWakes`; with idleSeen the pump reports it |
| tmux server killed | `serverKilled`: every agents' pane ends; the host's pane (person's tmux) does not |
| socket gone, processes run | `socketLost`: processes run on; the pump cannot see them; a new server (`serverRecreated`) does not have them |
| pump detached / page server restart | `pumpStolen`, `pageServerRestarts`, `pumpAttaches` |
| input line | `personTypes`, `personClears`, a revive's prompt (`queuePrompt`), `promptRead` (a merged prompt is misread). The engine sends a prompt with Enter: it merges only with a line the person had already started |
| wait markers, time | `silence` (per persistent role, ticks since its last poll), `tick`, `procPolls`, `procReads` |
| person acts any time or never | `personActs`; not fair |

## Act content

`flag` and `flag2` mean, per act: `Report` flag: the maker slipped; `WriteRule` flag: the test
command really behaves on its examples, flag2: the reference exists; `RunTest` flag: the
pipeline role's claim of the outcome; `Evaluate` with `Split` flag: the top must be remade; with
`Fit` flag: the label "only a role change", flag2: the content; `LoopReview` flag: hand the
draft to the person; `Decide` flag: take the result as it is; `RecheckDone` flag: it still
holds. `cause` on `Evaluate` (split) and `RemakeTop`: the real cause of the new task.

## Properties

Each property and its tier. "Mutant": the module where it must break (spec.sh `--check`).

Tier 1, safety under Byzantine agents and faults. History flags, one invariant each:

| Property | The impossible state | Mutant (spec.sh --check, a recorded seed); "not yet" = defined, not seen in 300 runs |
|---|---|---|
| NoActByEnded | an act of a maker that is not the task's live maker was taken | mutMaker |
| NoReviewOfOtherResult | a review was applied to another result than the one read | mutDup (seen in 1000 runs; not in 300) |
| NoPassUnderOtherVersion | a pass by a reviewer whose view had other item versions | mutRace (seen once in witnessCalm; not yet with a seed) |
| NoStaleReport | a report answered another revision than the one it was made for | mutDup (seen in 1000 runs; not in 300) |
| NoUnseenReject | the person's reject hit a result the page did not show (the live case: the page shows r0, the role fails it, the maker reports r1, the reject on the old page hits r1) | mutPage |
| NoUnseenAccept | the person's accept hit a draft the page did not show | mutPage (not yet) |
| NoRejectedDraftInEffect | a draft the person sent back took effect by an earlier accept | mutPage (not yet) |
| NoLostUpdate | a draft built on an older version of an item it changes took effect | mutRace |
| NoFailedTestInEffect | a rule took effect whose test command fails its examples | mutPipe |
| EveryRuleHasForm | a rule took effect with neither evidence form | mutPipe |
| NoBadReference | a rule took effect with a reference that does not exist | mutRef |
| NoDeepChangeWithoutPerson | a change of the direction took effect without the person | mutPipe (seen in 1000 runs; not in 300) |
| NoRoleChangeMisjudged | a role draft that changes more went back to the card without the host's reassign | mutPipe (not yet) |
| NoPassOfBrokenResult | a pass of a result a test-command rule catches | mutRole |
| NoPassOfBadResult | a pass (or recheck) of a bad result | mutRole; fixedRole (the store cannot judge quality) |
| NoShallowEvaluation | an evaluation at a level that cannot remove the real cause | mutPipe; fixedPipe (the store cannot know the cause) |
| NoStalePipelineAct | a pipeline act applied to a stage it was not made for | mutDup |
| NoSplitBrain | an act of an older epoch of its actor was taken | mutCrash |
| RevisionHasContext | a revision worked by a maker that lost its context | mutCrash (not yet) |
| NoUnrevisedResubmit | a draft the person sent back reached the person unchanged | mutPipe |
| NoUnrecheckedScope | a change missed a task its content touches (named items fewer than the real ones) | mutPipe |
| NoMergedInput | a revive's prompt merged with the person's typing was read | mutTmux |
| NoDoneUnderOldVersion | the project ended with a task done under an old version of an item that applies to it | none: holds by the store (EndProject needs the top done; a recheck clears it) |
| HostBoundToRunSession | an open run's top task has its open host assignment on another session | beforeMove; beforeBind (not yet) |
| C1aConfirmed | under C1 a, a remake not built on the host's warning (a duplicate of the first remake) | mutDup (seen in 1000 runs; not in 300) |
| C1bHosted | the top has no host (not done, not ended) | witnessCalm (C1 a); holds in c1b |
| ChangesWithinBudget | D7 budget: agent changes past the budget | none: holds by the store (checked when a change takes effect) |

Store-shape sanity (`Sane`; a violation is a bug of the model): `DoneIsClosed`,
`OneMakerPerTask`, `ClaimOnlyLive`, `RaiseHasOwner`.

The dashboard (DESIGN.md 10), safety of what the page shows:

| Property | The impossible state | Mutant |
|---|---|---|
| DashNoFalseWorking | a card shows Working while the role only waits (has no step of its own now) | mutPage (cards from an old page copy) |
| DashInactiveReal | a card shows Inactive with tmux connected and the polls on time | mutDash |
| DashQueueActive | the queue shows a task that is no longer queued or working | mutPage |
| DashRowMatches | the task pipeline row (it lists every escalation) shown while no escalation waits for the person, or hidden while one waits. A stale page can show either | mutPage |
| NoAcceptNotWaiting | an accept took effect on an escalation that did not wait for the person at its append (the stale page: its view says waiting, the store moved on) | mutAccept |
| NoUnacceptedEditChange | the person's direction edit put into effect items the person did not write and did not accept | editNever; with editBack 1, a pipeline role that names fewer items than it changes (no classify) |
| DashEscalationMatches | an escalation card (TASK PIPELINE row: queued, in the pipeline, waiting for review) differs from the pipeline's state of it | mutPage |

Tier 2, told once: `EveryObligationToldOnce` (mutants beforeMove, mutTmux),
`ToldIsAllowed` (an honest content of each told step is taken), `SomethingOwed`. A legal wait:
the one actor told does not hear and the engine owes the next move (`engineOwes`).

Convergence: `Converges` = the run stays inside the change and maker bounds. A violation is a
finding (the run goes on past them), never a success. Mutant: d7none (not yet).

Tier 3, progress: `FairProgress` = `Fairness` (each honest actor, each sender's acts, the
watcher, the pump and hooks, a new server, the pump attaching, a typed prompt read) implies
`always(eventually(final))`. Final is never "past the bound". Not yet run (TLC).

## Witnesses

One per action and per fault; the five witness modules together reach each in > 0 runs
(numbers in the review report). Each `w*` in workenv.qnt names what it covers.


## Simplified or left out on purpose (declared)

- The top task starts open, hosted, bound to session 0.
- One persistent role for both tasks. Reassign ends the role's open work and sends it again
  (its makers end); it is not counted as a change by D7.
- A split remakes the task as one finer task in the same slot (a new generation).
- Always-on store checks (the store's state machine): the stage order; a maker act only on a
  working task; `Fail` only while tries remain and `RaiseTries` only when they are used up;
  `Accept` only at the person; `Reject` only of a result in review or done; `EndProject` only
  once the host returned the top; `RemakeTop` only within the D7 budget.
- Rule rewrites past `maxRuleTries` must take the reference form (DESIGN.md has no bound).
- Past the D7 bound the person decides: take the result as it is (done) or evaluate again.
- A rule with both forms: the test command finds candidates, the role judges; `passTests`
  covers only rules with a test command alone.
- An honest agent is competent: it reviews correctly and evaluates at the real cause. The
  store cannot protect review quality or the choice of level from a Byzantine role or
  pipeline role: `NoPassOfBadResult` and `NoShallowEvaluation` break in `fixedRole` and
  `fixedPipe`, by design of the problem.
- History flags read from a sender's own basis (`seen`, `seenDir`, `ctx`) count only for
  non-Byzantine senders: a Byzantine sender can write the right basis while acting on a wrong
  one. For them only the store's refusal of a wrong claimed basis is checked.
- Fairness is per honest actor (process ids 0-8) and per sender, not per act in flight; an
  honest sender has one act in flight at a time; every sender at most `maxNet`.
- A Byzantine process goes on after a stop at its prompt at most twice; the page
  refreshes only when the store changed (else random runs stay shallow).
- Time is a tick that ages every wait marker; a poll (a wait return) resets its role's marker.
- The page offers run continue only while its view shows session 0 (a bound of the model;
  an old page can still send it twice). The old host process ends with it.
- Done tasks are rechecked; active tasks are rechecked by their running role (the maker reads
  its brief again; the role reviews under the new versions), not by a separate act.
- No text, no timing, no store, page or CLI as code.

## The check machine (arch-temp)

Heavy runs (TLC on full models, long simulations, Apalache) go to `ssh arch-temp`: 14 cores,
28 GB, Java 21, Node, Bun, Quint 0.33.1 (`~/aristoteles`, synced by rsync without .git, plan/,
node_modules). Use up to `_JAVA_OPTIONS=-Xmx24g` there; arch-3 keeps the quick checks and Metis.
