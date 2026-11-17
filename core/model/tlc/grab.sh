#!/bin/sh
# grab.sh MODULE: the TLA+ quint writes for TLC, with every invariant and temporal property
# named in INV and TEMP kept; to ~/stress/tlc/MODULE/MODULE.tla. quint starts TLC on it at
# once (w1.json: one worker); the copy is taken as soon as the file appears, then TLC is stopped.
m=$1; o=~/stress/tlc/$m; mkdir -p $o; T=~/stress/tmp/grab-$m; rm -rf $T; mkdir -p $T
~/stress/tlc/extract.sh $m; cd ~/stress/tlc/src/$m
start=$(date +%s)
TMPDIR=$T timeout 3600 node --max-old-space-size=20000 -r ~/stress/tlc/prune.js \
  ~/aristoteles/node_modules/@informalsystems/quint/dist/src/cli.js verify workenv.qnt \
  --main=$m --backend=tlc --tlc-config ~/stress/tlc/w1.json --invariant "$INV" --temporal "$TEMP" \
  --verbosity=3 > $o/grab.log 2>&1 &
pid=$!
while kill -0 $pid 2>/dev/null; do
  f=$(ls $T/quint-tlc-*/$m.tla 2>/dev/null | head -1)
  if [ -n "$f" ]; then
    cp $(dirname $f)/$m.tla $(dirname $f)/$m.cfg $o/
    echo "got $f after $(( $(date +%s) - start ))s"; break
  fi
  sleep 0.3
done
pkill -f "tlc2.TLC.*$m.tla"; wait; echo done
