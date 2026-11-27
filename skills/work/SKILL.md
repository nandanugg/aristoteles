---
name: work
description: Take the next step of an Aristoteles task, answer a Question, or report facts from an assigned fresh review.
---

# Work in an Aristoteles Project

In a new staff pane, follow its launch prompt to become Live. The output shows relevant journal changes, the role responsibilities and accepted directions, and a `work wait <token> --on=<last-read>` command. Use your private credential and the latest printed read position. Each wait shows changes since that position before it gives the next step. Without `--on`, it derives the starting point from your last act in this session or repeats the introduction if you have yet to act.

A fresh review child uses `work wait <token>` to get its assigned review. Use the read basis and address from that response. Your credential is private to its session or review. If an act is stale, run wait again before retrying. A refusal for a retired session or review calls for a new assignment.

## Task brief and result

`work brief <token> <task-key>` shows the goal, accepted direction and responsibility versions, stage slice, rule guidance, phase, and feedback. The host sends a task using `work send <token> --on=<read> --file=task.yaml`. The file carries `key`, `name`, `goal`, `reviewer` (a role key), the complete accepted `direction: { number, value, acceptedIn }`, the nonempty `stages` copied from that direction, and the attached `facts`. Each stage names its role by key. Sending pins the worker’s and reviewer’s responsibility versions.

When you begin, submit `{}` with `work report <token> <task-key> --on=<read> --file=report.yaml`. Follow the brief and report the whole images of touched files. Paths are relative to the project. Changed ranges are inclusive, one-based, ordered, and nonoverlapping. For a deletion use `image: { _tag: Deleted, previousContents: ... }`.

```yaml
attempt: 1
summary: Added the rationale
files:
  - path: proposal.md
    image: { _tag: Present, contents: "A shorter queue preserves order.\n" }
    changed: [{ first: 1, last: 1 }]
```

ReadyToReview runs the pinned command rules and records their exact output. If a review returns the work, it keeps the attempt and adds feedback. After a confirmed crash without a checkpoint, wait for a fresh session and begin the next numbered attempt. The task keeps its retry count and feedback.

If a task is too big or the cut contradicts the work or omits a prerequisite, report `{ attempt, reason: TooBig | WrongTask, evidence }` on the same command. Give a nonempty list of checked Quote or CommandOutput evidence. Raised preserves the list and stops work.

### When review raises a finished result

The pipeline reads the task’s evidence and records its assessment with `work assess <token> <task-key> --on=<read> --file=assessment.yaml`. Write `{ missed: Staff | Guidance | MovingTarget, why }`. Explain the cause with the recorded breaks and any relevant prior work.

- **Staff** runs `work try-again <token> <task-key> --on=<read>` once per task. The task returns with the breaks and a fresh review retry count. On a second Staff miss, propose staffing with a stronger model for the role that did the work. Give a reason in the staffing draft. End the previous-model session before the owner accepts.
- **Guidance** submits the full direction with one applicable rule added or revised. Keep the rest of the direction intact.
- **MovingTarget** follows the app’s directions and takes the same one automatic retry. On another miss, use the Staffing proposal route.

To submit the first fix, write `{ line: Proposal, key: <proposal-key>, move: submit, input: { subject: { _tag: Fix, task: <task-key> }, value } }` and run `work onboard submit <token> --on=<read> --file=fix.yaml`. The submitted draft goes to fresh review. If the owner sends it back, read the reason with `work onboard show <token> <proposal-key>`, assess the task again, and submit a revised draft with `move: submit` and `input: { value }` on the same proposal. If the assessment changes the cause, the old draft is withdrawn.

The owner can take a finished result as is with `work take-as-is <task-key> --on=<read> --why=<reason>`. As sender of the root task, the owner can also `work drop <task-key> --on=<read> --why=<reason>`. These choices are available from the Project page.

## Fresh review

Run the command printed by `work wait` for your fresh child. Quote exact passages in the reviewed file images. A task report gives one outcome per pinned prompt rule, with the complete pinned `rule` in each outcome. The journal already has the command outcomes. A finding carries `{ text, evidence }` and names a problem the rules do not cover.

```yaml
outcomes:
  - _tag: Holds
    rule: <the complete pinned prompt rule>
    evidence: { _tag: Quote, file: proposal.md, lines: { first: 1, last: 1 }, text: A shorter queue preserves order. }
findings: []
```

Use `Breaks` for a broken rule. The engine checks the evidence and derives the next move. Review assignment uses the reviewer's own available subagent slots when their allowance is positive. When their allowance is zero, the host serves the queue in journal order.

For a proposal, give one outcome for each built-in rule printed by wait. Copy the complete `rule` into each outcome. Outcomes and findings quote the submitted `proposal.json` at the stated lines. The owner decides whether to accept the exact reviewed version.

## Questions

The addressed recipient answers using the form and read basis printed by wait. Staff use `work answer <token> <question-address> --on=<read> --file=answer.yaml`. The full address is `project/<question-key>`, `<proposal-key>/<question-key>`, or `<task-key>/<question-key>`. The owner may answer from the page. Use the advertised `_tag` in the answer YAML. `ShortAnswer` takes one line in `text` and `Markdown` takes Markdown in `text`. `OneChoice` takes a zero-based index in `picked`. `ManyChoices` takes one or more zero-based indices in `picked`. `Matrix` takes one zero-based column index per row in `cells`.

When asking, provide Markdown `text` and an `expects` record such as `{ _tag: ShortAnswer }`. For a choice supply `options`. For a matrix supply `rows` and `columns`. Set `owner` in the question YAML to the Project, Proposal, or Task line. For a task use `owner: { _tag: Task, key: task:example }`.

## Splitting a task

The sender judges what fits the assignee’s staff and model. For a root task, the
owner is the sender. For a part, the staff serving the parent’s role is the sender.
Use `work split [<token>] <task-key> --on=<read> --file=split.yaml`. To split
before sending a root, provide `{ _tag: New, draft, partition }`. The draft
uses the normal brief with a coordination `role` and an `attachments` list.
Each attachment gives `at` (a position in the spine), `direction` (an accepted
version), and `stage` (a position in that direction). For a sent, raised,
or already split task, provide `{ _tag: Existing, partition }`.

A partition has `why`, `review`, and two or more `parts`. Explain why the
stages belong together and what fits in one cross-part review. Each part
provides `task`, `name`, `goal`, `role`, inclusive one-based `range:
{ first, last }`, `dependency: { _tag: Serial }`, and `why` it fits. Assign
each retained stage once and in order. Use fresh task keys for changed
parts. Serial work waits for the preceding parts to finish. The worktree
support for starting a scheduled Parallel part lands in a later unit.

An assignee can report `{ reason: TooBig, why }` on a Sent task before
beginning. While Working, report TooBig or WrongTask with the attempt and
evidence. The sender can split the raised brief or send a correction for
the same stage slice with `work send-back <task-key> --on=<read> --file=brief.yaml`
and `{ goal, why }`.

`work join-parts` joins adjacent parts. `work redistribute` moves stage
boundaries while keeping the part count. Both use a full partition file.
To omit a stage with no work, use `work drop-stage` with `{ _tag: Working,
stage, attempt, evidence }` while doing the work, or `{ _tag: Split, stage,
evidence, partition }` as sender of the split task. The revised partition
covers the remaining stages and leaves active or completed work in place.
