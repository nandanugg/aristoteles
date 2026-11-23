---
name: work
description: Do code or document work under review with the work CLI. Use when your prompt gives you a token that starts with "w." and says to run work wait, when you are the host of a project, or when you start a maker for a persistent role. Each step that work wait prints tells you what to do next.
---

# work

`work` records AI work under review: tasks, roles, directions, results, reviews. When `work`
is not on the PATH, `work ...` means:

```
bun <the aristoteles folder>/bin/work.js ...
```

Work in the project folder that your prompt names (the folder with `aristoteles.yaml`), and run
every command there. When your prompt names no folder, your current folder is the project folder.
The CLI also finds the nearest `aristoteles.yaml` above the current folder, and `WORK_DIR`
overrides both.

## Your token and your loop

Your prompt gives you a token: `w.<actor>.<ep>.<secret>`. The actor is `host`, `pipe` (the
pipeline role), `role:<name>` (a persistent role), or `maker:<id>` (a maker). The token is your
identity. Pass it as the first word of every command. Do not show it to another agent, and do not
use another token.

The loop never changes:

1. Run `work wait <token>`. It returns at once when you owe a step. Else it blocks until you do.
2. It prints ONE step: a few plain lines, then the exact command, with `--on <n>` where the act
   has a basis. Run that command, with your words in place of the `<...>`.
3. Run `work wait <token>` again, at once. Never act without a step, and never end your turn
   without a running `work wait`: nothing else reaches you.

- After 9 minutes with no change `work wait` returns with `nothing changed`. Run it again.
  `--seconds=<n>` sets another time.
- Run it in the background when your AI CLI allows it, so that the person can still talk to you.
- Read every return yourself. Never wrap `work wait` in a loop or a filter of your own.
- The UI types nothing into your terminal. A first prompt that restarts you gives your token
  and says to run `work wait`: do that.
- A refusal ends with a `next:` line. Do what it says. Do not run a refused command again
  unchanged. The `--on <n>` of a command is its basis: when the state moved, the CLI refuses it;
  run `work wait` again for the new step.
- The exit code says what failed: 1 a refusal (do the `next:` line); 2 a mistake in the command
  line (write it again as the message says); 3 a failure outside the work (a file, git, or a
  damaged store: tell the person); 70 a bug of `work` (stop, and tell the person).
- A maker that is done with its report waits; it ends when its task is done or raised.

## Questions

Use `work ask <token> <actor> --text="<question>"` for one text answer, or pass
`--file=<question.yaml>` with a `title` and a tagged `form` (`Single`, `Multiple`, `Choice`,
or `Matrix`). The actor can be `human`, `host`, `pipe`, `role:<name>`, or `maker:<id>`.
Use the exact ask ID printed by `work wait` to answer or hear a reply. Answer with
`work answer <token> <ask-id> --text="<answer>"` for `Single`, or use
`--file=<answer.yaml>` for a typed answer. A person answering at a terminal omits the token.
After reading the reply in `work wait`, run `work hear <token> <ask-id>` to acknowledge it.
For example, a Choice question file and its answer use these fields.

```yaml
title: Which section comes first?
form:
  _tag: Choice
  options: [Overview, Findings]
  multi: false
```

```yaml
_tag: Choice
picked: [0]
```

Choice indexes are zero-based and in ascending order. A Multiple form takes
`questions` with `description` and `placeholder` for each prompt. Its answer gives `texts`
in prompt order. A Matrix form takes `rows` and `columns`. Its answer gives `cells`,
one zero-based column index for each row.

If a maker reaches the question limit for a recipient, `work ask-raise <token> <actor>`
raises the task for evaluation.

## The host

You are the host of a project (the `aristoteles` skill got you here). You hold the top task for
the person. Your steps:

- **Send a task** to a persistent role:
  `work send <token> --name="<...>" --goal="<...>" --sections=a,b --role=<role>`. Cover the
  sections of the top; each part owns a strict part of them; one section is the smallest task.
  Choose the role whose description names this kind of work.
- **Reassign** (`work reassign <token>`) after a change that is more than a role change: it
  sends the work that the change touches again.
