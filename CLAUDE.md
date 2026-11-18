# aristoteles

## Models: only the latest is tested

- Revising the model means updating the model in place (`core/model/*.qnt`). No old version is kept.
- When a revision replaces a module, delete the old module with its `tlc.sh` lines, mutants and
  tests. Nothing tests a model that is no longer used: no regression runs of replaced modules.
- Run TLC and the simulator only on the latest model's modules.
- Why: CPU and time are limited. Never spend them on something we no longer use. aristoteles is
  v1: no migrations, no compatibility with an older model.
