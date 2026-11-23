# Pass 9 conformance replay

The driver reads Quint ITF traces. It sends only the action and its
nondeterministic inputs to a runtime port, then compares the observed
state with the model at every frame. Failures identify the witness,
frame and action.

| Model | Finite witnesses |
| --- | --- |
| `worker.qnt` | Hear Host, Role and Pipe, yield with work owed, reject a withdrawn turn, reject an old generation after replacement, and hear an obligation carried through park. |
| `admission.qnt` | Recheck beside a saturated fix lane, two simultaneous fixes, wait with a saturated positive child allowance, serial review at zero allowance, and separate role ownership inside one worker. |
| `permits.qnt` | Denied second start, serial review, background child recheck, park/recheck/resume, and deferred recheck after compatible capacity returns. |

Run `bun test adapters/cli/pass9-conformance.test.ts core/effects/pass9-conformance.test.ts`
for the live unit 2 runs, remaining finite replay, and journal checks.
Run `core/derived/pass9/replay/gen.sh` to regenerate the compressed
witnesses with the pinned Quint dependency. The generator looks for a
violation of each negated witness predicate. Run
`core/derived/pass9/replay/mutate.sh` to mutate the unit 2 implementation
and require each fault to fail the corresponding live test.

## Runtime inputs

- The worker port reads C16 obligations and parses the command printed
  by the CLI. It checks that the receipt and member credential match the
  bound generation, then matches intake to the journal suffix. The replay
  snapshots contain the safe identity, epoch, turn and basis fields.
- The admission port reads held attempts and child allocations by owning
  role and subject, the fix and recheck lanes, and the result of admission
  and serial-review attempts. Fixture-local integers identify model
  subjects.
- The permits port reads the C16 projection, folded attempt and maker
  state, and the worker and job records from the same snapshot. Confirmed
  end or park releases a provider slot. A reported result has a separate
  journal record from helper end and the C16 verdict.

The live worker tests use SQLite, the supervisor tick, CLI acknowledgement
and wait, and scoped intake. The fixture pump controls process observations.
The model adversary supplies or withdraws an answered question through C16
records so it can do so independently of the shared worker's lifecycle.
Every modeled submission runs through `dispatchAct`. The capacity test also
checks a competing real reservation while a fenced process is unresolved
and when confirmed end returns the slot.

Unit 2 ends at worker lifecycle and scoped turns. The park witness and
the admission and permits scheduler observations still use fixture ports
until child, recheck and park records exist. The permits test dispatches
every C16 act through SQLite. The C16 replay remains a separate gate.

The finite permits instance has one provider slot. Its deferred capacity
witness releases the parent's slot on confirmed end. A deferred helper
starting on a separate compatible slot while the parent stays online
requires a broader runtime fixture. Weak fairness in the models gives
liveness under their stated assumptions. A finite replay checks the
concrete selection and progress in its trace.