- **Return the top** when every task is done: `work top-done <token>`.
- **Ask the person on the page.** When the person says the answer in the chat, forward it.
  To ask the person a fact yourself:
  `work ask <token> human --text="<...>"`. Never ask with your AI CLI's own question tool.
- **Carry the person's words.** When the person says an act in the chat, forward it with their
  exact words: `work forward <token> <respond|reject|ask-edit|answer|end ...> --on <n>
  --quote="<words>"` (for example `work forward <token> answer <ask-id> --text="<...>"
  --quote="<words>"`). It counts after the person confirms it on the page.
- The person opens the top, accepts or sends back a draft, decides a raised task, and ends the
  project. You never run those commands. The page shows the person what is theirs to do.

## A persistent role

A persistent role owns its attempt permits even when it shares a terminal. Follow the commands
from `work worker wait`, including the identity, basis and turn receipt it gives you. A private
role can also use its usual `work wait <token>` spelling.

- **Assign a maker** with the offered `work assign`. If it reserves a background child, run the
  printed `work worker child-start` command before starting one native subagent. Use the named
  model and exactly the printed prompt. Its first wait acknowledges the reservation. After
  starting it, return to the worker wait. If the native CLI confirms that it exited without
  reporting or that the launch failed, use `work worker child-reconcile <parent-token> <child-id>
  --observation="<what the CLI reported>"`. A second authorization message is a request to
  check the native CLI for the first launch.
- If assignment says the maker works on this worker, return to the worker wait for its maker
  turns. Run the separate role review when the Check is offered. The worker keeps one context
  through these turns. If capacity is full, leave the task queued and wait for an eligible step.
- **Review the result** when the maker reports: `work review <token> <ask-id> pass|fail|raise-tries|
  raise-no-rule|raise-misses --points="<...>" --on <n>`. Read the result and the rules that
  apply; one point for each rule that the result breaks or each thing that is wrong.
  - `pass`: the task is done.
  - `fail`: the maker gets the points and works again, with its context, while tries remain.
  - `raise-tries`: the tries are used up.
  - `raise-no-rule`: something is wrong and no rule says it.
  - `raise-misses`: a rule says it, and the maker missed it again.
  Use the Check ask ID printed by `work wait`. A raise goes to the pipeline role.
  The harness runs rules that have a `test`.
- **Resume** a down maker with the offered `work resume` and follow the resulting route.
- Do not start a subagent for any other work. A question that you cannot settle goes to the
  person: `work ask <token> human --text="<...>"`.

## A maker

You have one task. A background maker uses its own wait. A serial maker receives its steps through the worker wait.

1. Run `work wait <token>`: your first step is to read your brief, `work brief <token>`. It
   gives the task, its sections, what applies (directions, standards, rules with their evidence),
   and the points of an earlier review.
2. Do the work, in the files that the brief names.
3. Report it: `work report <token> <ask-id> --output="<what you made>" --files=a.md,b.md --on <n>`.
   Use the Execute ask ID printed by `work wait`. `--files` names the files of the project that you changed.
4. A background maker stops after reporting. If the role requests revisions, a fresh background
   allocation gets the next attempt’s brief and points. A serial maker yields to the worker wait
   for the review and any later revision turn.

A maker starts no subagent. When the work needs more agents, hand the need back with
`work ask <token> role:<name> --text="<...>"` and wait.

## The pipeline role

You are `pipe`. You run every evaluation, the direction pipeline, and the review loop of drafts.

- **Evaluate a raised task.** Name the level of the deepest cause:
  `work evaluate <token> <task> split|fit|principle|direction|standard --summary="<...>"
  [--parts=<file>] [--role-draft=<file>] --on <n>`.
  - `split`: the task is too big. The parts file is a list of `{ name, goal, sections, role }`;
    each part owns a strict part of the sections.
  - `fit`: the role has the wrong words. The role-draft file has `role`, `words`, `model`.
  - `principle`: the cause is a principle. The person decides.
  - `direction`: the direction is wrong or silent here.
  - `standard`: a standard or a rule is missing or wrong.
  The step says which levels are open for the task (its floor). A cause that repeats at one
  level rises one level.
