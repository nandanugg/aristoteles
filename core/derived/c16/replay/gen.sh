#!/bin/sh
# Regenerates the stored traces of the model's simulator (quint run --mbt keeps the act of each
# step): 20 per instance, seed fixed, each gzipped. Run from anywhere; needs the committed model.
set -e
here=$(cd "$(dirname "$0")" && pwd)
model="$here/../../../model"
out="$here/traces"
tmp=$(mktemp -d)
mkdir -p "$out"
cd "$model"
for instance in coreTwo coreLoops coreWhereContext; do
  npx quint run configs.qnt --main="$instance" --max-samples=20 --n-traces=20 --max-steps=80 \
    --seed=7 --mbt --out-itf="$tmp/$instance-{seq}.itf.json" > /dev/null
  for f in "$tmp/$instance"-*.itf.json; do
    gzip -9 -n -c "$f" > "$out/$(basename "$f").gz"
  done
done
rm -r "${tmp:?}"
