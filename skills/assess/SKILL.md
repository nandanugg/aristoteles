---
name: assess
description: Read an app (a repo of code or documents) and draft its directions in aristoteles with the work CLI, so that its owner accepts or rejects each one. Use when the person asks to assess an app, to turn the agent harness of an app into aristoteles, to find or suggest the directions of an app, to start the directions of a new work project, or when work waiting shows a suggestion that asks for a new direction.
---

# assess

You read one app and write the first drafts of its directions. A direction says what the work
is for; its standards say how the output looks; its rules are the checks that a reviewer does
on one result. You write drafts only: the owner (a person) accepts or rejects each one. You
work outside any task, so you name yourself with `--by=assess` in each command.

When `work` is not on the PATH, `work …` means `bun <the aristoteles folder>/bin/work.js …`.
Run it in the dir that the person names (the folder with `aristoteles.yaml`). The person ran
`work init` there first, unless the dir has no `aristoteles.yaml` yet (below). You run in the
AI CLI that the person opened in the dir: you are its host.

## A dir with no `aristoteles.yaml` yet

The roles and the people must exist before any direction, so do this part first:

1. Read the app (step 3 below) for its kinds of work: code, documents, or both. When the app
   has its own agent harness, map each piece of it as the next section says.
2. Read `work guide roles`: the checks of work on the roles. Then write
   `aristoteles.draft.yaml` beside where `aristoteles.yaml` goes: the `people` (the git
   user of the dir is the person), the `limits`, the `roles`, and `decide` when a maker has
   more than one decider, in the form of `schema/aristoteles.schema.json`. Every dir has a
   role of each tier:
   - a high (Sol) role that splits a top task and decides its parts (for example `architect`);
   - a high (Sol) role that reviews the result of a top task: it approves the maker of that
     result, and the person accepts the end of a project after it;
   - a high (Sol) role that reviews each draft of a direction (`work guide direction-review`)
     before the person reads it; name it first in the `approvedBy` of each direction;
   - a medium (Terra) role that runs a part with a full review cycle (for example `lead`);
   - low (Luna) makers, each with its `output` form, and low checkers;
   - a program role for each check program that the work runs on a report (no tier).

   Also write the `tiers`: the commands of the AI CLI that you run in now, because the UI
   starts each Sol and Terra agent with them. Give `sol` and `terra` each a `launch` command
   with `{session}` (the session id that the UI gives the agent) and `{prompt}` (its first
   input), a `resume` command with `{session}`, and the `skills` folder of that CLI, relative
   to the dir. When the CLI can choose a model, put the model of the tier in its commands. Ask
   the person only for a command that you do not know. For example, for Claude Code:

   ```yaml
   tiers:
     sol:
       launch: claude --model opus --session-id {session} {prompt}
       resume: claude --resume {session} {prompt}
       skills: .claude/skills
   ```
3. Stop, and tell the person these steps, in this order:
   - In a terminal of their own, not in this AI CLI, run `work start` in the dir, and keep it
     open: the page and the agents stop when it stops. Do not start it for them.
   - Read the draft on the page, and accept the roles. The page writes `aristoteles.yaml`,
     runs `work init`, and links the skills. A refusal says what to fix in the draft.
   - Commit what the agents need, also `aristoteles.yaml`. Keep `.work/` and the linked skills
     out of git (`work guide roles`).

   Wait until the person tells you that the roles are accepted.
4. Record the fit of each agent role (the `role-fitness` skill): `work role fit <role>`, the
   answers in `.work/fit/<role>.yaml`, then
   `work role fit <role> --answers=.work/fit/<role>.yaml --by=assess`. A role with no fit
   record gets no work. A role that does not fit needs new words in `aristoteles.yaml`; ask the
   person to apply them with `work config apply`. Then go on with the steps below.

## An app with its own harness

Some apps run their own agents already: instruction docs, check programs, agent prompts (a
writer, a judge, a lead), a loop that writes and checks, a web app, a publish step. Map each
piece as below. You still write drafts only: the roles go into `aristoteles.draft.yaml`, the
directions into direction drafts, and the owner accepts or rejects each one.

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
- **Agents** → roles by tier, each with its acts. Take the `description`, the `intro`, and the
  `responsibilities` from the prompt file of the agent.
  - a writer: a low role with `do` and its `output` form (`<file>#<section>` for one section
    of a file);
  - a judge or a checker: a low role with `review: [<the writer>]`; each thing that it checks is
    a rule with `checkedBy: <the judge>`;
  - a lead that runs one section and decides it: a medium role with `approve: [<the writer>]`;
  - an orchestrator that splits the work: the high role that splits the top task and decides
    the results of its parts (`approve: [<the writer>]`). Give it no `do` act on the file of the
    parts: a maker keeps its file until it finishes, so each maker of a part would wait for
    it. It splits only with a Change act on the top task, which the person grants
    (`work grant --act=change --on=<task> --to=<role> --until=<time>`).