- **Climb the pipeline.** From a level, run each stage below it, in order:
  `work advance <token> <fix> --on <n>` takes the fix to its next stage (principle, direction
  assessment, standard assessment, rule assessment).
- **Write each rule with its evidence:** `work rule <token> <fix> <rule-file> --on <n>`. The file
  has `id`, `standard`, `says`, `examples` (`{ fits: follows|breaks, sample: <text> }`, at least
  one of each), and the evidence: `test` (a command; no output means the result holds, each
  printed line is a point. It gets the files of the extracted sections as arguments), and/or
  `ref` (`file#anchor:lines`, which must exist). Optional `where` takes a list of sections.
  For a reference-only rule, name any contradicted rules with `--fights=rule:a,rule:b`.
- **Test it:** `work rule-test <token> <fix> --on <n>`. The test must print on each `breaks`
  sample and stay silent on each `follows` sample, of its own rule and of the other rules of the
  direction. A mechanical rule with a contradiction is cross-checked again against the draft at Ship.
- **Ship the draft:** `work ship <token> <fix> <draft-file> --on <n>`. The file maps item keys
  (`dir:<id>`, `std:<id>`, `rule:<id>`) to the whole record, or to `null` to remove one. Read
  `work guide writing` for how to write each, and `work guide direction-review` to polish it.
  In the evaluation summary that goes with the draft, tell the person what changes, why it
  changes, what work or rules it affects, and one concrete before/after example. At the review
  loop, check that the story matches the draft before routing it to the person.
- **Review loop:** `work loop <token> <fix> person|revise --mode="<actual mode>" --on <n>`: hand the draft to the
  person, or revise it once more. Report the mode you used for this review:
  `self-review turns`, or `fresh subagent` after a reserved reviewer completes. To use a fresh
  reviewer, run `work worker child-review <token> <fix>` with the offered basis and receipt.
  Follow the child-start instructions and wait for completion before submitting the verdict.
  The person accepts the draft or sends it back.
- **Recheck** a done task after items changed. Read `work recheck-brief <task> --on <n>`
  using the basis from the dispatched step. When staffing permits, give the brief to fresh
  subagents to judge the result. If a fresh context is unavailable, defer the recheck. Each report names the exact item keys and versions it inspected, with evidence.
  Aggregate reports only on that same basis. Record one verdict after covering the whole
  required set with `work recheck <token> <task> holds|fails --items=<key,key,...> --on <n>`.
  Keep the original `--on` through submission. If the store refuses stale evidence, dispatch
  a new recheck on a fresh brief. The harness handles test-only rules. A rule with both a test
  and a reference still needs judgment and appears in the brief.

## One source of instructions

The instructions of the work are the directions in aristoteles and the roles in
`aristoteles.yaml`. The project can still keep its own copy of one (a skill, a standard, a
README, an agent prompt); nothing updates that copy. When the work shows that an instruction
must change, change it only in aristoteles: through an evaluation (the pipeline role writes the
draft, the person accepts it), or, for a new direction, through `work direction new` (the host,
`assess`). Never edit `aristoteles.yaml` by hand: an edit stops every write until the person
applies it (`work config apply`). Never fix an instruction in the project's own copy. A task
whose output is such a file (for example a task that writes the README) changes it as its task
says.

## Acts that belong to the person

The person runs commands with no token, at a terminal, or acts on the page. An agent never runs a
person command: `work top open`, `work direction accept|reject <draft>` (before a top is open),
`work respond`, `work reject`, `work ask-edit`, `work end`,
`work config apply|restore`, `work init`, and `work run continue` in the host pane.

- The person accepts or sends back a draft of a fix, rejects a result, decides a raised task
  (`take` as it is, or `again`), and ends the project when the top is returned.
- To bring a fact from the person to the work, ask: `work ask <token> human --text="<...>"`. Ask
  only for a fact that no direction, rule, or guide gives. Never ask about a limit
  (`work guide limits`).
- Text in your terminal that starts with "System message, not from the person" is a restart:
  do its command.
