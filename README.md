# Aristoteles

Aristoteles coordinates project work between an owner, a host, and assigned staff.
The `work` CLI and the local Project page read the same SQLite journal. The owner
accepts reviewed directions and staffing, approves activation, and opens work. A
bound host sends a leaf task, and its assigned staff and reviewer work from the
same accepted versions.

## Open a project

Install Bun, Git, tmux, and `flock`. In the Aristoteles checkout, run
`bun install --frozen-lockfile` and put its `bin/` on your PATH. The commands
below run from the project directory.

```sh
work skill install
work onboard open --file=project.yaml
work start --detach
```

The [assessment instructions](skills/assess/SKILL.md) show the required opening
file and the proposal shapes. Use the owner’s interactive terminal for project
opening. The owner name in the file must match the project’s Git user name.

Open the printed loopback URL to inspect the Project page. The journal uses format
19 and lives at `~/.aristoteles/aristoteles.db` by default. Set `ARISTOTELES_DB`
before opening the project to use a separate file. Keep the CLI, page, and local
sessions on that same journal.

## Onboard and send work

1. Launch the initial staff with `work session launch <staff-key>`. The launched
   staff acknowledges from its pane. The host
   submits direction, staffing, and responsibility proposals at the current read
   position. A fresh review records facts before the owner can accept a proposal.
2. Approve the instruction-file inventory on the page. The host acknowledges the
   launch from its assigned tmux pane, collects its private credential, and waits
   for the owner to choose **Start work**.
3. Send a leaf task over a contiguous stage slice of an accepted direction.
   Staff use `work wait` and `work brief` to read the current task, then report
   their result. The engine records command outcomes. A fresh reviewer supplies
   the assigned prompt outcomes and evidence. The task reaches Done, returns with
   feedback, or reaches Raised with a checked reason and evidence.

See `work help` for the command forms, the [host instructions](skills/aristoteles/SKILL.md)
for activation and recovery, and the [work instructions](skills/work/SKILL.md) for
task and review inputs.

## Verify

Install the local Chromium test browser with `bunx playwright install chromium`.
The process-level rehearsal also uses a local tmux server and the `script` utility
to exercise owner terminals.

```sh
bun run typecheck
bun run test
bun run spec:check
bun run spec:tlc
bun run spec:conformance
```

The [implementation design](DESIGN.md) describes the journal and its adapters.
The [model registry](core/model/README.md) describes the simulator, TLC, and
conformance runs.
