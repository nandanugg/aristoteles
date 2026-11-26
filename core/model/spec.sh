#!/bin/sh
set -eu
cd "$(dirname "$0")"
case "${1:-}" in
  --remaining) shift; exec sh ./remaining-spec.sh "$@" ;;
  ''|--check) exec sh ./run-checks.sh sim ;;
  *) echo "usage: spec.sh [--check | --remaining]" >&2; exit 2 ;;
esac
