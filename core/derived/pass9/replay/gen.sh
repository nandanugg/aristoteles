#!/bin/sh
# Replay keeps one finite ITF witness per row. The negated invariant must fail.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$root/core/model"
mkdir -p "$here/traces"
witness() {
  name=$1 file=$2 instance=$3 invariant=$4
  shift 4
  status=0
  "$root/node_modules/.bin/quint" run "$file.qnt" --main="$instance" "$@" \
    --backend=typescript --seed=0x2a --max-samples=1100 --max-steps=100 --mbt \
    --verbosity=1 --invariant="$invariant" --out-itf="$tmp/$name-{seq}.itf.json" \
    >"$tmp/$name.log" 2>&1 || status=$?
  if [ "$status" -eq 0 ] || ! grep -q 'Invariant violated' "$tmp/$name.log" ||
    [ ! -s "$tmp/$name-0.itf.json" ]; then
    cat "$tmp/$name.log" >&2
    echo "witness missing: $name" >&2
    exit 1
  fi
  # Strip wall-clock metadata so regeneration is byte-for-byte reproducible.
  node -e '
    const fs = require("node:fs")
    const trace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    delete trace["#meta"].timestamp
    delete trace["#meta"].description
    process.stdout.write(JSON.stringify(trace) + "\n")
  ' "$tmp/$name-0.itf.json" > "$tmp/$name.normalized"
  gzip -n -9 -c "$tmp/$name.normalized" > "$here/traces/$name.itf.json.gz"
}
witness worker-hearing worker workerFixed NoAllIdentities
witness worker-yield worker workerFixed NoYield
witness worker-park worker workerFixed NoHeardAfterPark
witness worker-stale worker workerFixed NoStaleRefusal
witness admission-lane admission admissionPipeOne NoRecheckBesideFix
witness admission-two-fixes admission admissionPipeTwo NoPipeOverlap
witness admission-wait admission admissionWait NoSaturatedWait
witness admission-serial admission admissionZero NoSerialReview
witness admission-owners admission admissionCollocated NoCollocatedOwners
witness permits-child permits permits NoChild --init=initChild --step=composedStep
witness permits-serial permits permits NoSerial --init=initSerial --step=composedStep
witness permits-admission permits permits NoSecondDenied --init=initAdmission --step=composedStep
witness permits-park permits permits 'not(scheduling.resumed and not(recheckPending))' --init=initPark --step=composedStep
witness permits-defer permits permits 'not(scheduling.deferred and scheduling.resumed and not(recheckPending))' --init=initDefer --step=composedStep
