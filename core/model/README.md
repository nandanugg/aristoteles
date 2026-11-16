# core/model: the work design as Quint specs

These files describe how aristoteles *should* behave, in Quint, and check it. The source is
plan/model/DESIGN.md (the design Nanda locked on 2026-11-16). They are test-only; no code imports
them. Only this new design is modelled: the code moves to it (v1, no compatibility), so the
specs of the old flow were removed.

The goal (Nanda, 2026-11-16): the system is **stall-free by design**. Every run ends, or it
waits only on the person, and the person is told what to do. No supervisor that restarts idle
agents, no reminder, is the fix.

## How to run

- `bun run spec`: typechecks every `.qnt` file, then simulates the design (no violation
  expected). About 2.5 minutes.
- `bun run spec:check`: the same, and each mutant must break its property with its recorded
  seed (the script turns quint's failure into a pass). About 10 minutes (run it on the check
  machine).
- `bun run spec:stress`: for the check machine. Every design module with every proposed check
  in 3000 runs of 150 steps, and a seed search for each mutant (one thread, so a seed
  reproduces); it prints the `breaksW` lines for spec.sh. About 40 minutes on 13 cores.
- None is part of `bun test`.
- What each tool covers: the simulator (`quint run`) only its random runs (samples x steps);
  TLC every reachable state within the model's bounds, any run length; Apalache every run up
  to a depth bound. Only the simulator has been used so far.
- Heavy runs (TLC, Apalache, long simulations) go to the check machine (below).

## Files and status

work.qnt (store, protocol), tmux.qnt, workenv.qnt (environment, properties, witnesses,
instances), spec.sh, stress.sh. Status: third review round; simulator only (smoke runs here,
3000-run holds and the seed search on the check machine). No TLC or Apalache yet.

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
  `obligations`, `silence` (wait markers), `quiet` (terminal output). Module `cfgs`: the
  configurations `DESIGN`, `FIXED`, `HONEST`, `CALM`.
