# aristoteles

`work` is a command line for AI work under review (each result of an AI is checked by a reviewer
before it counts). A person sets the directions; AI makers do
the tasks; AI reviewers check each result against the rules of the directions. The person
accepts only the directions and their changes. aristoteles is the store of this work: one
SQLite file that links each task to the version of the direction that it used.

- **Direction**: what the work is for. **Standard**: how the output looks. **Rule**: one check
  of a result, with its evidence: a test command (no output = it holds; each line is a point)
  and/or a reference (`file#anchor:lines`). Each has its own version.
- **Roles** (`aristoteles.yaml`): each persistent role has a terminal; it gives a task to a maker
  subagent, reviews the result itself, and raises what it cannot pass. One role is the pipeline
  role (`pipeline: true`): it evaluates every raise and runs the direction pipeline. The host is
  your own AI session. Each agent runs `work wait <token>`, which prints one step: the exact
  command to run next.
- **Top task**: the whole job of one project, for example one TSD, with its sections. You open
  it (`work top open`); the host sends tasks that cover its sections to the roles.
- The design: `plan/model/DESIGN.md` is locked by the person, and `core/model/` holds it as
  Quint specs checked by TLC; the code follows `core/model/work.qnt`.
- **Company directions**: a git repo with one folder for each direction. A project names a
  folder in its `aristoteles.lock`. The first command of each day fetches the repo, and a new
  commit comes in as a draft that its owner accepts.

## Requirements

