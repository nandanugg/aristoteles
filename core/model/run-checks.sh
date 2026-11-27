#!/bin/sh
# Both runners use this registry. Each file exports Case/Mutant via its registry name.
set -eu
cd "$(dirname "$0")"
mode=$1
QUINT=../../node_modules/.bin/quint
registry=checks/registry.tsv
out=${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/aristoteles-${mode}.XXXXXX")}
mkdir -p "$out"
printf '{"workers":%s,"maxHeap":"-Xmx%s"}\n' "${WORKERS:-2}" "${HEAP:-2G}" > "$out/tlc.json"
echo "Logs in $out"
# Fail before starting a check if any row has an unapproved class, an invalid
# deadline, or no case. Each case file is listed once.
awk -F '\t' '
  BEGIN {
    n = split("concurrency,timing,crash,network,duplicate,out of order,corruption,data loss,partial execution,dependency failure,human intervention,config changes", classes, ",")
    for (i = 1; i <= n; i++) allowed[classes[i]] = 1
  }
  /^#/ { next }
  {
    if (NF != 4 || $1 !~ /^[a-z][a-zA-Z0-9]*$/ || seen[$1]++ ||
        $3 != 120 || $4 != 600) {
      print "Invalid model registry row " NR > "/dev/stderr"; exit 1
    }
    n = split($2, classes, ",")
    if (n == 0) exit 1
    for (i = 1; i <= n; i++) if (!(classes[i] in allowed)) {
      print "Unapproved model fault class: " classes[i] > "/dev/stderr"; exit 1
    }
    print $1
  }
  END { if (NR < 2) exit 1 }
' "$registry" > "$out/registered"
for file in checks/*.qnt; do
  name=${file##*/}
  if ! grep -Fxq "${name%.qnt}" "$out/registered"; then
    echo "Unregistered model check: $file" >&2
    exit 1
  fi
done
while IFS= read -r name; do
  test -f "checks/$name.qnt" || { echo "Missing check $name" >&2; exit 1; }
done < "$out/registered"

run() {
  module=$1
  want=$2
  remaining=$((deadline - $(date +%s)))
  log="$out/$module.log"
  if [ "$remaining" -le 0 ]; then
    echo "FAIL $module exceeded cutoff"
    return 1
  fi
  start=$(date +%s)
  if [ "$mode" = tlc ]; then
    set -- verify "$file" --main="$module" --backend=tlc --tlc-config "$out/tlc.json" --invariant=Safety --verbosity=3
    if [ -n "${APALACHE_ENDPOINT:-}" ]; then set -- "$@" --server-endpoint "$APALACHE_ENDPOINT"; fi
  elif [ "$want" = holds ]; then
    set -- run "$file" --main="$module" --invariant=Safety --witnesses Success Fault --verbosity=1 \
      --max-samples=5000 --max-steps=45 --n-threads=1 --seed=0x2a
  else
    set -- run "$file" --main="$module" --invariant=Safety --verbosity=1 \
      --max-samples=5000 --max-steps=45 --n-threads=1 --seed=0x2a
  fi
  code=0
  timeout "$remaining" "$QUINT" "$@" > "$log" 2>&1 </dev/null || code=$?
  secs=$(($(date +%s) - start))
  case "$want" in
    holds) [ "$code" -eq 0 ] && grep -q '^\[ok\]' "$log" && found=1 || found=0 ;;
    breaks) [ "$code" -eq 1 ] && grep -q '^\[violation\]' "$log" && found=1 || found=0 ;;
  esac
  if [ "$found" -eq 0 ]; then
    echo "FAIL $module expected $want (exit $code, ${secs}s, $log)"
    tail -20 "$log"
    return 1
  fi
  if [ "$mode" = sim ] && [ "$want" = holds ]; then
    for witness in Success Fault; do
      if ! grep -Eq "^$witness was witnessed in [1-9][0-9]* trace" "$log"; then
        echo "FAIL $module missing $witness ($log)"
        tail -10 "$log"
        return 1
      fi
    done
  fi
  if [ "$mode" = tlc ]; then
    states=$(sed -n 's/.*states generated, \([0-9,]*\) distinct states found.*/\1/p' "$log" | tail -1)
    test -n "$states" || { echo "FAIL $module missing TLC state count ($log)"; return 1; }
    echo "$want $module ($states distinct states, ${secs}s)"
  else
    echo "$want $module (${secs}s)"
  fi
}

failed=0
selected=0
tab=$(printf '\t')
while IFS="$tab" read -r name classes target cutoff; do
  case "$name" in "#"*) continue ;; esac
  if ! printf '%s\n' "$name" | grep -Eq "${ONLY:-.}"; then continue; fi
  selected=$((selected + 1))
  file="checks/$name.qnt"
  started=$(date +%s)
  deadline=$((started + cutoff))
  run "$name" holds || failed=1
  run "${name}Mutant" breaks || failed=1
  elapsed=$(($(date +%s) - started))
  if [ "$elapsed" -gt "$target" ]; then echo "$name exceeded ${target}s target (${elapsed}s)"; fi
done < "$registry"
[ "$selected" -ne 0 ] || { echo "No model check matched ONLY" >&2; exit 1; }
exit "$failed"
