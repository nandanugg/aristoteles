---
name: assess
description: Read a project (a repo of code or documents) and onboard it into aristoteles with the work CLI - draft its roles and its directions as files, with scoped evidence and rule cases, so that the person reviews directions together before roles. Also drafts a new direction after the store exists. Use when the person asks to assess an app, to turn the agent harness of an app into aristoteles, to find or suggest the directions of an app, to onboard a dir, or when the person asks for a new direction.
---

# assess

You read one project and write the first drafts of its roles and its directions. A direction
says what the work is for; its standards say how the output looks; its rules are the checks that
a reviewer does on one result. You write drafts only: the person accepts, revises, or removes
each one. You run in the AI CLI that the person opened in the dir: you are its host.

When `work` is not on the PATH, `work …` means `bun <the aristoteles folder>/bin/work.js …`.
Run it in the dir that the person names.

## Onboarding a new dir

Onboarding works on files, before any store exists. Your own draft files go in `.work/drafts/`
(make the folder). Never write into `.work/assess/`: it belongs to `work onboard`, which keeps
one file there for each direction and one for the roles. Send each draft through a
`work onboard` command with `--file=`; a refusal says what to fix, so fix the file and send it
again. The store starts at the end, with only the accepted result.

1. **Read the project** (the part "Read the project" below) for its kinds of work and its
   repeatable parts.
2. **Draft the config:** run `work onboard config` with no `--file`. It refuses and prints the
   form to copy; `work onboard role <role>`, `ask <id>`, and `draft <id>` (after `found <id>`)
   print theirs the same way. Write
   `.work/drafts/config.yaml` in that form (the part "The config draft" below says what it
   holds), then run `work onboard config --file=.work/drafts/config.yaml`. The command runs the
   checks of `work config check` on it, and prints `next: start the page (work start --detach)`,
   then `found` and `draft` for each topic. Use stable provisional role ids so each checker
   can be named before role review. Revise a role with `work onboard role <role>`. Propose one staff assignment per role. Persistent roles share a staff through
   `workerGroup`. Give each disposable role the `subagentOf` staff ID of the role that assigns
   its work. Map program roles to staff in `programStaff`. Each staff needs a persistent role. Roles sharing a session use the
   same launch, model, concurrency and subagent allowance. In `accounts`, use subscriptions with
   `provider: Claude` or `provider: ChatGPT` and the plan name. Match the launch CLI to its provider.
   Read `work onboard show staffing` for measured tokens from a finished project. Otherwise estimate
   one project's tokens on one model from typical sections, roles per section, brief and result
   sizes, and review tries. Scale across staff models using relative costs from
   <https://artificialanalysis.ai/models>. Divide by a plan's five-hour volume from
   <https://theaggregate.ai/subscriptions> using monthly tokens divided by your stated number of
   windows per month. Put `estimate: { share: 0.25, basis: "one line explaining the inputs" }`
   under each estimated account, where 0.25 means 25% of one five-hour window. Omit the estimate
   if a source is unavailable or a number is missing. Submit with
   `work onboard staffing --file=.work/drafts/staffing.yaml`.
3. **Open the page** now, after the config: `work start --detach`. It keeps running when this AI
   CLI ends. Tell the person to read it: each role waits there as a card, and each direction
   appears as you name it, so the person sees it as it comes.
4. **Name the topics:** `work onboard found <id>` for each direction that you will draft (a
   lower-case id with dashes). The page states of a direction are:
   - Loading: the host has nothing drafted yet, or must draft again; the host acts.
   - Question: the host asked, and the person must answer.
   - Ready: verified and available for review together with the other directions.
   - Accepted: the person accepted the reviewed directions together.
   - Removed: the host applied a removal requested in a Revise.
   A role shows Waiting (the person decides), Revise (the host writes it again), or Accepted.
