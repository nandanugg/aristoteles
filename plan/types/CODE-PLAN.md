# Code plan for the Metis-first slice

This is the local review plan for `code-v2`, based on the accepted model at `a3698e0`. The accepted core types and ten registered Quint checks govern the implementation. Each unit is a reviewable change in dependency order. Build the engine and page together for each feature. Let Claude review this plan before starting U0. [Core types and paths](CORE.md) · [Quint registry](../../core/model/checks/registry.tsv)

## Scope and decisions for review

The first delivery opens a Project, offers onboarding proposals and Questions, reviews the proposals in the onboarding host’s own fresh subagent, lets Nanda accept them, activates, and runs one task. The task can go from Sent through Working, ReadyToReview and Reviewing to Done, return to Working with feedback, restart after a crash, or reach Raised. Nanda owns responsibility edits. A role names the broad work it does. Directions, standards and rules say how to do it. The engine and page share one set of types and the same submission and transition meanings.

- **One journal from project open.** Open the fresh store before onboarding and use the activation phase to gate task work. Proposals, answers and acceptances written before activation stay in that journal. A pre-commit rollback restores the activation’s external effects and returns to Onboarding with those records intact. Nanda confirmed this boundary on 2026-11-26. The model’s activation record sits inside the product’s earlier proposal journal. The current `deleteInactive` removes a directory’s rows and cannot serve that boundary. [Activation IO](../../adapters/live/activation.ts) · [Current store port](../../src/services/store.ts)
- **One gate for first active work.** The model’s `openTop` is a boundary on the existing Project. In this plan the owner’s **Start work** choice maps to a `Project.next` input that pins the committed host before its first work. It can commit before the host collects its credential. The same guard serializes this move with a pending rebind. This keeps the model’s late-collection path and requires no Top record. Confirm the choice and input in review. [Binding check](../../core/model/checks/activationHostBinding.qnt)
- **Fresh format.** Use format 16 for the first slice. The release base uses format 10 and the earlier strict-types worktree went through 15. Before assigning 16 in U1, check for any newer allocation made by parallel work. Refuse other formats before registering a project, running startup effects, or writing. The final cutover gives the CLI, server and page one running entry point for the new journal. [Current format and tables](../../src/store/schema.ts)
- **Landing order on the branch.** U1–U7 use the new store and page from test and integration entry points. U8 switches the normal entry points and removes the replaced routes together. Partial units are reviewed on `code-v2` before exposing them to live projects. Keep this project-specific plan on the local review branch.

## Units in landing order

Paths under **Add** are new. **Change** identifies existing files that keep a role. **Delete** identifies files or code that the unit replaces. For a mixed file, remove the named slice rather than keeping a second implementation reachable. U8 owns the final deletion of any caller still shared with the pre-cutover entry points.

### U0. Architecture gate

- **Add** `src/domain/architecture-probes.test.ts` for positive and negative samples and `src/domain/domain-primitive-baseline.json` for findings in untouched production files. Set up the scanner before the first new domain file.
- **Change** `src/domain/architecture.test.ts` and `core/architecture.test.ts` to check both TypeScript project graphs, including the browser. Keep the existing phase-write, dependency and import-door rules.
- **Delete** the old scanner’s exclusion of browser code for shared types and move checks. Remove baseline entries as their files are replaced. A new file or migrated declaration starts at zero findings.
- **Tests** Run both positive and negative architecture samples. Fail on an exported raw scalar through an alias, a parallel page DTO, a state write outside transitions, and a new finding in an old file. Test both baseline growth and the deletion of obsolete baseline entries.
- **Model conformance** U0 establishes the build gate for subsequent units. The first executable comparison is U1’s strict journal replay.

### U1. Shared line, journal, and projection