- **The loop** → tasks, reviewers, and deciders:
  - a write and a check for each section: the high role splits the top task into one part for
    each section (`context: { section: <heading id> }`); a standard for one section only has
    `where: { section: <heading id> }`;
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
  starts with a fresh store at `work init`. Name where the history stays in the report.

## Polish each draft before you send it

The Sol reviewer of directions reviews every new version. Before you send a new direction, read
it as that reviewer would, with each question of `work guide direction-review`, and fix it: the
person reads it only after that polish.

## Inputs

- The app: a folder or a repo to read.
- The project folder, with `aristoteles.yaml` (its people and roles).
- Optional: the suggestions that ask for a new direction (`work waiting` lists them as
  `s<n> asks for a new direction`). Each one gives an aim and concerns. Answer those first.

## Steps

1. Read `work guide writing` and `work guide direction-review`. Write and check every draft
   with them.
2. Read what the project has: `work waiting` (open suggestions, drafts that wait),
   `work role list` and `work role show <role>` (the roles that can check a rule, and the output
   form of each maker), and
   `work search <words>` for each topic that you find (a direction can exist already, also a
   company direction). A project with no `aristoteles.lock` follows no company direction.

3. Read the app, in this order, and stop when a topic has enough evidence:
   - the agent files that exist: `CLAUDE.md` and `AGENTS.md` (at the root and in
     sub-folders), `.claude/`, `.agents/skills/`, `skills/`, and the guides of the app;
   - the README and the docs;
   - the code, for the patterns that repeat: search for the constructs of each topic (for
     example feature flags, configuration, migrations, tests, logging);
   - the recent history: `git log --oneline -50`, and the words "always", "never", "must" in
     the docs and the agent files.

   Stop reading a topic when it has evidence in two places. Read about 40 files in all; name
   what you did not read in the report.
4. Group what you found into directions, one idea each. Draft a direction only when the app
   shows it in at least two places, or a document of the app states it. Leave out a topic with
   one weak sign, and name it in your report.
5. For each direction, write a file (for example `.work/assess/<id>.yaml`):

   ```yaml
   id: <direction id, lower case with dashes>
   name: <a short name>
   owner: <the person who accepts it: a person of aristoteles.yaml>
   from: [<the principles that ground it, of the eleven: Logos, Pathos, Ethos, Mythos, Oikos,
          Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia>]
   approvedBy: <optional: the roles and the owner who accept the next versions>
   says: |
     <what the work is for, in any markdown; the whole idea in the first paragraph>
   standards:
     - id: <standard id>
       where: <optional: { section: <heading id> } when it is for one section only>
       says: |
         <how the output looks; one idea; headers for its pieces>
       rules:
         - id: <rule id, unique in the project>
           checkedBy: <a role of aristoteles.yaml that reviews or approves the maker>
           says: |
             <one check, in its first sentence; reasons and examples under headers>
   ```

   Each standard follows from the words of its direction. Each rule is one check that a
   reviewer does on one result of a maker: its output form in `aristoteles.yaml` (a commit, a
   section of a file). A check of something else (a diagnosis, a report) is not a rule of this
   project; name it in the report. Leave `checkedBy` out when no role of `aristoteles.yaml`
   fits, and say so in the report. `work direction new` with no file prints this form.
6. Check the draft with each question of `work guide direction-review`, and fix it before you
   send it. After you send it, `work direction show d<n>#<entry>` prints one entry of it.
7. Send it: `work direction new --file=<file> --by=assess`, with `--answers=<s ids>` for the
   suggestions that it answers. A first draft needs no `--why`. A refusal says what to fix;
   fix it and send it again.
8. When the owner rejects a draft, `work waiting` shows the Reject and the command. Write a new
   draft that answers it (`--answers=<the Reject>`), and that proposes something else. Name
   what it corrects with `--why=<reason> --why-words="<the fact>"` (`work guide writing` lists
   the five reasons); the owner reads them beside the draft.

## Rules for the words

- The words are any markdown. Name no AI model and no AI vendor. The names of the app's own
  tools (for example Consul, Unleash, Kafka) are the words of the work: use them.
- Write what the app shows. Give the evidence in the report (file paths and what you saw), and
  keep the direction free of file paths with line numbers.
- Do not copy a company direction (in `aristoteles.lock`) into a direction of the app. When the
  app breaks a company direction, say so in the report.

## The report

End with one list for the person:

- each draft: its id (`d<n>`), its direction id, one sentence of what it asks for, and the
  evidence (where you saw it);
- for an app with its own harness: each piece of the harness and where it went (a role, a
  rule, a key of `aristoteles.yaml`, or outside the work, with the command that the person
  runs);
- each topic that you left out, and why;
- the command to read them: `work waiting`, then `work direction show d<n>`.
