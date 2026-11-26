# Quint models

## Metis-first checks

[CORE.md](../../plan/types/CORE.md) specifies the shared lines, current scope, and fault classes. The first slice covers onboarding proposals and activation, staff sessions, questions, and a task through review. It derives back or raise from reported facts. A raised task is the endpoint of this slice.

`lines.qnt` supplies the shared edge check, task and proposal moves, and review evidence and decision rules. `people.qnt` supplies session authority, capacity, review slot selection, and questions. `activation.qnt` holds the lifecycle, durable commit and binding observations, and rollback checks. The finite cases use small identities and abstract external observations, including a fixed marker file, process acknowledgements, exact evidence, and an interrupted operation followed by recovery. Runtime conformance to the new lines starts with their implementation.

| Command | Result |
| --- | --- |
| `bun run spec` or `bun run spec:check` | In each registered case, sample `Safety`, witness `Success` and `Fault`, and require the guard-removed variant to violate `Safety`. |
| `bun run spec:tlc` | Exhaust the reachable state space under `Safety`. Require the variant to violate the same invariant. |
| `ONLY=reviewSlot bun run spec:tlc` | Run the selected registry rows. `ONLY` accepts an extended regular expression. |

[The registry](checks/registry.tsv) controls both runners. Add `checks/<name>.qnt` with modules `<name>` and `<name>Mutant`, then add one row with the approved fault classes, the 120-second target, and the 600-second cutoff. Each file defines `init`, `step`, `Safety`, `Success`, and `Fault` in a shared case module. Use `Success` for the normal path and `Fault` for the interleaving or refusal that the safety check protects. The variant removes one guard. A syntax error, failed checker invocation, missed witness, or timeout fails the run. Logs are written to `OUT` or to a new temporary directory.

### Size budget

The shared model stays under about 500 lines. Each check stays under about 80. Each phase row names the duty and its legal destinations. A part that cannot fit needs a review of what forces its size before it grows.

| Shared file | Lines |
| --- | ---: |
| [lines.qnt](lines.qnt) | 170 |
| [people.qnt](people.qnt) | 81 |
| [activation.qnt](activation.qnt) | 106 |
| **Total** | **357** |

### TLC results

Wall time includes Quint translation and checker startup. Mutant counts show the states reached before the violation.

| Check file | Lines | Safety states | Wall time | Mutant states | Mutant wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| [taskReportRace.qnt](checks/taskReportRace.qnt) | 49 | 27 | 5 s | 23 | 6 s |
| [reviewEvidence.qnt](checks/reviewEvidence.qnt) | 64 | 68 | 6 s | 8 | 5 s |
| [reviewSlot.qnt](checks/reviewSlot.qnt) | 69 | 288 | 6 s | 6 | 6 s |
| [staffCapacity.qnt](checks/staffCapacity.qnt) | 58 | 81 | 6 s | 21 | 5 s |
| [onboardingReview.qnt](checks/onboardingReview.qnt) | 68 | 30 | 6 s | 14 | 6 s |
| [activationCommit.qnt](checks/activationCommit.qnt) | 72 | 43 | 6 s | 44 | 6 s |
| [activationRollback.qnt](checks/activationRollback.qnt) | 62 | 30 | 5 s | 24 | 6 s |
| [activationHostBinding.qnt](checks/activationHostBinding.qnt) | 71 | 122 | 6 s | 22 | 6 s |
| [staffReplacement.qnt](checks/staffReplacement.qnt) | 79 | 12 | 7 s | 8 | 6 s |
| [questionAnswer.qnt](checks/questionAnswer.qnt) | 33 | 20 | 6 s | 4 | 5 s |

All ten safety invariants held, and each mutant violated the same invariant. The simulator also reached both named witnesses in each case.

## Retained models