- **Add** `src/domain/project/{values,records,lines,events}.ts` for purpose scalars, shared records, per-line transitions, and the canonical `StoredEvent`, `Submission` and `Refusal` schemas. Add `core/schema/project.ts` and `core/services/project.ts` as the schema and services entry points. Add `src/services/project.ts`, `src/store/project.ts`, and `core/state/project.ts` for the transaction port, SQLite layer, and pure fold. Add `core/actions/project.ts` for the common intake. Add `adapters/web/app/project-state.ts` for the reactive fold and `adapters/web/project.ts` for the initial snapshot and committed event stream. Add the replay harness in `core/derived/project/replay/{gen.sh,driver.ts,replay.test.ts}`.
- **Change** `src/store/schema.ts` to define format 16’s append-only project event table and the format check. Reuse directory resolution from `src/store/path.ts` and the SQLite transaction pattern in `src/store/sqlite.ts`. Give each Project its own contiguous event numbers, including when one SQLite file holds multiple projects. Allocate the number, recheck the addressed read basis, and append under one transaction. Publish the resulting projection after commit. Releases, launches, and command execution happen through services. Replay consumes their recorded evidence.
- **Delete** the slice’s dependence on the `create/move` event families in `src/domain/events.ts`, separate reader-row writes from `src/store/rows.ts`, and page-specific event mirrors in `adapters/web/contract.ts`. Those mixed files remain for deferred consumers. Remove their imports from the slice when wiring each port.
- **Tests** Add `src/store/project.test.ts` and `core/state/project.test.ts`. Cover fresh open, foreign and old formats, canonical round trips, wrong-line moves, corrupt or out-of-order rows, same-basis competing writes, failed append, and engine/browser fold equality after reopen. A stale input or invalid phase leaves no appended row. An already accepted report cannot be applied after a later back move to the same attempt because its read basis has changed. Test interleaved writes to two projects, a lost commit response, duplicate notifications and page catch-up from a snapshot. Check that a refusal caused by an unrelated record would be erroneous when that record is outside the move’s read basis.
- **Model conformance** Wire the registry reader, trace decoder and canonical comparison here. Exercise the atomic append seam of `taskReportRace` with a minimal fixture. Its full task replay lands in U6.

### U2. Staff sessions and capacity

- **Add** `src/domain/project/staff.ts`, `core/derived/project/staff.ts`, `core/actions/staff-session.ts`, and `adapters/live/staff-session.ts` for the checked Staffing plan, the two capacity queries, and observed lifecycle transitions. Add `core/derived/project/next-step.ts` for the shared selection over phase duties. Add `adapters/web/app/staff-session.ts` for the session and capacity views.
- **Change** `adapters/live/worker-terminal.ts` at its launch/observe boundary and `adapters/cli/commands/wait.ts` at its selection/credential boundary. Drive the new lane with session and launch identity from authenticated provider observations. Open the Project with the onboarding host already assigned to the host role. Derive occupied provider slots per subscription from live lifetimes and subagent use per staff from current work and review assignments. A shared host/pipeline staff still has two roles. Serialize provider and child acquisition at the adapter until the live observation commits or the losing launch is reconciled. Charge the durable projection only for current work and observed lifetimes. A pause retains the checkpoint and resumes the attempt under a new lifetime. A crash retires old authority and folds `restart` for Working and clears review assignments. U6–U7 supply those task transitions.
- **Delete** the slice’s independent worker permit/reservation counters, ordinary task admission records and persisted offered turns from the new path. Remove the slice’s reads of `core/state/worker-runtime.ts` and `core/derived/c16/admission.ts`. Keep the parts those files serve for deferred recheck work. Reuse IO for provider capability, pane observation and secure launch or checkpoint handles. Keep credentials and native checkpoint material outside page payloads and journal events.
- **Tests** Add `core/actions/staff-session.test.ts` and `adapters/live/staff-session.test.ts`. Exercise concurrent starts, a stale staffing basis, capacity charged once across roles and shared subscriptions, the minimum host/pipeline allowance, a confirmed exit versus an unknown observation, same-attempt resume, and retired tokens. A failed admission or orphaned launch reconciles before exposing the slot again.
- **Model conformance** Complete `staffCapacity` here. Wire the lifetime and checkpoint observations for `staffReplacement` and run it end to end with U7.

### U3. Questions

- **Add** `src/domain/project/question.ts`, `core/actions/question.ts` and `core/actions/question.test.ts`.
- **Change** `adapters/web/app/questions.ts`, `adapters/web/project.ts`, `core/derived/project/next-step.ts`, and the question dispatch and rendering cases in `adapters/cli/commands/acts.ts` and `adapters/words/work.ts`. Store Open and Answered on the Project. Reuse the shared question form and answer schemas for CLI YAML and the page. An answer addresses its recipient and the current open question. The Staffing Consult becomes a Question tied to the staffing proposal and its basis. The host reads the reply and submits a revised proposal through the ordinary proposal line.
- **Delete** Ask/Hear objects, answer acknowledgement, per-pair counts and AskRaise from the slice’s question intake. Remove the page’s separate answer shape for this path and the Consult file when U4 removes its final consumers. Keep old work-control asks in the deferred code that still owns them.
- **Tests** Exercise the wrong actor, mismatched form, duplicate answer, stale question after replacement, and retained answers after reopen. Check parity between CLI and page reads and refusals. Include a staff recipient and the person as recipient.
- **Model conformance** Complete `questionAnswer` against the real fold and both input surfaces.

### U4. Onboarding proposals and owner acceptance

