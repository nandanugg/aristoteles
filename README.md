# aristoteles

`work` is a command line for AI work under review. A person sets the directions; AI makers do
the tasks; AI reviewers check each result against the rules of the directions. The person
accepts only the directions and their changes. aristoteles is the store of this work: one
SQLite file that links each task to the version of the direction that it used.

- **Direction**: what the work is for. **Standard**: how the output looks. **Rule**: one check
  that a reviewer does on one result. Each one is one entry in aristoteles, in free markdown.
- **Roles** (`work.yaml`): the makers and the reviewers of a project, in three tiers (high,
  medium, low). A model gets one command, `work brief <token>`, and the brief says what to do
  next.
- **Company directions**: a git repo with one folder for each direction. A project names a
  folder in its `aristoteles.lock`. The first command of each day fetches the repo, and a new
  commit comes in as a draft that its owner accepts.

## Requirements

- [Bun](https://bun.sh) 1.3 or later (tested with 1.3.14).
- git.

## Use it

```sh
git clone https://github.com/nandanugg/aristoteles.git
ln -s "$PWD/aristoteles/bin/work.js" ~/.local/bin/work   # or run: bun aristoteles/bin/work.js
```

In a project folder:

1. Write `work.yaml`: the project name, the people, and the roles (DESIGN.md, section 3).
2. Run `work init`.
3. A model drafts each direction with the `assess` skill (`skills/assess`), or with
   `work direction new --file=<direction.yaml> --by=<model run>`.
4. The owner reads each draft (`work waiting`, `work direction show <draft>`) and accepts or
   rejects it (`work review <draft> accept --evidence=...` or `reject --reason=...`).
5. The person opens a task and assigns it to a role: `work task open --file=<task.yaml>`,
   `work assign <task> --role=<role>`.

`work` with no command prints all the commands.

The store is `~/.aristoteles/aristoteles.db`. `ARISTOTELES_DB` names another file.

## Guides and skills

- `work guide writing`: how to write a direction for retrieval.
- `work guide direction-review`: the questions for the review of a direction.
- `skills/work`: the skill that a model reads to do work under review.
- `skills/assess`: the skill that reads an app and drafts its directions.
- `skills/role-fitness`: the skill that checks that a role in `work.yaml` fits its tier.

## Tests

```sh
bun test
```

The design and the decisions are in `DESIGN.md`. The reports of the thought tests are in
`thought-tests/`.
