# Project model

The model covers the task and review lines, staff sessions and capacity, questions,
owner acceptance, and activation. The ten checks in [the registry](checks/registry.tsv)
exercise those paths with a matching mutant for each safety property. Each check
imports its transitions from [lines](lines.qnt), [people](people.qnt), or
[activation](activation.qnt).

- `bun run spec:check` checks the models and exercises the good and mutant instances
  with the Quint simulator.
- `bun run spec:tlc` explores the same finite instances with TLC. The good instance
  must finish within its registry budget with no violation. Its mutant must produce
  a counterexample.
- `bun run spec:conformance` replays the registered success, fault and mutant
  witnesses against the Project journal implementation.
