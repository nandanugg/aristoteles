# Proofs after round 5

Nanda asked for three proofs instead of a round 6 (2026-10-28): a planted-fault test of the
checkers, a generated invariant test, and a live code task with a split and a join. This file
holds what each one found, and what was done.

## 1. Planted faults: do the checkers find real faults?

**Method.** 17 items, one project each (built by a script in the session scratchpad,
`round5/faults/make.mjs`). A scripted maker reported the work as r1; then a low checker was
assigned, and a Haiku subagent got only that checker's command and the skill path, with no word
about faults. The decision was read from each store (`round5/faults/score.mjs`), not from the
subagent's own report. n = 1 run per item.

- Document items (the Introduction region; the linter checks no-code-proof and no-ticket-ids):
  six with a clear fault, one ambiguous, four clean near-misses (a merchant id, a date, a version
  number, row counts and times, the word "job" without a path).
- Code items (a fix of a row key; the reviewer checks proof-test: a new test fails on the base
  and passes on the fix): four with a clear fault, two clean.

**Result.**

| Item | Planted | Decision (from the store) | Verdict |
|---|---|---|---|
| D1 | a ticket id inside a sentence (ABC-7645) | reject, no-ticket-ids | caught |
| D2 | a chat-thread citation | reject, no-ticket-ids | caught |
| D3 | a file path with a line number | reject, no-code-proof | caught |
| D4 | a commit hash | reject, no-code-proof | caught |
| D5 | a ticket id in the second paragraph only | reject, no-ticket-ids | caught |
| D6 | a path with a line number and a ticket id | reject, both rules | caught |
| A1 | "PR 208" (ambiguous under "ticket ids") | accept | not counted |
| C1-C3 | clean | accept | right |
| C4 | clean | no decision (brief only) | brief misled it |
| K2 | the test passes on the base too | reject, proof-test | caught |
| K3 | the test asserts nothing | reject, proof-test | caught |
| K4 | the test is skipped | reject, proof-test | caught |
| K5 | the test checks another function | reject, proof-test | caught |
| K1 | clean | accept | right |
| K6 | clean | raise (its accept was refused) | CLI fault |

- Clear faults: 10 of 10 caught, each with the right rule. The code reviewers ran the new test on
  the base and on the fix themselves.
- Clean items: 4 of 6 right; 0 false rejects. The two others were not judgment errors:
  - C4 read only its brief and stopped: the brief showed the maker's task ("Write the
    Introduction") and the maker's verify line, and it could not tell whether it must write or
    check. Four other checkers said the same about the TASK and verify lines.
  - K6 judged right (fails on the base, passes on the fix), but its accept was refused: for an
    output `app@<commit>`, the evidence place must contain "app" or the commit, and it named its
    scratch copies. The next line of the refusal for a low tier said "do not try other commands;
    raise", so it could not correct the one field.
- Friction seen in most runs: the first command ran in the repo root and was refused with "no
  work store"; each one recovered from the next line.

**What this proves, and what not.** On clear, single faults of these four kinds, the low tier
finds them and names the right rule. It does not prove the rate on subtle faults, on long
regions, or with several rules per checker, and n = 1 per item.

