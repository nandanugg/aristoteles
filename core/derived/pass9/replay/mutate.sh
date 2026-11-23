#!/bin/sh
# Mutate the Unit 2 implementation in a disposable copy. A load or setup
# error does not count as a kill. Each mutant must hit its named replay check.
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
for name in ("core", "adapters"):
    shutil.copytree(root / name, scratch / name, ignore=shutil.ignore_patterns("_apalache-out", "tmp"))
for name in ("src", "test", "node_modules", "package.json", "tsconfig.json", "bunfig.toml"):
    (scratch / name).symlink_to(root / name)
test = "adapters/cli/pass9-conformance.test.ts"
worker = "core/derived/c16/worker.ts"
wait = "adapters/cli/commands/wait.ts"
intake = "core/actions/work.ts"
lifecycle = "core/actions/worker.ts"
fold = "core/state/worker-runtime.ts"
mutants = [
    ("newest obligation first", worker, ")[0]", ").at(-1)",
     "wait skipped the oldest ready obligation"),
    ("wrong identity printed", wait,
     "workTokenOf(offer.actor, offer.epoch, memberSecretOf(secret, offer.actor, offer.epoch))",
     'workTokenOf("host", offer.epoch, memberSecretOf(secret, "host", offer.epoch))',
     "wait printed a credential for a different identity"),
    ("withdrawn occurrence reaches C16 intake", intake,
     "if (!currentOffer(folded.state, offer))", "if (false && !currentOffer(folded.state, offer))",
     "expected stale refusal, got heard"),
    ("accept another subject with the same receipt", intake,
     "offer.actor !== actor || offer.epoch !== ep || !matchesStep(call.act.body, offer.step)",
     "offer.actor !== actor || offer.epoch !== ep",
     "expected authority refusal, got stale"),
    ("ignore the offered basis", intake, "if (!privateCall && offer.on !== call.on)",
     "if (!privateCall && call.on === null)", "expected basis refusal, got null"),
    ("retry after the generation was fenced", intake,
     "yield* deliveryOf(call, events, folded, saved.create.delivery)", "void saved.create.delivery",
     "live intake retries only within its authenticated generation"),
    ("release a provider slot on logical fence", lifecycle,
     ".filter(({ reservation, ended }) =>\n      !ended && reservation",
     ".filter(({ reservation, ended, fenced }) =>\n      !ended && !fenced && reservation",
     "live session capacity stays charged while a fenced process is unknown"),
    ("keep a taken turn in the worker fold", fold, "if (taken) {", "if (false && taken) {",
     "folded worker turn differs from the journal"),
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
