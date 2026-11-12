# work — the CLI of the engine (draft 4)

`work` runs the engine of the intelligent-work design as a command line, so that agents of
three tiers and a person can do code and document work under review. A project moves to it
only after it passes the thought tests, the end-to-end tests, the property tests, and the
golden tests.

One rule holds for every line that `work` prints: an agent reads only this text, so every
line says what to do next, or why it cannot, with the exact command.

## 0. History of the thought tests

**Round 1 (draft 1, 40 findings, thought only).** Every acting command takes the caller's
token first. A claim per attempt. Parents and tiers. One escalate command. Forwarded person acts.
A digest for each result. Reject points. Ids with kind prefixes. `waiting`, `status`, `next`,
`direction review`, `source`, `forward`, `confirm`, programs. The store is the only truth.

**Round 2 (draft 2 as a running prototype, about 60 findings).** Three tests drove the CLI:
an Opus agent that tried to break identity and the rules, an Opus agent that walked real
code and document work, and a live Haiku writer that had only the skill and its one command.
What changed:

- Tokens have a 130-bit secret. A person command refuses `GIT_CONFIG_*` variables.
- Programs run with no shell, in the workspace folder or in a clean checkout of the
  reported commit. An output has only safe characters and stays inside the project.
- A direction review comes from a medium or high actor outside the suggester's tree. Only a
  person removes a rule that a person checks. Nobody resolves their own escalation, and an
  escalation to a person is resolved only by that person.
- A forward comes only from the top agent (medium or high, no parent), inside its own tree.
  A forwarded answer now waits for confirm, like an accept.
- Evidence names the place in the result and says what was seen. An unchanged result does
  not answer a Reject. A report of unchanged work, of another file, or of another section is
  refused. A join that changes an accepted part is refused.
- The tier's `maxAttempts` is the default and the ceiling; `resultLines` works; an unknown
  limit is refused. A waiver by an agent lasts at most `waiverHours` (72) and never covers a
  person-checked rule.
- A medium or high claim lasts until finish. The person frees or finishes any assignment.
- Briefs: the project folder, ANSWERS to the questions, PARTS of a split task, RULES for
  medium and high, evidence lines only for the rules that the reader checks.
- `waiting` shows what waits for the person (person-checked rules, change points, waivers,
  forwarded acts with their content). `next` prints the redo step, the checker to start again,
  and the finish steps.
- New: `work recheck`, `work config restore`, `work direction show <id>@<n>`. The CLI records
  the merge base of a reported commit, so `resume` finds it when main moves.

**Round 3 (draft 3, about 45 findings).** A live run first: a Sonnet section lead, a Haiku
writer, a Haiku linter, and the person finished a task from one prompt each ("I never had to
guess a token, a task id or a flag"). Then an Opus attacker and an Opus flows walker. The
lesson: a rule checked in one command was passed through another (forward, confirm, resolve,
checkpoint). What changed:

- **One place for the checks of every act.** A table (`GUARD` in `cli.js`) says, for each
  event type, whether it needs a claim and which ids must be in the caller's task tree;
  every agent event passes it, before any check of the act itself. The digest check is in
  the review handler, so a review, a forwarded review, and a confirmed review all pass it.
- **Removed:** person roles (the person acts only with no token at a terminal), an agent's
  split that answers the person's Reject (only that person's own split does), free-text forward
  channels.
- **Engine:** a resolve ends only an escalation and never counts as an accept; an approver below
  the suggester counts as the suggester; a changed `when` cannot take a person-checked rule
  off an open task without the person; a new rule takes no existing id; a recheck, or a
  second open maker, makes no end-of-round question; a task takes its closed parts' rules;
  an escalation goes to the nearest open assignment above.
- **Real work:** a report equal to the untouched output, a commit already on its base, a
  commit of a repo inside or around the workspace, and a sibling part's section are refused.
- **Forward:** a dry run of the person's act at forward time; a forwarded approve's confirm shows
  the version and the person-checked rules it removes.
- **Advice:** after a direction change, `next` checks the unchanged result again instead of
  a redo; a result built on an old base shows in `next` with no checkpoint; answers are cut
  in briefs (`work question show` prints them); the person's comments show in NOTES; a low
  checker sees only its checks; STOP names the act; a high agent is told to split first.
- **Files:** an official direction version is written back to its file.

**Round 4 (draft 4, the last round by the stop rule, about 30 findings).** An Opus attacker
tried seven invariants at every entry point, and an Opus walker finished three real flows
(a code fix with a moved main, a two-section TSD with a whole-page join, a cold resume).
Invariant 1 (only the person acts as the person) held at every entry point. The round was
**not clean**: other paths let one act do another act's work. Fixed after the round, each
with a test in `test/round4.test.js`:

- a forward after a version became official failed (a replay wrote into the stored config);
- after the parts were accepted, `next` said to split again; a task with parts cannot split;
- `split --review` and `approve --answers` closed points with a rule, or points of another
  tree; a closed part dropped the person's open point (the close is now refused);
- two directions could get one rule id; a revise could name a checker that is not a role;
- a part could drop its workspace base, or take a section of another task in its tree;
- a report equal to earlier rejected work, or a join, were judged wrong (refused / allowed);
- a low checker briefed before any report could review a later result;
- a program was printed as a checker to assign; the change step was hidden behind a redo;
- `direction revise` had no template; a new file in `directions/` was not named.

**Round 5 (draft 4, about 23 new findings).** Nanda asked for it after round 4. The same two
Opus agents attacked the round-4 fixes and walked the three flows again. Six round-4 fixes
were broken through another entry point, and one round-4 fix (the record half of R4-1) was
listed as done but was never written. The lesson of round 3 came back: a check for one case
does not close its cause. So each fix below closes a cause in one place. Each has a test in
`test/round5.test.js`, and the attackers' own scripts were run again against the fixed CLI:

- **Rule ids.** An id names the rule in the official version only; a suggestion changes
  nothing until it is approved. One version has no repeated id. A rule's checker reviews or
  approves a role that does the work, and a program lists the rule in its checks.
- **Closed parts.** A closed part owns nothing: the join may change its text, and its rules
  check the join. A closed task takes no part and no recheck. A task closes after its parts,
  and an agent's close never drops the person's open Reject anywhere under the task.
- **Sections.** One check at every report: each section that another open task of the tree
  owns, inside the output, stays as that task's latest result left it (whole-file joins,
  nested headings, parts). New design rule: parts that share a file each own a section of it,
  or none does.
- **Untouched work.** The first brief records each workspace file and each of its sections; a
  report equal to that is refused (this also closes R4-8). A join skips this only when a part
  has an accepted result. A part with an empty workspace is refused.
- **Direction changes.** Each rule of a new or replaced standard needs evidence again, from
  its own checker. A change with nothing to check needs one accept by a role that decides.
  `next` prints only those checkers (a program only when its rule changed), and the person's
  check. An approve that takes a rule off the task answers the points on that rule.
- **Points.** Rejected work is refused after a recheck too. A Reject of a task names no rule,
  and a point names a rule of the reviewed task. An agent does not split past the person's
  open point with no rule; `waiting` shows the person's own split as an answer.
- **Record and next.** The log and the blockers name the split that answered a point; an
  accepted result names its output; a confirmed approve prints what a terminal approve prints
  (old results, tasks that nobody works on, the person-checked rules that leave a task). A
  maker with no attempts left takes no claim. A parent that lost a child's token is told how
  to go on. `next` starts only its own children. `waiting` names a task that nobody works on.
- **Words.** A new file in `directions/` is deleted, not restored; `--answers` names the ids
  it takes; a missing token or file says what is missing; a split with no `--file` prints an
  example; verify runs in the project folder; a reviewer sees the base of a commit; `resume`
  lists the answers that came after the checkpoint.
- Three earlier tests changed with the design: a split that mixes parts with and without a
  section is refused at the split (I-N11, R4-10), and the gate does not run again after a
  change that has no rule for it (FW-6).

