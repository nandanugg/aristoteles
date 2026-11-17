#!/bin/sh
# run.sh NAME MODE(safety|live) WORKERS HEAP TIMEOUT [INVARIANTS] [PROPERTIES] [FAIR]: TLC on
# ~/stress/tlc/NAME/NAME.tla; Spec = init, step and fairness FAIR (default the model's
# Fairness); log in NAME/MODE/tlc.log
set -u
n=$1; mode=$2; w=$3; heap=$4; to=$5
[ -n "$n" ] && [ -n "$mode" ] || exit 1
inv=${6:-Sane EveryObligationToldOnce ToldIsAllowed SomethingOwed DoneIsCurrent
  NoDoneBrokenAtEnd NoPassOfBadResult NoLostUpdate NoTakenUndone NoClaimByEnded
  NoRefixAtSameLevel NoEscalationWithoutPerson NotAtCap}
props=${7:-Progress AgentChangesStop}
p=${n}_workenv_
fair=${8:-${p}Fairness}
d=$HOME/stress/tlc/$n/$mode${TAG:+-$TAG}; rm -rf "$d"; mkdir -p "$d"; cd "$d" || exit 1
cp ../$n.tla .
[ -f ../extra.tla ] && cp ../extra.tla .
# DEPTH (env): explore every state up to that many steps (a state constraint on the level).
printf -- '---- MODULE MC ----\nEXTENDS %s, TLC\nSpec == q_init /\\ [][q_step]_%svars /\\ %s\nInDepth == TLCGet("level") < %s\n====\n' \
  $n $p "$fair" "${DEPTH:-1000000}" | sed '$d' > MC.tla
# VIEW (env): the drops for view.sh, safety only. TAG (env): a suffix of the log dir.
[ -n "${VIEW:-}" ] && sh $HOME/stress/tlc/view.sh $n "$VIEW" >> MC.tla
echo "====" >> MC.tla
{ echo "SPECIFICATION Spec"; [ -n "${DEPTH:-}" ] && echo "CONSTRAINT InDepth"
  [ -n "${VIEW:-}" ] && echo "VIEW View"
  if [ "$mode" = safety ]; then for i in $inv; do echo "INVARIANT $p$i"; done
  else for i in $props; do echo "PROPERTY $p$i"; done; fi; } > MC.cfg
J=$HOME/.quint/apalache-dist-0.62.4/apalache/lib/apalache.jar
start=$(date +%s)
timeout "$to" java -Xmx"$heap" -Xss515m -XX:+UseParallelGC -Djava.io.tmpdir="$d" -cp $J \
  tlc2.TLC -deadlock -workers "$w" -metadir "$d/meta" MC.tla > tlc.log 2>&1
echo "exit $? secs $(( $(date +%s) - start ))" >> tlc.log
rm -rf meta
s=$(grep -E 'distinct states found|depth of the complete|violated|Error:|^exit |Progress\(' tlc.log \
  | tail -4 | tr '\n' ' ' | cut -c1-500)
echo "$(date -u +%H:%M) TLC $n $mode depth ${DEPTH:-all} view ${VIEW:-none}: $s" >> $HOME/stress/PROGRESS.md
