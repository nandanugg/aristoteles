# core/model: the work design as Quint specs

These files describe how aristoteles *should* behave, in Quint, and check it. The source is
plan/model/DESIGN.md (the design Nanda locked on 2026-11-16). They are test-only; no code imports
them. Only this new design is modelled: the code moves to it (v1, no compatibility), so the
specs of the old flow were removed.

The goal (Nanda, 2026-11-16): the system is **stall-free by design**. Every run ends, or it
waits only on the person, and the person is told what to do. No supervisor that restarts idle
agents, no reminder, is the fix.

## How to run

- `bun run spec`: typechecks every `.qnt` file, then simulates the design with every proposed
  check: 7 holds modules, 400 runs of 300 steps each, a fixed seed and one thread (so the
  answer is the same every time). No violation is expected, and the coverage gate (keys.sh)
  must pass: each checked property has a key witness (a state that exercises what it guards),
  and the holds module must reach it, else "no violation" would mean nothing. Then the quint
  test `workenv_test.qnt`. About 17 minutes: run it on the check machine.
- `bun run spec:check`: the same, and each mutant must break its property with its recorded
  seed (the script turns quint's failure into a pass).
- `bun run spec:stress`: for the check machine. The holds modules in 3000 runs of 300 steps
  with the coverage gate; a seed search for each mutant (one thread, so a seed reproduces; it
  prints the `breaksW` lines for spec.sh); and the witness sweep (every witness over the
  witness modules, printing the ones never reached).
- spec.sh runs its jobs in parallel (`JOBS`, default the number of cores), each with a
  fixed seed and one thread: the same answer every time. On the check machine `spec:check`
  takes about 7.5 minutes.
- None is part of `bun test`.
- What each tool covers: the simulator (`quint run`) only its random runs (samples x steps);
  TLC every reachable state within the model's bounds, any run length; Apalache every run up
  to a depth bound. Only the simulator has been used so far. For TLC: `tlcCalm` and `tlcCrash`
  (one task, every counter capped: `ENV.bounded`), fairness per process, `AgentChangesStop`,
  and `NotAtCap`. At a cap every action is off, the fair ones too: the run stops there,
  `Progress` does not judge it, and the invariant `NotAtCap` reports it (a cap is a bound of the
  model, never a success). tlcCalm and tlcCrash have two person acts and caps above what
  their runs reach: `NotAtCap` holds there (spec.sh 400 runs, stress.sh 3000 runs of 300
  steps), so TLC checks the design, not the caps. Dead processes stay in the process map (a
  history, not state): the cap on processes counts them.
- Heavy runs go to the check machine (below).

## Files and status

work.qnt (store, protocol), tmux.qnt, workenv.qnt (environment, properties, witnesses,
instances), workenv_test.qnt (a regression test), keys.sh (the coverage gate), spec.sh,
stress.sh. Status: fifth review round; simulator only. No TLC or Apalache yet.

## Words

- **Spec** (specification): the system written as *state* (variables) plus *actions* (the ways
  the state may change). Quint is the language; it is a typed syntax over TLA+.
- **Obligation**: a thing that must happen next for the run to go on, read from the state alone.
- **Told**: printed to an actor as a *Do* step by its wait. A *Wait* step tells nobody to act.
- **Invariant**: a condition that must hold in every state the system can reach (safety).
- **Final**: everything is done, or everything owed is owed by the person.
- **Progress**: from every state, the run reaches Final in the end (liveness).
- **Fairness**: an act that stays possible is taken in the end; here, an honest agent does what
  it is told. The person is not assumed fair: a wait on the person is allowed.
- **Simulator** (`quint run`): random runs; it finds bugs fast and proves nothing.
- **TLC**: a model checker; it visits every reachable state of a small model, and checks
  progress under fairness. It runs on Java.
- **Counterexample**: a run, step by step, that breaks a property.
- **Store**: the one truth. An ordered, append-only log; the model keeps its fold (`Store`).
- **Act**: a request to the store (`Act`): its sender's token, what it asks, its content. The
  store takes it (it is appended) or refuses it.
- **Token**: the sender's identity and its **epoch** (`ep`), a counter the store raises when it
  revives or resumes that actor. A sender has only its own token.
- **Basis**: what an act was built on: the revision of its target it saw (`seen`), the item
  versions of its view (`seenDir`, their sum; `vers`, per item), and for a recheck the items
  it judged (`items`).
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
  `obligations`, `silence` (wait markers), `quiet` (terminal output). Module `cfgs`: the
  configurations `DESIGN`, `FIXED`, `HONEST`, `CALM`, `DEEP` (every starting state).
- Instances: `designHonest`, `designMaker`, `designRole`, `designPipe`, `designHost` (the design
  as written, one Byzantine class at a time, every fault); the same five as `fixed*` (every
  proposed check on, from every starting state; `fixedRole` and `fixedPipe` on a calm run);
  `fixedCalm`; `fixedMakerTake`, `fixedHostTake` (fixedMaker and fixedHost from the take-as-is
  starts 8 and 11: spec.sh reaches their rare key witnesses wDecideFought and wDecideRecheck
  there); `tlcCalm`, `tlcCrash` (for TLC); `noRecheckBasis`, `noDecideRecheck`,
  `noListOnAttach`, `noLadderRoute` (one check off on the fixed ones); `convFixed`, `convNoCross`, `convNoRaise`, `convNeither`,
  `convNoScope`, `convNoSplitLimits` (how the loop ends, DESIGN.md 13);
  `editAlways`, `editNever` (editBack 0 and 2); `beforeMove` (the live fault before e4e49ff);
  the mutants `mutPage`, `mutDup`, `mutCrash`, `mutCrashHi`, `mutTmux`, `mutMaker`, `mutRace`,
  `mutAccept`, `mutBuild` (the design as written on a calm run, one fault class each),
  `mutRole`, `mutPipe`, `mutRecheck` (honest except lies) and `mutPipeByz`, `mutRefByz` (a
  Byzantine pipeline role, where a lie is too rare); the witness modules `witnessCalm`,
  `witnessDone`, `witnessCrash`, `witnessFaults`, `witnessByz`.
- Environments (`cfgs`): `HONEST` (every fault, honest agents, every real cause); `CALM` (no
  fault, no reject, no duplicate sends, 10 person acts). `ENV.causes` limits the real causes a
  task may get. `ENV.starts`: the starting states a run may begin in (`START_OF`): 0 two new
  tasks; 1 both done and the top returned; 2 a standards draft about to ship, on items already
  fixed once at standard level; 3 a direction draft at the person; 4 rules with only a test
  command in effect; 5 a task taken as is with a recheck pending (not broken); 6 a done task
  with a recheck pending (its work broken by a change); 7 a done task with a recheck pending
  that the change did not break, and a direction draft of the other task at the person (its
  accept may break the done task while a recheck is in flight); 8 a direction draft of task 0
  at the person while a standards draft on task 0's standard is about to ship; 9 task 0 in
  revision, its maker holding its claim after one failed review; 10 near the change bound
  (task 0 a one-section split part with a standard cause, task 1 done after its standard
  change); 11 task 0's direction draft at the person while task 1's fighting reference-only
  rule is about to ship; 12 both tasks at the top rung, task 0's principle draft (a fighting
  reference-only rule) about to ship. `DEEP` is all of them. `ENV.dups`: the network may deliver an
  act twice (a fault). `ENV.liars`, `maxLies`, `lieOn`: actors honest except for lies (an act
  with any content, a budget of its own, only on the act kinds named, `KIND_OF`).
  `ENV.misjudge`: an honest pipeline role may evaluate shallower than the real cause (a
  mistake). `ENV.printsOften`: the timing assumption that a live terminal prints or renews its
  wait beat within x ticks. `ENV.bounded`, `maxProcs`, `maxVer`, `maxStep`: every counter
  stops at its cap (for TLC).