- **Add** `src/domain/project/{direction,proposal,review}.ts`, `core/actions/proposal.ts`, `core/derived/project/review.ts` for shared review assignment and entry-order FIFO, `adapters/words/project.ts` for Project and Proposal status, and `core/actions/proposal.test.ts`.
- **Change** `adapters/cli/commands/onboard.ts`, `adapters/web/{contract,view,project}.ts`, and `adapters/web/app/{onboarding,onboarding-review,onboarding-roles,staffing,api}.ts`. Decode submitted YAML as input and store the proposal in the journal. Route each review through the assigned role. The onboarding host already serves its role and uses its own fresh subagent for directions and staffing, including the first staffing proposal. Only a reviewed proposal reaches WaitingForOwner. Nanda accepts the exact reviewed payload and pins the accepted version. Nanda owns responsibility choices and edits, including during onboarding. A changed draft or staffing arrangement returns through review. Company directions pin the source commit. Nested standards and rules belong to the accepted whole direction.
- **Delete** file-only approval and revision authority from the slice. Replace the `staffing-proposal.yaml` and `staffing-consult.json` stores, separate page `OnboardingAct` and staffing confirmation inputs, and branches such as approve-all and approval by presence of an edit file. Keep reviewed cards, direction diff and example rendering, staffing arrangement, and user choice UI as presentation over shared schemas. U8 removes the old writer and status files after U5 and the last route switch.
- **Tests** Add proposal state, stale owner choice, send-back/review again, own subagent versus host fallback, and stale child report tests. Verify exact accepted version, retained active staffing while a replacement is pending, editable roles with Nanda’s authority, company commit pinning, and settings that cannot pass Staffing or activation. Test owner cards through HTTP and the CLI source with the same proposal and evidence. Inspect network payloads for credentials and private process data.
- **Feedback budget** Measure the engine and page from each submission to its committed move becoming visible. Each move takes under one second. Measure proposal submission to fresh review start, accounting for the subagent’s own start-up time. Scheduling adds no delay beyond that start-up. Record both measurements in U8.
- **Model conformance** Complete `onboardingReview`. Verify proposal use of the same fresh-run and FIFO seams needed by `reviewSlot`. The full competing task queue replay lands in U7.

### U5. Activation and bound host

- **Add** `src/domain/project/activation.ts` for the phase and public observations and `core/actions/project-activation.ts` for the journal guards.
- **Change** `adapters/live/activation.ts`, `src/files/activation.ts`, `adapters/live/bootstrap.ts`, `adapters/cli/commands/activation.ts`, `adapters/web/project.ts`, and the activation panel under `adapters/web/app/onboarding.ts`. Reuse marker staging, the directory lock, bootstrap pane observation and private credential files. Pin the accepted proposal versions and approved file images. Record launch before spawn, mark real files, require a current acknowledgement, then commit Active in the journal. Recover a commit before its IO note by rereading the journal. Start work under the committed host binding. Pending replacements cannot collect credentials, and delivery retires on the first authenticated use. Hold the bind and start-work exclusions in the same transaction so either ordering is safe.
- **Delete** the old activation state in the legacy events and startup record. The retained config store initializes with `Workflow.Initialized`, which carries config and accepted test-fixture directions. Activation eligibility and moves use the project journal. The retained `/api/activation` routes forward the checked choice and recovery to the same journal. U8 removes the old routes.
- **Tests** Retarget `core/actions/activation.test.ts`, `test/activation.test.js` and `test/activation-fixture.js`. Cover unapproved or changed files, current versus stale acknowledgement, pre-commit cleanup preserving newer edits and the proposal journal, commit-before-note, cancellation versus committed rebind, late credential collection, retirement, and old/inactive work refusal. The real integration test opens a marker-bearing fixture in tmux or the existing controllable process adapter. Assert credentials absent from page, events and logs.
- **Model conformance** Complete `activationCommit`, `activationRollback` and `activationHostBinding`. Map the model file flag to one real approved file, launch identities to observed handles, and `openTop` to the Project’s first-work binding. Exercise credential collection on both sides of that last boundary. The projection exposes Active as soon as the binding commits. The model's later note is an IO reconciliation. Each launch identity covers a single process lifetime, so a replacement always reserves a new identity.

### U6. Task, attempt, and command outcomes

