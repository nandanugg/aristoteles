# Thought test, round 5: findings and what was done

Round 5 ran on 2026-10-28 against draft 4 (177 tests pass), with two Opus agents: an invariant
attacker (ids R5-1 to R5-13) and a flows walker (ids R5-F1 to R5-F11). Both reports are copied
below as the agents wrote them. Their scripts and stores were in the session scratchpad
(round5/invariants/ and round5/flows/), which can be cleared. No file in work/ changed during the
round (the hashes of all 25 files match). Nanda saw the list, then asked for the fix pass.

## What was done

Each fix has a test in `test/round5.test.js` (22 tests; the A and B tests failed on the code
before the fix). After the fix, the attacker's scripts s1-s15, s17, s18 and s21c ran again
against the fixed CLI; the line after each id is what the CLI printed then.

- **R5-1 (A)** `findRule` reads only the official version of each direction.
  s9b: `refused: repeatable is checked by a person; only the person waives it` (also with the
  suggestion in place).
- **R5-F1 (A)**, the closed-parts dead end. The region check skips closed parts; their rules
  check the join. A closed task takes no part (`t2 is closed; a closed task takes no parts`,
  s21c) and no recheck. s3: `r3 reported on t1`. s18: the join that fixes a closed part's
  rejected text is reported.
- **R5-2 (B)** `Task.close` (engine): a task closes after its parts, and an agent's close looks
  for the person's open Reject in the whole tree. s4: `refused: v1.1 is the person's open Reject
  on t3`, then `refused: t2 has open parts (t3); close them first`.
- **R5-3 (B)** with **R5-F6**: after a direction change, each rule of a new or replaced
  standard needs evidence again from its own checker, from an accept made while that standard
  was in force; a change with nothing to check needs one accept by a role that decides. s15:
  after the lead's bare accept, `t1 · In review`, and `next` asks Nanda to check repeatable.
  s22 (the code form): the change replaced the gate's standard, so `next` prints `gate runs on
  the next report of t1; a recheck asks for one`, and after the lead's bare accept, `t1 · In
  review` (`checked again under fixes@2: suite-passes (gate)`).
- **R4-2 regression (s20)** still holds after the close changes: `refused: TSD writing v2 removes
  "A reviewer can repeat the problem without the design", which a person checks`.
- **R5-4 (B)** a part with `workspace: []` is refused. s5: `refused: part Design has an empty
  workspace`.
- **R5-5 (B)** one region check at every report (regions of other open tasks inside the
  output, and the whole file of a direct part). New design rule at the split: parts that share
  a file each own a region, or none does. s6: `refused: the parts in docs/tsd.md are mixed`.
  s14: `refused: docs/tsd.md#design changes the region data-model of t3 (Data model) after r1
  was accepted`.
- **R5-6 (B)** the first brief records each workspace file and each region (closes R4-8 too).
  s1 and s2: `refused: ... is the same as before any work on t1`.
- **R5-7 (B)** rejected work is refused while a redo is open too. s7: `refused:
  docs/tsd.md#introduction is the same as r1, which was rejected`.
- **R5-F2 (B)** `Task.split` (engine): an agent does not split past the person's open point with
  no rule; the CLI prints the raise with the person's split command.
- **R5-8 (C)** a replaced standard's kept rules count in the id check; one version has no
  repeated id. s8: `refused: the rule id "no-ticket-ids" is already used`.
- **R5-9 (C)** `Review.decide` (engine): a Reject of a task names no rule, also through a
  relay. s10: `refused: Nanda could not reject t1 now: a Reject of a task names no rule`.
- **R5-F5 (C)** `Review.decide`: a point names a rule of the reviewed task; else it names the
  part that has the rule.
- **R5-10 (C)** an approve that takes a rule off the task answers the points on that rule. s11:
  the approve of tsd-writing@3 with `--answers=v1.1` passes, and `r2 has no blockers; t1 is
  Accepted`.
- **R5-11 (C)** one checker check for init and revise (`checkerProblem` in config.js). s13:
  `refused: rule exact-dates is checked by architect, which reviews or approves no role that
  does the work`. `next` starts only its own children.
- **R5-F3 (C)** `waiting` shows the person's own split as an answer to their no-rule point.
- **R5-F7 (C)** the brief of a maker with no attempts left takes no claim and prints STOP. Open:
  a recheck still uses one attempt (a policy choice).
- **R5-F8 (C)** `next` prints `if you do not have its token: work finish ..., then work assign`.
- **R5-F9 (C)** `waiting`, and the output of an approve and of its ratify, name a task that no
  open assignment works on.