5. **Draft each direction:** write `.work/drafts/<id>.yaml` (the part "A direction draft"), then
   `work onboard draft <id> --file=.work/drafts/<id>.yaml`. The first draft of a new direction
   gives its `id`, and the module renames the file in one step. Draft them all; the person opens
   any one that is ready.
6. **Surface uncertainties.** Ask about competing sources before drafting from them. Include
   deviations in the draft with their rule and two versions. Keep a direction waiting for
   review while the host rechecks an answer.
7. **Wait for the person:** `work onboard wait` blocks until something waits for you, 540 seconds
   at most. When your AI CLI cannot run a command that long, or you cannot run it in the
   background (so that the person can still talk to you), loop a short wait: `work onboard wait
   --seconds=60`, and run it again each time it prints `nothing waits for the host yet`. A wait
   that returns with nothing new is no news: run the next wait without a message to the person.
   Write to the person only when something changed, or when the person asks. It returns when
   something waits for you, and prints each direction and role with its state, each request, and
   the command that answers it:
   - a direction to draft, or to draft again after a Revise (the words of the person): do step 5
     again, with the same id;
   - answers that the person submitted: draft the direction again with the shown revision and recheck it;
   - a company direction that the person asked for: the part "A company direction";
   - a role to write again after a Revise: write its file (the part "One role"), then
     `work onboard role <role> --file=.work/drafts/<role>.yaml`.
   - a Staffing Consult: read `work onboard show staffing` and submit an updated proposal with
     the shown revision and your reply.
   `work onboard show <id>|<role>` prints one direction or role as the person sees it. When
   nothing waits, wait again; do not ask the person.
8. **The end is the person's.** The roles step opens when every direction is accepted or removed.
   The person approves all roles on the page, or at a terminal with `work onboard approve-roles`
   (it asks for the typed word `approve`). That starts the store. Never run the approve
   yourself. When the accepted files cannot start a store (two directions use one rule id, a rule
   names a role that is gone, no persistent role that splits), `work onboard status` says
   "the store cannot start", what blocks it, and your step; `work onboard wait` returns with it.
   Do that
   step (draft the named direction again, or write the named role), and the person accepts it
   again. Then do the next line that it prints: `work role fit <role>` for each agent role
   (the `role-fitness` skill: a role "fits" when its words pass the static checks and each of the
   seven questions of `guides/fitness.yaml` gets a yes with one real example of the role's work;
   the fit record is that answer file, in `.work/fit/<role>.yaml`, then
   `work role fit <role> --answers=.work/fit/<role>.yaml --by=assess`). A role with no fit record
   gets no work. A role that does not fit needs new words: write the role file again and run
   `work onboard role <role> --file=<role.yaml>` before the store starts. After the store starts,
   new words of a role come from an evaluation of the pipeline role (a fit cause), and the
   person accepts them.

## Read the project

Search across the project in this order. Record the source and location of each material
finding, what area it supports, and where you looked for contrary evidence. Keep track of
areas you could not search or verify and report them as unknown.

- the agent files that exist: `CLAUDE.md` and `AGENTS.md` (at the root and in sub-folders),
  `.claude/` (also `.claude/agents/`), `.agents/skills/`, `skills/`, and the guides of the app;
- the README and the docs;
- the code, for the patterns that repeat: search for the constructs of each topic (for example
  feature flags, configuration, migrations, tests, logging);
- the recent history: `git log --oneline -50`, and the words "always", "never", "must" in the
  docs and the agent files.

Group what you found into directions, one idea each: an idea a reviewer can check on its own,
not a broad quality. Draft a direction only when the project shows it in at least two places, or
a document of the project states it. Leave out a topic with one weak sign, and name it in your
report. When the project has several output types (templates, doctypes, kinds of change),
compare their instructions and how each is invoked, topic by topic, before drafting: draft what
they share once, and scope what only one type asks for to that type. Discovery is complete when
each topic of each type maps to a direction or is named as left out (a small topic by type map
in the report); a check program covering every rule says nothing about this coverage. Ask the
owner only where the types differ by a choice the sources do not settle. Keep competing stated sources with their locations
for a question on the direction. As you discover who makes or checks the work, draft
provisional role responsibilities for the later roles step. Read `work guide writing` and
`work guide direction-review` first: write and check every draft with them.

