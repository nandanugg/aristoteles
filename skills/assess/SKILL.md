---
name: assess
description: Read an app (a repo of code or documents) and draft its directions in aristoteles with the work CLI, so that its owner accepts or rejects each one. Use when the person asks to assess an app, to find or suggest the directions of an app, to start the directions of a new work project, or when work waiting shows a suggestion that asks for a new direction.
---

# assess

You read one app and write the first drafts of its directions. A direction says what the work
is for; its standards say how the output looks; its rules are the checks that a reviewer does
on one result. You write drafts only: the owner (a person) accepts or rejects each one. You
work outside any task, so you name yourself with `--by=assess` in each command.

When `work` is not on the PATH, `work …` means `bun <the aristoteles folder>/bin/work.js …`.
Run it in the project folder that the person names (the folder with `work.yaml`). The person
ran `work init` there first.

## Inputs

- The app: a folder or a repo to read.
- The project folder, with `work.yaml` (its people and roles).
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
   owner: <the person who accepts it: a person of work.yaml>
   from: [<the principles that ground it, of the eleven: Logos, Pathos, Ethos, Mythos, Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia>]
   approvedBy: <optional: the roles and the owner who accept the next versions>
   says: |
     <what the work is for, in any markdown; the whole idea in the first paragraph>
   standards:
     - id: <standard id>
       says: |
         <how the output looks; one idea; headers for its pieces>
       rules:
         - id: <rule id, unique in the project>
           checkedBy: <a role of work.yaml that reviews or approves the maker>
           says: |
             <one check, in its first sentence; reasons and examples under headers>
   ```

   Each standard follows from the words of its direction. Each rule is one check that a
   reviewer does on one result of a maker: its output form in `work.yaml` (a commit, a region
   of a file). A check of something else (a diagnosis, a report) is not a rule of this
   project; name it in the report. Leave `checkedBy` out when no role of `work.yaml` fits, and
   say so in the report. `work direction new --file` with no file prints this form.
6. Check the draft with each question of `work guide direction-review`, and fix it before you
   send it. After you send it, `work direction show d<n>#<entry>` prints one entry of it.
7. Send it: `work direction new --file=<file> --by=assess`, with `--answers=<s ids>` for the
   suggestions that it answers. A refusal says what to fix; fix it and send it again.
8. When the owner rejects a draft, `work waiting` shows the Reject and the command. Write a new
   draft that answers it (`--answers=<the Reject>`), and that proposes something else.

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
- each topic that you left out, and why;
- the command to read them: `work waiting`, then `work direction show d<n>`.
