#!/bin/sh
# apa.sh MODULE DEPTH TIMEOUT [INVARIANTS]: Apalache (quint verify) on MODULE to DEPTH steps;
# log in ~/stress/apa/MODULE-DEPTH.log. One at a time (JVM_ARGS heap 8g).
set -u
m=$1; k=$2; to=$3
inv=${4:-Sane NoLostUpdate NoPassOfBadResult NoShallowEvaluation RevisionHasContext
  NoMergedInput DoneIsCurrent NoDoneBrokenAtEnd NoTakenUndone}
o=$HOME/stress/apa; mkdir -p $o; T=$HOME/stress/tmp/apa-$m; rm -rf $T; mkdir -p $T
$HOME/stress/tlc/extract.sh $m; cd $HOME/stress/tlc/src/$m || exit 1
start=$(date +%s)
JVM_ARGS=-Xmx8g TMPDIR=$T timeout "$to" node --max-old-space-size=16000 -r $HOME/stress/tlc/prune.js \
  $HOME/aristoteles/node_modules/@informalsystems/quint/dist/src/cli.js verify workenv.qnt \
  --main=$m --max-steps=$k --invariants $inv --verbosity=3 \
  > $o/$m-$k.log 2>&1
echo "exit $? secs $(( $(date +%s) - start ))" >> $o/$m-$k.log
s=$(grep -E '^\[|❌|error|exit ' $o/$m-$k.log | tail -4 | tr '\n' ' ' | cut -c1-300)
echo "$(date -u +%H:%M) Apalache $m depth $k: $s" >> $HOME/stress/PROGRESS.md
