# Format 16 local cutover rehearsal

The shipped `bin/work.js` opened a format-16 journal in a scratch Git
checkout. The page ran through `work start --detach` and used the same
journal. The fixture installed the skills and launched local shell
processes in a private tmux socket.

The owner accepted the reviewed staffing and direction, answered a
Question in the browser, approved the marker files and started work
after the host acknowledged. The bound host sent a leaf task. The
staff reported a whole file and its changed lines. The command rule
and a fresh prompt review returned the first attempt with evidence.
An uncheckpointed session exit returned the task to Sent. The next
staff session ran attempt 2 with its feedback and reached Done.
A second task raised WrongTask and showed its quote in the page and
CLI.

The page reconnected after the server was stopped and reopened.
The journal kept a contiguous event sequence and refused a stale
submission. The old onboarding, activation, staffing and act URLs
returned 404. A separate format-10 file stayed byte-identical after
the shipped CLI tried status, start and project open. The journal,
rendered page and server log contained no credentials. The old
file-state helpers still support the explicitly invoked legacy
regression fixtures. A build audit found their old route and writer
markers absent from the shipped CLI and Project page bundles.

## Feedback budget

Measurements below come from the full suite, with the CLI command or
browser click as the starting point and the committed page state as
the end point. Child startup starts when tmux receives its launch and
ends when the local child signals readiness.

| Measurement | Staffing | Direction |
| --- | ---: | ---: |
| Open visible | 159 ms | 246 ms |
| Submit visible | 340 ms | 435 ms |
| Review visible | 541 ms | 466 ms |
| Accept visible | 178 ms | 100 ms |
| Submit to fresh child ready | 296 ms | 372 ms |
| Submit event timestamp to child dispatch | 40 ms | 80 ms |
| Local child startup | 30 ms | 24 ms |

These timings include the bundled CLI startup and page polling.
The proposal submit path dispatches review directly. The combined
activation-to-binding measurement was 1,012 ms in the full suite and
317 ms in the focused rehearsal. Start work itself was 76 ms in the
full suite.

## Conformance

Model revision `a3698e08731d5b286ec2dcdf1cc03eb0fb811087`.
The simulator and TLC held all ten registered instances and found
violations in all ten corresponding mutants. The named conformance
gate consumed all 30 witnesses. Both TypeScript graphs and all 1,028
tests passed. The architecture baseline recorded zero new findings.

Reproduce with `bun test test/project-first-task.test.js`,
`bun run spec:check`, `bun run spec:tlc`, and
`bun run spec:conformance`.
