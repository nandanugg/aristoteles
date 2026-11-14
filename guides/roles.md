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

## Persistence and icon

- Each agent role says `persistence: { persistent: true | false, why: <one line> }` and an `icon`.
  A program role has an icon and no persistence.
- Tier and persistence are apart. Only a persistent role gets a terminal of its own, for the
  whole project; a role that is not persistent runs as a subagent of a terminal. Any tier can be
  persistent.
- The lead is persistent. The host plays the high role of each top task, and the host is a
  terminal, so a dir needs at least one persistent high role. The store start is refused
  without it.
- Only a terminal starts subagents: the host, and a persistent agent. A subagent starts none; it
  tells the terminal above it what the work needs.
- The words of a role give principles that work as criteria for its kind of work, so that the
  four acts (do, review, approve, change) have a standard: what a good unit is, what a reviewer
  checks, what a lead approves, and what the high role changes.

### Choose persistence with the Rumsfeld matrix

This is guidance for the person who writes the roles. No file holds the matrix and no page shows
it; the `why` of a role says the reason in plain words.

| The role works on | Persistence | Why |
|---|---|---|
| Known knowns: the work is known and repeats | persistent | It starts cheaper subagents in parallel: workers that do the known work. |
| Known unknowns: the work is known, and some facts are missing | persistent | It starts subagents to find the facts: validators and surveyors that check a claim or fill in what is missing. |
| Unknown knowns and unknown unknowns: the work needs judgment that no rule gives | disposable by default | A big agent, started for one unit. Make it persistent when the project needs it again and again, for example an advisor with the knowledge of its domain. |

A disposable agent that starts disposable agents shows repetitive work. Make that role
persistent, so that its terminal starts the subagents, or give the work to a persistent role.

## Fit

- An agent role gets work (Open, or an assign) only when it has a fit record for its current
  words: `work role fit <role>`, and the `role-fitness` skill. The person, a high agent
  (`--as=<its token>`), or the host outside any task (`--by=<its name>`) records it. A program
  role needs no record.
- The static checks of fit: a low role has exactly one act; a role with a `do` act names its
  `output`; no responsibility contains a vague verb (handle, ensure, look at, deal with, manage,
  take care, make sure, support), in any form ("handles", "managed"). Another word, such as
  "handler" or "management", passes.
- `work config check` runs these checks on `aristoteles.draft.yaml` before the accept, and reads
  the draft as the accept on the page does. Anyone may run it; it writes nothing.

## Rules and their checkers

- A rule applies to each task that the `where` of its standard matches. A key of a `where`
  names one value, or a list of values, any one of which matches:
  `where: { section: [introduction, design] }`. A rule with no `where` applies to each task,
  also to the top task.
- A decider can accept a result only with evidence for each rule that applies, from the checker
  of that rule. That checker must review or approve the maker of the result. So the checker of
  a rule with no `where` reviews each maker, also the maker of the top task (for example the
  maker that puts the parts together).
- `limits.<tier>.Review.rules`: an assign is refused when more rules of the task name the role
  than this limit. `work role fit` counts each rule of the accepted directions that names the
  role. A limit applies only when `aristoteles.yaml` sets it.
- When work passes a limit, `work guide limits` gives the action.
- `limits.<tier>.Result.size` limits the lines of each result of a maker: all the lines of its
  file, or of its section, also the lines that did not change, because one review checks all of
  it. A commit has no size limit. Leave it out for a maker of a large file or section.

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

- `aristoteles.draft.yaml`: the draft of the roles and the tiers (onboarding). The store start
  removes it.
- `aristoteles.yaml`: the people, the limits, the roles, and the tiers. Commit it.
- `.work/assess/`: the onboarding files, one for each direction and one for the roles. Only
  `work onboard` writes there, and the store start deletes the folder. The host keeps its own
  draft files in `.work/drafts/` and sends each one with `work onboard ... --file=`.
- `.work/`: also the worktrees of the agents and the logs of the programs.
- The links to the aristoteles skills in the `skills` folder of each tier (for example
  `.claude/skills/work`). Each one points into the aristoteles folder of this machine. The
  app's own skills in that folder stay as they are. `work skill install` links the
  `aristoteles` skill in `.claude/skills/aristoteles` and `.agents/skills/aristoteles`; the
  project's `CLAUDE.md` and `AGENTS.md` are never edited.
- `work start` and `work skill install` add `.work/` and each link to `.git/info/exclude`, so git
  does not commit them and the app's `.gitignore` does not change. When you use work with no
  `work start`, keep `.work/` out of git yourself.
- An agent that makes commits works in a worktree of the base of its workspace (the last commit
  when no base is set). A change that is not committed is not there.
