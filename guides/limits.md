# Limits: the action when work passes one

A limit keeps the work of a tier inside what its model does well. When work passes a limit, the
CLI refuses the act and names the limit. Do the action of that limit below. Do not ask the
person about a limit: the person accepts only the direction drafts and the evaluations that the
action makes, as for any other change.

A low (Luna) or medium (Terra) role that cannot do the action escalates it to its parent
(`work escalate <token> --reason="<the limit, and the words of the refusal>"`). A high (Sol)
role does it.

## The limits of a tier (`limits.<tier>` in `aristoteles.yaml`)

### `Assignment.attempts`: the tries of a maker

- **It keeps:** a maker that fails again and again from more tries of the same work.
- **When work passes it:** the last try of the maker ended on a fault. The brief of the maker
  says STOP.
- **The action:** the high role evaluates the stop (`work next` shows the step): what is wrong,
  why, what to improve, and the level of the deepest cause. Then it makes the change at that
  level (`work next` gives each step):
  - `task`: remake the task;
  - `standard`, `direction` or `principle`: draft the change of the direction
    (`work direction revise <token> <direction> --file=<edit.yaml> --why=<reason>`), and name
    the evaluation in `--answers`. An evaluation at the level of a direction or a principle
    counts after the owner accepts it, and the owner accepts the draft on the page.

  Then a new maker works under the change.

### `Assignment.briefChars`: the size of a brief

- **It keeps:** the tokens of an agent for its work. A long brief leaves less room for the
  work itself.
- **When work passes it:** the assign is refused; or, when the brief grew later, `work brief`
  gives no brief, and the agent escalates and stops. The refusal names the largest part of the
  brief.
- **The action:** make the brief shorter, at the part that is largest:
  - the directions (their standards and rules): compact them. Draft a change with
    `--why=Shorten`: shorter words, one rule for one check (merge two rules that check one
    thing), and a `where` for a standard that only some tasks need. The owner accepts it on
    the page;
  - the task (its text or its references): split the task, or remake it with fewer
    references.

  The brief counts the tier's own guide text too, and a shorter direction cannot change it.
  So a limit needs room above that text. Start with 6000 for low, 12000 for medium, and
  16000 for high: they leave about 4000 to 6000 characters for the directions, the task, and
  its references.

  Measure before and after: `work assign <task> --role=<role> --dry-run` prints the size.

### `Review.rules`: the rules of one review

- **It keeps:** the attention of a checker, which checks each rule that applies on one result.
- **When work passes it:** the assign of the checker is refused.
- **The action:** give each task fewer rules of that checker:
  - rules for some sections only: give their standard a `where` that lists those sections
    (`where: { section: [a, b] }`), so that a task of another section does not get them;
  - two rules that check one thing: merge them (`--why=Shorten`);
  - a task with many sections: split it, so that each part gets the rules of its section.

  `work role fit` counts each rule of the accepted directions that names the role; the same
  actions bring that count down.

### `Result.size`: the lines of one result

- **It keeps:** a reviewer, which reads all of one result.
- **When work passes it:** the report is refused.
- **The action:** split the task: one part for each section, so that each result is one
  section of the file.

## The limit of a direction

### `maxStandards`: the standards of one direction

- **When work passes it:** the draft of the direction is refused.
- **The action:** merge two standards that say one thing (`--why=Shorten`), or move a group of
  standards to a new direction of their own.

## The limits that the UI handles

Nobody acts on these by hand, and nobody asks the person about them:

- A terminal that ends, shows error words, or is silent for `tiers.<tier>.silentMinutes`: the
  UI tries it again 3 times, then tells the host. The host answers it, or records a system
  problem (`work problem`).
- An open system problem: the UI tries it again each `retryMinutes`.
- The words of the host on a decision: after `hostWaitMinutes`, the decision shows to the
  person without them.
- A source outside git: after `outsideSourceHours`, the work made from it waits for a new
  read; `work next` gives the read.
- A program that runs longer than its `timeout`: its result is rejected ("timed out"). Make the
  check faster.

## A limit that only the person moves

- A permission ends at its `--until` time. The person grants it again.
- A change of the limits, of the acts or the tier of a role, or of a program's `timeout` in
  `aristoteles.yaml` needs a new store (DESIGN.md, section 9). When the actions above do not
  bring work under a limit, the host records it as a system problem, with the change that it
  proposes.
