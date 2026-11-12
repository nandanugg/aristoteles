# The roles of a dir: what work checks

Read this before you write the roles of `aristoteles.yaml` or of its draft. Each fact is a check
of work: a file that breaks one is refused, or the work stops later at that check.

## Who gives work to whom

- A role gives work only to a role of a lower tier, and only in its own task tree.
- A maker needs a decider: the role that assigns the maker, or a role above it, approves it.
- A high role gets its work only from the person. On the page, Open gives the top task of a
  draft to the high role of that draft. Any other high role needs `work assign` from the
  person at a terminal.
- The high role of a top task decides that task last. Then the end of the project goes to the
  person.

## Fit

- An agent role gets work (Open, or an assign) only when it has a fit record for its current
  words: `work role fit <role>`, and the `role-fitness` skill. The person, a high agent
  (`--as=<its token>`), or the host outside any task (`--by=<its name>`) records it. A program
  role needs no record.
- The static checks of fit: a low role has exactly one act; a role with a `do` act names its
  `output`; no responsibility contains a vague verb (handle, ensure, look at, deal with, manage,
  take care, make sure, support), in any form ("handles", "managed"). Another word, such as
  "handler" or "management", passes.

## Rules and their checkers

- A rule applies to each task that its `where` matches. A rule with no `where` applies to each
  task, also to the top task.
- A decider can accept a result only with evidence for each rule that applies, from the checker
  of that rule. That checker must review or approve the maker of the result. So the checker of
  a rule with no `where` reviews each maker, also the maker of the top task (for example the
  maker that puts the parts together).
- `limits.<tier>.Review.rules`: an assign is refused when more rules of the task name the role
  than this limit. `work role fit` counts each rule of the accepted directions that names the
  role. A limit applies only when `aristoteles.yaml` sets it.
- `limits.<tier>.Result.size` limits the size of each result of a maker. Leave it out for a
  maker of a large file.

## Sections

- A section is a markdown heading of any level, to the next heading of the same or a higher
  level. Its id is the heading in lower case, with only a-z, 0-9, spaces and dashes kept, and
  each run of spaces made one dash: "Risks & Threat Model" is `risks-threat-model`.
- When the app has its own ids for these parts, a program of the app must also accept these ids.

## Programs

- `run` is split into words at spaces; double quotes keep spaces. No shell runs it: for a pipe
  or `&&`, run `sh -c "<the commands>"`.
- `{output}` becomes the output of the result, and `{workspace.path}` the folder where the
  program runs.
- When the result is a commit, the program runs in a new checkout of that commit. It has no
  installed packages and no file that is not committed, so install first in the same command.
  When the result is a file, the program runs in the dir as it is.
- Exit 0 accepts each rule of `checks`; another exit rejects the result. `timeout` (120 seconds
  when not set) stops it.
- The program runs after each report. It must change no state of the app (no attempt, no
  record), or its runs change the work that it checks.

## The files of work in the dir

- `aristoteles.draft.yaml`: the draft of the roles. The accept on the page removes it.
- `aristoteles.yaml`: the people, the limits, the roles, and the tiers. Commit it.
- `.work/`: the worktrees of the agents and the logs of the programs. Do not commit it.
- The links to the aristoteles skills in the `skills` folder of each tier (for example
  `.claude/skills/work`). Each one points into the aristoteles folder of this machine. Do not
  commit them; keep the app's own skills in that folder as they are.
- An agent that makes commits works in a worktree of the base of its workspace (the last commit
  when no base is set). A change that is not committed is not there.