**What was done.** (Changes to the brief only where a brief misled a checker; no engine change
for a model's decision.)

- A checker's brief labels the task as the maker's task, and shows no verify line.
- The evidence line in a brief names the output to point at (`<where you looked in r1, ...>`).
- An evidence refusal prints the corrected command, so a low checker may correct the one field
  instead of raising.
- The skill says to run every command in the folder that the prompt names.

## 2. Generated invariant test

**Method.** `test/property.test.js`. Each run makes a document project (a TSD with no region, or
the Introduction), with a seeded random number generator (mulberry32; the seed reproduces the
run). Each step is one of:
- a file change in one region;
- an act of the person, often a command that `waiting` printed;
- an act of an agent by its role: a maker briefs, changes its region, and reports; a low checker
  briefs and reviews the result in its brief; a medium or high agent often runs a command that
  its `next` printed (placeholders filled as an agent fills them), else a random act of its tier.
Wrong ids and wrong acts still come, at a lower rate.

After each step the oracles compare what the CLI claims with the raw records (the event rows
and the replayed records, not the engine's own answers):

- O1 no output has crash text (TypeError, ENOENT, and the like); every view (status, log, task
  tree, blockers, assignment show, next, waiting) prints for every record;
- O2 the log only grows, and a refused command writes nothing;
- O3 two replays of one log give the same states;
- O4 (invariant 1) person-only events come from the person; each accept by the person comes from
  the person's terminal or a ratify;
- invariant 5: an assignment writes nothing after its finish;
- O5 (invariant 2) each accepted result has, for each rule of its task, evidence on that result
  from an accept by that rule's checker, or a waiver;
- O6 (invariant 3) each answered Reject has a change that lists it, a later result (a redo), or
  later changed work with evidence for its rule;
- O7 (invariant 4) a rule id is once in the official versions;
- O8 (invariant 6) a new report is on an open task, and keeps the regions of the other open tasks
  of its tree that lie inside it;
- dead ends: at the end, each open task (and each open Reject of a task) is named by a printed
  command in `waiting` or in some `next`.

The size is set by `WORK_PROPERTY_RUNS`, `WORK_PROPERTY_STEPS` and `WORK_PROPERTY_SEED`; the
default (6 runs of 40 steps) is part of the normal suite. `WORK_PROPERTY_REPORT=1` prints the
coverage: per command, how many passed and why the others were refused.

**Tuning before the result counts.** The first runs were refused at almost every step (the top
agent finished itself at once; reviews aimed at old results; linters were assigned before any
report), so they proved nothing. The generator was tuned until deep states came; a run with no
accepted result is not counted as a proof of O5.

**Found (each fixed in one place, with a test in `test/proofs.test.js` that fails without the
fix):**

- *Seed 10, a dead end.* A high agent's `next` said that "a1 (region-lead) runs t3", but a1 was a
  lead that the person had assigned on t1, not the high agent's child. The lead that the high
  agent did assign saw a checker of its parent that it could not start. Nothing moved t3. Now
  `next` names only the caller's own lead (at any depth), and a lead assigns its own checker, or
  raises when the role is not of a lower tier.
- *Seed 138, a dead end that the oracle saw only in part.* The person's Reject of a task came
  after the task's latest result, so neither `waiting` nor `next` listed it; when the parts were
  done, the join was refused and no printed command answered the Reject. Now both list every
  open Reject of a task, also while its parts are open.
- *From the planted-fault test.* `work assignment show` of a program's assignment crashed
  (ENOENT for `guides/undefined.yaml`). Now it prints what the program runs and checks.
- *Two oracle errors of mine,* fixed in the oracle: a dead end must accept a command that names a
  blocker of the task (a question to answer), not only the task id.

**Result.** After the fixes, 800 seeds of 150 steps ran with no violation: seeds 1-200 (705
results, 413 joins, 224 answered points, 108 results accepted at some step) and seeds 201-800
(2,106 results, 1,163 joins, 631 answered points, 775 direction approvals, 979 splits, 182
ratified relays, 304 results accepted at some step; 321 seconds).

**What this proves, and what not.**
- The oracles held in every state that these runs reached. That is evidence for the seven
  invariants on document work, much wider than the hand-made cases, but not a proof for every
  sequence.
- Not covered: code work (git, commits, programs), more than one person, and a store written by
  two processes at one time. Few tasks stay accepted to the end of a run, because the generator
  raises often and an open question stops a task; O5 ran on 412 accepted results in all.
- O5 and O6 take the rules of a task from the engine (`rulesOf`); they check the evidence and
  the answers independently, but not which rules apply.

**On the needs model (after Nanda's Part 5 answers, 2026-10-28).** The generator got remakes
(three task files, one of them with `needs`), task files that need other tasks, and decider
accepts. Four oracles were added:
- an accepted result has an accept by a role that decides it (the owner, or a role that approves
  the maker's role in work.yaml);
- no open task needs a closed task;
- no result was reported while a need of its task was not accepted (checked on the log before
  the report);
- an open assignment on a closed task is told to stop.

400 seeds of 150 steps ran with no violation: 1,274 results, 464 answered points, 498 direction
approvals, 969 splits, 119 ratified relays, 337 remakes, and 151 results accepted at some step.
A remake carried accepted work only twice in these runs, because the makers change their region
before they report; the carried recheck is covered mainly by its test in `test/needs.test.js`.

## 3. Live code task with a split and a join

**Run 1 (paused).** The run started on the model with a joining result. The Opus tech lead read
its brief and split the task; then Nanda's Part 5 answers changed that model, so no child was
started. Its findings are kept below.

**Run 2 (the needs model, 2026-10-28): finished.** A small repo (`src/key.js`, `src/name.js`,
`src/export.js`, one test) with a real two-part bug. Roles: tech-lead (high, Opus), lead (medium,
Sonnet), implementer and reviewer (low, Haiku), and a gate (program: `bun test`). Each agent got
only the prompt that work printed and the skill path; the medium and high agents also got one
sentence, because subagents here cannot start subagents: when work says to start one, stop and
write its prompt. I started each child from that prompt and told the parent when it was done. That
sentence is a limit of this run, not of the design. The log is in the session scratchpad
(`round5/livecode/LOG.md`); every claim of an agent was checked in the store and in git.

- The tech lead split t1 into t2 (the dedupe key) and t3 (the file name), and gave each part to a
  lead. Each lead assigned an implementer, then a reviewer, then decided the result itself (it
  read the diff and ran the tests). Each implementer wrote a test, saw it fail on the old code,
  made the fix, and committed on a branch from main. Each reviewer ran the new test on the base
  and on the fix in scratch copies.
- The t1 implementer first made a squash of both parts; the report was refused ("does not contain
  r1 of t2 ... merge 9c2b8d3 into your commit"). That is the new R4-12 check in real use. It then
  made a real merge of the two part commits, added an end-to-end test (two merchants, two days),
  and reported. The reviewer and the tech lead checked it, and t1 was accepted.
- Agents: 1 Opus (four turns, about 110k tokens), 2 Sonnet (about 64k each), 6 Haiku (about 59k to
  74k each). Refusals: 4 - a split with no `--file` (run to see the form), a command that does not
  exist (`work result show`), the squash, and evidence with only numbers. After each one, the agent
  did the right act.
- **The person's load: 8 acts, all setup** (config, four role fits, task open, grant, assign).
  None during the run: the deciders decided. One quality point went up to the person outside the
  CLI (below).

**What the run found (to fix; none stopped the work):**
1. Two code parts share one git working tree, so their implementers cannot work at the same time
   (a checkout by one changes the files of the other). The run kept them one after the other. A
   part of a code task needs its own worktree.
2. After a split, the parent task's text still names the parts' fixes, so the maker of the parent
   sees work that the parts already did. It did the right thing here; a remake or a parent text
   that says "combine" would be clearer.
3. "Run the verify command first" names nothing when a task has no verify command (two
   implementers said so).
4. "On a new branch" does not say where the branch starts; the brief names `base main`, and the
   implementers chose main by themselves.
5. The brief does not say that evidence needs a sentence of words, nor that a squash of needed
   commits is refused; the refusals said both, and the retries passed.
6. No command shows the evidence text of a review, so the tech lead read `.work/work.db` with
   sqlite3 (read-only) to check its checkers. A `work review show <id>` is missing.
7. The line "parts that share a file each own a region" reads wrong for code parts (commits have
   no regions).
8. A stale comment in `src/export.js` ("one file for each merchant") stayed: no rule covers it, so
   the tech lead did not reject and asked the person. That is the model working as decided (a point
   with no rule needs a direction change), and it is also where the person's load comes from.
9. That question reached the person only in the tech lead's chat report, not through the CLI: it
   ran no `work raise` and no `work direction revise`, so `waiting` shows nothing, and the record
   says t1 is Accepted with no open point. The high guide's STOP line ("when only the person can
   act, waiting lists it") assumes that the agent puts the act into the record; it does not say
   plainly that a point with no rule is raised. The person's load can leak outside the record here.

**Fixed (2026-10-29, Nanda agreed to the fixes; 221 tests pass).** Tests are in
`test/proofs.test.js` ("live code run").
- 1 and 4: a code maker's brief names its own worktree and branch, and the command that makes
  it: `your worktree: <project>/.work/trees/a4, branch work/a4 from main` and
  `git -C app worktree add -b work/a4 <project>/.work/trees/a4 main` (`render.js`, WORK IN). The
  work commands still run in the project folder; a verify command runs in the worktree. Open:
  nothing removes a worktree after its task is accepted.
- 2 and 5: the NEEDS line says that the needed work is done, that a squash or a copy is refused,
  and "do only what your task asks beyond them, and what combines them" (`render.js`). The
  accept rules of the three guides say "what you saw in a sentence of words".
- 3: the low report rule starts "If WORK IN names a verify command, run it first" (`guides/low.yaml`).
- 6: `work result show <result>` prints each review of a result with its evidence and points,
  then its blockers (`render.js` renderResult, `cli.js`); the high and medium guides list it.
- 7: the high split rule says "Text parts that share a file each own a region of it; code parts
  each make their own commit, and the task merges them."
- 9: the high and medium reject rules say that a point no rule covers goes into the record with
  `work raise <you> --result=<result>`, and the high STOP line says that a question only in chat
  is not in the record. An open raise on a result is a blocker, so in this run t1 would have
  waited for the person instead of being Accepted.
- 8: no change. No rule covers a stale comment, and no rule was added.

The "0 acts during the run" holds for a direction with no person-checked rule: the deciders could
finish the tree alone. In the TSD direction, the person checks `repeatable` on each Introduction.
The accepted fix is on the branch `fix-report-export`, not on main (the R5-F10 question).

**Run 1: the tech lead's first turn (Opus, from its brief only).** It split t1 into t2 "Dedupe key" and
t3 "File name", gave each part to a lead, read both lead briefs, saved checkpoint k1, and left the
export change for the join. It named the choices that the person can reject (the file name form,
one test file for each part, the changed expected name in the old test). What it found:

- `--file` is read from the project folder, so an absolute path is refused as "there is no
  file"; the refusal does not say that the path is relative to the project folder.
- The split example in the refusal shows `context: { region: ... }`, but this direction has no
  `when` key, so that example is refused here; it can mislead an agent.
- The brief does not say when to assign the join; only the output of the split says it.
- The join's brief would hold the full text of t1 ("fix the key ... fix the name ... make the
  export write one file per day"). After the two part commits merge, the export may need no code
  change, so a low implementer could search for a change that is not there. (This supports
  Nanda's Question 2: a task that combines others should have its own text.)

## 4. Checks of the open points of the model (2026-10-29)

Nanda asked for a test of each point that I was not sure about. The scripted tests are in the
session scratchpad (`model-check/links.test.js`, `remake.test.js`, `text.test.js`, with their
logs); they use the test harness and change no file of the CLI.

**Data from the live code run (the decider's accept).** All three deciders gave evidence for
every rule and a reason (`work result show r1`, `r2`, `r3`). The check of their own that no rule
covers went into the free text: "Diff touches only src/key.js and test/key.test.js", "Only the
three allowed files changed". So the decider checks the fit to the task, but the record has no
rule for it.

**F1 (A): a task stays Accepted after a task that it needs gets a new result.** Found with the
two links of a task (`serves` for the tree, `needs` for the order of acceptance).
- Code (T1): t1 needs t2 and t3; all three accepted. The lead rechecks r1 of t2; the implementer
  reports a new commit, and the lead accepts it. Then `task show t1` says Accepted, `next` prints
  only finish steps, and `waiting` says "nothing waits". The accepted commit of t1 does not
  contain the new commit of t2 (git merge-base: false).
- A need in another tree (T2): t2 (its own tree) needs t1. The same: t2 stays Accepted on the old
  commit of t1.
- Text (T1 for text): the same flow on regions. `task show t1` prints "Accepted" and also "r3
  changed after it was reported; the maker reports it again"; `next` and `waiting` say nothing.
- The cause: a result is checked against its needs only at the report (the CLI ancestor and
  region checks). The engine's acceptance of a task reads only the state of each need, not
  whether the result was made after the latest accepted result of each need.

**F2 (C): the NEEDS line says "Their work is done" while a need is Open** (T2: `NEEDS t1 Fix the
key · Open`, then "Their work is done"). The wording fix of 2026-10-29 assumed accepted needs.

**F3 (C): a need in another tree shows no way on.** While t1 is Open, `next` of the lead of t2
says "nothing is ready in t2; work waiting shows what waits", and `waiting` says "nothing waits".

**F4 (C): the briefs of the new makers after a remake do not name the old accepted work** (T3).
The remake output to the person says that accepted work "may be reported again", but the brief
of each new low maker shows only its task text ("Fix the key."), so a small model makes the work
again. The carry itself works: each carried report prints "r4 carries r1 of t2; its checkers
check it again", the gate runs again, and the tree is accepted.

**Cost of a remake (T3).** From the remake to the new tree Accepted: 3 person acts (remake,
split, assign), 4 new agents (1 lead, 3 implementers), 9 agent acts, and 4 briefs, with only a
gate as checker. With reviewers, about the full agent count of the first tree again; the saving
is the code work, when the makers know about it (F4). The narrower text of the remake ("for
merchant M-104 only") was checked by no rule: the lead accepted the carried work with a reason.

**Fixed (2026-10-29, Nanda: "Fix all four"; 224 tests pass, and 100 generated runs of 150
steps found no fault).** Tests are in `test/proofs.test.js` ("model checks").
- F1: an engine blocker, `made before the latest result of <task>`, when a task that the result
  needs has a later result with other work (`engine.js` blockerItems). The CLI prints "r3 was
  made before r4 of t2 (Key); the maker reports again with that work", and `next` gives the
  decider `work recheck r3`. In the test, the maker merges the new commit, and t1 is Accepted
  again.
- F2: while a need is not accepted, NEEDS says "Not all of them are accepted yet. Do not report
  until each one is; STOP and tell your parent."
- F3: `next` prints "t2 waits for t1 ... which is outside your task tree", and `waiting` prints
  "t2 ... waits for t1 ..., of another task tree".
- F4: the brief of a maker in a remade tree has an EARLIER block with the accepted results of the
  old tree, and "If one of them already does your task, report it again as it is".

**Nanda's answers to the other questions (2026-10-29).** The default decider rule and the agent
runs: Nanda asked for the case first (open). Rule growth: "The goal is the model works, so what
we need to do is to facilitate, to craft the rule is up to the apps itself" - no rule-growth
logic in the model.

**Not tested here:** checkers on subtle faults (needs Haiku runs), the cost of a remake with real
agents, rule growth (needs months of use), and an attack on the needs model (a round 6).

**Built after Nanda's answers (2026-10-29; 218 tests pass, 100 generated runs of 150 steps
clean).**
- Only Review: `checks` left Assignment and `--checks` left the CLI; a reviewer checks the rules
  that name its role. Every accept gives evidence; a line may name no rule
  (`--evidence="<where in the result> | <what you read there>"`). The decider's accept counts
  only with evidence; a reason alone decides nothing.
- No rule is checked by a person (`checkedBy: Human` is refused in config and in the engine).
  The person gives work only to medium and high roles.
- Old work after a remake is a starting point, not a result: `from: <result>` in the task or part
  file, a FROM line in the brief, the worktree starts at that commit, and a report of the
  starting point as it is, or of a commit not on top of it, is refused. `carries` is removed.
- A criticism: the high guide says to make the smallest change (one rule, else one standard);
  the work under it is checked again (test N2: `next` asks for a check, not a new result).
- Caveat: the planted-fault checkers and the live code run (sections 1 and 3) ran before these
  rules; a new live run would test them with real agents.

## 5. Agent tests after the answers of 2026-11-07

Nanda approved the three tests ("okay, test it"). They ran on the CLI with the changes of
2026-11-07 (who decides, attempts, needs, the person's acts). The scripts are in the session
scratchpad (`agent-tests/`); every verdict below was read from the stores, not from an agent's
own report.

### Test 1: subtle faults

**Method.** 16 projects (`agent-tests/t1/make.js`). Each has a long Introduction region (10
paragraphs, about 330 words) and one linter that checks four rules: no-code-proof,
no-ticket-ids, units, and agreed-facts (each fact matches `docs/facts.md`). A scripted maker
reported the region as r1; a fresh Haiku agent got only the printed prompt and the skill path.
Ten items have one fault (S7 and S9 have two), each in one clause deep in the text; six are
clean near-misses (a date in another format, a merchant id, a derived count with its unit). The
first build had two items that were not clean (a sentence not in the facts, and a new fact in
C2); they were fixed before any agent ran. n = 1 per item.

| Item | Planted | Decision (store) | Verdict |
|---|---|---|---|
| S1 | "abc-2964" in lower case, paragraph 6 | reject, no-ticket-ids | caught |
| S2 | "change 9f8e7d6" (a short commit hash), paragraph 9 | reject, no-code-proof | caught |
| S3 | "(export_job.go:212)", paragraph 5 | reject, no-code-proof | caught |
| S4 | "as said in the report-ops thread", paragraph 7 | reject, no-ticket-ids | caught |
| S5 | "about 40" with no unit, paragraph 4 | reject, units | caught |
| S6 | "ran three times" (the facts say twice), paragraph 1 | reject, agreed-facts | caught |
| S7 | "the other 312" with no unit, and "since PAY-881" | reject, units and no-ticket-ids (and agreed-facts for PAY-881) | caught |
| S8 | "two merchants were hit" (the facts say one), paragraph 8 | reject, agreed-facts | caught |
| S9 | "about 500k for each run" (no unit, not a fact) | reject, units and agreed-facts | caught |
| S10 | "10:00 UTC" (the facts say 09:00 UTC), paragraph 7 | reject, agreed-facts | caught |
| C1-C6 | clean | accept, evidence for all four rules | right |

- Faults: 10 of 10 caught, each with the right rule, also with four rules for one checker and a
  fault in one clause of a long region. The extra point on S7 is right: the ticket id is not an
  agreed fact either.
- Clean items: 6 of 6 accepted, with evidence that counts for each rule; 0 false rejects.
- Cost: 16 Haiku agents, about 58k to 61k tokens each (about 960k in all), 5 to 7 tool uses
  each.
- Friction: four agents said that `work` is not on the PATH; each one ran
  `bun <repo>/bin/work.js`, as the skill says, with no refusal.

**What this shows, and what not.** Cheap Haiku checkers find small faults deep in a region of
this size, with four rules each, and reject no clean near-miss. It does not show the rate for
regions many times longer, or for faults that need judgment (a weak claim, a missing step), and
n = 1 per item.

### Test 2: a live remake after a criticism

**Method.** One project (`agent-tests/t2/make.js`): a Sonnet region lead, Haiku writers and
linters, and an Opus architect. The direction has `approvedBy: { order: [architect, Nanda] }`, so
the architect checks each new version before the person approves it (Nanda's first reading of "Sol
checks again after my revision"; it runs only after a criticism). Each agent got only its printed
prompt and the skill path; the lead and the architect also got the sentence of section 3 (they
cannot start subagents, so they wrote each child's command and I started it). The test person was
me, through a script that gives a person command its terminal (`agent-tests/person.js`): the
criticism, the revise, and the approve are mine, not Nanda's. That is a limit of this run.

**What happened** (every step read from the store and the log):
1. The writer reported r1. A fresh linter rejected it for a real fact error ("their pod"; the
   facts say "the pod"): a fault, attempt 1 of 2. The writer fixed it as r2; the linter and the
   lead accepted it, and t1 was accepted.
2. The test person criticised r2 after its decider accepted it: "the first paragraph explains how
   the export works; the story must start with what happened to M-104". The smallest change was
   one rule in the standard intro-story: "The first paragraph says what happened, to whom, and
   when; the explanation comes after it" (checked by the linter).
3. The approve was refused: "TSD writing v2 waits for the accept of architect". The architect's
   `work next` showed the review; it read the version and accepted it as precise ("a linter gets
   the same answer each time"). Then the approve passed.
4. r2 was made under the old version, and the person's criticism is not a fault, so the writer
   started again at attempt 1 of 2 (the reset). The writer moved the story first (r3). A fresh
   linter rejected r3 with the new rule: the first paragraph still gave the cause. The linter said
   itself that a looser reading would pass. A fault: attempt 1 of 2 again.
5. The writer moved the cause to the second paragraph (r4); the linter and the lead accepted it.
   `work status` showed "attempts 1/2": only r3 counts.

**Cost.** 1 Sonnet lead (10 turns, its context grew from about 58k to 74k tokens), 1 Opus
architect (about 82k tokens, 19 tool uses), 8 Haiku agents (4 writers and 4 linters, 58k to 62k
each, about 484k). The person's acts during the run: 4 (the criticism, the revise, the assign of
the architect, the approve).

**What it shows.** The new rules work with real agents: the person criticises only after the
decider; the approve waits for the architect in its order; the criticism and the old version use
no attempt; only faults count. It also shows the risk that Nanda named: the architect judged the
new rule precise, and a fresh Haiku still found a second reading. The fix cost one more attempt,
not a new round.

**What it does not show.** The criticised result itself is rejected, so it is always made again;
the "only a check" path is for other accepted work under the changed direction, and this project
had one region, so that path did not run live (the CLI tests cover it). `decide` (Or, And, Order
on results) did not run live.

**Found, and fixed the same day:**
- After the first fault, the lead finished the writer and assigned a new one (a new round with
  fresh attempts) instead of giving the same command again: the step "if you do not have its
  token" read as a choice. It now says that the token is the one that assign printed, and that a
  finish and a new assign start a new round, only for a lost token. (In the run, my message to the
  lead also said that it may give the same command again.)
- The architect's `work next` still asked for a direction change while @2, which answers it,
  waited for approval. Now the step names the waiting version and gives no second revise.

**Found, open:**
- The CLI takes an unknown flag with no refusal (a linter passed `--evidence-note=ignored`; the
  review counted only its real evidence).
- The checker step "give a new subagent the command of a3" does not say that the same assignment
  checks each new result; the lead worked it out.

### Test 3: the attack round

**Method.** Two Opus agents read the code and attacked it in their own folders, with one shared
brief (`agent-tests/t3/BRIEF.md`): attacker A took the rules of 2026-11-07 (who decides, the
person's acts, attempts, needs); attacker B took the older rules. Each finding came as a test
that fails while the fault is there. I ran every test again before I counted it (23 tests, all
failing for the reason given). The tests are now in the repository as `test/round6-*.test.js`,
each with the behaviour that fixes it. Cost: attacker A about 240k tokens (51 tool uses),
attacker B about 262k (33 tool uses).

**Held.** No path let an act count for the person: an accept or an early reject by relay or at
the terminal, a settle with evidence, a waive, a person in a role, a decider out of turn, a role
that a decide entry does not name. Identity, evidence, and region checks held as before.

**Found: 18 faults (after two pairs of duplicates were merged), all fixed the same day.**

Work that could pass with no check, or start too early:
1. An agent's remake could drop the directions and the context of a task (`directions: []`), so
   its work passed with no checker. Now an agent's remake keeps them; only the person changes
   them. A remake file that does not name needs, directions, or context keeps those of the old
   task.
2. A direction change that adds a standard for another region answered the person's Reject of
   t1, and t1 was accepted again on the same work. Now a change answers a Reject only when it
   says something new to that task.
3. For code, the "new work" checks compared commit ids: an amended commit with the same files,
   or an empty commit on main, passed as new work. Now the digest of a commit is its git tree,
   and a commit with the same files as its merge base is refused.
4. A base that git cannot read made the base check pass (any exit code that was not 0 meant
   "not on the base"). Now the report is refused with the reason.
5. `task open` dropped `from:`, so a maker could report the starting point as new work.
6. A decide entry could name a role two times, so one accept met both items. Now `init` (and
   the engine) refuse it.
7. A part of a split did not wait for what its task waited for, and a remake dropped the needs
   of the old task. Now both keep them.
8. Two parts with one name were taken, so `after:` named only one of them. Now refused.
9. A settled raise made an unreviewed result use no attempt, so a maker could report with no
   end. A settle is not a review of the work.

Work that stopped with no next step:
10. A question or a Raise to an assignment that finished could never be answered. Now it goes up
    to the nearest open assignment above, else to the owner, when that assignment finishes.
11. A split of a task with a region made parts that could never report (each part has the
    region of its task). Now `work next` offers a medium role for a task with a region, and such
    a split is refused with a next step that works.
12. With `order` or `and`, a decider that is the parent of the lead saw no "decide" step.
13. `approvedBy` with the person before another item could never be met (the approve is the last
    accept). Now `init` refuses it.
14. A version review before its turn in `approvedBy` was stored and counted for nothing. Now it is
    refused, as a decide before its turn.
15. A gate whose rule a change removed made a stored report print "refused". Now the gate checks
    only its rules in force, and it does not run when none is.

The rest:
16. After a reset, the next end of a round asked the parent no new question.
17. The person's waive was refused with a wrong reason ("never from the maker"). A waiver is a
    decider's accept with less evidence, and the person accepts no result, so the refusal now
    says that, and the person's help lists no waive.
18. (merged with 10) The same dead end, reached when the person finishes the lead.

Three of the fixes follow from earlier rulings, not from Nanda's words, so Nanda can change them:
the person gives no waiver (1 and 17 come from "the person accepts no result"); an agent's
remake keeps the directions and the context (only the direction owner changes directions); a task
with a region is not split (a region is one task's work).

**Checks after the fixes.** 261 CLI tests pass; 100 generated runs of 150 steps found no fault.

**Open.** Nobody has attacked these fixes. The two open items of Test 2 stay (unknown flags; the
checker step wording).

### Test 4: the second attack round (2026-11-07, Nanda: "#1 yes")

**Method.** As Test 3, on all fixes of round 6 and of the open items (brief
`agent-tests/t4/BRIEF.md`): attacker C took the engine rules, attacker D the CLI and git. I ran
every test again before I counted it (30 tests, all failing for the reason given). They are in
the repository as `test/round7-*.test.js`. Cost: C about 284k tokens (51 tool uses), D about 230k
(44 tool uses).

**Held.** Again no path let an act count for the person (accept, early reject, relayed acts,
settle, waive), and no decider could act out of turn.

**Found: 21 faults, all fixed.** The worst first:
- A change that is undone (@3 the same as @1) let the decider's accept from before the person's
  criticism of the task count again. Now a decider's accept counts only after the latest Reject of
  its task. A word-for-word copy of a standard said "something new"; standards now compare by
  what they say.
- An agent's remake could drop the needs, the rounds left, and the workspace (and with it the
  base). Now it keeps them; it may add a need.
- For code: a rebase of rejected work, another task's commit, an orphan commit, and a workspace
  with no base passed as new work. Now a commit's work is its patch against its merge base
  (`git patch-id`), a commit that is another task's work is refused, and a commit needs a base
  that it shares history with. The same-files check ignores renames (`--no-renames`) and finds the
  other task's base by its path.
- Results that a gate accepted but nobody decided used no attempt. Now a result is an attempt
  until its deciders decide it, or a recheck or a criticism ends it.
- Dead ends: `order [architect, lead]` (the lead could not give the evidence for its own rule
  before its turn: now it can, and decides again at its turn); a decider that nobody plays (now
  `waiting` names the assign); the suggester of a version (now it is not asked to review its own
  version, and `waiting` names a reviewer outside its tree); a question to a finished assignment
  (now refused); a decider's settle of a Raise to another assignment (a bug: now allowed).
- The rest: approvedBy that can never be met (a low role, a person who is not the owner: now
  refused at init); a reset that reopened a replaced maker (a new maker now ends the makers
  before it); two questions for one end of a round; a split of a task with a region, and regions
  that nest (now refused); flags checked for each act, and a broken flag refused; the person's
  answer after a new lead (now any lead's question about the task reaches its low maker).

### Test 5: a live remake with two regions (2026-11-07, Nanda: "#1 yes")

**Method.** One project (`agent-tests/t5/make.js`): the test person split one TSD into the
Introduction and the Design; one Sonnet region lead ran both parts; each writer result needed the
lead's accept and then the Opus architect's (`decide: order [region-lead, architect]`); the
direction had `approvedBy: { order: [architect, Nanda] }`. The person's acts were mine, through
`person.js`, as in Test 2.

**What happened** (read from the store):
1. Two Haiku writers wrote the regions (one after the other: they edit one file), two Haiku
   linters accepted them, the lead accepted both, and then the architect accepted both. `decide`
   with an order worked live. One Haiku linter stopped after its brief and needed one message;
   the other agents did their work from the printed prompt.
2. The test person criticised the Introduction (its third paragraph tells four things) and
   suggested one rule for every region: "Each paragraph says one thing". The architect REJECTED
   that version: two linters could read "one thing" in two ways on the very paragraph that caused
   the change. It proposed a more precise rule (one question of the reader for each paragraph,
   with four example questions). The test person suggested that rule as @3; the architect
   accepted it; the person approved it.
3. The Introduction was rejected by the person, so it was made again (attempt 1 of 2 again: the
   criticism and the old version used no attempt). The accepted Design got a CHECK first, not new
   work: a fresh linter checked the one new rule and accepted it, and the lead accepted again.
4. The architect, deciding after the lead, rejected both results with the precise rule: one
   paragraph of each still answered two of the named questions. Both Haiku linters had read the
   rule more loosely.

**Stopped there** (the run was over its estimate): the last two fixes were not made.

**Cost.** About 9 Haiku runs (about 540k), 1 Sonnet lead (13 turns), 1 Opus architect (6 turns,
its context from about 91k to 138k): more than the 600k estimate.

**What it shows.** Both readings of Nanda's "Sol checks again" worked live: the architect's review
of the version caught a rule that was not precise, and the architect's decide after the lead
caught what the cheap checks missed. The other region's work got a check first, and needed a fix
only because a decider found a fault. Even the precise rule was read in two ways; the order of
deciders, not the words, found the faults.

**Found:** two makers of one document file can overwrite each other on disk before either
reports (open; now each brief names the other maker); a Haiku stopped after the brief (the
printed prompt now ends "and do what the brief says"); no command showed the reason of a version
review (now `direction show` prints it); `next` of the architect offered "run t2 with a medium
role" while a1 ran it (now any open medium of the tree counts); and the lead saw "nothing is
ready" while its results waited for the architect (now `next` says what they wait for).

### Test 6: the third attack round (2026-11-08, Nanda: "attack first if round 7 is the latest round")

**Method.** As Test 4, on the fixes of round 7 and on the file queue of 2026-11-08 (brief
`agent-tests/t6/BRIEF.md`, code at commit 1f1aa8d, read-only; the hash of the work folder was the
same before and after): attacker E took the engine rules, attacker F the CLI, git, and the file
queue. I ran every test again before I counted it (27 tests, all failing for the reason given).
They are in the repository as `test/round8-*.test.js`; where a fix refuses earlier than the test
expected (at task open, at the revise, at the split, at the assign), the test now expects that
refusal. Cost: E about 312k tokens (73 tool uses), F about 268k (79 tool uses), about 580k in all,
over the estimate of 500k.

**Held.** No path let an act count for the person. A decider's early accept does not count, and
the decider is asked again at its turn. A remake while the old maker holds a file tells the old
lead to finish it. An `after:` part cannot be assigned before its need is accepted. The queue
order is total (only earlier assigns count), so the queue alone has no cycle. A new maker of the
holder's task ends the old maker only when the old maker has no attempts left. Flags are refused
for every command. Two code makers on one repo do not wait, and the report checks their files.
`..` and absolute paths are refused at task open. C-A1, C-A2, C-A3, C-C1, C-C2, and the remake
needs (with cycles through a sibling and through the parent) held.

**Found: 26 faults, all fixed.** The worst first:
- An agent answered the person's point with a change that said the same: the same rules in
  another order, the same "when" with its keys in another order, or a rule that supersedes itself
  (then the agent closed the task). Now standards compare by what they say in any order, a rule
  does not supersede itself, and a point on a rule is answered only when no rule with those words
  stays.
- A second decide entry for one maker was dropped with no message (now refused at init). A later
  decider in an order rejected before its turn, with a point that named no rule, and so ended the
  maker's round (now only a check of its own rules may come before its turn). An agent's split
  gave a part more rounds than its task had left, and each agent's remake gave one more round (now
  an agent keeps only the rounds that are left).
- A region report changed an accepted region beside it, and a heading made after the split put
  one region inside another (now a report keeps every other region of its file, and nesting is
  checked at the report). One file had two names (`./docs/tsd.md`, `docs//tsd.md`, a link, an end
  slash, another case), so two makers held it, and one repo had two names (`app`, `./app`), so the
  checks of copied work and of the same files passed (now a workspace path is its one real name).
  A task with no workspace let its maker write a file outside the queue (now refused at the
  assign, and at the report).
- Dead ends: a question to a maker that a new maker replaced (now it goes up); a version that its
  reviewer rejected still "waited for" that reviewer (now the lines say it is rejected, and the
  suggester revises again); a reviewer named in another tree that is never told (now only one that
  follows the direction); a low decider that only the person was told to assign (now the lead's
  step); a maker that holds a file and cannot report, after a split or a criticism of a part it
  runs after (now the parent is told to finish it).
- The rest: the person's criticism used the maker's attempt (now a result that was decided once
  uses none); an agent's remake dropped the verify command; `git patch-id` dropped white space, so
  an indent that was the fix was "nothing changed" (now `--verbatim`); a coloured or external diff
  gave no patch-id (now one fixed diff form, and no patch-id is refused).

Also fixed: `waiting` called a part of the same tree "of another task tree". Not fixed (listed in
DESIGN section 0): after a reset of attempts, the end-of-round choices line still offers an assign
that is refused; the same `next` prints the right redo step. Not a finding, as the brief says: a
parent's finish of a holder whose subagent still runs starts the next maker (the parent's own act).

### Test 7: the fourth attack round (2026-11-08, Nanda: "I want it")

**Method.** As Test 6, on the evaluation (commit 47f05b5) and the round-8 fixes (brief
`agent-tests/t7/BRIEF.md`; the hash of the work folder was the same before and after): attacker G
took the engine, attacker H the CLI and what agents and the person see. I ran every test again
before I counted it (30 tests, all failing for the reason given; some faults overlap). They are in
the repository as `test/round9-*.test.js`. Cost: G about 319k tokens (83 tool uses), H about 340k
(102 tool uses), about 660k in all, over the estimate of 500k to 600k.

**Held.** A medium role, a high role outside the tree, and an agent shell cannot evaluate or accept
an evaluation. Before the evaluation, nothing answers the person's Reject, and an agent's split and
remake are refused. A brief, a report, and a new maker are refused during the stop. A relayed
Reject of the person stops the task at once. Rules in another order compare as the same. The paths
through `./`, `//`, an end slash, a link, or another case of a path that exists are refused. The
file queue, the region checks, and the patch-id for mode changes held.

**Found: 29 faults, all fixed.** The worst first:
- A decider's accept after the person's Reject of a task made the task accepted with no
  evaluation (the Reject of the task was no blocker of an earlier result).
- A person who is not the owner accepted, or wrote, the owner's evaluation; an agent wrote its
  evaluation again at the level task, and so skipped the person's accept of the first one.
- A version that its approvedBy reviewer rejected became official through a second reviewer.
- A new maker given before the review of the last try skipped the evaluation; a maker finished
  after a fault let a new maker start with full tries on the same inputs; a recheck with nothing
  changed outside gave endless tries; a standard removed and added back, a need with the same work
  again, and a remake from the same file each counted as new inputs.
- An agent closed a task that waited for an evaluation; two names that differ only in case were one
  file on this Mac; a maker whose output named its file got no workspace check; a binary change got
  another patch-id after `core.abbrev` changed.
- Dead ends and wrong steps in `next` and `waiting` after an evaluation (a second revise, a remake
  after the split, a split of a region task, an approve of no direction, the person not told).
