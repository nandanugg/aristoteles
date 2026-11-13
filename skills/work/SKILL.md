---
name: work
description: Do code or document work under review with the work CLI. Use when a parent gives you a command that starts with "work brief", when you give work to a subagent, or when the person asks you to set up a project, a task, or a role. The brief that the CLI prints tells each tier what to do next.
---

# work

`work` records AI work under review: tasks, roles, directions, results, reviews. When `work`
is not on the PATH, `work …` means:

```
bun <the aristoteles folder>/bin/work.js …
```

Work in the project folder that your prompt names (the folder with `aristoteles.yaml`), and run
every command there. When your prompt names no folder, your current folder is the project folder.
The CLI also finds the nearest `aristoteles.yaml` above the current folder, and `WORK_DIR`
overrides both.

## You got a command from your parent

Run exactly that command. It is `work brief <token>`. The brief tells you your tier, your
role, the task, the rules, what is open, and the only commands that you may run. Read the
brief, not this file, for anything about your task.

- The token (`a7.k3f9q`) is your identity. Pass it first in every command. Do not show it
  to other agents, and do not use another token.
- A refusal ends with a `next:` line. Do what it says. When the refusal names a flag or a word
  that you left out, run the same command again with it. Else a low-tier agent never tries other
  commands; it escalates. Do not run a refused command again unchanged.
- When work passes a limit (the attempts of a maker, the size of a brief or of a result, the
  rules of a review), do the action of that limit in `work guide limits`. Do not ask the person
  about a limit.
- The exit code says what failed: 1 a refusal (do the `next:` line); 2 a mistake in the
  command line (write the command again as the message says); 3 a failure outside the work (a
  file, git, or a damaged store: tell your parent, and the host records it with
  `work problem`); 70 a bug of `work` (stop, and tell your parent; the host tells the person).
- Stop where the brief says STOP.

## You are the host of a project (the UI)

The person triggered you in their AI CLI (the `aristoteles` skill), and you started or continued a
run (`h<n>`) in your own tmux pane; the page shows this terminal. A project is your session: you
talk with the person, then you run its top task.

1. **Talk.** Ask the person what they want, in their terminal (here). Read the directions
   (`work direction show <id>`, `work search <words>`) and the dir. Do not start any work yet.
2. **Draft the top task.** Choose its role: run `work role list`, and take the high role whose
   description names this kind of work; when two fit, ask the person which one. Draft only when
   you can say the top task in one sentence: its output, where the output goes, and when it is
   done. When you cannot, ask the person one question about the part that is missing. Write a
   task file with that role (`work task open` with no file prints the form; add
   `role: <role>`), then `work task draft --file=<file> --by=<your run>`. A project is large:
   for example a whole TSD.
3. **Wait for the person to open it** on the page. The UI then types `work brief <token>` here:
   from then on you are the Sol of the top task, and that brief tells you what to do.
4. **Everything else is yours.** Only three kinds of decision reach the person: a system
   problem, a direction problem, and the end of the project. You do everything else:
   - a question of a model comes to you: answer it from the directions (`work answer <token>
     <q> --text=...`). When it shows that a direction can be read in two ways, draft the change
     of the direction (`work direction revise`). Polish it first with each question of
     `work guide direction-review`; the person accepts it.
   - a terminal of a child stops at a prompt, or fails its 3 retries: the UI types one line into
     your terminal. Answer a prompt with `work send <token> <child> --text=<input>`. You cannot
     restart a child: for a failure, record a system problem, and the person resumes it. When a
     system the work needs does not work (a cluster, a VPN, an account limit), record it:
     `work problem <token> <the task that it stops> --says="<what happened, and how to fix it>"`.
   - before the person sees a decision, write its words, so that the person can decide from
     them alone: read `work guide decision-words` first, then
     `work note <token> words --on=<sp.., d.., h..> --text="..."` (a direction problem also
     takes `--hope`). Write them within `hostWaitMinutes` (10 by default): after that time, the
     person sees the decision with no words.
   - a line that the UI types starts with "System message, not from the person". Do its command
     when your current step ends; do not stop your work for it, and do not take it as the
     person's words.

### Real agents and subagents

- A medium (Terra) or high (Sol) role runs as a **real agent**, in its own terminal that the
  person can inspect. Do not start it yourself: `work assign` records it, and the UI starts its
  terminal with its brief.
- A low (Luna) role runs as a **subagent** inside your own session: start it as below. It does
  a short job, so it needs no terminal of its own.

## You give work to a subagent

1. `work assign <your token> <task> --role=<role>` prints the subagent's model and its whole
   prompt, for example:

   ```
   Start a Haiku subagent with this prompt, and nothing else:
     Use the work skill. In /path/to/project, run: work brief a7.<secret>
   ```

