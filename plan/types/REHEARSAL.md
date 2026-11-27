# Format 22 local rehearsal

`bun test test/project-first-task.test.js` runs the shipped `work` CLI and
Project page in a scratch Git checkout. It uses a fresh SQLite journal,
a private tmux socket, local shell sessions, and Chromium.

The owner accepts reviewed staffing and direction, answers a Question,
approves the marker inventory, and starts work after the host acknowledges.
The bound host sends a leaf task. Staff report a whole file and changed
lines. A command rule and prompt review return the first attempt with
evidence. A confirmed session exit returns the task to Sent. The next
session works from the feedback in a fresh attempt and reaches Done. A
second task raises WrongTask and shows the evidence in the page and CLI.

The same rehearsal measures commit-to-page visibility, dispatch to a
fresh review, and local child startup. It also exercises page reconnect,
stale submission refusal, unsupported journal format refusal, and
credential exclusion from the journal, page, and server log.

Run `bun run spec:check` and `bun run spec:tlc` for the ten registered
model checks and their mutants. `bun run spec:conformance` replays
the 30 checked-in witnesses. `bun run typecheck` checks the engine and
browser graphs and `bun run test` runs the full suite.