Save the discovery ledger with `work onboard discovery --file=<file.yaml>`. Use the same
`scope` and `sources` keys as a direction's `discovery` block. Add a short `summary` and set
`app` to true or false only if established, or null if unknown. The page lists the files
read and the unknown areas.

## The config draft

The responsibility draft holds `people` and `roles`. Read `work guide roles` for the
checks of work on roles. Describe the work that each role owns, what it outputs and what it
checks. Keep the role's id stable while discovery and verification cite it. A program role
needs its command. The pipeline role evaluates raised work and reviews drafts, and the role
with `split` divides the top's work. Model, account, persistence and launcher choices
belong to per-directory staffing.

Each role has the keys of a role of `aristoteles.yaml`, and two more for its card:

```yaml
roles:
  <role>:
    description: <what the role does, in one line>
    intro: <the first words of its brief>
    responsibilities: [<one exact output or command>]
    acts: [{ do: <its work> }]   # or { review: [<role>] }, { assign: [<role>] }, split, direct, fit
    pipeline: true   # only the one pipeline role
    icon: <a name of the list below>
    summary: <the one line of its card>
    found: <where the project has this role, such as .claude/agents/<role>.md>   # leave it out for a new role
```

Roles that the project has already come first: give them `found`, and take their `description`,
`intro`, and `responsibilities` from that file. A role that the project needs and lacks is new:
leave `found` out. Record a program role with its command.

Icons: bot, book-open, brain, clipboard-check, compass, crown, eye, feather, file-text,
flask-conical, gavel, git-branch, hammer, layers, lightbulb, list-checks, map, microscope,
pen-tool, puzzle, scale, search, shield-check, sparkles, telescope, terminal, user-cog, wrench.

### The words of a role

A task is made, reviewed, and raised: this is the standard workflow, and a role does not choose
it. Its words give principles that work as criteria for its kind of work: what a good unit of it
is, so that the role can do it and a reviewer can review it. A responsibility that gives no
criterion is not enough: say the exact output and the exact command (`work guide roles` lists
the static checks, and `guides/fitness.yaml` the seven questions).

### One role

A role file has the keys of one role, with `summary` and `found`, as in the config draft:
`work onboard role <role> --file=.work/drafts/<role>.yaml`. It is for a new role, and for the
answer to a Revise. It clears the request of the role.

## An app with its own harness

Some apps run their own agents already: instruction docs, check programs, agent prompts (a
writer, a reviewer, a lead), a loop that writes and checks, a web app, a publish step. Map each
piece as below. The roles go into the config draft, the directions into direction drafts.

- **Instruction and standard docs** -> directions, standards, and rules, in the owner's own
  words (`work guide writing`). A rule is one check that a reviewer can do on one result, so a
  list of checks in a doc becomes one rule for each check. A sentence that no reviewer can
  check on one result (for example "write for the reader") is no rule: say its idea in the
  words of the direction or the standard, or name it in the report.
- **Check programs** (validators, linters, test scripts) -> evidence for rules, not one rule
  each. Read the program's code, its tests and how the project invokes it: one program often
  holds several checks. Draft one rule for each condition that fails on its own and has its own
  fix, or name in the report why a condition is out of scope. Its `test` is a command whose
  output is empty when the result holds and one line for each point when it does not; it gets
  the files of the extracted sections as arguments, and prints only its own condition where the
  program allows. Where the program runs (on each section while writing, or on the assembled
  result) sets the rule's `where` and its checker (the scope, below). Name the program and its
  arguments in the report. A check that needs the judgment of a model is a rule that a role
  reviews, with a `ref` as evidence.