- **R5-F10 (C)** an accepted result names its output. Open: the step that puts a commit on its
  base (Nanda decides whether that is the CLI's job).
- **R5-12 / R5-F4 (D, or A by invariant 7)** the log prints `task.split t1 answering v1`, and the
  blockers print `the split of t1 answered it` (s12).
- **R5-13 (D)** a new file in `directions/` gets `the person deletes ...` (s17); `--answers` with
  a direction review gets `v1 is not a Reject point or a challenge` (s17); the ratify of a
  relayed approve shows the person-checked rules that leave one task, and the old results
  (also FW-14). The low join refusal now gives a raise line and says accepted or reported.
- **R5-F11 (D)** a missing token or `--file` says what is missing; a split with no `--file`
  prints an example; verify says that it runs in the project folder; a reviewer sees the base
  of a commit; `resume` lists the answers after the checkpoint.

Three rules of this pass are design decisions that Nanda has not seen yet; each has a test and
can be reverted:

1. Parts that share a file each own a region of it, or none does (a mixed split is refused).
2. A task closes after its parts, for the person too. So the person's close of a stuck task with
   parts goes part by part, from the bottom.
3. A closed part owns nothing: the join may change its text, and the part's rules check the join.
   The flows walker listed "a join that changes the region of a closed part is refused" as a step
   with no friction; this pass reverses it on purpose, because R5-F1 and s18 need it.

Three earlier tests changed with the design: I-N11 (round 3) and R4-10 now expect the mixed
split to be refused at the split, and FW-6 now expects no gate rerun after a change that has no
rule for the gate. Two e2e snapshots changed in one line each (the verify wording); they were
updated with `bun test -u` after that diff was read.

A live Haiku writer, given only its one command, read the brief, wrote the region, ran verify,
and reported r1; the store shows one brief and one report, and nothing in the brief was
unclear to it.

Not fixed in this pass (DESIGN section 0 lists them): R4-5 and FW-7, R4-12, FW-8, FW-3, FW-10 to
FW-13, FW-15, parts in one file with no region, and the four migration limits. Nobody has
attacked the round-5 fixes yet.

---

# Round 5: invariant attacker report

The runs are in `<scratch>/round5/invariants/scripts/`. These are `s1.sh` to `s23.sh`, `s5b.mjs`, `s22.mjs`, `lib.sh` and `mk.mjs`. Each script makes its own project in `invariants/pN/` and prints each command with its output.
- **Helpers:** in `lib.sh`, `ag` runs the agent as `cd <dir> && bun work/bin/work.js ... </dev/null`, and `pe` runs the person through `person.mjs`.
- **Projects:** `mk.mjs` makes the TSD task that has no region ("The TSD", workspace docs/tsd.md). `setup.mjs` makes the fixture task t1, "The Introduction", which has region introduction, with the lead a1.
- **Grant:** the grant is always `(person) work grant --act=change --on=<ids> --to=architect --until=2026-12-31T00:00:00Z`.
- **Tokens:** `<arch>`, `<lead>`, `<w>` and `<l>` are the tokens that `work assign` printed.

## Part 1: the round-4 fixes and the split rules

| Target | Result | Command that shows it |
|---|---|---|
| R4-1 split --review | rules hold; the record half is broken | Rules: a split refuses a Reject of a part's result with "is not about t1" (s21c.sh). Record: after `task split <arch> t1 --file=parts.yaml --review=v1`, the log shows only `task.split t1 -> t2, t3` with no "answering". `blockers r1` says "a direction change answered it, so the next result follows the new version" (s12.sh). See R5-12. |
| R4-2 approve with closed parts | holds | I closed a part with region introduction, at one level and as a part of a part. `direction approve <arch> tsd-writing@2` (which moves intro-story to region appendix) refuses with "removes ... which a person checks" (s20.sh). |
| R4-3 closing a part that has the person's Reject | broken | `task close <arch> t3` is refused. `task close <arch> t2`, the parent of t3, passes, and t1 becomes Accepted (s4.sh). See R5-2. |
| R4-4 approve --answers | holds, but makes dead ends | The tree check and the `--breaks` check hold. The `--breaks` refusal (in split too) leaves two kinds of point that no act can close (s10.sh, s11.sh). See R5-9 and R5-10. A direction-review id in `--answers` leaks a JS error (s17.sh). |
| R4-6 one rule id in two directions | broken (next door) | One revise (replace + add) gives one direction two `no-ticket-ids` rules (s8.sh). See R5-8. |
| R4-7 a part keeps its workspace base | broken | A part with `workspace: []` has no workspace. It reports `docs/facts.md#dedupe` (s5.sh, agent split). In the code fixture it reports `app@<head of main>`, and the gate accepts it (s5b.mjs). See R5-4. |
| R4-9 checkedBy that names no role | holds; the next door is open | `checkedBy: lintr` is refused. `checkedBy: architect` is accepted. That is a real role that never covers the maker, so the rule can never pass (s13.sh). See R5-11. |
| R4-10 a region that another task owns | broken | A mid-level join reports the whole file and rewrites its uncle's region (s6.sh). A `## Design` region rewrites the `### Data model` region of a sibling (s14.sh). See R5-5. |
| R4-11 equal to earlier rejected work | broken | After `recheck <lead> r2`, the maker reports the text of the rejected r1 again, and no refusal comes (s7.sh). See R5-7. |
| R4-13 a new file in directions/ | holds; the next lines are wrong | The message names "(new, not in the store: delete it)". The next lines say "the person restores it" and "work config restore". Restore leaves the file, and the refusal stays (s17.sh). See R5-13. |
| R4-14 a low checker briefed before a report | holds | REVIEW says "nothing is reported yet". A later `review <l> r1` is refused with "your brief named no result" (s21.sh). |
| FW-1 a relay after an official version | holds | Relays work after a ratified approve, after `config apply`, and after a second approve (s16.sh). |
| FW-2 next after accepted parts; a second split | holds, but leads to a dead end | A split is refused while t2 is accepted. The engine message says "close the parts first". If the architect does that and splits again, the join can never be reported (s3.sh). See "Closed parts, then split again" below. |
| FW-4 a join is not untouched work | broken | A split whose only part is closed at once turns off the untouched check. The join then reports the untouched file, and it passes (s2.sh). See R5-6. |
| FW-6 a program is not given as a checker | holds | After a direction change, `next` prints `work recheck`, not `--role=gate` (s22.mjs). But R5-3 shows that a bare accept skips that recheck. |
| Split (a): no split while parts are open | holds | With an open or accepted part, the split refuses with "t1 already has parts" (s3.sh). Note: a split of a CLOSED task passes and makes an orphan part (s21c.sh: `task split <arch> t2` after t2 is closed). |
| Split (b): only its own task, only a point with no rule | holds | A Reject of a part's result, answered through the parent's split, is refused with "is not about t1" (s21c.sh). A point with a rule is refused (round-4 test, and s10.sh). |
| Split (c): the person's Reject | holds | The person's own split answers that person's Reject (s21.sh). An agent's split does not (I-N10). |
| Closed parts, then split again | **hole, not intended** | **Rules through rulesOf:** kept (s20.sh). **The person's points:** kept when the agent closes the part itself (R4-3). They are dropped when the agent closes the part's parent (s4.sh, R5-2). **Workspace base:** kept, but not with `workspace: []` (R5-4). **The join:** a dead end. The join check keeps the latest result of every part unchanged, and closed and rejected parts are included. So the new part's region can never be joined: "the join changed r1 of t2 (Design) after it was accepted" (s3.sh). If a closed part has a rejected result, the join may not fix the rejected text, and the refusal still says "after it was accepted" (s18.sh). round-4.md lists this half under R4-12, but DESIGN section 0 lists only the code join form as open. Now the engine's new message "close the parts first" sends agents into this dead end. |

## Part 2: the seven invariants

| Invariant | Entry points tried | Result |
|---|---|---|
| 1. Only the person acts as the person | An agent's evidence on a person rule. An agent's settle of a raise to the person. Relayed accept, answer and approve, which wait for ratify. Ratify, grant, config apply and restore. `role fit --as` by a medium, which is refused. A split that answers the person's Reject. A close of a part with the person's Reject. (s16, s19, s20, s21, s23) | **holds**. No agent made a person act count. But the record can show an agent's waiver of a person-checked rule (R5-1). |
| 2. A rule passes only with evidence from its checker, on reported, unchanged, new work | Untouched work with a region form that is not filled. A join whose part is closed. A part with `workspace: []`. A recheck followed by a rejected twin. The old-version item after a direction change. (s1, s2, s5, s5b, s7, s15, s22) | **broken** (R5-3, R5-4, R5-6, R5-7) |
| 3. A point closes only by changed work with evidence, or by a change that lists it | Close of a part, of a parent part, and of the root. Split --review. Approve --answers. A relayed Reject of a task. A rule that a change removes. (s4, s10, s11, s12, s21c) | **broken** (R5-2). Two kinds of point can never close (R5-9, R5-10). |
| 4. A direction change: review, approval, person rules, unique ids | Agent approve with closed parts, at one and two levels. A review from inside the tree. A relayed approve. A revise that replaces and adds. A checkedBy role that cannot check. (s8, s13, s20, s23) | **broken**: rule ids are not unique (R5-8). The person rules hold. |
| 5. Every agent act: an open assignment, a claim, ids in its tree | answer, recheck, raise --result, release, finish, checkpoint, resume. Relayed ask, comment and accept. review --settles, waive, assign. A report of a file from another tree. (s19) | **holds**. Only the known R4-5 item (`--made-from=r<n>` has no tree check) is open. |
| 6. A report is new work, in its own workspace, region and repo; joins; the rules of closed parts | `workspace: []`. The whole-file join of a mid-level part. Nested headings. An untouched region. The rules of closed parts. (s1, s2, s5, s6, s14, s20) | **broken** (R5-4, R5-5, R5-6). The rules of closed parts hold. |
| 7. The record is true, and each refusal's next line fits the tier | Log and blockers after a split answer. Waiting after an ancestor close. A waiver through a shadowed rule. The join refusal for a closed or rejected part. Next after a rule that cannot be checked. A new direction file. The ratify of a `when` change. (s3, s4, s9b, s12, s13, s17, s18, s23) | **broken** (R5-1, R5-12, R5-13; also parts of R5-2, R5-9 and R5-11) |

## Part 3: new findings, most severe first

### R5-1 (A for the record; C for the effect) A suggested version that nobody approves takes over a rule id
**Cause:** `findRule` searches every version, newest first, including Suggested and rejected versions. So a high agent's suggestion changes what an id means for evidence, `--breaks`, `--checks` and `waive`.

**Sequence (s9b.sh):**
```
bun setup.mjs p9b ; work brief <lead>
(person) grant change on tsd-writing,t1 to architect ; (person) work assign t1 --role=architect ; work brief <arch>
work assign <lead> t1 --role=writer ; work brief <w> ; (edit docs/tsd.md) ; work report <w> --output=docs/tsd.md#introduction  -> r1
work waive <lead> r1 --rules=repeatable --reason="urgent" --until=2026-10-29T00:00:00Z
   -> refused: repeatable is checked by a person; only the person waives it
edit.yaml: replace intro-story with the same standard, but repeatable has checkedBy: linter
work direction revise <arch> tsd-writing --file=edit.yaml     -> tsd-writing@2 suggested (never reviewed or approved)
work waive <lead> r1 --rules=repeatable --reason="urgent, the person is away" --until=2026-10-29T00:00:00Z
   -> n1: repeatable not checked on r1 until 2026-10-29T00:00:00Z
work waiting --for=Nanda   -> "n1 waives repeatable on r1 until 2026-10-29T00:00:00Z (a1)"
```

**Other runs of the same cause:**
- s9.sh: a rejected suggestion makes no-ticket-ids Human. The log shows "evidence for no-code-proof, no-ticket-ids" from the linter, but `blockers r1` still says "no evidence on r1 for no-ticket-ids".
- s21.sh: `work assign <lead> t2 --role=linter --checks=repeatable` passes. The linter's brief shows "CHECKS repeatable ... (linter)". The person's `review r2 reject --breaks=repeatable` binds to the suggested rule.

**What happened:** the record says that an agent waived a person-checked rule, and that the linter checked its rules. But the engine used different rule objects, so none of it counts. While the suggestion is the newest version, nobody can check the real rule.

**What should happen:** an id names the rule in the current official version. A suggestion changes nothing until it becomes official.

**Fix:** let `findRule` look only in the current official version of each direction (or in the task's snapshot). Read Suggested and Replaced versions only through `direction show <id>@<n>`.

### R5-2 (B) Closing the parent of a part drops the person's open Reject, and the root is accepted
**Cause:** the R4-3 check looks only at Rejects of the closed task and its results. It does not look at Rejects in the task's parts.

**Sequence (s4.sh):**
```
bun mk.mjs p4 ; (person) grant change on t1 to architect ; (person) work assign t1 --role=architect ; work brief <arch>
work task split <arch> t1 --file=parts.yaml    (Body)                   -> t2
work task split <arch> t2 --file=sub.yaml      (Design, region design)  -> t3
work assign <arch> t3 --role=writer ; brief ; work report <w> --output=docs/tsd.md#design  -> r1
(person) work review r1 reject --point="the design hides the double run"   -> v1.1
work task close <arch> t3 --reason="the join writes it"        -> refused (R4-3 holds here)
work task close <arch> t2 --reason="the join writes the body"  -> t2 closed.
work assign <arch> t1 --role=writer ; brief ; work report <w2> --output=docs/tsd.md  -> r2 (the same design text)
work assign <arch> t1 --role=linter ; brief ; work review <l> r2 accept --evidence=... --evidence=...
work task tree t1        -> t1 The TSD · Accepted / t2 Body · Closed / t3 Design · In review (r1 rejected)
work next <arch>         -> finish steps
work waiting --for=Nanda -> v1.1 needs a change of tsd-writing
```

**What happened:** the root is Accepted while the person's point is still open. The join contains the same design text that the person rejected.

**What should happen:** an agent's close is refused while any task under the closed task has an open Reject by the person.

**Fix:** check the whole subtree of the task in the close check (`within(r.of.task ?? r.of, task)`). Also let `taskAccepted` count open tasks under closed parts, or close the subtree together with the part.

### R5-3 (B) One bare accept by the decider clears "made under an old version" for every checker
**Cause:** `followed()` passes when any accept was made under the new version. So a decider's `accept --reason` is enough, and the linter, the person and the gate do not check again.

**Sequence (s15.sh):**
```
bun setup.mjs p15 ; writer reports r1 ; linter accepts r1 with evidence
(person) work review r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"   -> t1 Accepted
(person) work direction revise tsd-writing --file=edit.yaml   (intro-story says "... and say who paid for the mistake"; the same rules)
(person) work direction approve tsd-writing@2 --why="name the cost"
work blockers r1   -> r1 was checked under an old version of tsd-writing; it is checked again under tsd-writing@2
work next <lead>   -> check r1 again ... give a new subagent the command of a3   (no step for the person)
work brief <lead> ; work review <lead> r1 accept --reason="still fine"   -> r1 has no blockers; t1 is Accepted.
```

**Code form (s22.mjs):** `next` says "gate runs on the next report of t1; a recheck asks for one". Then `review <lead> r1 accept --reason="fine"` makes t1 Accepted, and the gate never runs under fixes@2.

**What should happen:** each checker of the changed standards checks again under the new version (DESIGN section 8).

**Fix:** in `followed()`, count only an accept under the new version that gives evidence from the right checker for the rules of the changed standards. Let `next` also list the person's check.

### R5-4 (B) A part with `workspace: []` has no workspace (next door to R4-7)
**Cause:** `checkParts` checks each listed entry, so an empty list passes. Then `[]` replaces the task's workspace.

**Sequence (s5.sh, an agent split):**
```
bun mk.mjs p5 ; (person) grant change on t1 to architect ; architect assigned and briefed
parts.yaml:  - { name: Design, text: Write the design., workspace: [] }
work task split <arch> t1 --file=parts.yaml   -> t2
work assign <arch> t2 --role=writer ; work brief <w>    (no WORK IN; the form is <file>#<region>)
work report <w> --output=docs/facts.md#dedupe           -> r1 reported on t2
```

**Code form (s5b.mjs):** CODE_YAML has no high role, so the person did this split. It goes through the same `checkParts` path as s5.sh. The part reports `app@<head of main>`, which is no new commit. The output says "gate ran on r1: accept", and t2 is Accepted. The base check needs a workspace entry, so it does not run.

**What should happen:** a part works in its task's workspace, with the same base.

**Fix:** refuse `workspace: []` in a part, or treat it as not given. Also let `report` refuse a task that has no workspace when one of its ancestors has one.

### R5-5 (B) A report can rewrite a region that another task owns (next door to R4-10)
**Cause:** R4-10 compares only the region name of a `#region` output. A whole-file output is not compared, and neither is a region whose heading holds a sub-heading.

**Sequence 1 (s6.sh, then s6b.sh):**
```
bun mk.mjs p6 ; architect splits t1 into t2 Front (no region) and t3 Design (region design); splits t2 into t4 Summary (region summary)
t3: writer reports docs/tsd.md#design (r1); linter accepts.    t4: writer reports docs/tsd.md#summary (r2); linter accepts.
work assign <arch> t2 --role=writer ; brief     (its form is docs/tsd.md, the whole file)
(edit the Design region) ; work report <j2> --output=docs/tsd.md   -> r3 reported on t2
work assign <arch> t2 --role=linter ; brief ; review <l> r3 accept ...   -> t2 Accepted
work task tree t1  -> t3 Design · Accepted (r1 changed after it was reported)
work next <arch>   -> make t1 The TSD
t1 join: work report <j1> --output=docs/tsd.md  -> refused: the join changed r1 of t3 (Design) after it was accepted
(restore the design text) ; report again         -> refused: the join changed r3 of t2 (Front) after it was accepted
```

**Sequence 2 (s14.sh):**
- `docs/tsd.md` has `## Design`, and `### Data model` is under it.
- t3 (region data-model) is accepted.
- t2 (region design) reports `docs/tsd.md#design` with a new data model, and the output is "r2 reported on t2".
- `task tree` shows "t3 Data model · Accepted (r1 changed after it was reported)".

**What happened:** one task rewrote another task's accepted region, and the checkers of that region never saw the change. The top join can never be reported. The refusal blames "the join", but that join did not make the change.

**What should happen:** a report may not change a region that another task in the tree owns.

**Fix:** at each report, compare the latest result of every other task in the tree that owns a region with the file as it is now. Include regions inside the output. Refuse a change, and name the task that owns the region.

### R5-6 (B) Untouched work passes: no untouched digest for a region form that is not filled, and none for a join whose part was closed with no work
**Sequence 1 (s1.sh).** The task has no region, so the writer's form is `docs/tsd.md#<region>`, and the first brief records no untouched output.
```
bun mk.mjs p1 ; (person) work assign t1 --role=region-lead ; brief ; work assign <lead> t1 --role=writer ; work brief <w>
work report <w> --output=docs/tsd.md#design     (the file still says "TODO")   -> r1 reported
work assign <lead> t1 --role=linter ; brief ; work review <l> r1 accept --evidence=... --evidence=...
work task show t1   -> t1 The TSD · Accepted
```

**Sequence 2 (s2.sh).** FW-4 skips the check for every task that has parts.
```
bun mk.mjs p2 ; work task split <arch> t1 --file=parts.yaml -> t2 ; work task close <arch> t2 --reason="not needed after all"
work assign <arch> t1 --role=writer ; brief ; work report <w> --output=docs/tsd.md   (unchanged file)  -> r1
work assign <arch> t1 --role=linter ; brief ; review <l> r1 accept ...   -> t1 Accepted (still "TODO", "TODO")
```

**Note:** the cause is the same as the known R4-8 (no untouched digest). The entry points are different: one workspace file, and the join skip.

**Fix:** at the first brief, record the digest of each workspace file. At report, refuse an output (a file or a region) that equals the same output in that first snapshot. Skip the check for a join only when one of its parts has an accepted result.

### R5-7 (B, low) After a recheck, the maker may report earlier rejected work again (next door to R4-11)
**Cause:** `redoOpen` turns off the rejected-twin check as well as the "same as the previous result" check.

**Sequence (s7.sh):**
```
bun setup.mjs p7 ; writer reports A ("See the chat thread ...") -> r1
review <l1> r1 reject --point="cites a chat thread" --breaks=no-ticket-ids
writer reports B -> r2 ; a new linter accepts r2 with evidence (this answers v1.1)
work recheck <lead> r2 --reason="the facts file moved"
writer reports A again: work report <w> --output=docs/tsd.md#introduction   -> r3 reported (no refusal)
a new linter accepts r3 ; work blockers r3   -> only "no evidence on r3 for repeatable (checked by person)"
```

**What should happen:** the report is refused with "r3 is the same as r1, which was rejected".

**Fix:** keep the rejected-twin refusal while a redo is open. The redo should exempt only the digest of the previous result.

### R5-8 (C; breaks invariant 4) One direction gets two rules with the same id
**Cause:** in `Direction.revise`, a rule that a replaced standard keeps (`same`) is skipped, so its id never goes into `seenIds`. An added rule can then take the same id. The approve check compares only with other directions.

**Sequence (s8.sh):**
```
bun setup.mjs p8 ; architect with change on tsd-writing,t1
edit.yaml: replace facts-not-proof (new says; the same two rules), and add standard "headings" with rule { id: no-ticket-ids, says: "No ticket ids in headings either", checkedBy: linter }
work direction revise <arch> tsd-writing --file=edit.yaml ; work direction review <lead> tsd-writing@2 accept --reason="headings matter too"
work direction approve <arch> tsd-writing@2 --why="headings"   -> official
work direction show tsd-writing   -> no-ticket-ids is listed twice
writer reports r1 ; the linter's CHECKS list no-ticket-ids twice
review <l> r1 accept --evidence="no-code-proof | ..." --evidence="no-ticket-ids | ..."
work blockers r1   -> no evidence on r1 for no-ticket-ids (checked by linter)   (for ever: the id finds only the first rule)
```

**What should happen:** each rule id is unique in the project, so the second rule is refused at revise.

**Fix:** add the ids of every rule in the new version (kept, carried and fresh) to `seenIds`. At approve, refuse a version whose own rule ids repeat.

### R5-9 (C) A Reject of a task that names a rule can never close, and a relay makes it the person's
**Cause:**
- A Reject of a task makes the task Returned, so no report is possible.
- A split refuses a point with a rule, and so does an approve.
- From the code and from s10b.sh, the only way out is the person's `task close`, which works.

**Sequence (s10.sh, s10b.sh):**
```
bun setup.mjs p10 ; work brief <lead> ; work assign <lead> t1 --role=writer
work relay <lead> Nanda reject t1 --quote="no ticket ids in this task, ever" --point="no ticket ids in this task" --breaks=no-ticket-ids --channel=chat   -> v1
work report <w> ...                                       -> refused: The Introduction is returned until a change answers it
(person) work task split t1 --file=parts.yaml --review=v1 -> refused: ... names the rule no-ticket-ids ...
(person) work direction approve tsd-writing@2 --answers=v1 -> refused: ... not a direction change
work task close <arch> t1                                 -> refused: v1.1 is the person's open Reject on t1
work next <lead>   -> "a2 is working on t1"      work waiting --for=Nanda   -> no row for v1.1
(person) work task close t1 --reason="the point cannot close"   -> t1 closed.   (the only way out)
```

**What happened:** one relayed act by an agent stopped the task. Only the person's close of the task opens it, and neither `next` nor `waiting` shows the point.

**What should happen:** a Reject of a task asks for a split or a direction change. It does not name a rule.

**Fix:** refuse `--breaks` on a Reject of a task, in `review` and in `relay reject`.

### R5-10 (C) A point whose rule a later change removes can never close
**Sequence (s11.sh, s11b.sh):**
```
bun setup.mjs p11 ; writer reports r1 with "ABC-2964" ; review <l> r1 reject --point="cites ABC-2964" --breaks=no-ticket-ids  -> v1.1
work challenge <l> no-ticket-ids --reason="the ticket id is the only name the readers know"   -> c1
(person) direction revise (facts-not-proof without no-ticket-ids) ; (person) direction approve tsd-writing@2 --answers=c1
(person) direction revise (add a standard) ; (person) direction approve tsd-writing@3 --answers=v1.1
   -> refused: "cites ABC-2964" names the rule no-ticket-ids; changed work with evidence answers it, not a direction change
writer reports r2 (changed) ; a linter's evidence for no-ticket-ids -> refused: no-ticket-ids is not in your checks
all other evidence given ; work blockers r2   -> v1.1 needs a direction change: "cites ABC-2964"
work next <lead>   -> work raise <lead> --result=r2 --reason="v1.1 needs a direction change"
```

**What happened:** `next` asks for a direction change, and every direction change is refused.

**What should happen:** when the rule leaves the task, the point on it closes.

**Fix:** in `rejectAnswered`, accept a point whose rule the new version takes off the task. Another way: let the approve that removes a rule close the open points on it.

### R5-11 (C) A revise may name a real role that can never give evidence that counts (next door to R4-9)
**Sequence (s13.sh):**
```
bun setup.mjs p13 ; architect with change on tsd-writing,t1
edit.yaml: add { id: dates, says: Dates are exact., rules: [ { id: exact-dates, says: "Every date has a day", checkedBy: architect } ] }
work direction revise <arch> ... ; work direction review <lead> tsd-writing@2 accept ... ; work direction approve <arch> tsd-writing@2 --why="dates"
writer reports r1
work review <arch> r1 accept --evidence="exact-dates | the introduction | the one date has a day"   -> accept, no effect
work review <lead> r1 accept --evidence="exact-dates | ..." ; (person) work review r1 accept --evidence="exact-dates | ..."   -> no effect
work blockers r1   -> no evidence on r1 for exact-dates (checked by architect)
work next <lead>   -> "a2 is checking r1 (claimed since ...); if its subagent stopped: work release a1.<token> a2"   (a2 is the architect, not a child of a1)
```

**What should happen:** a revise names only a checker that can give evidence that counts for the maker's results.

**Fix:**
- In revise and init, refuse a checkedBy role that does not review or approve a Do role of the tasks under the direction.
- Also refuse a program that does not list the rule in its checks.
- In `next`, name a checker only when it is a child.

### R5-12 (D; breaks invariant 7) The record half of R4-1 is not done
**Sequence (s12.sh):** run `work review <lead> r1 reject --point="too much for one region; it needs two parts"`, then `work task split <arch> t1 --file=parts.yaml --review=v1`.

**What happened:**
- `work log` shows only `task.split t1 -> t2, t3`, with no "answering v1".
- `work blockers r1` says "v1.1 rejected r1: ...; a direction change answered it, so the next result follows the new version".
- No direction changed. The same text shows after the person's own split (s21.sh).

**Why D and not A:** I rate this D, not A. The fact that the point is closed is true, and no actor is led to a wrong act. Only the mechanism has the wrong name.

**Fix:** log `answering <ids>` for `task.split`. Show "a split answered it" when the change that answers the point is a Split.

### R5-13 (D) Next lines and messages that do not fit
- **A new file in `directions/` (s17.sh):** the low next line says "... changed; the person restores it", and the medium line says "work config restore". Restore leaves the new file, so the refusal stays. Say "the person deletes directions/notes.yaml".
- **The join refusal for a closed or rejected part (s3.sh, s18.sh):** a low writer is told "change only the joins; undo the change in that part", which cannot succeed. The text also says "after it was accepted" for a result that was rejected. Give the low writer a raise line, and say "rejected" or "closed".
- **A direction-review id in `--answers` (s17.sh):** `direction approve <arch> tsd-writing@2 --answers=v1`, where v1 is a direction review, gives "refused: undefined is not an object (evaluating 'task.aiDescription')". Name the kind of id that `--answers` takes.
- **The ratify of a relayed `when` change (s23.sh):** a relayed approve moves `intro-story` to `when: { region: appendix }`. The ratify does not say "removes person-checked rules" for t1, but `repeatable` leaves t1's RULES. Show the per-task loss that `approve` already computes (`onTask`).

Yes, real holes are left beyond the limits and the wording: one false record (R5-1), six ways a rule or point passes without what it needs (R5-2 to R5-7), four dead ends (R5-8 to R5-11), and the closed-parts join dead end from Target 2.

---

# Round 5 flows walk: report

In this report, F is `<scratch>/round5/flows`.

- Each flow has its project folder, a `walk.log`, and a `tokens` file. The full tokens are in `F/<flow>/tokens`; this report uses only the ids (a1, a10, ...).
- Each branch test is in a copy of a project folder. Its commands are in the `walk.log` of that flow.
- Setup scripts:
  - `F/setup-code.mjs` (flow 1): a lead (medium), an implementer (low), a low reviewer, and a program gate that runs `bun test`.
  - `F/setup-doc.mjs` (flow 2): the harness TSD roles with the limits of DESIGN section 3. The direction adds a standard `whole-page` with `when: { join: true }` and the rule `page-decides` (checkedBy Human).
  - `round5/setup.mjs` (flow 3).
- Commands: `F/w <dir> ...` runs an agent command and `F/p <dir> [--typed=<word>] ...` runs a person command.

The three flows:
- **Flow 1 (`F/f1`), finished.** A bug fix with a proof test. A reviewer Reject with a rule point and a no-rule point. A direction change by the person. The gate. Main moved, then `work source`, a recheck, and a rebase with a real conflict. Finish.
- **Flow 2 (`F/f2`), finished.**
  - The architect split the TSD first, then a lead ran each part with a writer and a linter.
  - The person's Reject was relayed with points, then an approve was relayed and ratified. The unchanged part was checked again.
  - The join was reviewed with the whole-page rule.
  - A second Reject by the person needed a new part. The agent's split was refused, so the person split. The new part was done and joined again.
  - An accept was relayed and ratified, then finish.
- **Flow 3 (`F/f3`), reached a Reject by the person.** A writer claimed its brief and stopped half way. The lead asked the person a question and saved a checkpoint, then the pause. The person answered. A cold resume of the lead used only status, waiting, next and brief.

## Part 1: round-4 flows findings

- **FW-1 holds.** In f2, tsd-writing@2 was already official. `relay a1 Nanda accept r6 ...` gave "e83: accept r6 ... waits until Nanda runs work ratify e83", and `ratify e83` gave v13.
- **FW-2 holds.** In f2, t2 and t3 were accepted. `next a1` gave "make t1 ... work assign a1 t1 --role=writer". `task split a1 t1 --file=parts2.yaml` was refused: "t1 already has parts; split a part, or close the parts first".
- **FW-4 holds.** In f2, the join `report a10 --output=docs/tsd.md` gave "r4 reported on t1 (attempt 1 of 3)".
- **FW-5 holds.** In f1, after the reviewer Reject v2 (v2.1 breaks small-fix, v2.2 has no rule), `next a1` printed two steps:
  - "v2.2 needs a direction change first ... work raise".
  - "redo t1: give a new subagent the command of a2 (attempt 2 of 3)".
- **FW-6 holds as written.** In `F/f1-copy-fw6`, `next` after fixes@3 has no `--role=gate`. But it prints a recheck for the gate that is not necessary (R5-F6).
- **FW-9 holds.** In f1, `direction revise fixes` with no `--file` printed the template (add, replace, remove, says).
- **FW-10 is still open.** In f1, after `recheck a1 r2`, the brief of a2 says only "OPEN r2 was built on app@f5e83167b813; app is now at main". It does not name the commit to rebase (app@085b853) or a branch.
- **FW-11 is still open.** `next` still prints steps that are already done:
  - f1: after `raise a1 --result=r1` (v3), `next a1` prints the same raise again.
  - f2: after `direction revise a1 tsd-writing`, `next a1` prints the revise for v3.1 again.
  - f2: after Nanda's point v3.2 (breaks repeatable), `next a1` still prints "r1 waits for Nanda to check repeatable".
- **FW-12 is still open.** In f3, the cold `brief a1` does not show k1. Only `resume a1 t1` prints "resume t1 from k1 ...".
- **FW-13 is still open.** In f2, the brief of writer a4 (attempt 2) has two lines that the writer cannot act on: "r1 was checked under an old version ..." and "v3.1 ... a direction change answered it".
- **FW-14 is still open.** In f2, `ratify e32` (the relayed approve of tsd-writing@2) printed only "e32 ratified -> n1, n2.". It did not say that r2 (t3) is now old. A terminal approve says this (f1: "now under an old version: r1 (t1)").
- **FW-15 is still open.** All four wording items are still there:
  - The low checker brief says "report it, and stop".
  - The medium STOP line still says `--for=<owner>`.
  - `waiting` shows two rows for the one relayed approve e32.
  - The log shows "review r2 recheck -> v7" with no reason.
- **FW-7 (not in the list, but seen) is still open.**
  - In f1, `next a1` said nothing about the moved main until `work source a1 app@main`.
  - In `F/f1-copy-stale`, `finish` of a2, a4 and a1 was not refused while r2 was on an old base. After that, `waiting` said "nothing waits".

## Part 2: new findings (most severe first)

### R5-F1 (A) After the parts are closed, a page review that changes a closed part's text cannot finish

**Why it stops.**
- The split rule needs every part closed before a new split.
- The join check compares every part, closed parts too, with that part's last result (cli.js, the loop "A join changes only the joins": `t.serves === a.task`, with no `!t.closed`).
- A closed task cannot take a new result (engine.js: "is closed").

**Commands** (copy `F/f2-intro-again`; the start is f2 with t2 and t3 accepted and the join r4 reported; architect a1, joiner a10):
1. `work task close a1 t2 --reason=...`, then the same for t3. This is necessary before any new split.
2. Person: `work review r4 reject --point="the Introduction says two days; it was a week"`. This makes v9.1.
3. `work recheck a1 r3 --reason=...` gives "v10 asks for a new result of t2". t2 is closed, so no maker can answer v10, and `next` shows no step for t2.
4. The intro is changed, then `work report a10 --output=docs/tsd.md`. It is refused: "the join changed r3 of t2 (The Introduction) after it was accepted".
5. Person: `work task split t1 --file=intro2.yaml --review=v9.1` makes t4 (region introduction).
   - Lead a12 assigns writer a13. a13 reports `docs/tsd.md#introduction`, which is r5.
   - Linter a14 accepts r5, and the person accepts r5 with `repeatable`. t4 is Accepted.
6. `work report a10 --output=docs/tsd.md` is refused again with the same message. Every possible join now differs either from r3 (t2) or from r5 (t4).

**What the work needs.** DESIGN section 8 says that a closed part gives its rules to the join. So the join can change a closed region, because those rules then check it. Now the only way out is to close t1 and open a new task.

**Fix.** In the join check, compare only parts that are not closed. Refuse a recheck of a result of a closed task.

### R5-F2 (B) An agent's split with no --review can do the work that the person's open point asks for, and then that point cannot close

**Commands** (copy `F/f2-agent-split`, made from `F/f2-parts-closed`; the person's point v8.1 has no rule and says "the TSD needs a Failure region"):
1. `work task split a1 t1 --file=parts2.yaml` (no `--review`) is allowed and makes t4 Failure.
   - t4 is written and accepted.
   - Joiner a10 reports r6.
   - The linter and the person accept r6.
2. `work blockers r6` still shows "v8.1 needs a direction change: ... the TSD needs a Failure region". No command links t4 to v8.1.
3. Person: `work task split t1 --file=parts2.yaml --review=v8.1` is refused: "t1 already has parts".
4. The only ways out are a contrived direction change, or the dummy split in `F/f2-agent-split-hack`:
   - `task close t4`
   - `task split t1 --file=dummy.yaml --review=v8.1` (a part named "Nothing more")
   - `task close t5`

   After that, t1 is Accepted, and the record says that the empty part t5 answered v8.1.

**Fix.** Refuse an agent's split while the task, or a result of it, has an open no-rule point by the person, and tell the agent to raise the split command to that person. Another fix: let the person link a point to an existing part.

### R5-F3 (C) No command shows that the person's own split can answer the person's no-rule point

In f2, after the person's Reject v8 (v8.1: "the TSD needs a Failure region"):
- `waiting` shows only "v8.1 needs a change of tsd-writing ... direction approve --answers=v8.1".
- `next a1` (high tier) shows only the revise and a redo.
- The architect's split is refused, first with "already has parts". After the parts are closed, it is refused with "is the person's Reject; only that person's own split answers it, or a direction change".
- The next line of the refusal points to `work next`, which shows the revise again.

I had to write a raise that contains the split command myself (v9). Then the person ran `task split t1 --file=parts2.yaml --review=v8.1`.

**Fix.** When a task can split and the person has an open no-rule point on it, `waiting` should also print `work task split t1 --file=<parts.yaml> --review=v8.1`. Add "close the parts first" when parts are open. The refusal and the high-tier `next` should print the raise to the person.

### R5-F4 (C, maybe A) After the person's split answers a point, the printed record says that a direction change answered it

The stored event is correct. The printed views are false.
- The store has event e65 with `"review":"v8.1"`.
- `blockers r4` and the join brief of a10 say "v8.1 rejected r4: ...; a direction change answered it". No direction change was made.
- `work log` shows "e65 Nanda (terminal) task.split t1 -> t4", with no "answering v8.1".

The round-4 fix of R4-1 said: log "answering" and render "a split answered it". That part was not done: render.js:124 always says "a direction change", and the log of task.split prints only the task.

If "the record" means what `log` and `blockers` print, this is A, so Nanda may want to grade it again.

**Fix.** Name the change that answered the point ("the split of t1 into t4 answered it"), and add `answering <id>` to the task.split log line.

### R5-F5 (C) A person's point on the join that names a part's rule shows as "needs a direction change", and the printed approve is refused

**Commands** (copies `F/f2-open-parts-recheck` and `F/f2-part-rule-point`; the parts are not closed):
1. Person: `review r4 reject --point="the Introduction says two days; it was a week" --breaks=repeatable`. The rule repeatable belongs to t2, not to t1.
2. `recheck a1 r3`. t2 is redone and accepted, and a10 reports the join r6.
3. `blockers r6` and `waiting` say "v8.1 needs a direction change", and they print `work direction approve tsd-writing@<n> --answers=v8.1`.
4. When copied, that approve is refused: "names the rule repeatable; changed work with evidence answers it".

On r4, the same point showed as "v8.1 breaks repeatable". The real answer is not printed anywhere: the person's evidence for repeatable on r6. When the person gave that evidence, r6 was accepted.

**Fix.** Treat a point that names any rule of the task tree as a rule point. `waiting` should then ask the person to check that rule on the newest join.

### R5-F6 (C) After a direction change, next prints a recheck so that the gate runs again, also when the gate's evidence still counts

In `F/f1-copy-fw6`:
1. t1 is accepted and finished (r3). The person approves fixes@3, which adds a reviewer rule, and assigns a new lead a7.
2. `next a7` prints first: "gate runs on the next report of t1; a recheck asks for one / work recheck a7 r3 ...".
3. If the lead runs it, the maker must report again. a2 has no attempts left, so that is a new round.
4. Without the recheck, one reviewer accept under fixes@3 gave "r3 has no blockers; it is accepted".

**Fix.** Print the program line only when a rule that the program checks has no evidence that counts.

### R5-F7 (C) A recheck on the maker's last attempt: the brief claims the assignment, and the report is refused after the work is done

In `F/f1-copy-move3`, r3 is attempt 3 of 3:
1. Main moves again, then `recheck a1 r3`. `next` correctly says to assign a new implementer.
2. But `work brief a2` claims a2 and prints "attempt 4 of 3" with a report command.
3. The maker rebases, then `report a2 --output=app@f17e95c` is refused: "a2 (implementer) has used its 3 attempts".
4. a2 stays claimed, so it needs a release.

Also, each recheck after a change outside uses one maker attempt. In f1, one Reject and one move of main used all 3 attempts.

**Fix.** A brief of a Do assignment with no attempts left does not claim. It prints STOP and says that the parent assigns a new maker.

### R5-F8 (C) After a cold resume, the parent has no token for its open child, and next loops

In f3 and in `F/f3-lost-token`:
1. After `release a1 a2`, `next` says "give a new subagent the command of a2 ... work brief a2.<the token that assign printed>". The new session never saw that token, and the store keeps only its hash.
2. `assign a1 t1 --role=writer` is refused: "already has an open Do assignment". Its next line is `work next`, which prints the same token placeholder.
3. `finish a1 a2` and then `assign` works (it makes a3), but it uses a round, and no line prints this way.

**Fix.** After a release, `next` adds: "if you do not have its token: work finish a1 a2, then work assign ...". Another fix: a command that gives a child a new token and makes the old token not valid.

### R5-F9 (C) A direction change can open a task again after its tree is finished, and then nothing waits

In `F/f1-copy-fw6`:
1. t1 is accepted, and a1, a2 and a4 are finished.
2. The person approves fixes@3. The approve says "(work next shows it)", but no open assignment exists that can run `next`.
3. `waiting` says "nothing waits", and `task show t1` says "In review".

**Fix.** `waiting` and the approve output should list each task that is not accepted and has no open assignment, with `work assign t1 --role=<role>`.

### R5-F10 (C) For code, nothing names the accepted commit or the step to put it on main

At the end of f1:
- `task show t1` and `blockers r3` print "r3 has no blockers; it is accepted." without the output.
- `next` prints only finish steps, and `waiting` says "nothing waits".
- The fix (app@356dccc) is on the branch fix-key, not on main. Only `work log` names the commit.

This may be outside the scope of `work`; Nanda decides.

**Fix.** When a task with a code output is accepted, print its output and the step to put that commit on its base.

### R5-F11 (D) Wording

- A person `work next` with no token gives: `"undefined" is not an assignment token`.
- A `--file` that does not exist gives a raw `ENOENT: no such file or directory, open '...'` (seen in `F/f2-relayed-split`).
- The brief does not say the folder in which `verify` runs. In f1, `bun test` worked from the project folder only by chance.
- `task split` with no `--file` prints only the keys, not a template like the one that revise prints.
- `resume a1 t1` says "changed outside: nothing" although q1 was answered after the checkpoint k1.
- The reviewer brief does not name the base commit that `proof-test` needs.

## Steps that worked with no friction

- init, role fit, task open and assign. Each printed subagent prompt worked when copied.
- A second low claim was refused with STOP and the release command.
- report with a digest. The gate `bun test` ran in a clean worktree of the reported commit and recorded its accept.
- A Reject with a rule point and a no-rule point: blockers and next show both.
- For the person: the revise template, revise, approve with `--answers`, and the settle of a raise.
- `work source`, the stale-base line, the recheck, and a real rebase. A commit that was not rebased was refused.
- Two regions in one file ran in parallel, each with a lead, a writer and a linter. The region digests stayed independent.
- A relayed Reject with points and `--breaks`. A relayed approve and a relayed accept, each with ratify. A relay with no `--channel`.
- After a direction change, the unchanged part was checked again, not made again.
- The whole-page rule shows only on the join.
- An agent's split with `--review` of the person's Reject is refused, also when the Reject was relayed. The person's own split answers it.
- A join that changes the region of a closed part is refused.
- A low raise becomes a question to the parent. The parent asked the owner, the person answered, the parent answered the child, and ANSWERS showed it.
- checkpoint and resume, release of a stopped child, and the finish steps.

## Is anything left that is more than a limit or wording?

Yes. R5-F1 (A) stops the work after a new split. R5-F2 (B) lets an agent's split leave the person's point with no real answer. R5-F3 to R5-F10 are C: in each, a printed step is wrong, missing, or makes a loop.
