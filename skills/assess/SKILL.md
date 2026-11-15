---
name: assess
description: Read a project (a repo of code or documents) and onboard it into aristoteles with the work CLI - draft its roles and its directions as files, with real examples, so that the person accepts or rejects each one on the page. Also drafts a new direction after the store exists. Use when the person asks to assess an app, to turn the agent harness of an app into aristoteles, to find or suggest the directions of an app, to onboard a dir, or when work waiting shows a suggestion that asks for a new direction.
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
   then `found` and `draft` for each topic. Until the store starts, you may change any part of
   the config draft (people, limits, tiers and their models, roles): send the whole file again
   with `work onboard config`, or one role with `work onboard role <role>`. A change clears only
   the accepts that it touches: a role's own block or its card words clear that role, a tier's
   settings or the limits of a level clear the roles of that tier, and the people clear none. The
   person then accepts those roles again.
3. **Open the page** now, after the config: `work start --detach`. It keeps running when this AI
   CLI ends. Tell the person to read it: each role waits there as a card, and each direction
   appears as you name it, so the person sees it as it comes.
4. **Name the topics:** `work onboard found <id>` for each direction that you will draft (a
   lower-case id with dashes). The page states of a direction are:
   - Loading: the host has nothing drafted yet, or must draft again; the host acts.
   - Question: the host asked, and the person must answer.
   - Ready: drafted; the person decides (accept, revise, or remove).
   - Accepted: the person accepted it.
   A role shows Waiting (the person decides), Revise (the host writes it again), or Accepted.
5. **Draft each direction:** write `.work/drafts/<id>.yaml` (the part "A direction draft"), then
   `work onboard draft <id> --file=.work/drafts/<id>.yaml`. The first draft of a new direction
   gives its `id`, and the module renames the file in one step. Draft them all; the person opens
   any one that is ready.
