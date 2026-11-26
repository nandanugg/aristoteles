#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
cd "$root"
registry=core/model/checks/registry.tsv
check=${1:-taskReportRace}
if ! awk -F '\t' -v check="$check" '$1 == check && NF == 4 { found = 1 } END { exit !found }' "$registry"; then
  echo "Unregistered check: $check" >&2
  exit 1
fi
file="core/model/checks/$check.qnt"
revision=$(git log -1 --format=%H -- "$file" core/model/lines.qnt core/model/people.qnt core/model/activation.qnt)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
out=${REPLAY_OUT:-$here/traces}
mkdir -p "$out"

witness() {
  kind=$1
  instance=$2
  invariant=$3
  status=0
  seed=0x2a
  # The capacity fault includes an actual plan replacement before the stale start.
  if [ "$check:$kind" = 'staffCapacity:fault' ]; then seed=31; fi
  "$root/node_modules/.bin/quint" run "$file" --main="$instance" \
    --backend=typescript --seed="$seed" --max-samples=5000 --max-steps=45 --n-threads=1 \
    --mbt --verbosity=1 --invariant="$invariant" --out-itf="$tmp/$kind-{seq}.itf.json" \
    >"$tmp/$kind.log" 2>&1 || status=$?
  if [ "$status" -ne 1 ] || ! grep -q 'Invariant violated' "$tmp/$kind.log" ||
     [ ! -s "$tmp/$kind-0.itf.json" ]; then
    cat "$tmp/$kind.log" >&2
    echo "Missing witness: $check/$kind" >&2
    exit 1
  fi
  bun -e '
    const [path, modelRevision] = Bun.argv.slice(1)
    const trace = await Bun.file(path).json()
    delete trace["#meta"].timestamp
    delete trace["#meta"].description
    trace["#meta"].modelRevision = modelRevision
    if (trace["#meta"].status !== "violation" || trace.states.length < 2)
      throw new Error("Missing violation trace")
    console.log(JSON.stringify(trace))
  ' "$tmp/$kind-0.itf.json" "$revision" >"$tmp/$kind.normalized"
  gzip -n -9 -c "$tmp/$kind.normalized" >"$tmp/$check-$kind.itf.json.gz"
}

witness success "$check" 'not(Success)'
witness fault "$check" 'not(Fault)'
witness mutant "${check}Mutant" Safety
for fixture in "$tmp/$check-"*.itf.json.gz; do
  mv "$fixture" "$out/"
done