- **Add** `src/domain/project/task.ts`, `core/actions/task.ts`, `core/effects/project-commands.ts`, `core/actions/task.test.ts`, and `adapters/web/app/task.ts` for the task panel.
- **Change** `core/state/project.ts`, `core/derived/project/next-step.ts`, `core/actions/staff-session.ts`, `adapters/cli/commands/acts.ts`, and `adapters/words/work.ts`. Only Active work is admitted. Send a task using a nonempty stage slice of a pinned direction and responsibility version. A work report records that an attempt began or gives its result and whole touched files. `ReadyToReview` runs the applicable rule commands with the task’s basis and records the outputs, including failure or an empty set. Only then enter Reviewing. The pure fold records results without calling commands again. A provider observation that the work session crashed derives `restart`. A confirmed checkpoint resumes the same attempt.
- **Delete** the slice’s `OpenMake`/Maker and Execute ask states, the separate ReadBrief acknowledgement, the C16 Report-to-Check routing and any default command success manufactured by the page. Preserve the old dispatcher files for deferred callers through U8. The new task can read its own pinned brief without committing an acknowledgement.
- **Tests** Exercise concurrent begins and reports, a competing writer, duplicate report after a lost response, retry basis after returning a result, interruption before journal append, wrong attempt/session, stale reads, whole files with quotes and changed lines, and success/failure/absence of commands. Test interruption while executing commands. Reconcile exact captured results before recording them. If an effect has unknown completion, surface a recoverable blocked step instead of inferring success or issuing a second attempt automatically. Check the ReadyToReview panel and CLI status against the committed phase.
- **Model conformance** Complete `taskReportRace`. Feed command and result observations for `reviewEvidence` and the attempt restart/resume actions for `staffReplacement` so U7 can replay both through the final phase. Capture each command under the committed result event and pinned rule. The command record survives a journal failure. A running command with no captured output waits for recovery.

### U7. Task review, feedback, and Raised

- **Add** `core/actions/task-review.ts` and `core/actions/task-review.test.ts` for the task-specific adapter to U4’s shared review validation.
- **Change** `src/domain/project/review.ts`, `core/derived/project/{review,next-step,staff}.ts`, `core/state/project.ts`, `adapters/cli/commands/{acts,wait}.ts`, `adapters/words/work.ts`, and `adapters/web/app/{task,review}.ts`. Assign a fresh child on the reviewer’s staff if its allowance is positive. A busy own slot waits locally. A zero allowance uses the host FIFO ordered by the event that entered Reviewing, even if another event later touches the task. Record `by` only after opening the fresh run. Recheck it under the journal write and release a losing allocation. Combine recorded command evidence and prompt outcomes with findings. Validate exact pinned rules and quotes. Derive `next`, `back` or `raise(reason)`. Back keeps the attempt, saves the breaking evidence and increments RetryCount. A confirmed crash restarts with a fresh attempt number and preserves the feedback and retry count. A report from the current working attempt can raise `WrongTask` or `TooBig` with evidence. Raised exposes the reason and evidence and stops at that phase.
- **Delete** the slice’s Check, report-selected verdict, priority/recheck queues and worker-held review permit writes. Drop CLI and page submissions that choose pass/fail/raise, or directly set a phase. Keep the pass/fail examples in the direction guidance UI, which are evidence about a rule.
- **Tests** Cover missing, duplicate and corrupt outcomes, command failure despite a passing prompt, first actionable break, repeated break, exhausted retries, finding without a rule, pre-existing breaks in unchanged lines, no review by the work’s own context, invalid old child report with the same Staff, two competing host waiters and positive-but-busy allowance. Test caller-visible feedback and the exact next step after back, restart, or Raised.
- **Model conformance** Complete `reviewEvidence`, `reviewSlot` and `staffReplacement`. The replacement replay exercises a checkpoint as well as a crash with fresh numbering and unchanged RetryCount.

### U8. Cutover and release rehearsal

- **Add** `test/project-first-task.test.js` for normal CLI and SQLite integration and `test/browser/project-first-task.check.js` for the page path.
- **Change** `adapters/cli/{main,caller,runtime}.ts`, `adapters/cli/commands/setup.ts`, `adapters/web/{start,server,watcher}.ts`, `adapters/web/app/{main,api}.ts`, and `core/{schema,services,actions,effects}/index.ts` as needed to select the new store and intake in one cutover. Promote the new flows to normal `work` entry points and mount the same checked projections in the app. Apply the CLI and skills changes below in this unit. Test a new CLI against a stale page and check that neither can mutate a previous store.
- **Delete** the old slice routes, imports and file-only state tools. Whole files targeted for deletion are `adapters/web/onboard.ts`, `adapters/words/onboard.ts` and `core/derived/onboarding.ts`, with the obsolete `core/derived/onboarding.test.ts` cases. Remove the old runtime writer from `src/files/onboarding.ts` and delete the file and `src/files/onboarding.test.ts` once the last consumers of reusable codecs or physical file helpers have moved. Move the pure `onboardedOf` conversion used by `core/actions/config.ts` to the retained config path if still needed. Remove `onboardingFilesView`/old `onboardingStoreView`, old Staffing Consult/approval fields, and stale file watchers from `adapters/web/{view,server}.ts`. Remove replaced CLI grammar, event schemas, fixtures and replay cases once the corresponding call sites are gone. Preserve the retained model and fixture cases listed below.
- **Tests** Run both typechecks, the zero-delta architecture gate, new scenario tests, the CLI integration and the browser scenarios. Rehearse on a scratch directory and distinct SQLite file with the shipped binary, skill links, and page. Walk proposal review → owner choice → activation → first task through output review. Also exercise a send-back, a recovery from an uncheckpointed exit, and a task reaching Raised. Verify event order and durable restart, exact page and CLI refusals, stale reconnect, shared app schemas, and refusal of old formats before any write. The rehearsal uses only local artifacts in the scratch workspace.
- **Feedback budget** During the rehearsal, record each move’s commit-to-page path from submission to visibility and the elapsed time from proposal submission to fresh review start. Report the subagent start-up time with the review measurement and verify both U4 targets.
- **Model conformance** Make the ten-check replay suite one named gate for the cutover. Compare all fixtures against the shared production ports. The browser scenario checks the same state through the normal network boundary and client layer.