- **Agents** -> role responsibilities, acts, and an icon. Take the
  `description`, the `intro`, and the `responsibilities` from the prompt file of the agent, and
  put its path in `found`.
  - a writer: a role with `do` and its `output` form (`<file>#<section>` for one section
    of a markdown file; a maker of code reports `<repo>@<commit>`, one commit);
  - a reviewer or a checker: a role with `review: [<the writer>]` and
    `assign: [<the writer>]`; each thing that it checks is a rule with `checkedBy: <it>`;
  - an orchestrator that splits the work: the role with `split`, which the host
    sends the tasks of the top to;
  - the evaluator of failures: the role with `pipeline: true`.
- **The loop** -> tasks, reviews, and raises:
  - a write and a check for each section: the top task names its sections, and the host sends
    one task for each part; a standard for one section only has `where: { section: <heading id> }`,
    and a standard for some sections lists them: `where: { section: [<heading id>, <heading id>] }`;
  - the tries of the loop: an input for staffing and runtime settings;
  - a step where the person says yes to each section: the person reads each result and can
    reject it; the review of the role decides it first;
  - a step that puts the parts together: a task of its own for a maker with a role of its own
    (for example `assembler`).
- **The publish step, the web app, and other integrations** stay outside the work. The work
  ends with the end of the project; then the person runs the publish step as before. Name
  each one in the report, with the command that the person runs.
- **The run history** of the harness (old runs, attempts, findings) is not carried: the dir
  starts with a fresh store. Name where the history stays in the report.

## A direction draft

Write the direction with its summary, diagram flow, words, standards and rules. It has no
`owner` and no `approvedBy`. Name the candidate's sources and scope under `discovery`.

```yaml
id: <direction id>
name: <short name>
from: [<grounding principles>]
summary: <what the direction asks and why>
discovery:
  scope: { searched: [<path or workflow>], unknown: [<area not verified>] }
  sources: [{ file: <path>, line: <line>, excerpt: <source wording> }]
flow:
  - { from: <actor>, to: <actor or file>, says: <what happens>, place: { file: <path>, line: <line> }, uses: [<direction, standard and rule ids>] }
says: <what the work is for>
standards:
  - id: <standard id>
    where: <optional context, such as { section: introduction }>
    says: <how the output looks>
    rules:
      - id: <unique rule id>
        says: <one check>
        checkedBy: <provisional role id>
        test: <existing test command, when there is one>
        evidence:
          scope: { searched: [<coverage>], unknown: [<area not verified>] }
          check: { _tag: Command, result: <what the command returned> }
          cases:
            - { fit: Follows, output: { file: <path>, line: <line>, excerpt: <real output> } }
            - { fit: Follows, output: { written: <illustrative output>, mark: <key line from the output> } }
          knownBreaks: []
```

Each standard follows from the words of its direction. Each rule is one check that a reviewer
does on one result of a maker: its output form in the config draft (a commit, a section of a
file). A check of something else (a diagnosis, a report) is not a rule of this project; name it
in the report. Leave `checkedBy` out when no role fits, and say so in the report. Name no AI
model and no AI vendor; the names of the project's own tools (for example Consul, Unleash,
Kafka) are the words of the work. Do not copy a company direction into a direction of the
project.

**The scope.** Directions are not equal, and a direction does not apply everywhere. A standard
with no `where` goes into the brief of every task and is checked on every part, so each brief
grows, and each role checks work that is not its own. For each standard, ask which sections or
outputs it governs, and give it a `where` for them; leave `where` out only when the standard
applies to every section. When one standard holds a rule for every section and a rule for some
sections, split it into two standards. The marked steps of the flow show the same scope: the
outputs in their `uses` are the ones that the direction governs. A check of the whole result
goes to the role that reviews the whole (see the loop above), not to each part. A `where` such
as `{ section: design, output: hld }` governs HLD design sections. Each condition must match the
task's context, so a TSD can use the same section id with its own scope.