The core subsets below still support the post-raise resolution, changed guidance, and scoped work that follow the Metis slice. The recheck helper and pipeline lane remain available until those paths change. Terminal and page adapters retain their separate checks. Run retained jobs explicitly with `sh core/model/spec.sh --remaining [--check]` or `sh core/model/tlc.sh --remaining`. Use `ONLY` to select an instance. These suites are separate from the Metis registry and its acceptance results.

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
- **Token**: the sender's identity and its **epoch** (`epoch`), a counter the store raises when it
  revives or resumes that actor. A sender has only its own token.
- **Basis**: what an act was built on: the revision of its target it saw (`seen`), the item
  versions of its view (`seenVersions`, their sum), and for a recheck the items
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
- **History flag**: a field of `Store.ghost` that records an impossible state the store let in.
- **Witness**: a state that should be reachable; `quint run --witnesses` counts the runs that
  reach it. Zero means a dead action.
- **Mutant**: a configuration where a property must break; it proves the property can see the
  fault.

## Files and modules

- `protocol.qnt`, module `protocol`: the store and the protocol, pure (no variables). For each
  act, together: when the store takes it (`allowed`: the token, the act's own legality, its
  basis `basisOk`), what it changes (`effect`), what the wait tells an actor to do it (`toldSteps`).
  The store's check `accept` (the epoch, `allowed`, the build check) and `take` (the effect and
  `sweep`), the obligations `obligationsOf`, `finalOf`, `pastBound`, the waits `waitsFor`.
