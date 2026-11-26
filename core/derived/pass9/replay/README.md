# Retained Pass 9 conformance replays

The Quint ITF driver sends an action and its nondeterministic inputs to a runtime port, then compares the projected state at every frame. Failures identify the trace, frame, and action.

| Model | Finite witnesses |
| --- | --- |
| `admission.qnt` | A recheck beside a full fix lane and two concurrent fix admissions. |
| `permits.qnt` | Child recheck, park and resume, and deferral until a compatible slot is available. |

Use `bun test core/effects/pass9-conformance.test.ts` to run these replays. The current onboarding flow also compares live recheck checkpoints, the exact basis and item versions, and consumption of the helper's report with the scheduler fixtures. `sh core/derived/pass9/replay/gen.sh` regenerates the compressed witnesses. The generator looks for a violation of each negated witness predicate.

The admission port reads held fixes and the independent recheck lane. The permits port reads the core state and worker and job observations from the same snapshot. Confirmed end or park releases a provider slot. The helper's report, child release, and final verdict have separate journal records. Finite fixture comparisons and live provider scenarios use different ports.
