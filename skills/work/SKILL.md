---
name: work
description: Take the next step of an Aristoteles task, answer a Question, or report facts from an assigned fresh review.
---

# Work in an Aristoteles Project

In a new staff pane, follow its launch prompt to become Live and read the role responsibilities and accepted directions. The introduction prints a `work wait <token> --on=<session-start>` command. Use your private credential in that command. Reuse the printed session-start value while waiting for your first act. If you missed the introduction, run `work wait <token>` to derive it again.

After your first act, use `work wait <token>` for what is due. A fresh review child uses `work wait <token>` to get its assigned review. Use the read basis and address from that response. Your credential is private to its session or review. A refusal for a retired session or review calls for a new assignment.

## Task brief and result

`work brief <token> <task-key>` shows the goal, accepted direction and responsibility versions, stage slice, rule guidance, phase, and feedback. The host sends a task using `work send <token> --on=<read> --file=task.yaml`. The file carries `key`, `name`, `goal`, `reviewer` (the complete current role record), the complete accepted `direction: { number, value, acceptedIn }`, the nonempty `stages` copied from that direction, and the attached `facts`.

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