- `types.qnt`, module `types`: the actors, the acts, the records of the store; no logic.
- `check.qnt`, module `check`: the composed model (G2): the actors around the protocol
  (`agentStep`, `personStep`, `exitHappens`, `askStep`, `rogueStep`, `reverseStep`, `honestOf`,
  `choices`) and the fairness (`AgentsG1`, `EngineFair`, `Assumed`). Constants: `OPTIONS` (the
  protocol options, protocol.qnt's own), `LIMITS` (the limits of a run).
- `properties.qnt`, module `properties`: each invariant, temporal property and witness, with
  its meaning; it exports `check`, which exports `protocol`, so an instance imports it alone (one copy of
  each: quint's TLA+ export overflows on two).
- `canon.qnt`, module `canon`: `canon`, the state-space reduction (pure on the store).
- `configsBase.qnt`: `FIXED_OPTIONS`, `BASE_LIMITS`, the named causes. `configs.qnt` has the
  retained cases (`coreTwo`, `coreTwoDir`, `coreLoops`, `coreCrossOnly`, and `coreWhereContext`).

Sizes: two tasks (`CFG.slots`); one host, one persistent role, one pipeline role; maker ids
from 3; 2 tries; 2 sections per task; no cap on review-loop revisions or rule rewrites (the
ladder, DESIGN.md 13.2).

## Options (`OPTIONS`)

| Field | Meaning | `DESIGN` | `FIXED` |
|---|---|---|---|
| crossTest | DESIGN.md 13.1: rule assessment runs a new rule's test command on the other rules' examples; a rule that contradicts another does not ship. A reference-only rule has no test command: it cannot be cross-tested | on | on |
| raiseLevel | DESIGN.md 13.2, per task and per item. Per task (`Task.floor`): a split part's next evaluation is at least standard; after a change of the task's own raise, at least direction (after a direction change, principle); the store refuses an evaluation below the floor (a role draft, Fit, is off the ladder). Per item: a draft that changes an item already fixed at its level goes one level up | on | on |
| ladderRoute | DESIGN.md 13.2: a draft entered at direction or principle (a raise up the ladder, a contradiction) goes to the review loop and the person, whatever items its content names | on | on |
| ruleLadder, loopLadder | DESIGN.md 13.2: a rule failing its own examples again, a draft the review loop sends back again, climbs one level (no caps on agents) | on | on |
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

| DESIGN.md | Quint (protocol.qnt unless named) |
|---|---|
| 1 Person | `Human`: `Open` of an Execute -> pipeline role (a reject of a result, an edit), `Respond` to a Decide (`Reply`: `AcceptIt`, `SendItBack`, `TakeAsIs`, `EvaluateAgain`), `EndProject`, `MoveHost` (run continue) |
| 1 Host | `Host`: `Open` of an Execute host -> role (a task sent), `Reassign`, `TopDone` (agents never remake the top, DESIGN.md 13.1); its wait finds the top only through `hostFinds` |
| 16 ask is the one act | `Open(r)`, `AnswerQuestion(r)`, `Hear(r)`, `AskRaise(r)` with `r = { kind, from, to, about }` (`kind`: `Question` any actor to any actor, `Execute`, `Check`, `Decide`; `about`: the task slot or fix id, -1 for a question); `Store.asks` (open), `Store.answered` (a question's answer not yet heard by the asker). An Answer closes its ask; a protocol Answer's own effect carries the result (no extra step) |
| 16 execute, check, decide as asks | host -> role: `Open` of an Execute; role -> maker: `Open` of an Execute (the store gives the fresh maker its id); the maker's result: its `Report` (the answer to that Execute), which opens `Check` maker -> role; the role's `Review` (the answer to the Check) carries the verdict ( `Pass` also closes the host's Execute, `Fail` opens a new Execute role -> the same maker, a raise opens an Execute role -> pipeline role); a reject or an edit: `Open` of an Execute person -> pipeline role; the draft after the pipeline: `Decide` pipeline role -> person, opened and withdrawn with the fix's stage (`sweep`), answered by `Respond` (`AcceptIt`, `SendItBack`, `TakeAsIs`, `EvaluateAgain`). The pipeline's stage steps, `Reassign`, `TopDone`, `Resume`, `Revive`, `Exit`, `RunRule`, `EndProject`, `MoveHost` stay steps (not asks). `waitsFor` = the open asks that are not questions, except those from the person (it is not event-driven); `NoWaitCycle` tests its closure |
| 16 one open ask; alternation; repeats | the asks are a set: one open ask per (kind, from, to, about); a question has about -1, one open or answered per (from, to); the answerer of a question alternates its answer with a step of its own (`Store.justAnswered`, `ownToldSteps`); questions per pair are counted (`ASK_CAP`), the next from a maker is `AskRaise`: it raises the maker's task (`askRaised`) |
| 1 Persistent role | `Role`: `Open` of an Execute role -> maker, `Review` (the answer to a Check; its verdict is the decision), `Resume`; `card` |
| 1 Maker subagent | `Maker`, a fresh id per Execute role -> maker; `ReadBrief`, `Report` (the answer to its Execute); it lives inside the role's process (`Exit` of the role) |
| 1 Pipeline role | `Pipe`: `Evaluate`, `Advance`, `WriteRule`, `RunTest`, `Ship`, `LoopReview`, `RecheckDone` |
| 2 the loop | Execute host -> role, Execute role -> maker, `ReadBrief`, the maker's `Report`, Check, the role's `Review`: `Pass` (done), `Fail` (revision to the same maker, `revisions + 1`), raise |
| 2.6 raise | `RaiseTries` (only when tries are used up), `RaiseNoRule`, `RaiseMisses`, the person's reject (Execute person -> pipeline role); `raise` |
| 3 the five levels | `Evaluate` with `Level`; `Split` (a new task generation, one section less), `Fit` (role draft), `Principle`, `Direct`, `Standard` (`entryOf`); the real cause: `Task.cause`, `resolves` |
| 4 stages | `AtPrinciple` -> `AtDirection` -> `AtStandard` -> `AtRule` -> `Testing` -> `Drafting`; `nextStage` |
| 4 rule forms | `Form`: `Mech` (test command), `Ref` (reference), `Both`; `WriteRule` (`flag`: the test's real behaviour, `flag2`: the reference exists); `RunTest` |
| 5 only a standard change? | `Ship`: the draft names `items` (content: `real`); no direction among them: `shipStandard` (in effect at once, back to the role); else `InLoop` |
| 5 review loop, change by human | `LoopReview`, the person's `Respond` to a Decide (accept, send back) |
| 5 role draft, only a role change? | `Evaluate` `Fit` -> `InLoop`; accept: role-only -> `cardInEffect`, `backToRole`; else `Accepted` -> `Reassign` |
| 6 C1, D7 | settled: DESIGN.md 12 (the host keeps the top; agents never remake it, 13.1) and DESIGN.md 13 (no budgets) |
| 13, 13.1 how the loop ends | `crossTest` (`Fix.fights`, `RunTest`); no agreeing rule: a contradiction found at `RunTest` goes at once to direction assessment (13.1), and a second contradiction of a draft already at direction goes on to the person (`Fix.contradicted`; a rule that fails its own examples is always written again); `raiseLevel` (`Task.floor` per task; `Store.fixDepth` per item, `refixed`, `raiseUp`); `ladderRoute`; `strictScope` (`Task.sections`); `changeBound`, `NoRefixAtSameLevel`, `NoAgentChangeAtTop` |
| 12 lifetimes | the host holds the top for the whole project (`Top` has no "hosted"; `TopDone` keeps it); roles never end |
| 7 Store | `accept`, `take` |
| 10.1 the person's edit, the pipeline row | the edit (an Execute person -> pipeline role about `EDIT`, at direction assessment; `wrote`), `shipEdit` (editBack), `atPerson` (acceptCheck) |
| 11 take as is | the reply take as is to a Decide (instead of the draft at the person) with `decideRecheck`: done with `pending` = the items that moved (`oldFor`); `RecheckDone` (with `recheckBasis` it names what it judged), `RunRule` |
| 9 per-item versions, scoped recheck | `Item`, `ITEMS`, `applies`, `Store.versions`, `Fix.items`/`real`, `itemsInEffect` (scope), `Task.pending`, `RecheckDone` (pipeline role), `RunRule` (harness), `Maker.brief` and `Task.checked` (snapshots `{item: version}`) |

## Act content

An act is `{ who, epoch, seen, seenVersions, old, byzantine, hadContext, body }` (types.qnt
`Act`): the sender's token (`who`, `epoch`), its basis (`seen`: the revision of the target;
`seenVersions`: the sum of the item versions it saw), `old` (from an old page build, which names
no basis) and two ghosts the store never reads (`byzantine`, `hadContext`). The body carries
only its own fields:

- `Report` (a maker's result to its Execute): `slipped`, the maker slipped. `Review` (the role's
  answer to a Check): `verdict`. `Respond` (the person's answer to a Decide): `reply`
  (`AcceptIt`, `SendItBack`, `TakeAsIs`, `EvaluateAgain`), `resolvesFight` and `breaksTasks`
  (ghosts, the environment's truth, below).
- `Evaluate`: a `finding`: `Splits` (`cause`: the real cause of the new task part), `FitsRole`
  (`label`: the pipeline's answer "only a role change"; `only`: the content), or `FixAt` (the
  level, and the versions it is built on: `base`, really `trueBase`, which NoLostUpdate reads;
  they differ only for a Byzantine sender).
- `WriteRule`: `form`, `testOk` (the test command really behaves on its examples), `refOk` (the
  reference exists), `fights` (the rule contradicts the other rule: the environment's truth).
  `RunTest`: `passed`, the pipeline role's claim of the outcome; `contradicts`, its claim that the
  test failed on another rule's example. `Ship`: `items` (the items the draft names), `real` (the
  items its content changes), `breaksTasks`. `LoopReview`: `toPerson`, hand the draft to the
  person. `RecheckDone`: `holds`, with the `items` and `base` versions it judged.
- `breaksTasks` on `Ship` and on the person's accept (ghost, the environment's truth): the tasks
  whose work the change breaks, raised tasks included; their result becomes bad (`Task.broken`,
  `badResult`) until it is made again under the new versions. A recheck judges only that
  (`broken`), not a defect the person took as it is (`Task.taken`). `resolvesFight`: the accepted
  direction change resolves a contradiction.
- An ask is `{ kind, from, to, about }` (types.qnt `Ask`); the body stays abstract. `Open`,
  `AnswerQuestion`, `Hear` and `AskRaise` carry the ask (the sender is `from`, or `to` for an
  answer); the basis of a protocol ask is the old target's (`basisOf`: a result's id for the Check
  and a reject, the maker's `revisions` for its report, the fix's `basisStep` for a Decide); a
  question's is its legality (an open question for `AnswerQuestion`, an answered one for `Hear`,
  the cap for `AskRaise`).

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
- DESIGN.md 13.2: no caps on agents. A rule that fails its own examples is written again
  once; a second failure climbs (`ruleLadder`): standard assessment, then direction, then
  principle, then the person (`Fix.climbedTo`). A draft the review loop sends back is revised
  once; a second send-back climbs one level from its entry (`loopLadder`; a role draft goes to
  the person). A reference-only rule cannot be cross-tested, so a contradiction can still ship
  through it.
- The person's "take as is" (`Decide`) is offered at the person instead of the draft
  (DESIGN.md 11: "any person's done"); there are no budgets, so no other path reaches it.
- The truth of a contradiction is the environment's choice (`WriteRule` `fights`, a ghost the
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
- History flags read from a sender's own basis (`seen`, `seenVersions`, `hadContext`) count only for
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
- The truth of what a change breaks is the environment's choice (`breaksTasks`); a result made under
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
  live maker adds to tries, then `Open` of an Execute to a maker resets them; `EndProject` is legal while the
  person's edit is open.
- Done tasks are rechecked; active tasks are rechecked by their running role (the maker reads
  its brief again; the role reviews under the new versions), not by a separate act.
- The dashboard's "matches" properties (DashNoFalseWorking, DashQueueActive,
  DashEscalationMatches, DashRowMatches) compare the page's copy with the store. A page can
  only render a copy, so they break in every configuration while the page is stale: they
  measure the staleness window, they are not safety goals. Every act the page sends is still
  checked by the store (NoUnseenReject, NoUnseenAccept, NoAcceptNotWaiting).
- No text, no timing, no store, page or CLI as code.

### Retained scheduler and admission

`permits.qnt` composes the current task protocol with the recheck helper. Its retained cases cover a child recheck, park and resume, deferral when capacity cannot be released, the retained-context mutant, and the missing-recheck mutant. `admission.qnt` models the two pipeline fix admissions and the separate recheck lane. The retained replay inputs and their generator are in [Pass 9 conformance](../derived/pass9/replay/README.md).

### terminals.qnt (G1)

Contains: the host's pane in the person's own tmux (never revived by the engine: its end or
its stop is recorded and shown to the person, who starts it again); the role's and the
pipeline role's panes in the agents' server; the role's maker, a subagent inside the role's
process; the server killed, its socket lost, a reboot (also the host's pane and the
engine); the pump (attached, about to attach again, or detached for good without
pumpReattach; it hears an end only while attached; listOnAttach); a CLI stopped at its
prompt (idleSeen: its hook records an exit); the usage limit (a limited process hears
nothing; the limit lifts, fair); the outbox: the watcher records a revive or a send in the
store, acts, then marks it, and can crash between any two (evidence: before acting again on a
revive it looks for the pane of that revive); the person typing into a pane (promptArg off
only). Aristoteles is an adversary: what an agent owes is not state (G1 is checked for owes
always true) and a send can be asked for at any time. Faults are not counted: any number, in
any order, until the faults reach maxFaults (no `adversaryDone` step: a count keeps the states finite).

Abstracted: process ids and epochs (one process per agent; a revived one replaces the old
one, whose acts the store refuses), the context of a resumed process, time, the protocol.

Fair: the engine parts only (the pump's and hooks' reports, the watcher's record, act and
mark per op, the server's recreation, the pump's attach, a typed prompt read, the limit
lifting). Not fair: agents, the person, the adversary, faults.

TLC results (arch-temp, 12 workers, 2026-11-17), every reachable state:

| Module | Checked | Expected | Distinct states | Time |
|---|---|---|---|---|
| termFixed (maxFaults 2) | Sane, ExactlyOnce; G1All (G1 for host, role, pipeline role, maker), SendDone | holds | 18,125 | 10 s |
| termFixed3 (maxFaults 3) | the same | holds | 123,173 | 22 s |
| termNoList (listOnAttach off) | G1All | breaks | 3,351 | 8 s |
| termNoReattach (pumpReattach off) | G1All | breaks | 19,303 | 10 s |
| termNoPromptArg (promptArg off: the prompt typed, merged with the person's typing) | G1All | breaks | 73,858 | 12 s |
| termNoOutbox (the watcher acts from memory after the record) | G1All; SendDone | breaks (each) | 8,822 | 9 s |
| termNoHostWatch (the host's end not recorded) | G1All | breaks | 14,235 | 9 s |
| termNoIdleSeen (no stop-at-prompt hook) | G1All | breaks | 16,637 | 10 s |
| termNoEvidence (no look for the revive's pane after a crash) | ExactlyOnce | breaks | 3,263 | 8 s |

What it measured (rule 7): the adversary's owes bits as state multiplied the states by 16
(they feed no action: now G1 is checked with owes true); faults without a count (until a fair
step ends them) passed 2.3 million states and kept growing, so the count stays (2, and 3).

Two findings came from TLC and are in the model (and the design must have them): the page
server looks at the host's pane when it starts (else a restart between the host's end and
its record loses the end: the pump's listing does not cover the person's tmux); the role's
revive holds its makers as ended (else a maker resumed by the old role, on a lost socket,
between the role's exit and its revive, dies unseen). protocol.qnt's Revive does not do the
second yet: noted for P2.

A send is at least once: a typed text leaves no mark the watcher can read, so after a crash
between act and mark it is typed again. Agents hear their steps through the store; a send is
a nudge.

### store.qnt (G3)

Contains: two items with versions (item 1 holds the draft the person may accept); the
store's checks of protocol.qnt (basis: compare-and-set on what the act read, which also refuses
a second copy; recheckBasis; epochs; build; acceptCheck); senders that are honest but slow:
an act is built on a snapshot (any versions up to the current ones: every old view and
more), names its basis from it, and arrives late, out of order, any number of times; a
process whose actor was revived still sends with its old epoch; the page as one more stale
viewer (refresh, a new build, reload): the person's accept is built on the page's copy. Any
act's effect is "write these items": an over-approximation of every act kind. The property
is the truth, in ghosts the store never reads (R6-10): an act that took effect was built on
a snapshot equal to the store on every item it reads or writes, by the actor's current
process, from the current build, and an accept is of the draft that waits. Safety only.
Versions stop at 2, one epoch bump. Symmetry was not used (quint's TLC export has no
symmetry sets); the model is small without it. A Byzantine sender (one that names a basis
it did not build on) is outside G3: the big model covers it (NoLostUpdate, mutRace).

TLC results:

| Module | Expected | Distinct states | Time |
|---|---|---|---|
| storeFixed: G3Holds | holds | 336 | 7 s |
| storeNoBasis | breaks (a stale act) | 30 | 6 s |
| storeNoRecheckBasis | breaks (a stale recheck) | 42 | 6 s |
| storeNoEpochs | breaks (an old process's act after a revive) | 117 | 7 s |
| storeNoBuild | breaks (an accept from an old build, which names no basis) | 248 | 6 s |
| storeNoAcceptCheck | holds: the basis on the draft's version already refuses an accept of a draft that moved | 336 | 7 s |
| storeBlind (an act may write what it did not read) | breaks (a lost update, a second copy) | 30 | 7 s |

Senders are honest about their basis (the basis is the snapshot): the harness, not the AI,
fills the basis from what the CLI fetched; an agent acting on an old brief is then exactly a
stale basis. A sender that names a basis it did not build on is Byzantine (the big model).

How protocol.qnt's acts keep "it reads what it writes" (the fact G3 rests on). An act's
content built from a view is covered by its basis (`basisOf`: a fix's `basisStep`, a result's id, a
maker's revision; with recheckBasis the judged versions) or by `legal` (the state the act
needs, which its own effect changes, so a second copy is refused); the rest of its effect is
computed by the store at the append, from the current store, so it is not stale:

| Acts | What refuses a stale or second copy |
|---|---|
| Review (the verdict), Open of an Execute person -> pipeline role about a slot (reject), RecheckDone | the result's id (`resultId`); RecheckDone also the judged versions |
| Report (the maker's answer) | the maker's revision, the brief's versions (briefCheck), the live maker (endedCheck) |
| Evaluate, Advance, WriteRule, RunTest, Ship, LoopReview, Respond to a Decide (accept, send back, take, again) | the fix's `basisStep` |
| Ask Execute host -> role, Ask Execute role -> maker, TopDone, EndProject, Reassign, the edit | `legal`: the state they change (Unsent, Sent, not done, open, an accepted fix, the edit closed) |
| a question | `legal`: an open question (AnswerQuestion), an answered one (Hear), the cap |
| Resume, Revive, Exit, RunRule | `legal`: the exit record or the pending rule they change |
| RecheckDone (its own second copy) | `legal`: the pending items it clears, or the task sent back; a copy of a passed recheck excludes the same items again (no effect) |
| MoveHost (run continue) | nothing: `legal` is always true. A second copy moves the host twice. A finding (P2: give it a basis, the session it moves from) |

What store.qnt does not show (R6-11): it checks the mechanism on items with versions, not
protocol.qnt's accept itself; the table above is the mapping, by reading. 

### browser.qnt (G4)

Contains: what the person owes (two acts), the role's terminal inputs (its own step, the
engine's inactive signal: tmux, the usage-limit message, 1 minute of silence) and the
escalation's state, all set and cleared at any time; the page's copy, its websocket, its
build; the page server (it restarts itself on a new build); faults: websocket drops, server
crashes, a new build, any number until adversaryDone. A background tab has no timer of its own: only
what the engine pushes or sends on reconnect reaches it. The page server has its own copy
of the store: it hears changes through its watch, which can be lost (a fault), and reads the
store again when it starts and by a poll (off in browserNoPoll). G4 is "shown while a page
is open". Fair: the server's restart, the
page's reconnect (or reload when its build is old), the push. The person's refresh is not
fair. Safety after a refresh (`DashAfterRefresh`): the dashboard the page draws from its copy
is the store's (no Working while the role only waits, Inactive only from the engine's signal,
the pipeline row exactly when an escalation waits for the person, the escalation card's
status, the owed acts). These are definitions more than checks (the page draws its cards
with the store's function, from a copy it got whole): they fail only if the copy is not
whole. A page that applies pushed diffs to an old copy is not modelled.

TLC results:

| Module | Checked | Expected | Distinct states | Time |
|---|---|---|---|---|
| browserFixed | DashAfterRefresh; G4All | holds | 131,584 | 14 s |
| browserNoReconnect | G4All | breaks | 95,528 | 10 s |
| browserNoReload (no reload on a new build) | G4All | breaks | 100,421 | 9 s |
| browserNoPush (only the person's refresh) | G4All | breaks | 100,782 | 10 s |
| browserNoPoll (the server's watch lost, no poll) | G4All | breaks | 99,850 | 9 s |

One owed act: every copy the page gets is the whole state, so each act behaves alone (two
acts and a three-state escalation passed 3 million states).

### pipe.qnt (the live terminal)

Contains: tmux (up or down), the pump (attached, detached, crashed), the websocket (open or
closed), the page's terminal view (current, stale, closed); the screen as a version (versions
0..2) in tmux, in the pump's copy and in the page's drawn copy. One browser/target
stream has two successive key ids. The browser keeps an outbox across reconnect and
automatic reload. A page-server restart clears the queue and any in-flight attempt,
crashes the pump, and retains the durable dispatch marks. The marks form a contiguous prefix: the
server marks the next id when the pump is ready, before writing, with one attempt in
flight. Receipts are lost with their socket. A marked replay gets a new receipt
when its attempt is over. This can retire an interrupted key without asserting delivery.

The adversary may restart the server, reload the page, drop the socket, bring tmux
down or up, detach or crash the pump, or make the view stale. When failures stop,
weakly fair recovery reconnects the socket, replays pending keys, attaches the pump,
and redraws the last screen. Tab close, tab crash and host power loss are outside
the model.

Properties: `ShowsCurrentScreen` (in the end the view draws tmux's last screen),
`NoKeystrokeLost` (every typed key eventually reaches tmux unless a failure cleared
its marked in-flight attempt), `NoKeystrokeTwice` (no id applied more than once),
`Prefix` (marks are contiguous), `AtMostOneWriting`, `WritingIsMarked`, and `NotStuck`
(simulator screen-recovery check). Simulator witnesses exercise replay and receipt
retirement after restart, an interrupted write, delivery of a buffered key restored
after reload, and the draining of a gap. Receive can choose key 2 before key 1 from
the reconnect replay. Socket identity and explicit retired-socket callbacks belong
in the implementation tests.

| Module | Checked | Expected |
|---|---|---|
| pipeFixed | NoKeystrokeTwice; ShowsCurrentScreen, NoKeystrokeLost | holds |
| pipeNoReattach (the pump never attaches again) | ShowsCurrentScreen | breaks |
| pipeNoReconnect (the websocket never reconnects) | ShowsCurrentScreen | breaks |
| pipeNoRedraw (no redraw: a stale view stays) | ShowsCurrentScreen | breaks |
| pipeNoDedup (a sent again keystroke is forwarded again) | NoKeystrokeTwice | breaks |
| pipeMarkAfter (write, then mark) | NoKeystrokeTwice | breaks |
| pipeVolatileMarks (server restart loses its marks) | NoKeystrokeTwice | breaks |
| pipeNoBuffer (a keystroke typed on a closed socket is dropped) | NoKeystrokeLost | breaks |
| pipeNoOutbox (automatic reload fails to adopt the outbox) | NoKeystrokeLost | breaks |

A dropped prefix key in pipeNoBuffer can also strand a later queued key. The
prefix guard stays enabled in pipeNoDedup, which allows a marked key to dispatch
again.

TLC on the durable-mark model: pipeFixed completed with 111,536 distinct states.

### Remaining fix, recheck, and scope instances

`check.qnt` and `canon.qnt` provide the core environment for `configs.qnt`. The runnable cases cover a standard change that affects a second task, a direction change and reassignment, repeated review send-backs along the current fix path, checking interacting rules, and the output scope of a split part. `properties.qnt` shares the safety predicates between those instances. Broad project convergence and actor fairness composition are outside the Metis-first proof scope.

Run a retained case directly with `sh core/model/tlc.sh one FILE INSTANCE holds|breaks INVARIANTS|- TEMPORAL|-`. Invariant or temporal lists are comma-separated. `remaining-tlc.sh` lists the retained instances and their selected properties.
