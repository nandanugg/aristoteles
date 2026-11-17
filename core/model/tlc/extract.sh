#!/bin/sh
# extract.sh MODULE: a copy of the model with only workenv, cfgs and MODULE (the other
# instance modules make quint flatten and serialize GBs); to ~/stress/tlc/src/MODULE/
m=$1; d=~/stress/tlc/src/$m; rm -rf $d; mkdir -p $d; M=~/aristoteles/core/model
cp $M/work.qnt $M/tmux.qnt $d/
end=$(grep -n "^module cfgs" $M/workenv.qnt | cut -d: -f1)
end=$(awk -v s=$end "NR>s && /^}/ {print NR; exit}" $M/workenv.qnt)
{ sed -n "1,${end}p" $M/workenv.qnt
  awk -v m="module $m {" "\$0==m {p=1} p {print} p && /^}/ {exit}" $M/workenv.qnt; } > $d/workenv.qnt
