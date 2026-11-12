# aristoteles

`work` is a command line for AI work under review. A person sets the directions; AI makers do
the tasks; AI reviewers check each result against the rules of the directions. The person
accepts only the directions and their changes. aristoteles is the store of this work: one
SQLite file that links each task to the version of the direction that it used.

- **Direction**: what the work is for. **Standard**: how the output looks. **Rule**: one check
  that a reviewer does on one result. Each one is one entry in aristoteles, in free markdown.
- **Roles** (`aristoteles.yaml`): the makers and the reviewers of a project, in three tiers (high,
  medium, low). A model gets one command, `work brief <token>`, and the brief says what to do
  next.
- **Company directions**: a git repo with one folder for each direction. A project names a
  folder in its `aristoteles.lock`. The first command of each day fetches the repo, and a new
  commit comes in as a draft that its owner accepts.

## Requirements

- [Bun](https://bun.sh) 1.3 or later (tested with 1.3.14).
- git.

## Start from your AI CLI

Open the AI CLI that you use (Claude Code, Codex, or another) in the dir, and paste this prompt
into it. That CLI is the host: it gets aristoteles, reads the dir, and drafts its people, its
roles, and the commands of its own CLI for the agents. No other step guesses which CLI you use.

```text
Set up aristoteles for this folder, then assess it.
1. Find aristoteles. If `work` is on the PATH, it links to <the aristoteles folder>/bin/work.js.
   If not, run: git clone https://github.com/nandanugg/aristoteles.git ~/.aristoteles/code
   Then run `bun install --production` in that folder (Bun 1.3 or later and git are necessary;
   the UI also needs tmux), and link the CLI:
   mkdir -p ~/.local/bin && ln -s ~/.aristoteles/code/bin/work.js ~/.local/bin/work
   When `work` is still not on the PATH, use `bun <the aristoteles folder>/bin/work.js` in its place.
2. Read <the aristoteles folder>/skills/assess/SKILL.md and do what it says for this folder.
3. You are the host: write the tiers of the draft with the commands of this AI CLI.
```

When the draft is ready, run `work start` in the dir and accept the roles on the page. Then tell
the CLI that the roles are accepted: it drafts the directions, and you accept each one on the
page. When `work start` runs before the draft, the page shows the same prompt, with the paths of
this machine.

## Use it by hand

```sh
git clone https://github.com/nandanugg/aristoteles.git
ln -s "$PWD/aristoteles/bin/work.js" ~/.local/bin/work   # or run: bun aristoteles/bin/work.js
```

In a dir (a folder of your work):

1. Write `aristoteles.yaml`: the people and the roles (DESIGN.md, section 3; the name of the dir
   is its folder name). Its first line can name the schema, so an editor completes the keys:
   `# yaml-language-server: $schema=<the aristoteles folder>/schema/aristoteles.schema.json`.
2. Run `work init`.
3. A model drafts each direction with the `assess` skill (`skills/assess`), or with
   `work direction new --file=<direction.yaml> --by=<model run>`.
4. The owner reads each draft (`work waiting`, `work direction show <draft>`) and accepts or
   rejects it (`work review <draft> accept --evidence=...` or `reject --reason=...`).
5. The person opens a task and assigns it to a role: `work task open --file=<task.yaml>`,
   `work assign <task> --role=<role>`.

`work` with no command prints all the commands. It exits 0 on success, 1 on a refusal, 2 on a
mistake in the command line, 3 when something outside fails (git, tmux, a fetch, a busy or
damaged store), and 70 on a bug.

The store is `~/.aristoteles/aristoteles.db`. `ARISTOTELES_DB` names another file.

## The UI: `work start`

`work start` in a dir opens its page in the browser: a canvas with a card for each task, its
work and its reviews, and the real terminal of each AI agent. It needs `bun install` once in the
aristoteles folder, and tmux for the terminals.

- **A project is a talk.** New project starts a host (a Sol role) in its own terminal. Tell it
  what you want; it drafts the top task, and you open it with one click.
- **Real agents and subagents.** A Sol or Terra role runs in a real terminal that you can open
  and type into; the UI starts it. A Luna role runs as a subagent inside its parent's terminal.
- **Only three kinds of decision need you**, each with a badge: a system problem, a direction
  problem, and the end of a project. The host handles the rest, and writes its words on each
  decision first.
- **The settings** (the gear) are in `aristoteles.yaml`: the command of each tier, for example
  `claude --model opus --session-id {session} {prompt}`, its resume command, the words of an
  error and of a prompt, and the theme.
- The terminals run in tmux on their own socket (`tmux -L aristoteles ls`), so they keep running
  when the server or the browser stops. The plan of the UI is in `plan/ui/PLAN.md`.

## Guides and skills

- `work guide writing`: how to write a direction for retrieval.
- `work guide direction-review`: the questions for the review of a direction.
- `work guide decision-words`: how a host writes the words of a decision, so that the person can
  decide.
- `skills/work`: the skill that a model reads to do work under review.
- `skills/assess`: the skill that reads an app and drafts its directions.
- `skills/role-fitness`: the skill that checks that a role in `aristoteles.yaml` fits its tier.

## Tests

```sh
bun run test        # every test file, 12 files at a time
bun run test:fast   # every file but those that start tmux or a browser (test/slow-files.js)
bun run test:slow   # only those
```

Each is `bun test` with a limit of 30 seconds for each test: the tests of git and of the
terminals are slow on a busy machine.

The design and the decisions are in `DESIGN.md`. The reports of the thought tests are in
`thought-tests/`.