**The principles** (`from`). Each principle asks one question, and `work guide writing` gives
the question of each. A direction grounds in the one or two whose question it answers. Name a
doubt in your report.

**The summary.** One or two plain sentences that say what the direction asks and why it matters,
for a person who reads the direction the first time. The page and the CLI show it first, before
the words. Use plain words: no ids, no file paths, no names of rules. The command refuses a draft
with no summary.

**The flow.** Write a flow for each direction: how the direction works in the project, from the
first act of an actor down to the output. The page draws it as a sequence diagram under the
summary, and the CLI prints it as numbered lines.

- Each step is one act: `from` acts, `to` is the actor or the file that it acts on, and `says` is
  what happens, in one plain line. A step from an actor to the same actor is an act on its own
  (the page draws it as a box on its lifeline).
- The first step is the act that starts the direction (often the person's). The last step makes
  or checks the output.
- `place` names where the project defines the step: the `file`, and the `line` of the
  instruction, the skill, the template, or the code. A line needs its file. Leave `place` out when
  no file defines the step.
- Name each actor the same way in each step: a person, a role of the config draft, a program, or
  a file. The lifelines are the actors in the order that they first appear.
- The place of the steps carries the sources, so leave out the words of where the direction
  comes from in `says`.
- Mark each step that the direction governs with `uses`: the ids that apply there (the direction
  id, standard ids, rule ids of this draft). A marked step has `uses`; an unmarked step leaves it out. The page colors a marked step and tags it with its ids; the
  others are gray. A flow marks at least one step, and the command refuses an id that is not in
  the draft.

A direction about how documents are written goes from the person's first act down to the
document:

```yaml
flow:
  - { from: Person, to: architect, says: asks for a TSD of the export feature }
  - { from: architect, to: writer, says: gives each section to a writer, place: { file: CLAUDE.md, line: 12 } }
  - { from: writer, to: writer, says: reads the rule of one heading for each section, place: { file: .claude/skills/writer/SKILL.md, line: 30 } }
  - { from: writer, to: docs/tsd/export.md, says: fills the template one section at a time, place: { file: docs/templates/tsd.md, line: 1 }, uses: [...] }
  - { from: linter, to: docs/tsd/export.md, says: checks that each section says one thing, place: { file: scripts/lint-tsd.sh, line: 8 }, uses: [...] }
```

A direction about code is often short:

```yaml
flow:
  - { from: developer, to: src/export/config.go, says: reads each env var in one typed function, place: { file: src/export/config.go, line: 9 }, uses: [...] }
  - { from: CI, to: src/export, says: fails the build on a direct os.Getenv, place: { file: .golangci.yml, line: 22 } }
```

**Cases.** Put the cases on the rule they follow or break. Give a case its input when the
output answers something: what the maker or checker received (its instruction, such as "check
X" or "make Y", or the file it worked from). A following and a breaking case form a pair with the
same input, so the two outputs show what the rule tells apart. A real case gives the exact file, line and
excerpt. When real cases are sparse, record what you searched and use a labelled illustrative
output (`{ written: ..., mark: ... }`) with its key line in `mark`. With no observed break,
leave the breaking case list empty and name the coverage. Unknown coverage stays unknown. Replacing cases during
onboarding is an evidence revision and creates no direction version.

A check's evidence is `{ _tag: Command, result: ... }` with the rule's `test`, or
`{ _tag: Reference, checker: ..., result: ... }` with the rule's `ref`. Record
`{ _tag: Absent }` when no check exists and `{ _tag: Unknown, question: ... }` when it is open.
Run a rule's own test on the claimed cases and record what actually happened: nothing on the
following case, exactly this rule's point on the breaking one. Where you can, make the two cases
differ in that one point, so the pair shows what the rule detects. Verify the
reference and checker route where the rule is checked against a reference.

## Questions and revisions

Before drafting from competing sources, create the direction with `work onboard found <id>`
and submit `work onboard ask <id> --file=<questions.yaml>`. Use a Candidates target, with two
source records and the wording each choice gives.

For a deviation, include `questions` in the direction draft and publish both together with
`work onboard draft <id> --file=<direction.yaml>`. Put a command or reference on the conflicting
rule. Each question has `says`, `options: [<wording A>, <wording B>]`, and one target:

```yaml
target:
  _tag: Deviation
  rule: <the affected rule id>
  code: { words: <what the code does>, source: { file: <path>, line: <line>, excerpt: <code> } }
  principle: { words: <what the project states>, source: { file: <path>, line: <line>, excerpt: <stated text> } }
```

For Candidates, use `_tag: Candidates`, `topic`, `a` and `b` with the same words/source shape.
A deviation can also carry additional `cases` with the same code and principle shape.
A deviation's A adopts the code and B keeps the stated rule. The person may give their own
words. After an answer, read its revision with `work onboard show <id>`, redraft using
`--revision=<revision>`, and recheck the cases, command or reference and checker routing.
When the rule still holds and code still breaks it, keep the real spot in the rule's
`knownBreaks` with its searched scope. This records the finding for later review. It grants
no waiver and opens no task. A removal request is a Revise. After checking it, the host marks
the result with `work onboard removed <id>`. The person approves the reviewed directions
together after the questions and verification are complete.

## A company direction

The person adds a URL in the form `https://host/owner/repo.git#directions/folder` or a prompt
for a new local direction. The card appears immediately while the host works. The terminal
forms are `work onboard add --url=<url>` and `work onboard add --principle=<prompt>`. If the
person elects to change a company rule, draft the result as a local adaptation. The card
retains the company source for review.


A company direction is a folder of a git repo that other projects follow. The person asks for it
on the page (add a company direction) or in the chat; then `work onboard company <id>
--repo=<repo> --path=<folder>` makes it, and it shows Loading. The text, the standards, and the
rules come from the folder at one commit: you do not write them. The summary is the first
sentence of the folder's words; you do not write it either. Your draft file has only
`id` (optional), `checkedBy` (the role that checks each rule), `rules` (`{ <rule id>: <role> }`
for a rule with another checker), `flow` (how the direction works in this project, its steps
marked with its applicable rule ids);
send it with
`work onboard draft <id> --file=<it>`. Do not copy its words into a direction of the project;
when the project breaks it, say so in the report. When the person has no company repo, point to
the public example: https://github.com/nandanugg/aristoteles-example-direction.

## After the store starts

The store exists after `work onboard approve-roles`; then `work onboard` is over, and a change is
an event.

- A new direction (the person's words): read `work search <words>` (a direction can exist
  already, also a company direction). Write the draft in the form that `work direction new` with
  no file prints, and send it: `work direction new --file=<file> --by=assess`. A standard that
  belongs under a direction with a version goes into
  `work direction revise <direction id> --file=<edit.yaml> --by=assess`. Its owner accepts it with
  `work direction accept <draft>`, or rejects it with `work direction reject <draft>
  --reason=<why>`, before a top task is open.
- The flow of a company draft (its steps marked with its applicable rule ids) and its rules' cases,
  before its accept: `work direction examples <draft> --file=<flow.yaml> --by=assess`, the file
  `{ flow: [...], rules: { <rule id>: <evidence> } }` (cases live on rules, guides/writing.md
  Cases).
- When a top task is open, the pipeline role changes directions through a raised task (the `work`
  skill, part "The pipeline role"); the person accepts that draft.
- When the owner rejects a draft, write a new draft that answers the reason and proposes
  something else.

## The report

End with one list for the person:

- each direction: its id, its summary, and the evidence (the outputs of its rule cases);
- each role that you drafted: its model, its acts, its persistence and why, and where the
  project has it;
- for an app with its own harness: each piece of the harness and where it went (a role, a rule,
  a key of the config, or outside the work, with the command that the person runs);
- each topic that you left out, and why;
- the command to read them: `work onboard status`.