6. **Ask only after a draft exists** (the part "Questions"): `work onboard ask <id>
   --file=.work/drafts/<id>.questions.yaml` is refused before the first draft ("a question is
   about a draft"). So draft first, then ask. When you cannot draft at all, draft what the
   files show, and ask about the rest.
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
   - answers that the person submitted: draft the direction again with them;
   - a company direction that the person asked for: the part "A company direction";
   - a role to write again after a Revise: write its file (the part "One role"), then
     `work onboard role <role> --file=.work/drafts/<role>.yaml`.
   `work onboard show <id>|<role>` prints one direction or role as the person sees it. When
   nothing waits, wait again; do not ask the person.
8. **The end is the person's.** The roles step opens when every direction is accepted or removed.
   The person approves all roles on the page, or at a terminal with `work onboard approve-roles`
   (it asks for the typed word `approve`). That starts the store. Never run the approve
   yourself. When the accepted files cannot start a store (two directions use one rule id, a rule
   names a role that is gone, no persistent high role), `work onboard status` says
   "the store cannot start", what blocks it, and your step; `work onboard wait` returns with it. Do that
   step (draft the named direction again, or write the named role), and the person accepts it
   again. Then do the next line that it prints: `work role fit <role>` for each agent role
   (the `role-fitness` skill: a role "fits" when its words pass the static checks and each of the
   seven questions of `guides/fitness.yaml` gets a yes with one real example of the role's work;
   the fit record is that answer file, in `.work/fit/<role>.yaml`, then
   `work role fit <role> --answers=.work/fit/<role>.yaml --by=assess`). A role with no fit record
   gets no work. A role that does not fit needs new words: write them in a file, run
   `work role draft <role> --file=<words.yaml> --by=assess`, and ask the person to accept them on
   the page; then record its fit again. A new tier or another persistence is an adjustment
   (`work adjust`, the `work` skill).

## Read the project

Read in this order, and stop reading a topic when it has evidence in two places. Read at most
40 files in all; name what you did not read in your report.

- the agent files that exist: `CLAUDE.md` and `AGENTS.md` (at the root and in sub-folders),
  `.claude/` (also `.claude/agents/`), `.agents/skills/`, `skills/`, and the guides of the app;
- the README and the docs;
- the code, for the patterns that repeat: search for the constructs of each topic (for example
  feature flags, configuration, migrations, tests, logging);
- the recent history: `git log --oneline -50`, and the words "always", "never", "must" in the
  docs and the agent files.

Group what you found into directions, one idea each. Draft a direction only when the project
shows it in at least two places, or a document of the project states it. Leave out a topic with
one weak sign, and name it in your report. Read `work guide writing` and
`work guide direction-review` first: write and check every draft with them.

## The config draft

The file has the keys of the form that `work onboard config` prints, and the keys of
`aristoteles.yaml` (`schema/aristoteles.schema.json`): `people`, `limits`, `roles`, `decide`,
`tiers`.

- `people`: the exact name that `git config user.name` gives in the dir is the person. When it
  gives none, ask the person for the name to set there.
- `limits`: a limit has a tier, a part (`Assignment`, `Review`, `Result`), and a key. Start with
  this, for the brief size of each tier and the rules of a review. The brief (the text that
  `work brief` prints to an agent) counts the guide text of its tier, so a limit needs room above
  it:

  ```yaml
  limits:
    low:    { Assignment: { briefChars: 6000, attempts: 3 }, Review: { rules: 5 } }
    medium: { Assignment: { briefChars: 12000 }, Review: { rules: 12 } }
    high:   { Assignment: { briefChars: 16000 }, Review: { rules: 20 } }
  ```
- `decide`: needed when a maker has more than one decider.
- `roles`: read `work guide roles` (the checks of work on the roles). Every dir has a role of
  each tier (`sol` is the high tier, `terra` the medium tier, `luna` the low tier; the page and
  `tiers` use those names):
  - a high (Sol) role for each kind of top task (the whole job of a project, for example one TSD; an
    example role is `architect`). The host drafts a top task for it, and the person opens it on the page. This role splits the top task, gives the
    parts to lower roles, decides their results, and decides the result of the top task last;
    then the end of the project comes to the person. Give no other high role a part in these
    decisions: a high role gets work only from the person, and the page gives it only to the high
    role of a top task;
  - a medium (Terra) role that runs a part with a full review cycle (for example `lead`);
  - low (Luna) makers, each with its `output` form (the form of one result: `<file>#<section>`
    for one section of a file, or `<repo>@<commit>` for a commit; the schema, under
    `roles.<role>.output`, lists them), and low checkers;
  - a program role (`kind: program`, explained in "An app with its own harness") for each check
    program that the work runs on a report (no tier, no persistence).
- `tiers`: the commands of the AI CLI that you run in now (the part "The tiers" below).

Each role has the keys of a role of `aristoteles.yaml`, and two more for its card:

```yaml
roles:
  <role>:
    tier: high | medium | low
    description: <what the role does, in one line>
    intro: <the first words of its brief>
    responsibilities: [<one exact output or command>]
    acts: [{ do: <its work> }]          # or [{ review: [<role>] }] or [{ approve: [<role>] }]
    persistence: { persistent: true | false, why: <one line> }
    icon: <a name of the list below>
    summary: <the one line of its card>
    found: <where the project has this role, such as .claude/agents/<role>.md>   # leave it out for a new role
```

Roles that the project has already come first: give them `found`, and take their `description`,
`intro`, and `responsibilities` from that file. A role that the project needs and lacks is new:
leave `found` out. A program role has no `persistence`.

Icons: bot, book-open, brain, clipboard-check, compass, crown, eye, feather, file-text,
flask-conical, gavel, git-branch, hammer, layers, lightbulb, list-checks, map, microscope,
pen-tool, puzzle, scale, search, shield-check, sparkles, telescope, terminal, user-cog, wrench.

### The words of a role

A task is done, reviewed, approved, or changed: these four acts are the standard workflow, and a
role does not choose them. Its words give principles that work as criteria for its kind of work:
what a good unit of it is, so that the role can do it, a reviewer can review it, a lead can
approve it, and the high role can change it. A responsibility that gives no criterion is not
enough: say the exact output and the exact command (`work guide roles` lists the static checks,
and `guides/fitness.yaml` the seven questions).

### Persistence, and the Rumsfeld matrix

Tier and persistence are apart. Only a persistent role gets a terminal of its own, for the whole
project; a role that is not persistent runs as a subagent of a terminal. Use the matrix to
choose, and write the reason in `why`. Never write the matrix itself into the files: the page
does not show it.

- Known knowns and known unknowns: persistent. The role knows the work, or knows what it must
  find out, so it starts cheaper subagents in parallel: workers, validators, and surveyors that
  check a claim or fill in facts.
- Unknown knowns and unknown unknowns: a big agent, disposable by default. Make it persistent
  when the project needs it again and again, for example an advisor with the knowledge of its
  domain.
- The lead is persistent: the host plays the high role of each top task, and the host is a
  terminal. Make at least one high role persistent, or the store start is refused. The person has
  no toggle for that role. Disposable high roles work under it.
- A disposable agent that starts disposable agents shows repetitive work: only a terminal (the
  host, or a persistent agent) starts subagents. A role that is not persistent hands a need for
  more agents back to the terminal above it. Write that in its `responsibilities`.
- A role of any tier can be persistent, also a low one. A low role that does one short job
  again and again is disposable by default.

### The tiers

The UI starts each persistent agent with the commands of its tier. Give `sol`, `terra`, and
`luna` each a `model`, a `launch` command, a `resume` command, and the `skills` folder of the AI
CLI, relative to the dir. `launch` and `resume` name the model as `{model}`, and have `{session}`
(the session id that the UI gives the agent) and `{prompt}` (its first input). Give the commands
of the CLI that you run in now; ask the person only for a command that you do not know. When the
CLI can start subagents, set its limit on nested subagents in the command: only a terminal starts
subagents, so a persistent agent must not let its subagents start more. For Claude Code, with
the environment prefix:

```yaml
tiers:
  sol:
    model: opus
    launch: CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 claude --model {model} --session-id {session} {prompt}
    resume: CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 claude --model {model} --resume {session} {prompt}
    skills: .claude/skills
  terra:
    model: sonnet
    # the same launch, resume, and skills
  luna:
    model: haiku
    # the same launch, resume, and skills
```

The start words of a persistent agent have a default ("Use the work skill. You are {agent}: run
work wait --by={agent}, and do what it prints."); leave `start` out.

### One role

A role file has the keys of one role, with `summary` and `found`, as in the config draft:
`work onboard role <role> --file=.work/drafts/<role>.yaml`. It is for a new role, and for the
answer to a Revise. It clears the request of the role.

## An app with its own harness

Some apps run their own agents already: instruction docs, check programs, agent prompts (a
writer, a judge, a lead), a loop that writes and checks, a web app, a publish step. Map each
piece as below. The roles go into the config draft, the directions into direction drafts.

- **Instruction and standard docs** → directions, standards, and rules, in the owner's own
  words (`work guide writing`). A rule is one check that a reviewer can do on one result, so a
  list of checks in a doc becomes one rule for each check. A sentence that no reviewer can
  check on one result (for example "write for the reader") is no rule: say its idea in the
  words of the direction or the standard, or name it in the report.
- **Check programs** (validators, linters, test scripts) → roles of `kind: program`: `run`
  (the words of the command, with no shell; `{output}` and `{workspace.path}` are filled in),
  `on: report`, `checks` (its rules), and `acts: [{ review: [<the maker>] }]`. A program has
  no tier. Each thing that it checks is one rule with `checkedBy: <the program>`. Exit 0
  accepts all of its checks; any other exit rejects the result. A check that needs the
  judgment of a model is a low role that reviews. When the program reads other arguments than
  `{output}` or `{workspace.path}`, say in the report what to change.
- **Agents** → roles by tier, each with its acts, its persistence, and its icon. Take the
  `description`, the `intro`, and the `responsibilities` from the prompt file of the agent, and
  put its path in `found`.
  - a writer: a low role with `do` and its `output` form (`<file>#<section>` for one section
    of a markdown file; a maker of code reports `<repo>@<commit>`, one commit);
  - a judge or a checker: a low role with `review: [<the writer>]`; each thing that it checks is
    a rule with `checkedBy: <the judge>`;
  - a lead that runs one section and decides it: a medium role with `approve: [<the writer>]`;
  - an orchestrator that splits the work: the high role that splits the top task and decides
    the results of its parts (`approve: [<the writer>]`). Give it no `do` act on the file of the
    parts: a maker keeps its file until it finishes, so each maker of a part would wait for
    it. It may split a task only when it holds the permission to change that task (a "Change
    act"): the person's Open of the top task on the page gives it that permission for 30 days. Do
    not ask the person for a permission (`work grant`).
- **The loop** → tasks, reviewers, and deciders:
  - a write and a check for each section: the high role splits the top task into one part for
    each section (`context: { section: <heading id> }`); a standard for one section only has
    `where: { section: <heading id> }`, and a standard for some sections lists them:
    `where: { section: [<heading id>, <heading id>] }`;
  - the tries of the loop: `limits.<tier>.Assignment.attempts`;
  - more than one decider of a maker: `decide: [{ resultsOf: <the writer>, by: { order:
    [<the lead>, <the high role>] } }]` (`or`: any one of them; `and`: each one; `order`: each
    one, in turn);
  - a step where the person says yes to each section: the deciders accept the section instead,
    and the person accepts no result. The person reads each result after its deciders accept
    it, and can reject it then;
  - a step that puts the parts together: after every part is accepted, `work next` asks the
    high role to give the top task to a low maker. Give that job a low role of its own (for
    example `assembler`), so that its deciders are not those of a part;
  - a review of the whole result: the high role that approves that maker. A rule with no
    `where` is checked on each part too, and no `where` holds a rule to the whole result
    alone. So put each check of the whole result in the `responsibilities` of that role, and
    name it in the report.
- **The publish step, the web app, and other integrations** stay outside the work. The work
  ends with the end of the project; then the person runs the publish step as before. Name
  each one in the report, with the command that the person runs.
- **The run history** of the harness (old runs, attempts, findings) is not carried: the dir
  starts with a fresh store. Name where the history stays in the report.

## A direction draft

A direction draft has exactly these keys: `id name from summary flow says standards examples`. It has
no `owner` and no `approvedBy`: the person who starts the store owns each direction.

```yaml
id: <direction id, lower case with dashes>
name: <a short name>
from: [<one or two principles of the eleven that ground it: Logos, Pathos, Ethos, Mythos,
       Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia>]
summary: <one or two plain sentences: what the direction asks, and why it matters>
flow:
  - { from: <an actor>, to: <an actor, or the file that it acts on>, says: <what happens, in one plain line>, file: <where the project defines the step>, line: <n>, uses: [<for a step that the direction governs: the ids that apply there>] }
says: |
  <what the work is for, in any markdown; the whole idea in the first paragraph>
standards:
  - id: <standard id>
    where: <optional: { section: <heading id> } for one section, or
            { section: [<heading id>, <heading id>] } for some sections>
    says: |
      <how the output looks; one idea; headers for its pieces>
    rules:
      - id: <rule id, unique in the project>
        checkedBy: <a role of the config draft that reviews or approves the maker>
        says: |
          <one check, in its first sentence; reasons and examples under headers>
examples:
  - step: <the number of a marked step of the flow>
    fit: <Follows or Breaks: the output follows the direction, or breaks it>
    input: <only for a step that checks or decides: what it got, as an output below>
    output: { file: <a real result>, line: <n>, excerpt: <a short part of it as it is now> }
            # or { written: <the output in your words> } when the project has none
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
goes to the role that reviews the whole (see the loop above), not to each part.

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
- `file` and `line` name where the project defines the step: the line of the instruction, the
  skill, the template, or the code. Leave them out when no file defines it.
- Name each actor the same way in each step: a person, a role of the config draft, a program, or
  a file. The lifelines are the actors in the order that they first appear.
- The file and line of the steps carry the sources, so leave out the words of where the direction
  comes from in `says`.
- Mark each step that the direction governs with `uses`: the ids that apply there (the direction
  id, standard ids, rule ids of this draft). The page colors a marked step and tags it with its
  ids; the others are gray. A flow marks at least one step, and the command refuses an id that
  is not in the draft.

A direction about how documents are written goes from the person's first act down to the
document:

```yaml
flow:
  - { from: Person, to: architect, says: asks for a TSD of the export feature }
  - { from: architect, to: writer, says: gives each section to a writer, file: CLAUDE.md, line: 12 }
  - { from: writer, to: writer, says: reads the rule of one heading for each section, file: .claude/skills/writer/SKILL.md, line: 30 }
  - { from: writer, to: docs/tsd/export.md, says: fills the template one section at a time, file: docs/templates/tsd.md, line: 1, uses: [tsd-writing, one-topic] }
  - { from: linter, to: docs/tsd/export.md, says: checks that each section says one thing, file: scripts/lint-tsd.sh, line: 8, uses: [one-topic] }
```

A direction about code is often short:

```yaml
flow:
  - { from: developer, to: src/export/config.go, says: reads each env var in one typed function, file: src/export/config.go, line: 9, uses: [typed-config] }
  - { from: CI, to: src/export, says: fails the build on a direct os.Getenv, file: .golangci.yml, line: 22 }
```

**Examples.** For each marked step of the flow, give one output that follows the direction and
one that breaks it (`step` is the number of the step). An example is about outputs only:

- A step that makes something (a writer, a coder, any role that outputs) gives its `output`.
- A step that checks or decides (a reviewer, a linter, a decider) gives its `input` (what it got)
  and its `output` (what it said).
- A sample is real when the project has one: a file, a line, and a short excerpt of the file as it
  is now (the command refuses an excerpt that is not in its file). When the project has none,
  write it: `{ written: <the output in your words> }`; the page labels it "written by the host".

```yaml
examples:
  - { step: 4, fit: Follows, output: { file: docs/tsd/export.md, line: 7, excerpt: "## Design" } }
  - { step: 4, fit: Breaks, output: { written: "## Design and rollout" } }
  - step: 5
    fit: Breaks
    input: { file: docs/tsd/export.md, line: 7, excerpt: "## Design" }
    output: { written: "Accept: the section says one thing" }
```

A break is information for the person to judge the direction; it makes no task. More or other
examples come on request (a Revise); a change of examples makes no new version of the direction.

**Polish before you send.** Read the draft with each question of `work guide direction-review`,
and fix it: the person reads it only after that polish.

## Questions

When you cannot draft a direction without an answer, write
`.work/drafts/<id>.questions.yaml` and send it with `work onboard ask <id> --file=<it>`; the
direction shows Question. Each question says what you must know, names one example, and gives
exactly two options, A and B:

```yaml
questions:
  - says: <what you must know to draft the direction>
    example: { step: <n>, fit: Follows | Breaks, output: { file: <path>, line: <n>, excerpt: <a short part of the file> } }
    options: [<option A>, <option B>]
```

Ask only what the files cannot answer. The person submits one answer for each question
(`work onboard answer <id> --options=A,B`, or the page). `work onboard wait` then returns, and
you draft the direction again with the answers; that clears the questions.

## A company direction

A company direction is a folder of a git repo that other projects follow. The person asks for it
on the page (add a company direction) or in the chat; then `work onboard company <id>
--repo=<repo> --path=<folder>` makes it, and it shows Loading. The text, the standards, and the
rules come from the folder at one commit: you do not write them. The summary is the first
sentence of the folder's words; you do not write it either. Your draft file has only
`id` (optional), `checkedBy` (the role that checks each rule), `rules` (`{ <rule id>: <role> }`
for a rule with another checker), `flow` (how the direction works in this project, its steps
marked), and `examples`;
send it with
`work onboard draft <id> --file=<it>`. Do not copy its words into a direction of the project;
when the project breaks it, say so in the report. When the person has no company repo, point to
the public example: https://github.com/nandanugg/aristoteles-example-direction.

## After the store starts

The store exists after `work onboard approve-roles`; then `work onboard` is over, and a change is
an event.

- A new direction (a suggestion that asks for one, or the person's words): read `work waiting`
  (each such suggestion shows as `s<n> asks for a new direction`) and `work search <words>`
  (a direction can exist already, also a company direction). Write the draft in the form that
  `work direction new` with no file prints, and send it:
  `work direction new --file=<file> --by=assess`, with `--answers=<s ids>` for the suggestions
  that it answers. A standard that belongs under a direction with a version goes into
  `work direction revise <direction id> --file=<edit.yaml> --by=assess`. Its owner accepts it.
- The flow (its steps marked) and the examples of a company draft, before its accept:
  `work direction examples <draft> --file=<examples.yaml> --by=assess`.
- A role or a direction that must change: `work adjust` (the `work` skill, part "Adjust the roles
  and the directions"); the person accepts each adjustment.
- When the owner rejects a draft, `work waiting` shows the Reject and the command. Write a new
  draft that answers it (`--answers=<the Reject>`) and proposes something else. Name what it
  corrects with `--why=<reason> --why-words="<the fact>"` (`work guide writing` lists the five
  reasons).

## The report

End with one list for the person:

- each direction: its id, its summary, and the evidence (the outputs of its examples);
- each role that you drafted: its tier, its persistence and why, and where the project has it;
- for an app with its own harness: each piece of the harness and where it went (a role, a rule,
  a key of the config, or outside the work, with the command that the person runs);
- each topic that you left out, and why;
- the command to read them: `work onboard status`.