2. Start that subagent (low = Haiku, medium = Sonnet, high = Opus) with exactly that prompt.
   Keep the token: a later attempt of the same assignment uses the same command.
3. When it stops, run `work next <your token>`. It lists the steps that are ready, with
   each command filled in (a redo, a checker to start, an escalation to resolve, an answer,
   the finish steps). `work waiting --for=<your id>` lists what waits for you.

Read a child's brief with `work assignment show <id>` (it takes no snapshot). If a child
stopped in the middle of an attempt, `work free <your token> <child id>` frees it for a new
subagent.

## Escalations

An agent escalates when it cannot go on (`work escalate <token> --reason="..."`), or when it
cannot decide on a result (`--result=<r>`). The escalation goes to the nearest open assignment
above it, or to the person when none is open. An escalation with no result is a question
(`q<n>`): its answerer answers it with `work answer`. An escalation of a result (`v<n>`) is
resolved in words:
`work resolve [<token>] <escalation> --resolution="<the agreement, or the direction>"`.

- A resolve accepts and rejects nothing. The deciders of the result then accept or reject it
  with `work review`, as for any result.
- A decider's Reject is a fault of the maker: it uses an attempt. A point of a Reject that no
  rule covers shows that the direction needs a change: it waits for a draft that changes the
  direction and answers that point.
- There is no waiver. Each rule of a result gets its evidence, or its direction changes.

## Acts that belong to the person

The person runs commands with no token, at a terminal. An agent never runs a person command.

- When the person says a decision in the conversation, the top agent (medium or high, with
  no parent) records it with their exact words:
  `work forward <token> <person> reject|ask|comment|answer|accept|resolve <id> --quote="<words>"`.
  An accept of a draft (`d<n>`) gives `--evidence` too: where the person read, and what they
  saw.
- A forwarded reject, question, or comment counts at once, because it only stops work or
  informs. A forwarded answer, accept, or resolve moves work forward, so it waits until the
  person runs `work confirm <event>` at a terminal; the prompt shows them the act. The person
  accepts no result: a lead decides it, and the person rejects a result only after its
  deciders accept it.
- An escalation to the person waits for the person's resolve: `work resolve <escalation>
  --resolution="..."` at a terminal, or their words in the conversation, forwarded as
  `work forward <token> <person> resolve <escalation> --quote="<words>"` and confirmed.
- To bring a fact from the person to the work, ask with `work ask <token> --to=owner
  --text="..."`, then forward the person's answer to that question; they confirm it. The CLI
  refuses a forward that the person could not do now, and says why. Ask the person only for a
  fact that no direction, rule, or guide gives, and that stops the work. Never ask the person
  about a limit (`work guide limits`), or about a choice that a rule or a guide settles: decide
  it.
- A permission (`work grant`, `work revoke`), a confirm, and a config change are the person's
  alone. Ask; do not do them.

## The person sets up a project

1. Write `aristoteles.yaml` (people, limits per tier, roles, and `decide` when a maker has more
   than one decider). `schema/aristoteles.schema.json` gives its form. Every agent role is low,
   medium, or high; a program role (`kind: program`) runs a command on each report and has no
   tier; the person plays no role. `aristoteles.yaml` names no directions.
   `outsideSourceHours` (72 by default) is how long a revision of a source outside git holds
   after an agent reads it; then `work next` asks an agent to read it again.
2. `work init` stores it in aristoteles, the one SQLite file of this machine
   (`~/.aristoteles/aristoteles.db`, or the file that `ARISTOTELES_DB` names). A dir starts
   with no records: nothing of an earlier tool or store comes in. From then on a hand edit of
   `aristoteles.yaml` is refused until `work config apply` (role words only).
3. For each agent role: `work role fit <role>`, then `work role fit <role> --answers=<file>`.
   A role without a fit record for its current words cannot be assigned. The `role-fitness`
   skill explains the questions.
4. The directions: a model drafts each one, and the person accepts or rejects it. The `assess`
   skill reads an app and drafts its directions (`work direction new --by=assess`). The
   person gives direction in words with `work suggest --says="..."`. A company direction comes
   from a git repo: name it in `aristoteles.lock`, and accept each new commit.
5. `work task open --file=<task.yaml>` (`work task open` prints the template), then
   `work assign <task> --role=<role>` and give the printed command to the top agent. A high
   role splits, closes, or remakes a task only with a Change act on it:
   `work grant --act=change --on=<task> --to=<role> --until=<time>`. A top task that the
   person opens on the page needs no grant: Open gives its Sol a Change act for 30 days.