## Architecture gate

The dependency order is `schema → services → state → derived → actions → effects → adapters`. Runtime stays behind Effect service interfaces. The browser imports shared schemas, pure transitions and selectors. Its layer supplies reactive state and an authenticated engine port for external observations and commits. It folds committed events immediately and catches up on gaps. It has no authority to invent an observation, event number, actor or timestamp. A page projection can select or redact fields from the domain schemas. It cannot redeclare IDs, domain payloads, phases, moves or refusal meanings. Session credentials, private command process handles and native checkpoint material stay in IO. Put checked public identities and verified observations in committed events so the browser can fold the same inputs. The snapshot and event feed must preserve every field that the shared fold uses.

The architecture test uses the TypeScript checker for the real engine and browser projects. Scan new and migrated production types, schemas, inferred fields and transitive aliases. Purpose-brand and refine uncategorized scalars. Use literal unions or structured template types where the format suffices. Domain types have required fields, tagged object unions, record references and exhaustiveness by line. Check IDs appear only as a record’s identity, journal/wire address or UI/map key. Check moves and IO through the existing state-write and import rules, including the browser path. A raw JS number used in SQLite plumbing or external argv belongs at the boundary and is checked before crossing into the domain. Test that passing raw or forged values through another module does not bypass the guard.

At U0, record only measured primitive findings in production files still awaiting replacement. Use stable finding identities including file, declaration or field, rule and normalized source site. Freeze that set as an upper bound. Any new finding fails, including a new finding inside an old file. New files and migrated exports start empty. An old entry cannot follow code into a new file. Delete the corresponding entries when a file or declaration is replaced and reject stale entries. The branch checks in both the current list and its U0 upper bound so a later change cannot grow the allowance. The gate also proves the browser and engine resolve each migrated wire schema to the same declaration.

## Model conformance

Use the accepted model registry as the case list. Each case has a success witness, a protected fault witness, and a guard-removed mutant. Keep the shared model and individual checks within the agreed size and runtime budgets. A needed change in a modeled decision goes through model review before an implementation divergence is accepted. [Model](../../core/model/README.md) · [Registry](../../core/model/checks/registry.tsv)

Generate a canonical ITF trace for each of those three paths from the pinned Quint version. Use a fixed seed, one simulator thread and action/nondeterministic-pick instrumentation. Find the two positive witnesses by checking the negations of the named predicates. Run the mutant against `Safety`. Assert that the expected witness or violation is present before writing a fixture. Normalize generated metadata while retaining actions, picks, relevant states and the model revision. Store the small gzip fixtures under `core/derived/project/replay/traces/` and verify the set matches the registry. Follow the [existing retained ITF generator](../../core/derived/pass9/replay/gen.sh) for the trace format. Test regeneration without altering unrelated retained traces.

The driver maps initial state to deterministic fixture setup through domain constructors and public intake. It submits picked facts, owner choices, or observed IO to the actual engine entry point using a real temporary SQLite store. Inject production ports from `replay.test.ts` so the driver stays within the derived layer’s dependency rules. Simulate the outside world at the `Files`, `Commands` and `Sessions` ports when the model abbreviates an IO step. An abbreviated model action may span several runtime observations. Document their boundary and compare after each model step, plus any intermediate invariant relevant to that fault. Compare the current phase and duty, event effect, attempts and basis, proposal versions, owed actors, capacity, host queue, session/activation binding, and durable refolds wherever the case models them. Feed the committed event response to the same reactive fold the browser uses and compare its checked projection. Test actual HTTP and CLI intake in the relevant unit to catch mapping, authority and routing errors. Use model state as the oracle and action/picks as input. Never install an expected destination in the runtime fixture.

