#!/bin/sh
set -eu
cd "$(dirname "$0")"
case "${1:-}" in
  --remaining) shift; exec sh ./remaining-tlc.sh "$@" ;;
  one) exec sh ./remaining-tlc.sh "$@" ;;
  '') exec sh ./run-checks.sh tlc ;;
  *) echo "usage: tlc.sh [--remaining | one FILE INSTANCE holds|breaks INVARIANTS TEMPORAL]" >&2; exit 2 ;;
esac