Sizes: two tasks (`CFG.slots`); one host, one persistent role, one pipeline role; maker ids
from 3 (at most `maxMakers` with `ENV.bounded`; unbounded otherwise); 3 tries; 2 sections per
task; 1 review-loop revision; 2 rule rewrites; 1 run continue; 3 environment faults; 3 acts in
flight; 6 person acts.

## Options (`CFG`; README of `cfgs` in workenv.qnt)

| Field | Meaning | `DESIGN` | `FIXED` |
|---|---|---|---|
| crossTest | DESIGN.md 13.1: rule assessment runs a new rule's test command on the other rules' examples; a rule that contradicts another does not ship. A reference-only rule has no test command: it cannot be cross-tested | on | on |
| raiseLevel | DESIGN.md 13.2, per task and per item. Per task (`Task.floor`): a split part's next evaluation is at least standard; after a change of the task's own raise, at least direction (after a direction change, principle); the store refuses an evaluation below the floor (a role draft, Fit, is off the ladder). Per item: a draft that changes an item already fixed at its level goes one level up | on | on |
| ladderRoute | DESIGN.md 13.2: a draft entered at direction or principle (a raise up the ladder, a contradiction) goes to the review loop and the person, whatever items its content names | on | on |
| strictScope | DESIGN.md 13: a split part owns one section less; a one-section task cannot be split (the store refuses it) | on | on |
| recheckBasis | a recheck names the items and versions it judged; the store refuses it if they moved | off | on |
| slots | the tasks of the top (`Set(0, 1)`; `tlcCalm` uses one) | 0, 1 | 0, 1 |
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
| rebind | e4e49ff: run continue moves the open host assignment to the new session | on | on |
| pumpReattach | the pump attaches again after another client's attach -d | off | on |
| hostWatched | the end of the host's pane (in the person's tmux) is reported | off | on |
| promptArg | a revive passes its prompt as an argument to the CLI; nothing is typed into the input line (off only in `mutTmux`) | on | on |
| idleSeen | the CLI's own "stopped at its prompt" hook: it counts as an exit, and the terminal shows Inactive | off | on |
| silentSteps | the ticks without a wait poll before a card shows Inactive (DESIGN.md: 1 minute) | 3 | 3 |
| reviewSubagents | a role gives its review to a subagent (then the role waits); Nanda's reading: no | off | off |
| editBack | DESIGN.md 10.1, open: after the pipeline role carries the person's direction edit down, back to the person: 0 always, 1 only when the change has items the person did not write (the proposal), 2 never | 1 | 1 |
| acceptCheck | the store refuses an accept or send-back of an escalation not waiting for the person at the append | on | on |
| decideRecheck | DESIGN.md 11 (Nanda's ruling): the person's "take as is" first rechecks the task against the changes that landed while it was raised | on | on (off only in `noDecideRecheck`) |
| briefCheck | the store refuses a report made under an old brief (an item that applies to the task moved since the maker read it) | off | on |
| listOnAttach | tmux: the pump lists the panes when it attaches (else it sees only the ends that happen while it is attached: edge-triggered) | off | on |

## DESIGN.md to Quint

| DESIGN.md | Quint (work.qnt unless named) |
|---|---|
| 1 Person | `PERSON`: `Reject`, `Accept`, `SendBack`, `Decide`, `EndProject`, `MoveHost` (run continue); workenv `personActs` |
| 1 Host | `HOST`: `SendTask`, `Reassign`, `TopDone` (agents never remake the top, DESIGN.md 13.1); its wait finds the top only through `hostFinds` |
| 1 Persistent role | `ROLE`: `AssignDo`, `Review` (its verdict is the decision), `Resume`; `card` |
| 1 Maker subagent | `Maker`, a fresh id per `AssignDo`; `ReadBrief`, `Report`; it lives inside the role's process (workenv `killed`, `Exit` of the role) |
| 1 Pipeline role | `PIPE`: `Evaluate`, `Advance`, `WriteRule`, `RunTest`, `Ship`, `LoopReview`, `RecheckDone` |
| 2 the loop | `SendTask` -> `AssignDo` -> `ReadBrief` -> `Report` -> `Review`: `Pass` (done), `Fail` (revision to the same maker, `revs + 1`), raise |
| 2.6 raise | `RaiseTries` (only when tries are used up), `RaiseNoRule`, `RaiseMisses`, the person's `Reject`; `raise` |
| 3 the five levels | `Evaluate` with `Level`; `Split` (a new task generation, one section less), `Fit` (role draft), `Principle`, `Direct`, `Standard` (`entryOf`); the real cause: `Task.cause`, `resolves` |
| 4 stages | `SPrinciple` -> `SDirAssess` -> `SStdAssess` -> `SRuleAssess` -> `STest` -> `SDraft`; `nextStage` |
| 4 rule forms | `Form`: `Mech` (test command), `Ref` (reference), `Both`; `WriteRule` (`flag`: the test's real behaviour, `flag2`: the reference exists); `RunTest` |
| 5 only a standard change? | `Ship`: the draft names `items` (content: `real`); no direction among them: `shipStandard` (in effect at once, back to the role); else `SLoop` |
| 5 review loop, change by human | `LoopReview`, `Accept`, `SendBack` |
| 5 role draft, only a role change? | `Evaluate` `Fit` -> `SLoop`; `Accept`: role-only -> `cardInEffect`, `backToRole`; else `SAccepted` -> `Reassign` |
| 6 C1, D7 | settled: DESIGN.md 12 (the host keeps the top; agents never remake it, 13.1) and DESIGN.md 13 (no budgets) |
| 13, 13.1 how the loop ends | `crossTest` (`Fix.fights`, `RunTest`); no agreeing rule: a contradiction found at `RunTest` goes at once to direction assessment (13.1), and a second contradiction of a draft already at direction goes on to the person (`Fix.contradicted`; a rule that fails its own examples is always written again); `raiseLevel` (`Task.floor` per task; `Store.fixDepth` per item, `refixed`, `raiseUp`); `ladderRoute`; `strictScope` (`Task.sections`); `changeBound`, `NoRefixAtSameLevel`, `NoAgentChangeAtTop` |
| 12 lifetimes | the host holds the top for the whole project (`Top` has no "hosted"; `TopDone` keeps it); roles never end |
| 7 Store | `accept`, `take`; workenv `storeTakes`, `storeRefuses` |
| 8 tmux | tmux.qnt; workenv `serverKilled`, `socketLost`, `serverRecreated`, `pumpStolen`, `pageServerRestarts`, `pumpAttaches`, `personTypes`, `personClears`, `promptRead`, `procReads` (output) |
| 10.1 the person's edit, the pipeline row | `EditDirection` (a pipeline entry `EDIT` at direction assessment; `wrote`), `shipEdit` (editBack), `atPerson` (acceptCheck); workenv `rowShown`, `DashRowMatches` |
| 10 dashboard | workenv `card` (the terminal's status: Inactive from tmux, the usage-limit message, or neither a wait poll nor output for x ticks), `cards`, `queue`, `escOf`, `rowShown`, `silence`, `quiet`, `tick`, `procPolls`, `procPrints`, `hitsLimit`; `LiveNotInactive`, `DashInactiveReal`, and the staleness properties |
| 11 take as is | `Decide` (the person, instead of the draft at the person) with `decideRecheck`: done with `pend` = the items that moved (`oldFor`); `RecheckDone` (with `recheckBasis` it names what it judged), `RunRule` |
| 9 per-item versions, scoped recheck | `Item`, `ITEMS`, `applies`, `Store.ver`, `Fix.items`/`real`, `itemsInEffect` (scope), `Task.pend`, `RecheckDone` (pipeline role), `RunRule` (harness), `Maker.brief` and `Task.checked` (snapshots `{item: version}`) |

## The environment to Quint (workenv.qnt)

| Fault | Quint |
|---|---|
| store refuses an act | `storeRefuses` |
| act late, out of order | `net` is a set; `storeTakes(k)` picks any act of sender k |
| act sent twice | `storeTakesKept` (taken; a copy stays in flight; only with `ENV.dups`); `procRepeats` (a resumed process sends its last act again) |
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
| machine reboot | `machineReboots`: the agents' server and the person's tmux (the host's pane) end at once |
| an end the pump did not see | `Proc.unseen`: a process that ended while the pump was not attached; seen later only with listOnAttach |
| usage limit | `hitsLimit`: the AI CLI shows its usage-limit message and stops (`Proc.limited`); a limited process does not hear; `limitLifts` (fair) ends the limit |
| terminal output | `quiet` (ticks since the terminal printed), `procPrints`, every act and read prints |
| socket gone, processes run | `socketLost`: processes run on; the pump cannot see them; a new server (`serverRecreated`) does not have them |
| pump detached / page server restart | `pumpStolen`, `pageServerRestarts`, `pumpAttaches` |
| input line | `personTypes`, `personClears`. A revive passes its prompt as an argument (promptArg), so no engine text is typed; with promptArg off (`mutTmux`) it is typed (`queuePrompt`) and merges with a line the person had already started (`promptRead`) |
| wait markers, time | `silence` (per persistent role, ticks since its last poll), `tick`, `procPolls`, `procReads` |
| person acts any time or never | `personActs`; not fair |

## Act content

`flag` and `flag2` mean, per act: `Report` flag: the maker slipped; `WriteRule` flag: the test
command really behaves on its examples, flag2: the reference exists; `RunTest` flag: the
pipeline role's claim of the outcome, flag2: its claim that the test failed on another rule's
example (a contradiction); `Evaluate` with `Fit` flag: the label "only a role change", flag2: the content; `LoopReview` flag: hand the
draft to the person; `Decide` flag: take the result as it is; `RecheckDone` flag: it still
holds. `cause` on `Evaluate` (split): the real cause of the new task part. `hits` on
`Ship` and `Accept`, the person's too (ghost, the environment's truth): the tasks whose work
the change breaks, raised tasks included; their result becomes bad (`Task.broken`, `rBad`)
until it is made again under the new versions. A recheck judges only that (`broken`), not a
defect the person took as it is (`Task.taken`). `vers` on `Evaluate` and `EditDirection`: the
item versions the sender says its content is built on (the draft's `base`, compared and set at
the append with rebase); `realVers` (ghost): the versions it really is built on (`trueBase`,
which NoLostUpdate reads; they differ only for a Byzantine sender).

## Properties

Each property is the negation of one history flag (`s.g.*`, a ghost the store never reads).
For each: its tier, its kind, and its mutant (the module where it must break, with a seed in
spec.sh `--check`, found by `bun run spec:stress`). "Not seen" = the mutant is defined but no
violation came in the runs given.

Kind: **guard** = the flag is set on exactly the act a store check refuses, so the property is
a regression check of that check (it fails the moment the check is switched off, and says
nothing more). **guard (option)** = the flag compares with a truth (the content, what the page
showed, the test command's real result) that the store reads through that option; with the
option on (FIXED) it is true by construction; its mutant shows the option is needed.
**content** = the flag compares with a truth the store cannot read even with every check on
(the real cause, the quality of a result, what a change really breaks, what a lost context or
tmux did, a Byzantine sender's real base, the count of agent changes); these are the
properties that say the design is right.

Tier 1, safety under Byzantine agents and faults:

| Property | Kind | The impossible state | Mutant (the check it shows needed) |
|---|---|---|---|
| NoActByEnded | guard | an act of a maker that is not the task's live maker was taken | mutMaker (endedCheck) |
| NoClaimByEnded | guard | a claim held by a maker the store ended or holds as down | none: endedCheck also covers ReadBrief |
| NoReviewOfOtherResult | guard | a review was applied to another result than the one read | mutDup (basis) |
| NoPassUnderOtherVersion | guard | a pass by a reviewer whose view had other item versions | mutRace (basis) |
| NoStaleReport | guard | a report answered another revision than the one it was made for | mutDup (basis) |
| NoStalePipelineAct | guard | a pipeline act applied to a stage it was not made for | mutDup (basis) |
| NoSplitBrain | guard | an act of an older epoch of its actor was taken | mutCrash (epochs) |
| EveryRuleHasForm | guard | a rule took effect with neither evidence form | mutPipeByz (formCheck) |
| NoBadReference | guard | a rule took effect with a reference that does not exist | mutRefByz (refCheck) |
| NoRejectedDraftInEffect | guard | a draft the person sent back took effect by an earlier accept | mutAccept (acceptCheck) |
| NoAcceptNotWaiting | guard | an accept took effect on an escalation that did not wait for the person at its append | mutAccept (acceptCheck) |
| NoUnrevisedResubmit | guard | a draft the person sent back reached the person unchanged | mutPipe (reviseCheck) |
| NoUnacceptedEditChange | guard | the person's edit put into effect items the person did not write and did not accept | editNever (editBack) |
| HostBoundToRunSession | guard | the host's assignment of the top is on another session than the run's | beforeMove (rebind, e4e49ff) |
| NoWrittenDropped | guard (classify) | the person's edit took effect without an item the person wrote | mutPipeByz (classify); true by construction with classify on (the store reads the content) |
| NoUnseenReject | guard (basis, build) | the person's reject hit a result the page did not show | mutBuild (build); mutPage (basis): not seen in 1000 runs |
| NoUnseenAccept | guard (basis) | the person's accept hit a draft the page did not show | mutPage (basis) |
| NoLostUpdate | content | a draft took effect built on an older version of an item it changes (`trueBase`) | mutRace (rebase) |
| NoFailedTestInEffect | guard (harnessTest) | a rule took effect whose test command fails its examples | mutPipeByz (harnessTest) |
| NoDeepChangeWithoutPerson | guard (classify) | a change of the direction took effect without the person | mutPipe (classify) |
| NoRoleChangeMisjudged | guard (classify) | a role draft that changes more went back to the card without the host's reassign | mutPipeByz (classify) |
| NoUnrecheckedScope | guard (classify) | a change missed a task its content touches | mutPipe (classify) |
| NoPassOfBrokenResult | guard (passTests) | a pass of a result a test-command rule catches | mutRole (passTests) |
| NoPassOfBadResult | content | a pass (or a passed recheck) of a bad result | mutRole, mutRecheck, noRecheckBasis (recheckBasis; start 7); breaks in fixedRole (and in principle fixedPipe; not seen there in 1000 runs) by design: no store check judges quality |
| NoShallowEvaluation | content | an evaluation at a level that cannot remove the real cause | mutPipeByz; breaks in fixedPipe and convFixed (misjudge) by design: no store check knows the cause |
| RevisionHasContext | content | a revision worked by a maker that lost its context | mutCrash (fullBrief; start 9); mutCrashHi from a fresh start: not seen in 3000 runs |
| NoMergedInput | content | a typed prompt merged with the person's typing was read | mutTmux (promptArg) |
| DoneIsCurrent | content | a done task with nothing left to recheck is under an old version of an item that applies to it | noDecideRecheck (decideRecheck, DESIGN.md 11) |
| NoDoneBrokenAtEnd | content | the project ended with a done task whose work a change broke (`hits`) | mutRecheck (a lying recheck) |
| NoTakenUndone | content | a recheck undid a task the person took as is, though the change broke nothing (DESIGN.md 11) | mutRecheck |
| NoRefixAtSameLevel | guard (raiseLevel) | an item or a task fixed again at the same or a lower level (DESIGN.md 13.2) | convNoRaise, convNeither (raiseLevel) |
| NoEscalationWithoutPerson | guard (ladderRoute) | a draft raised to direction or principle took effect without the person | noLadderRoute (a lying pipeline role names only standards) |
| Converges | derived (raiseLevel, strictScope, ladderRoute) | the agents made more than `changeBound` changes (standard changes and splits) | convNoSplitLimits (strictScope and raiseLevel off) |
| NoAgentChangeAtTop | guard (raiseLevel, ladderRoute) | a change of a task already at the top rung (floor principle) took effect without the person | noLadderRoute (start 12) |

`changeBound` is derived from the config: per task, sections - 1 splits and then one standard
change (the task's floor then goes to direction, which reaches the person); slots x sections,
4 with 2 tasks and 2 sections. It does not depend on the number of items. Under FIXED it
follows from three store checks (an evaluation below the task's floor is refused, a split at
one section is refused, a raised draft goes to the person): a derived property; its value is
that those checks imply the bound. Past the top rung the person is the end (DESIGN.md 13):
a task at principle may change again, one principle change through the person per new
fight (start 12 shows it); nothing bounds that count but the person, who can send the draft
back or take the task as is. NoAgentChangeAtTop checks that each such change goes through the
person. It is a check of the model, not a budget of the design: the design has none.

Removed: NoDraftDropped and the kept-draft handling (agents never remake the top, DESIGN.md
13.1); C1aConfirmed and C1bHosted (DESIGN.md 12: the host keeps the top); NoDoneUnderOldVersion
(merged into DoneIsCurrent); ChangesWithinBudget (no budgets); LiveNotInactive and
DashInactiveReal (they restate the model's own assumption and definition).

Store-shape sanity (`Sane`; a violation is a bug of the model): `DoneIsClosed`,
`OneMakerPerTask`, `RaiseHasOwner`.

Dashboard staleness (not in the holds runs; see "Simplified"): DashNoFalseWorking,
DashQueueActive, DashEscalationMatches, DashRowMatches (mutPage). PageOffersPersonObs holds by
the page's definition: the quint test `workenv_test.qnt`.

Tier 2, told once: `EveryObligationToldOnce` (beforeMove; mutTmux (pumpReattach);
noListOnAttach (listOnAttach)), `ToldIsAllowed`, `SomethingOwed`. A process held by a usage
limit hears nothing; the engine owes it nothing until the limit lifts (a fair step).

Convergence (DESIGN.md 13 and 13.1), 600 steps per run:

- convFixed (crossTest, raiseLevel, strictScope on; a pipeline role that can misjudge the
  level; rules that can contradict): holds.
- convNoRaise (raiseLevel off): breaks NoRefixAtSameLevel (a misjudged standard fix repeats
  at the same level) and Converges.
- convNeither (crossTest and raiseLevel off): breaks NoRefixAtSameLevel (two rules ping-pong)
  and Converges.
- convNoCross (crossTest off, raiseLevel on, a person with 40 acts): holds Converges and
  NoAgentChangeAtTop. A contradiction is raised
  to direction and principle, which go to the person: more work for the person, not an
  endless loop. Whether the person's direction change resolves a contradiction is the
  environment's choice at the accept (`flag3`); if not, the rule still fights.
- convNoScope (strictScope off): holds. The split floor (with raiseLevel on, a split part
  cannot be split again; its next fix is a standard or higher) already ends splits; strict scope and the floor overlap.
- convNoSplitLimits (strictScope and raiseLevel off): breaks Converges (splits never end) and
  NoRefixAtSameLevel.

Tier 3, progress: `FairProgress` and `AgentChangesStop` (temporal, with per-process fairness).
For TLC; not yet run.

Holds (no violation, every key witness of keys.sh reached): fixedHonest, fixedMaker,
fixedHost, fixedCalm, convFixed (except NoShallowEvaluation), fixedRole (except
NoPassOfBadResult, NoDoneBrokenAtEnd), fixedPipe (except NoShallowEvaluation,
NoPassOfBadResult, NoDoneBrokenAtEnd). spec.sh: 400 runs of 300 steps; stress.sh: 3000 runs
of 300 steps (convFixed 600), on c2b4405 (2026-11-17): every module held, every key witness
was reached, and the witness sweep reached every witness. tlcCalm and tlcCrash: NotAtCap
held in 3000 runs of 300 steps.

## Witnesses

One per action and per fault; the five witness modules together reach each in > 0 runs
(numbers in the review report). Each `w*` in workenv.qnt names what it covers.


## Simplified or left out on purpose (declared)

- The top task starts open and hosted, bound to session 0 (or in a deep start, `ENV.starts`).
  The host and the roles live as long as the project (DESIGN.md 12): returning the top does not
  end the host; agents never remake the top (DESIGN.md 13.1); there is no "give the top again".
- One persistent role for both tasks. Reassign ends the role's open work and sends it again
  (its makers end); it is not counted as an agent change.
- A split replaces the task by one finer task in the same slot (a new generation).
- Always-on store checks (the store's state machine): the stage order; a maker act only on a
  working task; `Fail` only while tries remain and `RaiseTries` only when they are used up;
  `Accept` only at the person; `Reject` only of a result in review or done; `EndProject` only
  once the host returned the top and no recheck is pending.
- Rule rewrites past `maxRuleTries` must take the reference form (DESIGN.md has no bound). A
  reference-only rule cannot be cross-tested, so a contradiction can still ship through it.
- The person's "take as is" (`Decide`) is offered at the person instead of the draft
  (DESIGN.md 11: "any person's done"); there are no budgets, so no other path reaches it.
- The truth of a contradiction is the environment's choice (`WriteRule` `flag3`, a ghost the
  store never reads): a rule that fights the other rule of the direction breaks the tasks that
  rule applies to and gives them a standard cause again (the ping-pong of DESIGN.md 13,
  example d20). Any direction draft can change any standard or rule (`ITEMSETS` is
  symmetric). An honest pipeline role evaluates at the real cause; with `misjudge` it may
  evaluate shallower (a mistake).
- Convergence: `changeBound` = slots x sections = 4 agent changes (README "Properties").
  Fixes at direction and principle level reach the person and are not counted.
- A rule with both forms: the test command finds candidates, the role judges; `passTests`
  covers only rules with a test command alone, and the harness rechecks only those (`RunRule`);
  a rule with both forms is rechecked by the pipeline role (`RecheckDone`).
- An honest agent is competent: it reviews correctly and evaluates at the real cause. The
  store cannot protect review quality or the choice of level from a Byzantine role or
  pipeline role: `NoPassOfBadResult` and `NoShallowEvaluation` (and, through a passed recheck,
  `NoDoneBrokenAtEnd`) break in `fixedRole` and `fixedPipe`, by design of the problem.
- History flags read from a sender's own basis (`seen`, `seenDir`, `ctx`) count only for
  non-Byzantine senders: a Byzantine sender can write the right basis while acting on a wrong
  one. For them only the store's refusal of a wrong claimed basis is checked.
- Fairness is per process (process ids 0-11, `procFair`; a stale process of an actor cannot
  stand in for the live one) and per sender, not per act in flight; an honest sender has one
  act in flight at a time; every sender at most `maxNet`. The page refreshes fairly; a usage
  limit lifts fairly.
- A Byzantine process goes on after a stop at its prompt at most twice; the page
  refreshes only when the store changed (else random runs stay shallow).
- Time is a tick that ages every wait marker and every output marker (they stop at x, so time
  never ends); a poll resets the wait marker, any output the output marker. The card shows the
  actor's latest process (an old one left running by a lost socket is not its terminal).
- The terminal card's Inactive (DESIGN.md 10): tmux disconnected, the usage-limit message,
  the CLI's own "stopped at its prompt" hook (idleSeen), or 1 minute with neither a wait poll
  nor output. The 1-minute rule rests on an assumption (`ENV.printsOften`; LiveNotInactive
  restates it, so it is not a check): a live terminal prints or renews its beat within the
  minute. What it cannot see: a CLI that keeps redrawing while stuck never shows Inactive; a
  hung tool call that prints nothing shows Inactive only after the minute.
- The truth of what a change breaks is the environment's choice (`hits`); a result made under
  an old brief stays broken.
- The person's direction edit, once in effect (accepted, or at once by editBack), goes to the
  host's reassign like any accepted direction draft.
- The page offers run continue only while its view shows session 0 (a bound of the model;
  an old page can still send it twice). The old host process ends with it.
- fde5e40 (a finished host assignment held the session) has no path under DESIGN.md 12 (the
  host's assignment never finishes), so its "before" module is gone; HostBoundToRunSession
  rests on rebind (e4e49ff, `beforeMove`).
- Not done (the review's "nice to have"): the card version in the task's snapshot; a test
  command that catches only some bad results (`mechCatches` assumes every one); a Byzantine
  view (a Byzantine process never reads; its lying basis is random); `Review` `Fail` with no
  live maker adds to tries, then `AssignDo` resets them; `EndProject` is legal while the
  person's edit is open.
- Done tasks are rechecked; active tasks are rechecked by their running role (the maker reads
  its brief again; the role reviews under the new versions), not by a separate act.
- The dashboard's "matches" properties (DashNoFalseWorking, DashQueueActive,
  DashEscalationMatches, DashRowMatches) compare the page's copy with the store. A page can
  only render a copy, so they break in every configuration while the page is stale: they
  measure the staleness window, they are not safety goals. Every act the page sends is still
  checked by the store (NoUnseenReject, NoUnseenAccept, NoAcceptNotWaiting).
- No text, no timing, no store, page or CLI as code.

## The check machine (arch-temp)

Heavy runs (TLC on full models, long simulations, Apalache) go to `ssh arch-temp`: 14 cores,
28 GB, Java 21, Node, Bun, Quint 0.33.1 (`~/aristoteles`, synced by rsync without .git, plan/,
node_modules). Use up to `_JAVA_OPTIONS=-Xmx24g` there; arch-3 keeps the quick checks and the live runs.