For each mutant trace, replay its common prefix and deliver the offending input to the production guard. Test that the runtime refuses it or reconciles without applying the invalid change. Compare the event suffix and reloaded projection, including the legitimate state change for refusal-with-reconciliation cases. A passing TLC run or a matched final state alone does not satisfy replay coverage. At U8 run `bun run spec:check`, `bun run spec:tlc`, and `bun run spec:conformance`. Keep its acceptance report alongside the scratch rehearsal with the exact revision tested.

| Quint case | Executable checkpoint | What the replay compares |
| --- | --- | --- |
| `taskReportRace` | U6 | Provisional result, interruption before append, two competing deliveries, one write, and command intake only after the result commits. |
| `staffCapacity` | U2 | Shared subscription and shared-staff child use, stale staffing, denial, release and the next permitted start. |
| `questionAnswer` | U3 | Recipient and answer form, one append, a surviving answer after replacement, wrong actor and duplicate refusal. |
| `onboardingReview` | U4 | Fresh host child reviews before owner visibility, send-back/review again, stale child after replacement, and the exact accepted proposal. |
| `activationCommit` | U5 | Marked approved files, live acknowledged launch, work gate, old acknowledgement refusal and lost note reconciliation. |
| `activationRollback` | U5 | Original file restoration, retention of more recent human edits and preservation of the proposal journal. |
| `activationHostBinding` | U5 | Pre-work rebind, delayed note, committed launch versus pending launch, late collection and first-use retirement. |
| `reviewEvidence` | U7 | Command evidence combined with complete prompt outcomes, corrupted or duplicate entries refused, first feedback and repeated break. |
| `reviewSlot` | U7 | Entry order survives a later edit, positive allowance waits locally when full, and a stale run cannot consume a later assignment. |
| `staffReplacement` | U7 | Same attempt on resume, `restart` without a checkpoint, fresh attempt number with preserved retries, retained evidence, waiting reviews and stale session refusal. |

## Deferred paths and their dependencies

| Later work | Files and behavior retained | How the slice runs independently |
| --- | --- | --- |
| Resolution beyond Raised, fixes, owner responses and relayed `Proposal<Act>` | The current fix/response logic in `core/state/c16/{data,effect,fold}.ts`, its `core/actions/work.ts` and `adapters/cli/commands/acts.ts` branches, and their retained replay consumers. | The task records Raised, evidence and reason. The slice stops there and shows why. It never calls the legacy evaluation/decide dispatcher, starts a fix, or offers an owner action from the old lane. The main Question path handles direct answers. |
| Split, contract, parallel work and later integration | Keep old scope paths and unaffected storage or IO helpers, including the `coreWhereContext` witness and future contract cases. | The first task is one leaf over a pinned stage slice and the current project folder. Scope matches the task’s own stages and attached stage facts. Evidence of oversize can reach Raised. No child task creation, multi-worktree merge, parent tier or contract mutation is needed. |
| Changes to guidance after a Done task | `core/actions/recheck.ts`, `core/effects/recheck.ts`, `core/state/rechecks.ts`, the deferred scheduler in `core/derived/c16/`, and the retained permits/admission/recheck fixtures. | The first task reads the accepted direction version at send time. The slice consumes onboarding proposal changes before activation. It offers no legacy recheck command, helper or queue. |
| Terminals, pipe transport and page features outside the slice | Keep `adapters/web/app/{terminal,pipe-outbox,pipe-socket}.ts`, `adapters/web/{pipe-keys,pump}.ts`, `adapters/live/pump.ts`, their tests, and unrelated settings, search and dashboard surfaces. | Reuse process and pane adapters for observed launches. The new task panel needs only checked Project data and file/command evidence. The existing optional terminal viewer can remain a transport view where it needs no legacy domain state. Hide active-work controls tied to the old dispatcher. Other page work can follow separately. |

The retained source and model fixtures still serve their own tests. At U8 verify the normal CLI and page cannot invoke an old-format store opener, mutate a legacy work state, or run a legacy effect for this project. Retained modules may use explicit fixtures. Audit the production import graph and route dispatch before deleting shared helpers. There is no format translation or automatic import of the old drafts or stores.

## CLI words and instructions

