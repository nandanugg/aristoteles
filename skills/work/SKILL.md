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

Go to the project folder that your prompt names (the folder with `work.yaml`) before the
first command, and run every command there. The CLI also finds the nearest `work.yaml` above
the current folder, and `WORK_DIR` overrides both.

## You got a command from your parent

Run exactly that command. It is `work brief <token>`. The brief tells you your tier, your
role, the task, the rules, what is open, and the only commands that you may run. Read the
brief, not this file, for anything about your task.

- The token (`a7.k3f9q`) is your identity. Pass it first in every command. Do not show it
  to other agents, and do not use another token.
- A refusal ends with a `next:` line. Do what it says. A low-tier agent never tries other
  commands; it raises.
- Stop where the brief says STOP.

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
   each command filled in (a redo, a checker to start, an answer, the finish steps).
   `work waiting --for=<your id>` lists what waits for you.

Read a child's brief with `work assignment show <id>` (it takes no snapshot). If a child
stopped in the middle of an attempt, `work release <your token> <child id>` frees it for a
new subagent.

## Acts that belong to the person

The person runs commands with no token, at a terminal. An agent never runs a person command.

- When the person says a decision in the conversation, the top agent (medium or high, with
  no parent) records it with their exact words:
  `work relay <token> <person> reject|ask|comment|accept|answer <id> --quote="<words>"`.
  An accept of a draft (`d<n>`) gives `--evidence` too: where the person read, and what they saw.
- A relayed reject, question, or comment counts at once, because it only stops work or
  informs. A relayed answer, accept, or settle (an accept with `--settles`) moves work
  forward, so it waits until the person runs `work ratify <event>` at a terminal; the prompt
  shows them the act. The person accepts no result: a lead decides it, and the person rejects
  a result only after its deciders accept it.
- To bring a fact from the person to the work, ask with `work ask <token> --to=owner
  --text="..."`, then relay the person's answer to that question; they ratify it. The CLI
  refuses a relay that the person could not do now, and says why.
- Grants, ratifies, and config changes are the person's alone. Ask; do not do them.

## The person sets up a project

1. Write `work.yaml` (people, limits per tier, roles). `DESIGN.md` section 3 shows it. Every
   role is low, medium, or high; the person plays no role. `work.yaml` names no directions.
2. `work init` stores it in aristoteles, the one SQLite file of this machine
   (`~/.aristoteles/aristoteles.db`). From then on a hand edit of `work.yaml` is refused until
   `work config apply` (role words only).
3. For each role: `work role fit <role>`, then `work role fit <role> --answers=<file>`.
   A role without a fit record for its current words cannot be assigned. The `role-fitness`
   skill explains the questions.
4. The directions: a model drafts each one, and the person accepts or rejects it. The `assess`
   skill reads an app and drafts its directions (`work direction new --by=assess`). The
   person gives direction in words with `work suggest --says="..."`. A company direction comes
   from a git repo: name it in `aristoteles.lock`, and accept each new commit.
5. `work task open --file=<task.yaml>` (`work task open` prints the template), then
   `work assign <task> --role=<role>` and give the printed command to the top agent.
