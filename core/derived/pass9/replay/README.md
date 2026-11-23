# Pass 9 conformance replay

The driver reads Quint ITF traces. It sends only the action and its
nondeterministic inputs to a runtime port, then compares the observed
state with the model at every frame. Failures identify the witness,
frame and action.

| Model | Finite witnesses |
| --- | --- |
| `worker.qnt` | Hear Host, Role and Pipe, yield with work owed, reject a stale printed turn, and hear an obligation carried through park. |
| `admission.qnt` | Recheck beside a saturated fix lane, two simultaneous fixes, wait with a saturated positive child allowance, serial review at zero allowance, and separate role ownership inside one worker. |
| `permits.qnt` | Denied second start, serial review, background child recheck, park/recheck/resume, and deferred recheck after compatible capacity returns. |

Run `bun test core/effects/pass9-conformance.test.ts` for the replay and
the focused journal checks. Run `core/derived/pass9/replay/gen.sh` to
regenerate the compressed witnesses with the pinned Quint dependency.
The generator looks for a violation of each negated witness predicate.
Run `core/derived/pass9/replay/mutate.sh` for the observation-side
mutation checks. It requires each mutation to fail with the expected
diagnostic.

## Runtime inputs

- The worker port reads obligations and the actual printed delivery, then
  matches accepted intake to the journal suffix. It records the observed
  identity, epoch and generation of the supplied credential through the
  fixture's credential labels. Raw credentials and verifiers stay out of
  replay.
- The admission port reads held attempts and child allocations by owning
  role and subject, the fix and recheck lanes, and the result of admission
  and serial-review attempts. Fixture-local integers identify model
  subjects.
- The permits port reads the C16 projection, folded attempt and maker
  state, and the worker and job records from the same snapshot. Confirmed
  end or park releases a provider slot. A reported result has a separate
  journal record from helper end and the C16 verdict.

`core/effects/pass9-conformance-fixtures.ts` currently supplies worker and
scheduler observations in process. The permits test dispatches every
C16 act through the real SQLite store and dispatcher. Connect the live
worker and scheduler ports and run the same witnesses with fixture
terminal and provider processes as those runtime units land. At that
point the relevant implementation faults can be injected in the live
code. Keep the existing C16 suite as a separate regression gate.

The finite permits instance has one provider slot. Its deferred capacity
witness releases the parent's slot on confirmed end. A deferred helper
starting on a separate compatible slot while the parent stays online
requires a broader runtime fixture. Weak fairness in the models gives
liveness under their stated assumptions. A finite replay checks the
concrete selection and progress in its trace.
