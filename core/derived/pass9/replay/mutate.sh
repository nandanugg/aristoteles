#!/bin/sh
# Mutate the observation-side implementation in a disposable copy. A load or setup
# error does not count as a kill. Wire the real pass 9 runtime into these witnesses
# when its unit lands so implementation mutants can target it directly.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
python3 - "$root" "$scratch" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys

root, scratch = map(Path, sys.argv[1:])
shutil.copytree(root / "core", scratch / "core", ignore=shutil.ignore_patterns("_apalache-out", "tmp"))
for name in ("src", "test", "adapters", "node_modules", "package.json", "tsconfig.json", "bunfig.toml"):
    (scratch / name).symlink_to(root / name)
test = "core/effects/pass9-conformance.test.ts"
fixture = "core/effects/pass9-conformance-fixtures.ts"
journal = "core/derived/pass9/replay/journal.ts"
mutants = [
    ("newest obligation first", fixture, "owed.values().next().value", "[...owed.values()].at(-1)",
     "wait skipped the oldest ready obligation"),
    ("wrong identity is printed", fixture, "tokenActor: scope.actor,", "tokenActor: 'Host',",
     "wait printed a credential for a different identity"),
    ("stale wait treated as successful retry", fixture, "outcome: accepted ? 'taken' : 'refused',",
     "outcome: accepted ? 'taken' : 'retry',", "model submission requires a fresh intake outcome"),
    ("rechecks take a fix permit", fixture, "rechecks.add(2)", "rechecks.add(2); fixes.add(2)",
     "Pipe fix cap exceeded"),
    ("role permit charged to the resident role", fixture, "attempts.set(command.task, r)",
     "attempts.set(command.task, 0)", "allocation charged to a different role"),
    ("release slot on logical fence", journal, "w.state !== 'Exited' && w.state !== 'Parked'",
     "w.state !== 'Exited' && w.state !== 'Parked' && w.state !== 'Fenced'", "fenced allocation until confirmation"),
    ("helper report releases its child", journal,
     "jobs.set(event.job, { ...job, report: event.report })",
     "jobs.set(event.job, { ...job, report: event.report }); children.delete(job.allocation ?? '')",
     "separates helper report, child release, and verdict"),
]

def run():
    process = subprocess.run(["bun", "test", test], cwd=scratch, capture_output=True, text=True)
    return process.returncode, process.stdout + process.stderr

code, out = run()
if code:
    print(out)
    raise SystemExit("unmutated replay failed")
survived = 0
for name, path, old, new, diagnostic in mutants:
    source = scratch / path
    original = source.read_text()
    if original.count(old) != 1:
        raise SystemExit(f"mutation site not unique: {name}")
    source.write_text(original.replace(old, new))
    try:
        code, out = run()
        failed = [line for line in out.splitlines() if line.startswith("(fail) pass 9 ")]
        if code != 0 and failed and diagnostic in out:
            print(f"caught: {name} ({failed[0]})")
        else:
            print(f"{'BROKEN' if code else 'SURVIVED'}: {name}\n{out}")
            survived += 1
    finally:
        source.write_text(original)
print(f"{len(mutants) - survived} of {len(mutants)} caught")
raise SystemExit(bool(survived))
PY