- [Bun](https://bun.sh) 1.4.3 or later (tested with 1.4.4). On macOS, an older Bun can wait for
  ever in a sync spawn (oven-sh/bun issue 34069), and the page's terminals then stop. Install it
  as https://bun.com/docs/installation says (on Linux its installer needs `unzip`), and put
  `~/.bun/bin` on the PATH of the shell that runs your AI CLI.
- git.
- tmux 3 or later, for the terminals of the agents.

## Start from your AI CLI

Open the AI CLI that you use (Claude Code, Codex, or another) in the dir, in a tmux pane, and
paste this prompt into it. That session is the host: it gets aristoteles, installs its skill in
the dir, onboards a new dir with you, starts the page, and starts or continues a project with you. The page shows that same terminal,
so you talk with the host there or on the page. No step guesses which CLI you use.

```text
Use aristoteles in this folder.
1. Find aristoteles. When `work` is on the PATH, it is a link to <the aristoteles folder>/bin/work.js.
   If not, run: git clone https://github.com/nandanugg/aristoteles.git ~/.aristoteles/code
   Then run `bun install --production` in that folder (Bun 1.4.3 or later, git and tmux are
   necessary), and link the CLI (and put ~/.local/bin on the PATH when it is not there):
   mkdir -p ~/.local/bin && ln -s ~/.aristoteles/code/bin/work.js ~/.local/bin/work
   When `work` is still not on the PATH, use `bun <the aristoteles folder>/bin/work.js` in its place.
   Then run `work skill install` in this folder: it links the /aristoteles skill here, out of git.
2. Read <the aristoteles folder>/skills/aristoteles/SKILL.md and do what it says: you are the host.
```

`work skill install` links the skill in `.claude/skills/aristoteles` and
`.agents/skills/aristoteles`, and lists both links in `.git/info/exclude`. aristoteles never edits
your `CLAUDE.md` or `AGENTS.md`: a session that starts with `/aristoteles` works for aristoteles,
and any other session of the dir still uses your old files.

In a new dir, the host onboards the dir with you. Onboarding works on files, and nothing goes to
the store until the end:

1. The host reads the dir and drafts the people, the roles (each with a one-line summary, and the
   place where the project has it already), and the commands of its own CLI for each model. It
   opens the page (`work start --detach`).
2. The host drafts each direction with a summary (one or two plain sentences), a flow (how the
   direction works, from the first act of an actor down to the output; the page draws it as a
   sequence diagram, the steps that the direction governs marked with the ids that apply there),
   its standards, its rules, and its examples: for each marked step, an output that follows the
   direction and one that breaks it (with the input of a step that checks or decides), real when
   the project has one, else written by the host. You open any ready direction on the page: its
   summary, its flow, what its words changed since the last draft, then its examples.
   Accept it; or write what to change and press Revise; or remove it. When the host needs an
   answer, it asks a question with an example and two options, A and B. You can add a direction (the
   principle, and an example if you have one) or a company direction. A company direction is a
   folder of a git repo that other projects follow; for an example, see
   https://github.com/nandanugg/aristoteles-example-direction.
3. When every direction is accepted or removed, the agents page opens: a card for each role, with
   its icon, its model, and whether it is persistent. Only a persistent role gets a terminal of
   its own; a role that is not persistent runs as a subagent. Accept, revise, or remove each role.
4. Approve all roles. That starts the store with only the accepted result (at a terminal:
   `work onboard approve-roles`; the page and the command ask you to type the word `approve`). Commit
   `aristoteles.yaml`. The host then records the fit of each agent role: a role fits when its words pass
   the static checks of work and a yes answer to seven short questions about its kind of work
   (`guides/fitness.yaml`); a role with no fit record gets no work.

Each page act has a twin at a terminal: `work onboard status` shows each direction and role with
its state, `work onboard accept <id>`, `revise <id> --words=<words>`, `remove <id>`,
`approve-directions`, and the role commands (`accept-role`, `revise-role`, `remove-role`,
`persistence`).

After the store starts, a change is an event that you accept. Say what to change in words
(`work suggest roles --says=<words>`, or about a direction `work suggest <direction>
--says=<words>`); the host or a role that fits roles drafts it with `work adjust` (add or remove a role,
change a model or a persistence, retire a direction), or with `work role draft` and
`work direction revise` for words. Each draft waits for you on the page: accept it, or reject it
with your reason.

Then the host asks: a new project, or continue one? After the first start, the `aristoteles`
skill is linked in the dir, so you trigger it by its name. When the host's AI CLI ends, trigger a
host again and continue the project there: the page never starts or restarts a host.

## Use it by hand

```sh
git clone https://github.com/nandanugg/aristoteles.git
ln -s "$PWD/aristoteles/bin/work.js" ~/.local/bin/work   # or run: bun aristoteles/bin/work.js
```

In a dir (a folder of your work):

1. Write `aristoteles.yaml`: the people and the roles, each agent role with its `persistence` and
   its `icon` (DESIGN.md, section 3 holds the keys of the file, and section 13 holds onboarding;
   the name of the dir is its folder name). Its first line can name the schema, so an editor
   completes the keys:
   `# yaml-language-server: $schema=<the aristoteles folder>/schema/aristoteles.schema.json`.
2. Run `work init`.
3. A model drafts each direction with the `assess` skill (`skills/assess`), or with
   `work direction new --file=<direction.yaml> --by=<name>` (a lower-case name that the model
   gives itself).
4. The owner reads each draft (`work direction show <draft>`) and accepts or rejects it
   (`work direction accept <draft>` or `work direction reject <draft> --reason=...`).
5. Open the top: `work top open --name=... --goal=... --sections=a,b`. In your own tmux pane,
   start your AI CLI and have it run `work run continue`: that session is the host. `work start`
   starts the pipeline role and the roles in their terminals.

`work` with no command prints all the commands. It exits 0 on success, 1 on a refusal, 2 on a
mistake in the command line, 3 when something outside fails (git, tmux, a fetch, a busy or
damaged store), and 70 on a bug.

The store is `~/.aristoteles/aristoteles.db`. `ARISTOTELES_DB` names another file.

The first `work` call after a `git pull`, an edit of the code or a `bun install` builds the CLI
into one file in `.cache/cli/` of the aristoteles folder (git ignores it), and the calls after it
start from that file. A build that fails changes nothing: that call runs the code as it is.

## The UI: `work start`

`work start` in a dir opens its page in the browser: the dashboard (the task queue, the host,
a column per role with its status Working, Waiting or Inactive, the pipeline row with the
escalations that wait for you), and the real terminal of each AI agent. It needs `bun install` once in the
aristoteles folder, and tmux for the terminals.

It prints the page's address, `http://127.0.0.1:<port>/`, and the addresses for other machines
(`http://<an address of this machine>:<port>/`). The server listens on every interface, with no
key: anyone on the same network can open the page and type into the agents' terminals, so run
it only on a network that you trust. It answers only a request that names this machine (any
other host name gets 403), and an act and the terminals need the page's own origin. Set
`WORK_PORT` to keep the same port across starts. A machine with no browser opener (a server
over ssh) only prints the addresses.

- **A project is a talk** with the host, the AI CLI that you triggered: the page shows its
  terminal. Tell it what you want; it drafts the top task, and you open it with one click.
- **Persistent agents and subagents.** A persistent role (of any model) runs in a real terminal that
  you can open and type into, from its first assignment to the end of the project; the UI starts
  it, and it takes its work with `work wait --by=<agent>`. A role that is not persistent runs as
  a subagent inside the terminal that gives it the work. Only a terminal starts subagents.
- **Only seven kinds of decision need you**, each with a badge: a system problem (something the
  work needs does not work, such as a cluster or an account limit), a direction problem (a
  result shows that a direction can be read in two ways, or is wrong), the end of a project, your words that an agent relayed as an act (you confirm it),
  new words of a role, an adjustment (a drafted change of a role or a direction after the
  store starts), and a question that an agent asks you (pick an option or write the answer; it
  counts at once). Anything else that only you can move shows too, with the acts that move it
  (an evaluation for your accept, a draft that needs a reviewer, a brief over its limit, a task
  with no agent). What belongs to no open task waits on the projects page, under "Waits for
  you". The host handles the rest, and writes its words on each decision first. After the first talk, every question to you comes on the page, not in the terminal.
- **The settings** (the gear) are in `aristoteles.yaml`: the commands of each model, for example
  `claude --model opus --session-id {session} {prompt}`, its resume command, the words of an
  error and of a prompt, and the theme.
- The terminals run in tmux on their own socket (`tmux -L aristoteles ls`), so they keep running
  when the server or the browser stops. The plan of the UI is in `plan/ui/PLAN.md`.

## Guides and skills

- `work guide writing`: how to write a direction for retrieval.
- `work guide direction-review`: the pipeline role's review loop of a direction draft.
- `work guide roles`: the checks of work on the roles of a dir, and the files that work adds to
  it.
- `work guide limits`: the tries before a raise and the other limits of the config.
- `skills/work`: the skill that each agent reads: the host, a persistent role, a maker, the
  pipeline role (`work wait <token>` prints one step at a time).
- `skills/aristoteles`: the skill that the person triggers in their AI CLI; that session is the
  host. `work skill install` links it into a dir.
- `skills/assess`: the skill that reads an app and onboards it: its roles and its directions,
  with examples, as files (`work onboard`).
- `skills/role-fitness`: the skill that checks that a role in `aristoteles.yaml` fits its model and its acts.

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