These are the proposed spellings for the first delivery. Types and printed paths use the accepted names. U8 verifies help text, the commands printed by `wait`, and installed skills against the same registry. [Accepted names](CORE.md#1-names)

| Surface | Command or action |
| --- | --- |
| Open and inspect | `work start` serves the page. `work onboard open --file=<project.yaml>` opens the fresh Project under the owner’s authority and assigns the onboarding host. `work onboard status` and `work onboard show <subject>` read its typed records. |
| Draft and submit | `work onboard submit <token> --file=<proposal.yaml>` supplies a draft or resubmission on its named proposal and current basis. A responsibility draft or edit addresses a Role. The owner applies responsibility changes. Staffing edits that change reviewed material go back through the host review. |
| Fresh review | `work wait <token>` gives staff their derived next step and basis. `work review <token> <task-or-proposal> --file=<facts.yaml>` supplies outcomes and findings from the assigned fresh child. The task runs rule commands itself in ReadyToReview. |
| Owner choice and activation | The page and `work onboard accept\|send-back\|remove <proposal>` submit the same checked project move. `work activation start\|resume\|relaunch\|rollback` uses the existing owner recovery surface. The page’s **Start work** or `work project start` commits the first-work binding when Active. |
| First task | `work send <token> --file=<task.yaml>` supplies a task draft. `work report <token> <task> --file=<report.yaml>` records that work began or supplies its result, using the read basis printed by `wait`. A problem report supplies the current attempt, `WrongTask` or `TooBig`, and evidence. `work brief <token> <task>` reads the pinned brief. `restart` follows the confirmed session observation and offers a fresh attempt. |
| Questions | `work question <token> <recipient> --file=<question.yaml>` opens a Question. The owner runs `work answer <question> --file=<answer.yaml>`. Staff use `work answer <token> <question> --file=<answer.yaml>`. Both use the same answer schema as the page. A staffing reply addresses the Question, then refers to it in the revised staffing proposal. |

- **[`skills/assess/SKILL.md`](../../skills/assess/SKILL.md)** drafts wide roles, then puts how-to guidance into direction stages, standards and rules. It makes clear who reviews, who can accept, how to send back reviewed material, and how to respond to a Staffing Question. Remove program-role, checker, bulk approval, per-file Consult and approval-starts-store instructions. Preserve examples whose inputs and outputs become rule evidence. Have the assessment identify which app checks the harness will run and what the app’s own runner must hand off.
- **[`skills/aristoteles/SKILL.md`](../../skills/aristoteles/SKILL.md)** shows the host how to start in the fresh Project, review onboarding in its own fresh child, use shared Staffing and Question forms, and let the owner activate and start work. Remove file-state instructions and the old Staffing Consult reply flag path.
- **[`skills/work/SKILL.md`](../../skills/work/SKILL.md)** and **[`adapters/words/work.ts`](../../adapters/words/work.ts)** explain the brief, reports, review facts, Question/Answer, retry, restart and Raised. Remove Maker, Execute/Check asks, Hear, AskRaise, prescribed verdicts, volunteered raises and legacy permit language from the first-task instructions. The review step prints the applicable guidance and evidence contract.
- **[`skills/role-fitness/SKILL.md`](../../skills/role-fitness/SKILL.md)** and **[`guides/roles.md`](../../guides/roles.md)** describe broad responsibilities, staffing and separate guidance. Nanda can change the role’s responsibility. Pipeline assessment supplies direction-level evidence rather than owning that change. Remove tiers and a pipeline role edit from this path.

## The durian-metis run

1. After the cutover rehearsal and review, Nanda chooses a fresh SQLite file through `ARISTOTELES_DB` and starts the CLI, browser server, onboarding host, and any child processes with that same setting. Use a fresh project checkout or isolated activation workspace so marker files and private launch files start on the intended basis. Preserve the current store and drafts as reference. The current local checkout has an untracked `aristoteles.draft.yaml`. Use its material when redrafting and preserve that file.
2. Open the project with the onboarding host already assigned and able to launch its own fresh child. Redo the existing directions and staffing drafts as proposals. Use the old material as source when writing the new proposal forms. Convert the document workflow to ordered stages with scoped standards, independent rules and examples. Keep the broad writing, verification and pipeline responsibilities and let Nanda edit their wording. Use one subscriptions list, every role assigned once, and the host’s estimate or none. Review each proposal in the host’s own subagent, then accept the exact versions as owner.
3. Settle a staffing or scope Question in the page if needed. Preflight the marker files, confirm the current bootstrap host and activate. Open active work after the committed binding is visible. Check the page and `work wait` agree about current authority.
4. Send one representative TSD or HLD leaf task that fits one attempt and needs no parallel work or contract. Pin its direction/stage and role responsibility. Wire a rule command for a deterministic check where appropriate and a prompt rule for judgment. The Metis host gives the Aristoteles task to the assigned role and lets the harness run the selected commands and fresh review. Check the existing durian-metis validator workflow so it hands off those checks once. Keep provider-specific judge packet handling and publishing outside this trial. Reconcile any needed handoff in its skills before running the live task. [Current durian-metis workflow](../../../durianpay/durian-metis/skills/durian-metis/SKILL.md)
5. Observe the task move through ReadyToReview and Reviewing to Done on the page and in the CLI. Include the artifact, command outputs, review findings or evidence, pinned versions, and final event numbers in the acceptance record. Exercise back, restart and Raised in the scratch rehearsal. Nanda decides whether the first live slice is ready before scheduling the later paths.

## Names to rule

| Unit | Name | Meaning |
| --- | --- | --- |
| U1 | `Party` | The actor or engine authority that owes a move on a line. |
| U1 | `Submission` | A read basis, line address, move and checked input. |
| U2 | `roles` | The project's host, pipeline and work roles. |
| U4, U6 | `Waiting`, `Assigned` | The shared state of a review assignment. Assigned records the staff and review number. |
| U4 | `feedback` | A draft's `None`, `Review { facts }` or `Owner { why }`. |
| U4, U6 | `Outcome`, `Evidence` | `Holds` or `Breaks`, each with a file `Quote` or a `CommandOutput`. |
| U5 | `ApprovedFile` | A marker file and the image approved by the owner. |
| U5 | `ApprovedFiles` | The checked manifest of distinct instruction files. |
| U5 | `FileHash` | Digest of the image approved for a marker file. |
| U5 | `HostLaunch` | The launch on the shared `Reserved`, `Acknowledged`, `Bound` and `Cancelled` line. |
| U5 | `LaunchNonce` | Private proof that the caller belongs to the launch. |
| U5 | `HostCredential` | Private credential used by the committed host. |
| U5 | `LaunchVerifier` | Private digest used to check the host credential after delivery retires. |
| U5 | `ActivationPanel` | Owner controls for file approval and starting work. |
| U5 | `replacement` | The optional launch considered for the active host binding. |
| U5 | `NotStarted` | The owner has yet to start work under the current binding. |
| U5 | `Started { at }` | Work has started under the committed binding. |
| U5 | `Used { at, usedAt }` | The bound host has authenticated its first use. |
| U6 | `WorkResult` | A work report’s attempt, summary and whole touched files. |
| U6 | `CommandOutcome` | The holding or breaking evidence for a pinned command rule. |
| U6 | `CommandExit`, `CommandTextOutput` | Checked exit status and captured text from a rule command. |
| U6 | `TaskDraft` | The opening input of a task, including the stage slice that supplies its role. |
| U6 | `where` | An attempt runs in a `Session` or a `Subagent`. |
| U6 | `lastAttempt` | `None` before work begins, or `Attempted { number }` for numbering the next attempt. |
| U6 | `CommandRecord`, `CommandCapture` | The private address and capture state of a command for a committed result. |
| U6 | `NotStarted`, `Running`, `Captured` | Whether the command was issued and whether the provider recorded its output. |
| U6 | `TaskBriefText`, `TaskPanel` | The CLI’s pinned brief and the page view of the task. |
| U7 | `ReviewFacts` | Outcomes and findings with evidence for the pinned task input or proposal draft. |
| U7 | `ReviewFeedback` | The breaking outcomes already pointed out to the staff on the current retry basis. |
| U7 | `knownBreaks` | Pinned quotes documenting pre-existing breaks of a rule. Matching quotes outside the changed lines remain in the result. |
| U7 | `RetryLimit` | The configured number of times review can return the work. |
| U7 | `WrongTask` | A raise reason for evidence that the current task as cut contradicts what exists or needs a prerequisite. |
| U8 | `ProjectCredential` | Private credential for the bound host, staff session or fresh review. |

Start work takes the `start` move on Activation. The latest launch in
Activating is the last entry of `launches`. Active keeps the current
replacement on the same HostLaunch line. `cancel` ends a reserved or
acknowledged launch. After a replacement binds, reconciliation removes
the earlier credentials and clears the replacement.

Nanda's ruling on 2026-11-26 names the journal port `Journal` and its
transaction callback `Write`. She kept `StaffingAccepted`, `Running`,
`Unknown`, `Committed`, `PageProject`, `AuthenticatedActor` and `staffCards`.
An unopened project is null. A stored move carries the line, source phase and
move from the table, with the data its edge accepts. The same table generates the
public submission schema and supplies its authority. The task opens on its own
line. Staffing basis comes from the accepted staffing version or the opening
event. Review entry order comes
from the journal event that moved the task to Reviewing. The page uses
`QuestionCard`. Opening a question takes the line's input, and its `about`
field can refer directly to a staffing proposal and its read basis.

A Paused lifetime is the address for retrieving a checkpoint from the provider's
private storage. The journal and page carry that lifetime's identity and state.

The U4 ruling keeps `ProposalCard` and names the views `OnboardingView`,
`RoleCard` and `StaffingView`. The owner query selects WaitingForOwner.
An assigned review is identified by its task or proposal and its review
number. The `assign` move changes the shared review assignment from Waiting
to Assigned. Proposal review identifies the child by the queued review basis
chosen before launch.