**The needs model (Nanda's Part 5 answers, 2026-10-28).** No joining result and no `join` key:
a task lists the tasks that it needs, and a split sets the parent's needs to its parts. Every
result also needs its decider's accept. A closed task moves its rules nowhere; a needed task is
not closed, and the task that needs it is remade (`work task remake`), with its accepted work
carried and checked again. The engine brief holds short ANSWERS, NOTES, and NEEDS. Two of the
three design rules of round 5 went with it ("a closed part owns nothing", "close after the
parts"); "every part in one file has a section, or none" stays. Tests: `test/needs.test.js`, and
the changed tests of rounds 2 to 5; the property test ran 400 seeds on it
(`thought-tests/proofs.md`).

**Round 6 (2026-11-07).** Nanda approved three agent tests (`thought-tests/proofs.md` section
5): 16 Haiku linters found 10 of 10 small faults and rejected no clean item; a live remake ran
the rules of 2026-11-07 with real agents; two Opus attackers found 18 faults, all fixed, each with
a test in `test/round6-*.test.js`.

**Round 7 (2026-11-07).** A second attack round on those fixes found 21 faults, all fixed (tests
in `test/round7-*.test.js`), and a live remake with two sections ran `decide: order` and
`approvedBy` with real agents (`thought-tests/proofs.md` section 5, Tests 4 and 5).

**Round 8 (2026-11-08).** Nanda chose one maker for each file at a time (section 8). A third
attack round of two Opus attackers on the round-7 fixes and on that file queue found 26 faults,
all fixed (tests in `test/round8-*.test.js`, about 580k tokens): the worst let a change with the
same words answer the person's point, let a later decider reject before its turn, let a section
report change an accepted section beside it, and let one file have two names, so two makers held
it. Section 11 lists the rules derived while fixing them.

**Evaluation (2026-11-08).** Nanda: "when mistake happen, the correct course would be to
evaluate, not to decide". A maker's last try that ends on a fault, and the person's Reject, stop
the task until the high role (or the person) writes an evaluation: what is wrong, why, what to
improve, and the level of the cause; the work goes on only on changed inputs. Rounds
(`maxRounds`) and the end-of-round question are gone: a new maker with the same inputs would make
the same mistake. Every workflow has a high role. Section 8, "Evaluation"; tests
`test/evaluation.test.js` and the rewritten tests of the older rounds.

**Round 9 (2026-11-08).** A fourth attack round of two Opus attackers on the evaluation and on
the round-8 fixes found 29 faults (with some overlap), all fixed (tests in `test/round9-*.test.js`,
about 660k tokens). The worst: a decider's accept after the person's Reject of a task made the task
accepted with no evaluation; another person (not the owner) accepted the owner's evaluation; an
agent wrote its evaluation again at a lower level to skip the person's accept; a version that its
approvedBy reviewer rejected became official; a new maker given before the review of the last try
skipped the evaluation; a recheck with nothing changed outside gave endless tries. Section 11 lists
the rules derived while fixing them.

**The flows of the design page (2026-11-08).** Nanda asked for every flow worth a tab, tested
first. The page has 20 flows (8 happy, 12 negative); a test of the page (outside this repo) runs each one
through the CLI. The runs found two replies that pointed to a wrong step, both fixed (tests in
`test/replies.test.js`): an agent's remake of a top task said "split t2 or assign it", but t2 is
outside the agent's tree, so the reply names the owner who assigns it; a confirm of a forwarded
approve did not say that the version is official. `test/harness.js` has `wait(minutes)`, so that
a waiver can end in a test. Two suggestions are on the page (Part 4): `next` offers the check of a
waived rule while the waiver lasts; the brief of a remade task shows the evaluation of the task
that it replaces.

**The design review of 2026-11-08.** Nanda reviewed the types of Part 2 and decided this model;
the engine, the CLI, the tests, and the 20 page flows follow it.

- A change of a direction goes in three steps. A suggestion is feedback in words, from anyone
  (`work suggest`, id `s1`), about a direction, a standard, or a rule; with nothing to be about,
  it asks for a new direction. A challenge is a suggestion that says something is wrong. A high
  role writes a draft (`work direction revise`, id `d1`) that names the Rejects and suggestions
  that it answers (`--answers`, `--why`); the answer checks run at the revise. The draft gets
  Reviews like a result (`work review d1 accept --evidence=... | reject --reason=...`). The accept
  that meets `approvedBy` (none: the owner, or a role with a Change act) makes the next version.
  There is no approve act. Every version has its draft (`revision`); version 1 comes from a
  model's draft of the whole direction (`work direction new`) and the owner's accept (the roles of
  `approvedBy` decide from version 2, because no task follows a direction with no version). Only a model revises: the person gives
  direction in words (`work suggest`) and accepts or rejects the whole draft. The reviser and the
  actors below it do not review the draft. A model's accept of a draft needs evidence; the
  person's accept needs none, and their comment is optional (Nanda, 2026-11-11). A Reject by a
  decider ends the draft, and the next draft answers it (`--answers=<the Reject>`; a draft that
  proposes the same is refused); when the reviser is finished, a new run of its role revises.
  After another reviewer's Reject only the
  owner's accept makes it official; a new spirit or a new direction needs the owner's accept; a
  draft built on an old version is refused at the accept that would make it official.
- Session is removed. An actor is a person `{ name }` or a run of a model `{ name, run }`; two
  actors are the same when they are one person or one run. The channel stays in the record of
  the CLI.
- Each act has its time (`when`), which the tool gives (the CLI: the time of the event). The
  engine refuses an act with a time before the last act. A grant covers an act from its own
  time to its `until`, and before its revoke (`revoked` holds its time); a revoke keeps the acts
  before it. A recorded review counts with the acts that its reviewer had at its own time, so an
  accept made under a night grant still counts in the morning. A waiver counts for a read at a
  time between its own time and its `until`; the reads (`blockers`, `Task.state`, the brief) take
  the time. A model can grant too; nobody gives more than they may do.
- A stop is the record that makes a task wait: an Exhaustion (`ex1`: the last try of a maker
  ended on a fault) or a Reject of the person (its points are one stop). An evaluation answers
  one stop (`work evaluate <stop>`; a task id names its first waiting stop); two stops, two
  evaluations. The owner decides an evaluation that waits for the person with `work review ev1
  accept --evidence=... | reject --reason=...`; an escalation on an evaluation is refused.
- The limits sit under the part that checks them: `Assignment: { briefChars, attempts }`,
  `Review: { rules }`, `Result: { size }` (`Note: { waiverHours }` left with the waiver on
  2026-11-12). The engine checks attempts (the default and the ceiling of a maker).
- A standard's `when` is `where`: the context where it applies.

**Open after round 8.** The ids in brackets are in `thought-tests/round-4.md` and `round-5.md`:

- Nobody has attacked the round-9 fixes yet.
- From the page flows, one line each: after the CLI refuses a code commit because another open
  task changes the same file, `next` offers the maker's new try at once, and that try is refused
  again until the other task is accepted. `next` offers the check of a result that its decider
  rejected with a point that waits for a direction change. An approve of a version that says
  nothing new to a task passes; only the brief of the maker is refused after it. After a source
  changes, `next` offers the maker of the task that joins the parts while a part is stale. A
  writer on a task with no section and no parts reports one section that it chooses.
- A medium or high maker has no limit of tries in the configs of the tests, so its mistakes start
  no evaluation until a person rejects the work.
- Decided on 2026-11-08: two makers of parts of one document file no longer write it at the
  same time; one maker writes a file at a time, in the order of the assigns (section 8).
- The live two-section run stopped before its last two fixes.
- Closed on 2026-11-07 (Nanda: "do this open part"; tests in `test/open-items.test.js`): a
  command refuses a flag that it does not read; the checker step says that the same assignment
  checks each new result; a low maker's brief has the answers to the questions that an
  assignment above it asked about its task (FW-8); parts that share a document file each have
  their own section (`section` needs no "when"); a commit that changes a file of another open task
  that does not wait for it is refused (FW-7, R4-5: work that changes the same files runs one
  after the other); the top agent gets the step that puts an accepted commit on its base
  (R5-F10); a finish removes a code maker's worktree and keeps its branch.
- R5-F7 is decided (2026-11-07): only a fault uses an attempt, and an approved change resets
  the attempts (section 8).
- A forwarded approve does not warn about the open change points that it does not list (FW-3,
  partly fixed).
- Advice and wording from round 4: the redo line after a recheck does not name the old
  output to rebase (FW-10); `next` still prints some steps that the record closed (FW-11); a
  cold brief does not show the last checkpoint (FW-12); a low maker's OPEN shows items that
  it cannot act on (FW-13); small wording (FW-15).
- The four migration limits of section 4.
- From the live code run (proofs.md section 3, fixed 2026-10-29): a code maker's brief names
  its own git worktree (`.work/trees/<assignment>`, branch `work/<assignment>` from the base)
  and the command that makes it; the work commands still run in the project folder. A finish
  removes the worktree (2026-11-07). `work result show <result>` prints each
  review with its evidence and points.

The tests of rounds 2 to 5 are in `test/round2.test.js` to `test/round5.test.js`; the
findings of each round, with what was done, are in `thought-tests/round-2.md` to
`round-5.md`. Round 1 was a thought test on paper; this section's round-1 line lists it.

## 1. The parts

| Part | What it is | Where |
|---|---|---|
| Engine | the model: Workflow, Direction, Task, Assignment, Result, Review, Checkpoint, Note | `engine.js` (copied from the page, then extended) |
| Store | aristoteles (section 9.1): one SQLite file for every project of this machine; the act log that the engine replays, and a table for each record with its links | `~/.aristoteles/aristoteles.db`, or `ARISTOTELES_DB` |
| Project config | roles with their tiers, people, limits, deciders; the company directions that the project follows | `aristoteles.yaml`, and `aristoteles.lock` |
| Guides | how to write a direction, and the questions of the review of a draft (`work guide <name>`) | `guides/*.md` |
| Tier guides | for each tier: its introduction, and the guide of each command it may run | `guides/<tier>.yaml` (shipped with the CLI) |
| Fitness questions | the questions that `work role fit` prints | `guides/fitness.yaml` |
| Skills | `work` (the front door), `role-fitness`, and `assess` (reads an app and drafts its directions) | `skills/` |

## 2. Tiers

A tier is a model class. The person is above all tiers.

| Tier | Model class | Does | Never does |
|---|---|---|---|
| person | a human, with no token, at a terminal (no role is played by a person) | owns tasks and directions; accepts drafts of directions and standards (not results); the spirit of a direction; permissions; config; confirms; criticises work; gives work only to medium and high roles | accepts each result; reviews a draft that they wrote |
| high | Opus class | keeps the work on its directions: splits, closes, writes drafts of directions and (as a decider of approvedBy, or with a Change act) accepts the drafts of others, evaluates a mistake, assigns medium and low roles, escalates to the person | changes the spirit; reviews its own draft; does medium or low work |
| medium | Sonnet class | runs one task: assigns low roles, decides each result of its makers, escalates to its parent | changes a direction; does a low unit itself |
| low | Haiku class | executes one unit: one report, or one review of its checks; escalates when the brief is not enough | anything its brief does not list |

The tier of an agent comes from the role of its assignment. A program (a gate, a test run)
is a role of kind `program`: it has no tier; the CLI runs it.

## 3. Project config

`aristoteles.yaml` (2026-11-11: it replaces `work.yaml`, and it is the one file of a dir). The
name of a dir is its folder name, so the file has no `project:` key; the store keys a dir by the
full path of its folder. The file also holds the settings of the UI (`tiers`, `retryMinutes`,
`hostWaitMinutes`, `sound`, `theme`; see `plan/ui/PLAN.md`). Only the mechanism (people, limits,
roles, decide) is stored at `work init`, so a change of a setting is not a change of the stored
config. `schema/aristoteles.schema.json` is its schema.

```yaml
people:                                    # the person is the git user.name, if listed here
  - name: Nanda
limits:                                    # per tier, under the part that checks each limit
  low:    { Assignment: { briefChars: 12000, attempts: 3 }, Review: { rules: 5 }, Result: { size: 400 } }
  medium: { Assignment: { briefChars: 40000 }, Review: { rules: 12 }, Result: { size: 2000 } }
  high:   { Assignment: { briefChars: 80000 }, Review: { rules: 20 } }
roles:
  writer:
    tier: low
    description: Writes one TSD section from its brief.
    intro: You write one section under its heading. The brief gives the facts and the rules.
    responsibilities:
      - Write the section under its heading in the file that WORK IN names.
      - Report it with work report, as <file>#<section>.
    output: "<file>#<section>"           # <file>, <repo>, <task id>, and context keys are filled in
    acts: [{ do: write one TSD section }]
  linter:
    tier: low
    description: Checks one section against the rules in its checks.
    intro: For each rule in your checks, say where you looked and what you saw.
    responsibilities:
      - Give one --evidence line for each rule in your checks.
      - Reject with one --point for each rule that the section breaks.
    acts: [{ review: [writer] }]
  section-lead:
    tier: medium
    description: Runs one section - assigns the writer and the linter, and decides the section.
    intro: You run one section until its rules have evidence, or you escalate.
    responsibilities:
      - Assign the writer, then the linter on each result, with work assign.
      - Escalate with work escalate when a round ends.
    acts: [{ approve: [writer] }]
  spec-gate:
    kind: program
    run: "bun test"                        # words, no shell; {workspace.path} and {output} are filled in
    timeout: 300                           # seconds (120 when not set); a timeout is a reject
    on: report                             # runs after each report of a role that it reviews
    checks: [suite-passes]                 # rules that are checkedBy this program, and only those
    acts: [{ review: [implementer] }]
```

`aristoteles.yaml` names no directions: each one lives in aristoteles. A model drafts a new direction
as a whole, with `work direction new [<token>] --file=<direction.yaml> [--by=<model run>]`: a
high role with its token, or a model run outside any task (such as the `assess` skill). Its
owner accepts the first version. The file of a new direction (each `says` is any markdown):

```yaml
id: tsd-writing
name: TSD writing
owner: Nanda
from: [Pathos, Logos]
says: The reader understands and decides from the page alone.
standards:
  - id: facts-not-proof
    says: The body states facts; the proof stays in the agreed facts.
    rules:
      - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }
      - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }
  - id: intro-story
    where: { section: introduction }
    says: Tell the story first, in plain words.
    rules:
      - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead }
```

A task file (`work task open` with no `--file` prints this template):

```yaml
name: The Introduction
text: Write the Introduction from the agreed facts.
directions: [tsd-writing]
context: { section: introduction }        # every key must be used by some "when"
workspace:                               # relative paths inside the project
  - { source: tsd, path: docs/report-export.md, verify: "work-lint docs/report-export.md" }
  # code: { source: app, path: app, base: main } - a git source: the CLI reads the merge base of each commit from git
references: ["docs/agreed-facts.md#dedupe"]
```

`needs: [t2, t3]` names the tasks that this task needs: its maker starts only when each of
them is accepted (work that uses other work, or changes the same files, runs after it), it
takes no result while one of them is not accepted, and its result is the whole workspace (a document file, or a commit that
contains their accepted commits). A split sets the parent's needs to its parts; each part also waits for what its task waits for,
and names the parts above it that it runs after (`after: [Schema]`); `work next` says which part
waits. Parts that share a document file each have their own section of it (`context: { section:
<heading id> }`; `section` is the CLI's own key, so it needs no "when"); a task with a section is
one unit, and is not split into parts that share it.
There is no reserved context key: the whole page is decided by the decider of its task.

A `verify` command exits 0 when the work is ready. The live Haiku test showed why: a verify
that fails on correct work makes a careful agent escalate instead of report.

## 4. Identity

- **The person** is the git user.name, if it is in `people`. A command with no token is a
  person command, and every person command needs a terminal (an agent's shell has none, so
  it is refused with "an agent passes its token first"). A person command refuses
  `GIT_CONFIG_*` variables. `grant`, `revoke`, `confirm`, `config apply|restore`, and a
  person's accept of a draft (`work review d1 accept`) also need a typed confirmation, and the
  prompt shows the act.
- **An agent** acts only with its token. `work assign` prints the whole subagent prompt once:
  `Use the work skill. In <project folder>, run: work brief a7.<secret>`. The secret has 130
  bits, and the store keeps only its hash. Lists and logs show `a7` only.
- **A claim.** `work brief <token>` claims the assignment. A low claim ends with its one
  `report`, `review`, or `escalate`; a second low claim while one is open is refused ("STOP").
  A medium or high claim lasts until `finish`, and the agent may read its brief again. A
  report or a review needs a claim, so it always follows a brief (the snapshot). A parent
  frees a stopped child with `work free <you> <child>`; the person with `work free <a>`.
- **A parent** sees a child's brief with `work assignment show a7` (read-only, no snapshot).
- **A forward**: the top agent (medium or high, no parent, with a claim) records the person's
  act on something in its own tree: `work forward <you> <person> <act> <id> --quote="<their
  exact words>" --channel=chat|github`. The CLI first applies the act as the person in a dry
  run, and refuses the forward when the person could not do it now. A reject, a question
  (`ask`, to an assignment in the tree), or a comment counts at once, at the time of the forward.
  An accept (of a result, a task, or a draft, with evidence), an answer, or a resolve (of an
  escalation, in the person's words) waits for the person's `work confirm <event>`, and counts
  at the time of the confirm. A grant is never forwarded.
- **The checks of every act** are in one table: the caller's assignment is open; it has a
  claim where the act needs one; each id that the act names is inside the caller's task
  tree. The table runs before any check of the act itself.

**Limits that only the migration closes** (a server-side store, and the board with the
person's key). They are stated here so that nobody trusts the prototype past them:

- An agent that runs as the same OS user can write rows into the aristoteles file and act as
  anyone. One unknown row stops every command ("the store is damaged at eN").
- `script(1)` gives an agent shell a terminal, so it passes the person checks.
- A parent that keeps its children's tokens can do their work; the log shows two actors.
- A token is in the process arguments while a command runs, so `ps` shows it for that time.

## 5. Ids

Every id has a kind prefix: task `t3`, assignment `a7`, result `r12`, review `v4` with
points `v4.1`, question `q5`, suggestion `s1`, draft `d1`, stop `ex1` (the last try of a maker
that ended on a fault), evaluation `ev1`, permission `x1`, checkpoint `k1`, note `n2`, event
`e88`. An official version of a direction is `tsd-writing@3`; one piece of it is
`tsd-writing@3#<standard, rule, or header>[#<header>]`. Standards and rules use the ids of the
draft file (`no-ticket-ids`); a rule id is unique in the project. Every argument checks
its kind, and a wrong kind names the kind it expected.

## 6. Commands

`<you>` is the caller's token. "person" means no token, at a terminal. Each command reads
only its own flags, and refuses any other flag before it stores anything. A failure prints
`refused: <why>` and one `next:` line. The exit code: 0 success, 1 a refusal, 2 a mistake in
the command line (an unknown command or flag, a flag with no value), 3 an outside failure (git,
tmux, a fetch, the files, a busy store) or a damaged store, 70 a bug.

**Reading (anyone)**

| Command | What it prints |
|---|---|
| `work` | a short usage; an agent's commands are in its brief |
| `work brief <you>` | your brief (section 7); claims the attempt; takes the snapshot |
| `work assignment show <a>` | a child's brief, read-only |
| `work next <you>` | the steps that are ready in your subtree, one command each |
| `work waiting [--for=<person>\|<a>]` | what waits, with the command that ends the wait |
| `work status` | open assignments, claims, and their age |
| `work task show <t>` / `work task tree <t>` | a task, its state, its parts, changed or rejected results |
| `work direction show <id>[@<n>]\|<draft>[#<entry>[#<header>]]` | an official version (the draft that made it, and the open drafts), or a draft: its standards and rules, what it changes from its base, what it answers, its reviews, and whose accept it waits for ; with `#`, one standard, one rule, or the text under one header |
| `work direction new [<token>] --file=<direction.yaml> [--by=<model run>] [--answers=]` | a model's draft of a new direction, as a whole; a high role, or a model run outside any task; the owner accepts version 1 |
| `work search <words>` | the words of directions, standards, rules, suggestions, and reasons in aristoteles, with the versions that hold them and the tasks that read them |
| `work guide writing\|direction-review\|decision-words` | how to write a direction, the questions of the review of a draft, and how a host writes the words of a decision for the person |
| `work evaluation show <ev>` | an evaluation: the stop that it answers, its level, what is wrong, why, what to improve, and its review |
| `work blockers <r>` | what still stops that result, with ids |
| `work log [--last=<n>]` | the history: who, on which channel, what, and the ids it made |
| `work question show <q>` | a question and its answer in full |
| `work result show <r>` | a result and each review of it: the evidence lines, the points, the escalations, then its blockers |
| `work role list` / `work role show <role>` | roles (from the store), tiers, roles with no fit record |
| `work role fit <role> [--answers=<file>] [--as=<you>] [--by=<model run>]` | the static checks and the fitness questions; with answers, records them (the person, a high role, or a model run outside any task) |

**Acting (with a token)**

| Command | Who |
|---|---|
| `work assign <you> <t> --role=<role> [--max-attempts=<n>] [--dry-run]` | high (medium and low roles), medium (low roles), the person (medium and high roles only); only in the caller's task tree; a reviewer checks the rules that name its role |
| `work report <you> --output=<the form in your brief> [--made-from=<source>@<rev>\|<r>]` | a role with a Do act; the CLI computes digest and size and runs the programs; `--made-from` never names a git source |
| `work review <you> <r\|t> accept --evidence="<rule id> \| <where> \| <what>" ...` | a role that reviews or approves the maker's role; a low checker only the result in its brief |
| `work review <you> <r\|t> reject --point="<text>" [--breaks=<rule id>] ...` | the same; each `--breaks` belongs to the `--point` before it |
| `work resolve <you> <v> --resolution=<text> [--evidence=...]` | the assignment that an escalation names, or a decider; never the one that escalated. A resolve accepts and rejects nothing: the deciders then review the result as usual |
| `work recheck <you> <r> --reason=<what changed outside>` | medium or high that decides; asks the maker for a new result |
| `work escalate <you> --reason=<text> [--result=<r>]` | anyone with an open assignment; goes to the parent (or the owner); with `--result`, the result waits for the resolve |
| `work ask <you> --text=<context first, then the question> [--to=parent\|owner]` | anyone; a low role asks only its parent |
| `work answer <you> <q> --text=<text>` | the assignment that the question names |
| `work note <you> finding\|message --text=<text>` | anyone |
| `work suggest <you> [<rule\|standard\|direction>] --says=<the words>` | anyone, the person too; with nothing to be about, it asks for a new direction |
| `work direction revise <you> <direction> --file=<edit.yaml> [--answers=<v, v.n, or s ids>] [--why=<why>]` | high only (the person suggests); makes a draft `d1`; after a Reject of a draft, the next draft answers it |
| `work review <you> <d> accept --evidence="<where in the draft> \| <what>" ...` / `reject --reason=<text>` | medium or high, not the reviser or an actor below it; the person accepts with an optional `--reason` and no evidence; the accept that meets `approvedBy` (none: the owner, or a role with a Change act) makes the draft official, and the new version is written to its file |
| `work evaluate <you> <stop>\|<t> --wrong= --why= --improve= --level=` | the high role of the task's tree; it answers one stop (a task id names its first waiting stop) |
| `work grant <you> --act= --on= --to= --until=` / `work revoke <you> <x>` | an agent gives only an act that its assignment has; only the giver revokes |
| `work task split <you> <t> --file=<parts.yaml> [--review=<v>]` | high with a Change act on the task (it covers its parts); a part can name the parts above it that it runs after (`after:`) |
| `work task close <you> <t> --reason=<text>` | the same |
| `work finish <you> [<child a>]` | the agent, or its parent for a child; refused while the assignment has open children |
| `work free <you> <child a>` | the parent of a child whose subagent stopped |
| `work source <you> <source>@<revision>` | medium or high, for a source outside git; the CLI reads the base of each commit of a git source from git |
| `work checkpoint <you> <t> --next=<text>` / `work resume <you> <t>` | medium, high |
| `work forward <you> <person> <act> <id> ... --quote=<words> --channel=<chat\|github>` | the top agent only; `<act>` is reject, ask, comment, answer, accept, or resolve (of an escalation, in the person's words) |

**Person (no token)**

`work init`, `work config apply|restore`, `work task open --file=` (only the person opens a
task; a high agent splits), `work assign <t> --role=`, `work suggest` (the person does not revise;
a high role writes the draft), `work review <d> accept|reject`, `work review <ev> accept|reject`
(an evaluation of the owner's task), `work evaluate <stop>`,
`work grant --act=approve|review|change --on=<ids> --to=<role> --until=<time>`,
`work revoke <x>`, `work confirm <event>`, `work answer <q> --text=`,
`work review <r|t> reject ...` (a result only after its deciders accept it), `work resolve <v> --resolution=`,
`work task split|close`,
`work free|finish <a>`, `work role fit <role> --answers=<file>`.

## 7. `work brief <you>`

```
work brief a2 · writer (low) · t1 The Introduction · attempt 2 of 3
snapshot: tsd-writing@1
dir: /path/to/the/dir (run every work command in this folder)

YOU ARE  low tier. You execute one unit of work, report it, and stop.
ROLE     Writes one TSD section from its brief.
         - Write the section under its heading in the file that WORK IN names.
         - Report it with work report as docs/tsd.md#introduction.
TASK     Write the Introduction from the agreed facts.
WORK IN  docs/tsd.md (source tsd); verify: work-lint docs/tsd.md (exit 0 = ready)
READ     docs/facts.md#dedupe
RULES    no-code-proof  No file paths with line numbers, no commit hashes in the body  (linter)
         no-ticket-ids  No ticket ids and no chat-thread citations  (linter)
         repeatable     A reviewer can repeat the problem without the design  (person)
ANSWERS  q1 asked by a2: the verify fails on correct text
           answer (a1): the verify is wrong; report the text as it is
OPEN     v1.1 breaks no-ticket-ids: "the first line cites ABC-2964" (on r1, a3)

YOUR TURN
  report     work report a2.<secret> --output=docs/tsd.md#introduction
             If WORK IN names a verify command, run it first; exit 0 means ready. If it fails and you cannot fix it, escalate with its output.
  escalate   work escalate a2.<secret> --reason="<the missing fact, and where you looked>"
             Escalate when the brief is not enough to do the work. Do not guess.
  suggest    ...
STOP after one report, one review, or one escalation. Do not run other work commands.
```

- Only the commands whose act the role has appear in YOUR TURN (`guides/<tier>.yaml`, key
  `when`: do, review, approve, change, directions, lower, top, any), with the token, the task,
  the result, the output form, and one `--evidence` for each rule that the reader checks.
- A low checker sees CHECKS and `REVIEW r12 by a8 (writer): <output>`; medium and high see
  every RULE of the task.
- OPEN is cut to what the reader acts on: a low maker sees the points to fix, a low checker
  its own checks, medium and high every item. At most six lines, then
  `(n more: work blockers <r>)`. A result that changed after its report shows here too.
- ANSWERS shows the last three answers: a low maker the answers to its own questions, medium
  and high the answers of the task, a low checker none. Each answer is cut at 200 characters
  (`work question show <q>` prints it). NOTES shows the person's last two comments.
- WORK IN also names each program that runs on the maker's reports.
- STOP names the act: "after one report or one escalation" for a maker, "after one review or one
  escalation" for a checker; medium and high also stop when only the person can act.
- A split task's brief shows PARTS with their accepted results, and the output is the whole
  workspace file.
- A medium or high brief adds READY: the steps of `work next`, with commands filled in.
- The CLI measures the printed brief at `assign` and at each `work brief`. Over the tier's
  `briefChars`, `assign` is refused ("split the task"), and `brief` prints only the escalation
  command, with the largest part named.

## 8. Results and reviews

- **Outputs.** When the brief fills the output form fully, the report must be exactly that
  output. Otherwise it must match the role's form. Three outputs exist: a file (hashed),
  `<file>#<section>` (the section under the heading whose lower-case, dashed text is the
  section; a heading used twice is refused), and `<repo>@<commit>` (the commit sha). The file
  or repo must be in the task's workspace, inside the project, in safe characters.
- **New work only.** A report whose digest is the same as the previous result is refused,
  unless a recheck asked for a new result. A report equal to the output at the task's first
  brief is refused (untouched work). A commit already on the workspace base is refused. A
  commit must be of the workspace repo itself (`git rev-parse --show-toplevel`). A part may
  not report a section that a sibling part's context owns. A report keeps the sections of the
  other open tasks of its tree, and of the tasks that it needs, as their latest results left
  them; a commit of a task that needs others contains their accepted commits. A report may
  not be the starting point of its task (`from: <result>` in the task or part file; the brief
  shows FROM, and a code maker's worktree starts at that commit): a result is new work, made
  on top of the starting point. After a recheck,
  a commit must contain the new revision of its source.
- **Newer needed work.** A result is old when a task that it needs got a later result with
  other work (engine blocker `made before the latest result of <task>`); `next` gives its
  decider `work recheck`, and the maker reports again with that work. A need of another task
  tree shows in `next` and in `waiting`.
- **Changed work.** `work review`, a forwarded accept, and a confirm refuse when the digest
  changed after the report (a resolve with no evidence is not refused). A low checker is told
  to escalate and stop. `blockers`, `task tree`, and briefs show "changed after it was reported".
- **Reject points.** A Reject has points (`--point`). A point with `--breaks` closes when a
  later, changed result has evidence for that rule; evidence on the same work shows "the same
  work was rejected". A point with no rule closes with a direction change that lists it
  (`--answers=v4.2`). A recheck is a Reject that any later result answers.
- **Evidence** is one line per rule: `<rule id> | <where you looked> | <what you saw>`. From
  an agent, `where` names the result's file, repo, or section, and `what` has at least three
  words. A low checker gives evidence for each of its checks and only those. Evidence counts
  only from the rule's checker (a role, a program, a person, or a decider when no checker is
  named). The CLI cannot judge whether the words are true; the decider and the person do.
- **The decider decides** (Nanda, 2026-10-28). Every result also needs an accept by a role
  that decides it (the owner, or a role that approves the maker's role), under a version that
  says the same to its task as the current one; the decider may Reject instead. A role assigns
  a maker only when it, or an assignment above it, decides that maker.
- **Who decides** (Nanda, 2026-11-07). The workflow names each decider: a role with an Approve
  act on the maker. When a maker has more than one, `aristoteles.yaml` says how they combine:
  `decide: [ { resultsOf: writer, by: { order: [section-lead, architect] } } ]`, with `or`
  (any one), `and` (each one), or `order` (each one, one after the other). With no entry, any
  one of them decides. A direction file can say who accepts its new versions:
  `approvedBy: { order: [architect, Nanda] }` (a version review, then the approve). Both are
  read at `work init`; a change of them needs a new store.
- **Who reviews.** Anyone escalates. An Accept or a Reject comes from a role that covers the
  maker, a role that decides, or a role with a Change act. The person, as the owner, reads a
  result at any time, accepts none, and criticises it with a Reject only after its deciders
  accept it ("Terra must see it first"). No rule is checked by a person (`checkedBy: Human`
  is refused): the person approves directions and standards, and a person's criticism goes back
  to them. Every accept gives evidence; a line names a rule, or names none
  (`--evidence="<where in the result> | <what you read there>"`). The decider's accept counts
  only with evidence, read from the latest result itself.
- **Attempts** (Nanda, 2026-11-07). Only a fault uses an attempt: a
  result that a reviewer or a decider rejects, or that waits for its first review. A recheck,
  the person's criticism, and a Reject of a result made under an older version use none, so an
  approved change resets the attempts. When a fault uses the last attempt, the task waits for an
  evaluation (below). There are no rounds: a new maker with the same brief would make the same
  mistake (Nanda, 2026-11-08).
- **Evaluation** (Nanda, 2026-11-08: "when mistake happen, the correct course would be to
  evaluate, not to decide"). Two events start one: a maker used its last try on a fault, or the
  person rejected the task or one of its results. Until an evaluation of the task made after the
  event exists, no new maker starts, and nothing answers the person's Reject (no change, split,
  remake, or redo counts for it). The evaluation is one record on the task, written by an open
  high assignment whose tree holds the task (every workflow has a high role), or by the person:
  what is wrong (the results and the rules that they break), why the task cannot be done as
  asked, what to improve so that it can continue, and the level of the deepest cause: `task`
  (its text, its split, its needs, its brief), `standard` (a standard or a rule), `direction`,
  or `principle`. An evaluation at the level `direction` or `principle` counts only after the
  person accepts it; at `task` or `standard` it counts when it is written, and a standard change
  goes through approvedBy as before. After a maker's last try, an evaluation does not reopen the
  work by itself: the next maker starts only when its inputs differ from those of the maker that
  failed: an approved version after the evaluation says something new to the task (this resets
  the attempts), a task that it needs has a newer accepted result, or the task is remade or split.
  A standard change sends a check to the accepted work that it applies to, also of a task that
  did not fail; that work is made again only when the check finds a fault. Every brief of the
  task shows its latest evaluation. A person's Reject keeps its answer rules (a change that says
  something new, the person's own split or remake, or changed work for a point that names a
  rule); the evaluation comes first. Tests: `test/evaluation.test.js`.
- **Resolves.** A resolve ends an escalation only, and never counts as an accept of the work.
- **Programs.** After a report, the CLI runs each program role with `on: report` whose acts
  review the maker's role: no shell, in the workspace folder, or in a clean checkout of the
  reported commit (`git worktree add --detach`, removed in every case). Exit 0 records an
  accept with evidence for each of its `checks`; any other exit, a timeout, or a program that
  cannot run records a reject with the last three lines. The full output is in
  `.work/runs/<result>-<program>.log`.
- **Close and remake** (Nanda, 2026-10-28). A closed task is not needed, so its rules move
  nowhere. A task that an open task needs is not closed: without it, the scope of that task
  changed, so that task is remade (`work task remake`). The new task replaces the old one, and
  the old task and its open parts close as replaced; their open assignments are told to stop.
  The work is not thrown away: accepted work is reported again in the new tasks and checked
  again, and it changes only where the new, more specific scope needs it.
- **After a direction change**, a result made under the old version is not made again: its
  checkers check it again under the new version (`next` prints the commands), and the accept
  that makes a draft official lists the results that became old.
- **Round 7 rules** (2026-11-07). A decider that also checks a rule of the task may give that
  evidence before its turn in an order; it decides again at its turn. A decider's accept counts
  only after the latest Reject of its task. Standards compare by what they say. A result is an
  attempt until its deciders decide it (a gate's or a reviewer's accept is not a decision), or a
  recheck or a criticism ends it; a new maker of a task ends the makers before it. approvedBy
  names only medium or high roles and the owner. A question to a finished assignment is refused.
  For code: a commit needs a base that it shares history with; its work is its patch against its
  merge base (`git patch-id`); a commit that is another task's work is refused. A task with a
  section is not split, and the sections of parts do not nest. Flags are checked for each act.
- **Recheck after a change outside.** The revision of a source comes from the system of the
  source. A workspace with a `base` is a git source: for a `<repo>@<commit>` output the CLI
  reads the merge base from git and records it as the result's source, as evidence. A new
  commit on the base asks for no recheck (Nanda, 2026-11-07): work that uses other work, or
  changes the same files, needs it and runs after it, so a new commit on main is work that
  this task does not need. A `--made-from` that names a git source is refused, and so is
  `work source` for one. `work source` records a source outside git, such as a page version,
  and only a medium or high agent runs it. `work resume` lists each result made from a source
  that changed since the checkpoint, with the `work recheck` command.
- **Work that changes the same files** (Nanda, 2026-11-07). For a commit, the CLI compares the
  files that it changes against its merge base with the files that the latest commit of each
  other open task in the same repo changes against that commit's recorded base. When they
  share a file, the two tasks do not wait for each other (needs, either way, or one inside the
  other), and this commit does not contain the other one, the report is refused: one task must
  run after the other. A commit with the same files as its base, or an amend of rejected work
  with the same files, is not new work (the digest of a commit is its git tree). When the top
  task is accepted and its commit is not on the base, `work next` of the top agent prints the
  step that puts it there; the project does it its own way.
- **One maker for each file at a time** (Nanda, 2026-11-08). A maker that reports a commit works
  in its own git worktree. Every other maker writes the files of its workspace in the project
  folder, which all makers share, so two sections of one file could overwrite each other. Makers
  that write one file (or a folder and a file in it) take turns in the order of their assigns,
  and a turn ends when its maker finishes; a redo keeps the turn. The assign is not refused: it
  is stored, says which maker writes the file first, and its subagent starts later, so the lead
  does not wait. Before its turn, the maker's brief is refused (so it takes no snapshot and
  cannot report). `work next` tells the parent to finish a maker whose part is accepted, or that
  has no attempts left, when another maker waits for its file; the finish names the maker whose
  turn starts; `waiting` lists each maker that waits. So the file changes one maker after the
  other, and its history has no two makers at the same time. The queue compares names, so a
  workspace path names its file in one way, its real name on disk (round 8); the parent also
  finishes a maker that cannot report because its task waits for another task. Tests:
  `test/file-queue.test.js`, `test/round8-f-queue-*.test.js`.

## 9. Store: aristoteles

The store is **aristoteles** (Nanda, 2026-11-10; the name comes from the source of the eleven
principles): one SQLite file for every project of this machine, `~/.aristoteles/aristoteles.db`,
or the file that `ARISTOTELES_DB` names (each test uses its own). A project is the name in its
`aristoteles.yaml`; a second folder with the same name gets no store.

- **Full SQL.** Everything that the work makes is in tables, with its links: `direction`,
  `draft`, `standard`, `rule`, `draft_standard`, `standard_rule`, `version`, `suggestion`,
  `answer`, `review`, `evidence`, `task`, `task_direction`, `task_closed`, `assignment`,
  `assignment_finished`, `brief`, `result`, `result_version`, `evaluation`, and `words` (with
  full-text search). A task under an old version reaches that version's standards and rules with
  a join (`aristoteles.js` has the schema; `test/aristoteles.test.js` has the query).
- **Rows are only added.** A close, a finish, and a new version are new rows. A standard or a
  rule keeps one row while the drafts keep it unchanged; its id is the draft that made it, then
  its key (`d1/facts-not-proof/no-code-proof`).
- **The act log stays** (table `act`; my choice, Nanda can change it). It is the order of the
  acts: each write replays the project's acts, checks the new act against that state, appends
  it, and adds the rows of its records, in one transaction. The replay sets the clock to each
  act's time, so an act that was valid then stays valid; a read sets the clock to now. A test
  checks that a replay of the acts makes the stored rows.
- **Files hold only the mechanism and the guides:** `aristoteles.yaml` (people, roles, limits,
  deciders), `aristoteles.lock` (company directions), `guides/`, `skills/`. `work init` and `work
  config apply` store `aristoteles.yaml` as an act; each write compares its hash and refuses on a change;
  `work config restore` writes it back; `config apply` changes only the words of roles. Any
  other change (acts, tiers, new roles, limits) needs a new store in the prototype. `init`
  refuses an unknown limit key, and a `directions` key.
- A role is assigned only when it has a fit record for the hash of its current words.
- **Directions.** A model drafts a new direction as a whole (`work direction new`); its owner
  accepts version 1. A high role revises it (`work direction revise`). A task names only a
  direction with a version. The checks of `approvedBy` and of a program's rules run at the
  draft.
- **Words and pieces.** The words of a direction, a standard, and a rule are any markdown. The
  headers inside the words of one entry divide them: `work direction show
  <id>[@<n>]#<standard, rule, or header>[#<header>]` prints one piece, and a brief gives a rule
  with headers as its first paragraph and the address of each piece. `work guide writing` says
  how to write for that. `work search <words>` finds words of directions, standards, rules,
  suggestions, and reasons, with the versions that hold each match and the tasks that read them.

### 9.1 Company directions

- A company direction is a folder in a git repo (GitHub): `direction.md` (its first `# ` line is
  its name), `<standard id>/standard.md`, and `<standard id>/<rule id>.md`, each in any markdown.
  It changes in its repo, with a pull request; `work direction revise` refuses it, and a
  suggestion about it names its repo. A company standard has no `where` (my choice).
- A project names each company direction that it follows in `aristoteles.lock`, beside
  `aristoteles.yaml`, in the project's git:

  ```yaml
  feature-flags:
    repo: github.com/<org>/<repo>      # the person writes repo, path, tag, owner, and checkers
    path: directions/feature-flags
    tag: ff-v4                         # optional; the default branch with none
    owner: Nanda                       # accepts each new commit
    checkedBy: reviewer                # the role that checks its rules (a company file names no role)
    rules: { one-read: lead }          # a role for one rule
    commit: <hash>                     # work writes these three
    newest: <hash>
    refreshed: 2026-11-10
  ```

  The checkers are in the lock entry, beside the rest of the company direction (my choice; the
  first plan named `aristoteles.yaml`).
- **The daily refresh.** The first `work` command of a day (`refreshed` is before the date of
  today on this machine) fetches each repo into `~/.aristoteles/sources/`. When the folder at
  the newest commit that changed it differs from the current version, it comes in as a draft
  with its source (repo, path, commit), and waits for the owner's accept; `work waiting` shows
  it, and `work direction show` shows what changed. A commit that changes only other files
  makes no draft; a commit that came in once does not come in again. The accept moves `commit`
  in the lockfile, and the version row keeps its source. A failed fetch stops no command: the
  reply says "still on <hash>", and the next command tries again. Two commands at once may both
  fetch; only one brings the commit in.
- The ruling of 2026-10-25 ("no sha") is about results: the engine stamps each result itself.
  A company direction pinned by a commit is a different record.

## 10. Tests and files

- `engine.test.js`: property tests of the engine (the 51 from the page, adapted where the
  rules changed, plus the extensions and the round-2 rules).
- `test/e2e.test.js`: command sequences as the person and the agents run them, with golden
  snapshots (`test/__snapshots__`) of the briefs and the refusals.
- `test/round2.test.js`, `test/round3.test.js`, `test/round4.test.js`: one test for each
  finding of rounds 2 to 4 that the prototype closes, including git repos for the gate and the
  bases, and one table-driven test that tries every agent path to a person-only act.
- 177 tests in all (`bun test`).
- Thought tests: agents drive the running CLI and look for edge cases.
- Files: `engine.js`, `config.js`, `store.js`, `state.js` (replay), `digest.js`, `render.js`
  (briefs and lists), `cli.js` (commands), `bin/work.js`, `guides/`, `skills/`,
  `thought-tests/` (the findings of rounds 2 to 4).
- There is no sample project outside the test fixture (`test/harness.js`); DESIGN section 3
  shows the files to write.

## 11. Decided by Nanda (2026-10-28, 2026-10-29, 2026-11-03, 2026-11-07, 2026-11-08, 2026-11-09, 2026-11-10)

On 2026-10-29: the model is functional (fresh Haiku agents, one after the other; a Review reads
only the latest result). Only Review checks: an assignment has no `checks` list, and a reviewer
checks every rule that names its role. A rule still names its reviewer. No rule is checked by a
person; the person approves directions and standards, gives work only to medium and high
roles, and a criticism is answered by the smallest change (one rule, else one standard); the
work under it is checked again and remade only where a check finds a fault. Old work after a
remake is a starting point (`from:`), never a result. Writing and pruning rules belongs to each
app. The tech lead is long-lived (cache); the Haikus are fresh and cheap.

On 2026-11-03: two questions left the open list because the model already answers them. A
tech lead that gives a writer itself needs an Approve act on writers in the workflow (no
change). The revision of a git source comes from git, as the `Source` type of the abstraction
says; the CLI now reads it there (section 8), and a low agent records no source.

On 2026-11-07, Nanda answered the five questions of the page:
- Who decides is not an abstraction problem: the workflow names the deciders of a maker, one
  or more, and says how they combine with Or, And, or Order (section 8, "Who decides"). The
  same combinators say who accepts a new version of a direction (`approvedBy`).
- Only a fault uses an attempt; the person's revision uses none and resets the attempts. Sol
  checks again after the revision, because a direction that is not precise can cause the
  mistake of the lead: the workflow writes this with Order, on the results
  (`order: [section-lead, architect]`) or on the direction (`approvedBy`).
- The model must know which work runs at the same time. Work that uses other work (a method
  that calls another method), or work in the same repository that changes the same feature,
  runs after it; only work that changes different files runs at the same time. So a maker
  starts only when the tasks that its task needs are accepted, a split part names the parts
  that it runs after, and a new commit on main asks for no recheck.
- The person does not accept a result: the lead must see it first. The person reads it at
  any time and criticises it after its deciders accept it. The owner of a task decides no
  result unless the workflow names the owner role.
- The three tests with real agents run on the CLI with these changes.

Derived the same day from earlier rulings, while fixing the faults of the attack round (Nanda can
change them):
- The person gives no waiver: a waiver is a decider's accept with less evidence, and the person
  accepts no result.
- An agent's remake keeps the directions and the context of the task; only the person changes
  them (only the direction owner changes directions). A remake file keeps the needs, directions,
  and context of the old task that it does not name.
- A task with a section is one unit of work: it is not split into parts that share the section,
  and `work next` offers a medium role for it.
- A question or an escalation to an assignment that finishes goes up to the nearest open assignment
  above, else to the owner (the rule for a new question, applied when the answerer stops).
- For a commit, the digest is its git tree: a new commit with the same files is the same work.

Nanda, later the same day: "we can critique a task before or after it's done". The person may
reject a task at any time; only a Reject of a result waits for its deciders.

Nanda accepted all the changes listed above ("#2 yeah"), approved a second attack round and a
two-section live remake ("#1 yes"), and set the roadmap (outside this repo). Derived the same day
while fixing round 7 (Nanda can change them): a criticism of a task makes its deciders look again
(their earlier accepts stop counting); a result is an attempt until it is decided; an agent's
remake keeps the needs, the rounds left, and the workspace; the work of a commit is its patch
against its merge base; a task with a section is not split.

On 2026-11-08, Nanda accepted the rules derived while fixing round 7 ("#3 okay, that's good").
Two makers of one document file: "one maker for each file", with a queue, so the lead is not
blocked and the history of the file is good; this was chosen over a command that writes one
section, because sections can conflict (section 8, "One maker for each file at a time"). The
library and the browser bridge of the roadmap wait: "we still need to enhance our abstraction
first". A third attack round runs first, on the round-7 fixes and the file queue.

Nanda, later on 2026-11-08, on mistakes: evaluate, not decide (section 8, "Evaluation"). An
evaluation starts when one maker used all its tries on faults, the high model writes it, the
human evaluates a change of a direction or a principle, and the human's critique also starts one.
Every workflow has the three tiers ("from sol, to terra, and then to luna"). When the cause lies
in accepted work of another task, a standard change sends that work a check, and it is made again
only if the check fails. Rounds were never a ruling; they are removed. Derived while building it
(Nanda can change them): the next maker starts only when its inputs differ from those that failed
(a direction version that says something new to the task, a newer accepted result of a task that
it needs, or a remake or a split); an agent's split or remake waits for the evaluation; the
person's own evaluation counts at once; an evaluation at the level of a task or a standard counts
when it is written.

Derived while fixing round 9 (Nanda can change them):
- The person's criticism of a result, once evaluated and answered by a direction version, is
  checked again under that version and made again only when a check finds a fault (the ruling of
  2026-10-29). Every workflow has the three tiers; init refuses one that misses a tier. A part
  with a section that runs after another part reports its own section; only a task with no section
  that needs other tasks reports the whole file.
- A task is not accepted while it waits for an evaluation, or while a Reject of it waits for a
  change. A last try that ends on a fault starts an evaluation also when a new maker was given
  before its review; a maker that is finished while its latest try has a fault ended on that fault.
- Only the owner of the task writes an evaluation that counts at once, or accepts one. While an
  evaluation waits for the owner, an agent writes no other; after the owner rejected one, the next
  one also needs the owner's accept.
- A draft that a decider of approvedBy rejected is ended, also for the person; each actor
  reviews a draft once.
- A recheck needs a change outside (a newer source, newer work of a task that it needs, a new
  version), or reopens accepted work; else it would be a free try.
- A rule that a version removed and a later one adds back with the same words is the same rule. A
  newer accepted result of a needed task is new input only when its work differs from the work that
  the failed try used. A remake that says what the old task says is refused.
- A decider's check before its turn uses the rules of the result's task. A decider's Reject after
  it decided the result (a look again after a criticism) uses no try.
- An agent's close waits for the evaluation too. A workspace path that differs only in case from
  the path of another task is refused. A maker whose output names a file needs a workspace. The
  patch-id reads full index lines.

Derived the same day while fixing round 8 (Nanda can change them):
- (Replaced the same day by the evaluation: there are no rounds.) An agent's split or remake
  keeps no count of rounds; it waits for the evaluation of a task that waits for one.
- In an order of deciders, a decider before its turn only checks its own rules: an accept with
  that evidence, or a Reject that breaks one of them. A Reject for any other reason waits for
  its turn. One decide entry names all the deciders of one maker.
- A result that its deciders decided once uses no attempt, also when a later criticism makes
  them look again.
- Standards compare by what they say, in any order of rules or of the keys of "where"; a rule
  does not supersede itself.
- A draft that its approvedBy reviewer rejects ends; its reviser writes a new draft.
- A workspace path names a file in one way: its real name on disk, with no `./`, `//`, end
  slash, link, or other case. A maker that writes a file needs the workspace of its task, and a
  report keeps every section of the other open tasks in its file; sections do not nest, also when
  a heading comes after the split.
- The work of a commit is its patch with white space as it is (an indent can be the fix), read
  in one fixed diff form.
- The parent finishes a maker that holds a file and cannot report (its task waits for a task
  that is not accepted) when another maker waits for that file.

On 2026-11-08 (the design review of Part 2; section 0 has the model): suggestion, draft, and
reviews in place of the approve act; every version has its draft; Session removed (an actor is a
person or one run); each act has its time from the tool, and no clock; the limits sit under the
part that checks them; the review of an evaluation is a Review; an Exhaustion is a record, and an
evaluation answers one stop (two stops, two evaluations); a standard's `when` is `where`; a model
can grant, and nobody gives more than they may do.

Derived the same day while building it (Nanda can change them):
- A draft and an evaluation take only an Accept or a Reject; an escalation on either is refused.
- An accept made under a grant keeps counting after the grant ends, because a review counts
  with the acts that its reviewer had at its own time.
- A grant covers acts from its own time; a revoke is given once.
- A forwarded act that counts at once takes the time of the forward; a confirmed act, the time of
  the confirm.
- The draft of version 1 has its CLI id (`d1`), as every draft does. `work evaluate <task>` names the first stop of the task that waits.
- A forwarded accept of a draft is the person's accept: it needs no evidence (Nanda, 2026-11-11).

On 2026-11-09, after the retest: only a model writes a draft ("let ai write the draft, I can only
give direction ... only the AI know which instruction is the best"), so `work direction revise`
has no person form; the person suggests. The person accepts or rejects the whole draft; after a
Reject, the next draft answers it and shows what changed since the rejected draft ("oh yeah,
that's good, do it"). Each stop gets one evaluation ("yes, that's true"). An accept made under a
grant keeps counting after the grant ends. A model writes the first draft of a direction too
("ai write the drafts, I reject/approve it"); how that first draft gets its assignment is open,
so the config file still holds version 1.

Derived on 2026-11-09 (Nanda can change them):
- A draft that answers the Reject of another draft must propose something else than that draft.
- When the reviser of a rejected draft is finished, an open high role of a tree that follows the
  direction revises; with none, the person assigns a new run of the reviser's role.

On 2026-11-10: a suggestion about a direction is answered only by a change of what the direction
says, as built ("I can't write standard if the direction didn't say so"): a new standard needs
the words of its direction first. An open suggestion shows in the `work next` of each high role
of a tree that follows its direction, with the revise command; with no such role, it shows in the
owner's `work waiting` with the assign. A suggestion that asks for a new direction has no task,
so it shows in neither. A grant covers each act by the time of that act; a task that started
inside the grant gets nothing more. The first draft of a direction: a task with no direction is
refused (no direction stays optional); the work starts from the skill that reads an app and
suggests its directions (roadmap item 4), with the storage of directions.

Later on 2026-11-10, the storage (section 9.1): its name is aristoteles ("the proper name is just
aristoteles, because it's where I got the inspiration"). It is "full on sql": the words outside
SQL are only guides on how to use aristoteles, because SQL keeps the link from a task to the old
version that it used; "the mechanism like role, is a file". It lives in one SQLite file. A company
direction is on GitHub: aristoteles records the repo link, the file path, and the commit, so each
task shows which commit it used. Its file is markdown. A new commit counts only after the owner
accepts it, and a lockfile records the last refresh: when that refresh is a day old, the next
command pulls and reconciles a changed file.

That night, before the build: a direction, a standard, and a rule are one entry each, and SQL
links them ("why would we build it with sql if we still keep header levels"); the words of each
entry are free markdown ("our job is only to store, and retrieve parts if required by the
roles"); headers divide the words of one entry, and the writer is told so, to write for
contextual retrieval (`work guide writing`). The reviewer of a draft checks vagueness, double
statements, context density, negative parallelism, concision, more than one reading, and whether
the direction is correct for its aim and concerns (`work guide direction-review`). The skill that
reads an app is built too (`skills/assess`).

Derived while building it (Nanda can change them):
- Version 1 of a direction has only its owner as decider; `approvedBy` decides from version 2,
  because no task follows a direction with no version, so no role of it can work on the draft.
- A model run outside any task names itself with `--by=<name>`; its run id is the time of its
  act. A person at a terminal cannot draft (`work suggest`).
- The act log stays as the order of the acts, beside the tables (section 9).
- The checkers of a company direction are in its lock entry; a company standard has no `where`.
- A commit of a company direction that came in once does not come in again, also after a Reject.
- A brief gives a rule that has headers as its first paragraph and the address of each piece.


1. **A parent task after a split:** no "joining result". A task lists the tasks that it
   needs; a split sets the parent's needs to its parts; the parent's own result comes after
   they are accepted, and any assignment of the owner may make a better result.
2. **Forwarded acts that count at once:** as built. A reject, a question, and a comment count
   at once; an accept (also of a draft), an answer, and a resolve wait for `work confirm`.
3. **The channel that confirms a person:** as built. A terminal and a typed confirmation
   now; the board with the person's key at the migration.
4. **Does the decider decide:** yes. Every result also needs its decider's accept, and the
   decider may Reject.
5. **The `join` key:** removed. If the writing is wrong, the instruction is changed.
6. **The engine brief** holds ANSWERS, NOTES, and the needed tasks in a short form (one line
   each, with the id to read more), so a small model does not get a long brief.
7. **A closed task** moves its rules nowhere; a needed task is not closed, and the task that
   needs it is remade, with its accepted work carried and checked again.

Item 6 is built: the engine's `briefOf` makes the short lines, and the CLI prints them with its
ids.

## 12. The UI (2026-11-11)

`work start` serves the UI of a dir on 127.0.0.1 (`ui/`): the requirements are in
`plan/ui/PLAN.md`, the parts and what the build changed in `plan/ui/BUILD.md`.

- `ui/view.js` builds what the page shows from the replay and the reads of the engine: the
  projects (runs, and top tasks opened at a terminal), the canvas in layout A (task, work and
  review cards; only the latest attempt), the panel of a task, the diff by file, and the decisions
  that reach the person (`decisionsOf`).
- `ui/server.js`: the key of `work start` (a SameSite=Strict cookie; a websocket and a POST also
  need the page's own origin), the read API, `POST /api/act` for the person's acts, and the
  websocket for "changed" and for the terminals.
- `ui/pump.js`: the terminals in tmux on the socket `aristoteles`; `ui/watcher.js`: the life
  cycle of the real agents (start, wake, retry, the host's decisions); `ui/act.js`: a person act in
  the server's process, on the ui channel.
- New in the CLI for the UI: `work run start|done|close|list`, `work session <a> --id [--token]`,
  `work task draft --by=<run>` and `work task open <draft>`, `work problem`, `work event`,
  `work send`, `work note <token> words --on=<decision> [--hope]`, and `work start`.
