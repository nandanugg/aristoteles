#!/bin/sh
# probes.sh NAME DEPTH: TLC safety to DEPTH with each VIEW; the distinct states of each.
n=$1; D=$2
for v in none ev ev,dead ev,dead,pview ev,dead,ptodo ev,dead,timers ev,dead,g ev,dead,page \
    ev,dead,net ev,dead,pview,ptodo,timers,g; do
  t=d$D-$(echo $v | tr ',' '+')
  if [ $v = none ]; then DEPTH=$D TAG=$t ~/stress/tlc/run.sh $n safety 12 16g 3600
  else DEPTH=$D VIEW=$v TAG=$t ~/stress/tlc/run.sh $n safety 12 16g 3600; fi
  l=~/stress/tlc/$n/safety-$t/tlc.log
  echo "$n depth<$D view=$v: $(grep -E 'distinct states found, ' $l) $(grep -E '^exit' $l)" \
    >> ~/stress/probes.txt
done