- Instances: `designHonest`, `designMaker`, `designRole`, `designPipe`, `designHost` (the design
  as written, one Byzantine class at a time, every fault); the same five as `fixed*` (every
  proposed check on; `fixedRole` and `fixedPipe` on a calm run); `fixedCalm` (every check, a
  calm run, budget 1); `c1b`, `d7none`, `d7shrink` (Nanda's options); `editAlways`,
  `editNever` (editBack 0 and 2); `noDecideRecheck`, `noShrinkSplit`, `noListOnAttach` (one
  check off on the fixed ones); `beforeBind`, `beforeMove` (the live faults before fde5e40 and
  e4e49ff); the mutants `mutPage`, `mutDup`, `mutCrash`, `mutTmux`, `mutMaker`, `mutRole`,
  `mutPipe`, `mutRef`, `mutRace`, `mutDash`, `mutAccept`, `mutBuild`, `mutQuiet` (the design
  as written on a calm run, one fault class each, so random runs go deep); the witness modules
  `witnessCalm`, `witnessDone`, `witnessCrash`, `witnessFaults`, `witnessStuck`, `witnessByz`.
- Environments (`cfgs`): `HONEST` (every fault, honest agents, every real cause); `CALM` (no
  fault, no reject, 10 person acts). `ENV.causes` limits the real causes a task may get, so a
  calm run reaches done tasks. `ENV.start` 1 starts deep: both tasks done and the top returned
  to the person. `ENV.printsOften`: the timing assumption that a live terminal prints or
  renews its wait beat within x ticks (false only in `mutQuiet`).

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
| dashInactiveFromView | a mutant: a card is also Inactive when the page's copy says the role is down | off | off |
| silentSteps | the ticks without a wait poll before a card shows Inactive (DESIGN.md: 1 minute) | 3 | 3 |
| reviewSubagents | a role gives its review to a subagent (then the role waits); Nanda's reading: no | off | off |
| editBack | DESIGN.md 10.1, open: after the pipeline role carries the person's direction edit down, back to the person: 0 always, 1 only when the change has items the person did not write (the proposal), 2 never | 1 | 1 |
| acceptCheck | the store refuses an accept or send-back of an escalation not waiting for the person at the append | on | on |
| decideRecheck | DESIGN.md 11 (Nanda's ruling): the person's "take as is" first rechecks the task against the changes that landed while it was raised | on | on (off only in `noDecideRecheck`) |
| briefCheck | the store refuses a report made under an old brief (an item that applies to the task moved since the maker read it) | off | on |
| shrinkAcrossSplit | D7 shrink: a split keeps the task's bound of points (else a split resets it and the loop never shrinks) | off | on |
| listOnAttach | tmux: the pump lists the panes when it attaches (else it sees only the ends that happen while it is attached: edge-triggered) | off | on |

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
| 10 dashboard | workenv `card` (the terminal's status: Inactive from tmux, the usage-limit message, or neither a wait poll nor output for x ticks), `cards`, `queue`, `escOf`, `rowShown`, `silence`, `quiet`, `tick`, `procPolls`, `procPrints`, `hitsLimit`; `LiveNotInactive`, `DashInactiveReal`, and the staleness properties |
| 11 take as is | `Decide` with `decideRecheck`: done with `pend` = the items that moved (`oldFor`); `RecheckDone`, `RunRule` |
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
| machine reboot | `machineReboots`: the agents' server and the person's tmux (the host's pane) end at once |
| an end the pump did not see | `Proc.unseen`: a process that ended while the pump was not attached; seen later only with listOnAttach |
| usage limit | `hitsLimit`: the AI CLI shows its usage-limit message and stops (`Proc.limited`) |
| terminal output | `quiet` (ticks since the terminal printed), `procPrints`, every act and read prints |
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
holds. `cause` on `Evaluate` (split) and `RemakeTop`: the real cause of the new task. `hits` on
`Ship` and `Accept` (ghost, the environment's truth): the tasks whose work the change breaks;
their result becomes bad (`Task.broken`, `rBad`) until it is made again under the new
versions, so a recheck has something real to find.

## Properties

Each property, its tier, and its mutant: the module where it must break, with the seed in
spec.sh `--check` (from `bun run spec:stress`). "Not seen" = the mutant is defined but no
violation came in the runs given (they need the deep starts or targeted environments of the
stress phase).

Tier 1, safety under Byzantine agents and faults. One invariant each:

| Property | The impossible state | Mutant (check it shows needed) |
|---|---|---|
| NoActByEnded | an act of a maker that is not the task's live maker was taken | mutMaker (endedCheck) |
| NoClaimByEnded | a claim held by a maker the store ended or holds as down (a late read by an ended maker) | witnessCalm (endedCheck: it must cover ReadBrief too) |
| NoReviewOfOtherResult | a review was applied to another result than the one read | mutDup (basis) |
| NoPassUnderOtherVersion | a pass by a reviewer whose view had other item versions | mutRace (basis): not seen in 3000 runs |
| NoStaleReport | a report answered another revision than the one it was made for | mutDup (basis) |
| NoUnseenReject | the person's reject hit a result the page did not show (the live case: the page shows r0, the role fails it, the maker reports r1, the reject on the old page hits r1) | mutPage (basis); mutBuild (build: an old-build act names no basis, so it skips the basis check) |
| NoUnseenAccept | the person's accept hit a draft the page did not show | mutPage (basis): not seen in 3000 runs |
| NoRejectedDraftInEffect | a draft the person sent back took effect by an earlier accept | mutAccept (acceptCheck) |
| NoLostUpdate | a draft built on an older version of an item it changes took effect | mutRace (rebase: compare and set at the append) |
| NoFailedTestInEffect | a rule took effect whose test command fails its examples | mutPipe (harnessTest) |
| EveryRuleHasForm | a rule took effect with neither evidence form | mutPipe (formCheck) |
| NoBadReference | a rule took effect with a reference that does not exist | mutRef (refCheck) |
| NoDeepChangeWithoutPerson | a change of the direction took effect without the person | mutPipe (classify): not seen in 3000 runs |
| NoRoleChangeMisjudged | a role draft that changes more went back to the card without the host's reassign | mutPipe (classify): not seen in 3000 runs |
| NoUnrecheckedScope | a change missed a task its content touches (named items fewer than the real ones) | mutPipe (classify) |
| NoPassOfBrokenResult | a pass of a result a test-command rule catches | mutRole (passTests): not seen in 1000 runs |
| NoPassOfBadResult | a pass (or recheck) of a bad result | mutRole; fixedRole: no store check can judge quality |
| NoShallowEvaluation | an evaluation at a level that cannot remove the real cause | mutPipe; fixedPipe: no store check can know the cause |
| NoStalePipelineAct | a pipeline act applied to a stage it was not made for | mutDup (basis) |
| NoSplitBrain | an act of an older epoch of its actor was taken | mutCrash (epochs) |
| RevisionHasContext | a revision worked by a maker that lost its context | mutCrash (fullBrief): not seen in 3000 runs |
| NoUnrevisedResubmit | a draft the person sent back reached the person unchanged | mutPipe (reviseCheck) |
| NoMergedInput | a revive's prompt merged with the person's typing was read | mutTmux (waitEmptyInput) |
| NoDoneUnderOldVersion | the project ended with a task done under an old version of an item that applies to it | noDecideRecheck: not seen in 1000 runs (DoneIsCurrent shows the same state) |
| DoneIsCurrent | a done task with nothing left to recheck is under an old version of an item that applies to it (the reviewer's case: past the budget, a change lands on the raised task, the person takes it as is) | noDecideRecheck (decideRecheck, now DESIGN.md 11) |
| NoDoneBrokenAtEnd | the project ended with a done task whose work a change broke (ground truth: `hits`) | mutRecheck (a Byzantine pipeline role passes the recheck): not seen in 1000 runs |
| NoAcceptNotWaiting | an accept took effect on an escalation that did not wait for the person at its append | mutAccept (acceptCheck) |
| NoUnacceptedEditChange | the person's direction edit put into effect items the person did not write and did not accept | editNever (editBack 2) |
| HostBoundToRunSession | an open run's top task has its open host assignment on another session | beforeMove (rebind, e4e49ff); beforeBind (bindOpenOnly, fde5e40; from the deep start: top returned, a reject reopens it, the person gives it again) |
| C1aConfirmed | under C1 a, a remake not built on the host's warning (a duplicate of the first remake) | mutDup (basis) |
| C1bHosted | the top has no host (not done, not ended) | witnessCalm (C1 a); holds in c1b |

ChangesWithinBudget was dropped: it restated the store's own guard (the budget is checked
where a change takes effect).

Store-shape sanity (`Sane`; a violation is a bug of the model): `DoneIsClosed`,
`OneMakerPerTask`, `RaiseHasOwner`. (ClaimOnlyLive left it: it is a protocol property,
NoClaimByEnded.)

The dashboard (DESIGN.md 10). The terminal card (Nanda: Inactive is the terminal's status):

| Property | The impossible state | Mutant |
|---|---|---|
| LiveNotInactive | a live terminal (it works, or waits in `work wait`; within its limit) shows Inactive | mutQuiet (without the timing assumption: a live terminal may print nothing and renew no beat for x ticks) |
| DashInactiveReal | Inactive from the page's copy of the store (it restates `card` unless the mutant) | mutDash |
| PageOffersPersonObs | a step the page's view owes the person that the page does not offer (the reviewer's case: a top split the host can no longer remake; now offered, and the row shows it) | none: the fix is in; no mutant |

The staleness properties compare the page's copy with the store; a page can only render a
copy, so they break whenever the page is stale (they are not in the holds runs):
DashNoFalseWorking, DashQueueActive, DashEscalationMatches, DashRowMatches (mutPage).

Tier 2, told once: `EveryObligationToldOnce` (mutants beforeMove, mutTmux (pumpReattach);
noListOnAttach: not seen in 1000 runs), `ToldIsAllowed`, `SomethingOwed`. A legal wait: the
one actor told does not hear and the engine owes the next move (`engineOwes`), or a host's
step while the top has no host (`hostWaitsOnPerson`: the person is told to open the top).

Convergence: `Converges` = agent changes stay within `maxChanges` and makers within
`maxMakers`. A violation is a finding (the run goes on past them), never a success. Mutants:
d7none (every real cause) and noShrinkSplit: not seen in 3000 runs.

Tier 3, progress: `FairProgress` = `Fairness` (each honest actor, each sender's acts, the
watcher, the pump and hooks, a new server, the pump attaching, a typed prompt read) implies
`always(eventually(final))`. Final is never "past the bound". Not yet run (TLC).

Holds (no violation, 3000 runs of 150 steps on the check machine): fixedHonest, fixedMaker,
fixedHost, fixedCalm, c1b, d7shrink, and fixedRole / fixedPipe except the two properties no
store check can hold.

## Witnesses

One per action and per fault; the five witness modules together reach each in > 0 runs
(numbers in the review report). Each `w*` in workenv.qnt names what it covers.


## Simplified or left out on purpose (declared)

- The top task starts open, hosted, bound to session 0 (or, with `ENV.start` 1, done and
  returned to the person).
- One persistent role for both tasks. Reassign ends the role's open work and sends it again
  (its makers end); it is not counted as a change by D7.
- A split remakes the task as one finer task in the same slot (a new generation).
- Always-on store checks (the store's state machine): the stage order; a maker act only on a
  working task; `Fail` only while tries remain and `RaiseTries` only when they are used up;
  `Accept` only at the person; `Reject` only of a result in review or done; `EndProject` only
  once the host returned the top; `RemakeTop` only within the D7 budget.
- Rule rewrites past `maxRuleTries` must take the reference form (DESIGN.md has no bound).
- Past the D7 bound the person decides: take the result as it is (done, after the recheck of
  DESIGN.md 11) or evaluate again. A split of the top the host can no longer remake is also
  the person's decision (the page offers it, the row shows it).
- A rule with both forms: the test command finds candidates, the role judges; `passTests`
  covers only rules with a test command alone, and the harness rechecks only those (`RunRule`);
  a rule with both forms is rechecked by the pipeline role (`RecheckDone`).
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
- Time is a tick that ages every wait marker and every output marker (they stop at x, so time
  never ends); a poll resets the wait marker, any output the output marker. The card shows the
  actor's latest process (an old one left running by a lost socket is not its terminal).
- The truth of what a change breaks is the environment's choice (`hits`); a result made under
  an old brief stays broken.
- The person's direction edit, once in effect (accepted, or at once by editBack), goes to the
  host's reassign like any accepted direction draft.
- The page offers run continue only while its view shows session 0 (a bound of the model;
  an old page can still send it twice). The old host process ends with it.
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
