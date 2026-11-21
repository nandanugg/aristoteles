# The roles of a dir: what work checks

Read this before you write the roles of `aristoteles.yaml` or of its draft. Each fact is a check
of work: a file that breaks one is refused, or the work stops later at that check.

## The kinds of role

- The **host** is not a role of the file. It is the AI CLI of the person, in a tmux pane. It
  gets the top task, sends tasks to the roles, and reassigns them after a change.
- A **persistent role** has a terminal of its own for the whole project, and a card on the
  page. It gets a task, assigns a maker, reviews the result itself, and raises the task when
  review cannot settle it.
- A **maker** is a subagent of a persistent role, started for one task. It reads its brief,
  works, and reports. When the review fails, the same maker gets the points and works again.
- The **pipeline role** is one persistent role with `pipeline: true`. It runs the evaluations of
  raised tasks, the direction pipeline, and the review loop of drafts. It is no card: it takes
  no task from the host. The top task cannot open without it.

## The model and the acts of a role

- Each agent role names its `model`: an entry of the `models` table, which holds the commands of
  the model (`launch`, `resume`, `skills`) and its `limits`.
- Choose the model by the care that the work needs: a strong model for the pipeline role and for
  a role that reviews; a smaller one for a maker that does one unit from its brief.
- The `acts` of a role say what it may do: `{ do: <work> }`, `{ review: [roles] }`,
  `{ assign: [roles] }`, `{ change: [direction ids] }`, and the words `split`, `direct`, `fit`.
  The config start needs one persistent role with `split`.
- A role gives work only to the roles of its `assign` act.

## Persistence and icon

- Each agent role says `persistence: { persistent: true | false, why: <one line> }` and an `icon`.
- Only a persistent role gets a terminal of its own; a role that is not persistent runs as a
  subagent of a terminal. A role of any model can be persistent.
- Only a terminal starts subagents: the host, and a persistent agent. A subagent starts none; it
  hands a need back with `work ask <token> role:<name> --text="<question>"`.

### Choose persistence with the Rumsfeld matrix

This is guidance for the person who writes the roles. No file holds the matrix and no page shows
it; the `why` of a role says the reason in plain words.

| The role works on | Persistence | Why |
|---|---|---|
| Known knowns: the work is known and repeats | persistent | It starts cheaper subagents in parallel: makers that do the known work. |
| Known unknowns: the work is known, and some facts are missing | persistent | It starts subagents to find the facts: surveyors that check a claim or fill in what is missing. |
| Unknown knowns and unknown unknowns: the work needs judgment that no rule gives | disposable by default | A big agent, started for one unit. Make it persistent when the project needs it again and again. |

## Fit

- A role gets work only when it has a fit record for its current words: `work role fit <role>`,
  and the `role-fitness` skill. The person, or the host that drafted the roles
  (`--by=<its name>`), records it.
- The static checks of fit: a role with a `do` act names its `output`; no responsibility contains
  a vague verb (handle, ensure, look at, deal with, manage, take care, make sure, support), in
  any form ("handles", "managed"). Another word, such as "handler" or "management", passes.
- `work config check` runs these checks on `aristoteles.draft.yaml` before the accept. Anyone may
  run it; it writes nothing.

## Rules and their evidence

- A rule applies to each task that the `where` of its standard matches. A key of a `where`
  names one value, or a list of values, any one of which matches:
  `where: { section: [introduction, design] }`. A rule with no `where` applies to each task.
- A rule carries its evidence form: a `test` (a command; no output means the result holds, each
  printed line is a point; it gets the files of the extracted sections as arguments), a `ref`
  (`file#anchor:lines`, which the harness checks and the page quotes), or both. The pipeline role
  runs the test on the examples of the direction before the rule ships.
- A rule names the role that checks it (`checkedBy`). That role must review a role that does the
  work. `Human` checks no rule: the person accepts directions, not results.
- `models.<model>.limits.Review.rules`: `work role fit` counts each rule of the accepted
  directions that names the role, and the static check fails above this limit.
- `models.<model>.limits.Assignment.attempts`: the tries of a task before a raise (three when
  no model sets it; the fewest of the models counts). See `work guide limits`.

## Sections

- A section is a markdown heading of any level, to the next heading of the same or a higher
  level. Its id is the heading in lower case, with only a-z, 0-9, spaces and dashes kept, and
  each run of spaces made one dash: "Risks & Threat Model" is `risks-threat-model`.
- The top task names its sections (`--sections=a,b`). A task covers some of them; one section is
  the smallest task.

## The files of work in the dir

- `aristoteles.draft.yaml`: the draft of the roles and the models (onboarding). The store start
  removes it.
- `aristoteles.yaml`: the people, the models with their commands and limits, and the roles.
  Commit it.
- `.work/assess/`: the onboarding files, one for each direction and one for the roles. Only
  `work onboard` writes there, and the store start deletes the folder. The host keeps its own
  draft files in `.work/drafts/` and sends each one with `work onboard ... --file=`.
- `.work/`: also the worktrees and the logs of the agents.
- The links to the aristoteles skills in the `skills` folder of each model (for example
  `.claude/skills/work`). The app's own skills in that folder stay as they are.
  `work skill install` links the `aristoteles` skill in `.claude/skills/aristoteles` and
  `.agents/skills/aristoteles`; the project's `CLAUDE.md` and `AGENTS.md` are never edited.
- `work start` and `work skill install` add `.work/` and each link to `.git/info/exclude`.
